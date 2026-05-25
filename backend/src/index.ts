import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import * as Sentry from '@sentry/node';
import swaggerUi from 'swagger-ui-express';
import { ZodError } from "zod";

import { authRouter } from "./routes/auth.js";
import { filesRouter, uploadsRouter } from "./routes/files.js";
import { permissionsRouter } from "./routes/permissions.js";
import { notificationsRouter } from "./routes/notifications.js";
import { profileRouter } from "./routes/profile.js";
import { trainingsRouter } from "./routes/trainings.js";
import { usersRouter } from "./routes/users.js";
import { vacationsRouter } from "./routes/vacations.js";
import { hourBankRouter } from './routes/hour-bank.js';
import { wellbeingRouter } from './routes/wellbeing.js';
import { careerPlanRouter } from './routes/career-plan.js';
import { performanceReviewRouter } from './routes/performance-review.js';
import { prisma } from './lib/prisma.js';
import { runCitizenCardExpiryNotificationSweep } from './lib/citizen-card-expiry-notifications.js';
import { runJanuaryIrsAlertSweep } from './lib/january-irs-alerts.js';
import { openApiSpec } from './lib/openapi.js';
import { runWeeklyHourBankReportSweep } from './lib/hour-bank.js';
import { runOccupationalHealthAlertSweep } from './lib/occupational-health-alerts.js';
import { runUpcomingTrainingsMonthlySweep } from './lib/trainings-monthly-report.js';

dotenv.config();

if (!process.env.JWT_SECRET?.trim()) {
  throw new Error('JWT_SECRET é obrigatório para iniciar a API.');
}

const app = express();
const port = Number(process.env.PORT ?? 4000);
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const sentryDsn = process.env.SENTRY_DSN?.trim();
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  });
}

const defaultAllowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'https://smarterhub.netlify.app',
];

function normalizeOrigin(origin: string) {
  const value = origin.trim();

  if (!value) {
    return '';
  }

  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }

  return `https://${value}`;
}

const envAllowedOrigins = (process.env.FRONTEND_URL ?? '')
  .split(',')
  .map((item) => normalizeOrigin(item))
  .filter(Boolean);

const allowedOrigins = Array.from(new Set([...defaultAllowedOrigins, ...envAllowedOrigins]));

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Muitas tentativas de autenticação. Tenta novamente em alguns minutos.',
  },
});

const writeRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.WRITE_RATE_LIMIT_MAX ?? 120),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Limite de pedidos temporariamente excedido. Tenta novamente em instantes.',
  },
});

app.use(helmet({
  crossOriginResourcePolicy: false,
}));
app.use(pinoHttp({ logger }));

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin não permitida por CORS: ${origin}`));
    }
  })
);
app.use(express.json());
app.use('/uploads', uploadsRouter);
app.use('/api', writeRateLimiter);
app.use('/api/auth/login', authRateLimiter);
app.use('/api/auth/microsoft', authRateLimiter);

app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, { explorer: true }));
app.get('/openapi.json', (_req, res) => {
  return res.json(openApiSpec);
});

app.get("/health", (_req, res) => {
  return res.json({ status: "ok" });
});

app.use("/api", authRouter);
app.use("/api", usersRouter);
app.use("/api", permissionsRouter);
app.use("/api", filesRouter);
app.use("/api", profileRouter);
app.use("/api", trainingsRouter);
app.use("/api", vacationsRouter);
app.use("/api", notificationsRouter);
app.use('/api', hourBankRouter);
app.use('/api', wellbeingRouter);
app.use('/api', careerPlanRouter);
app.use('/api', performanceReviewRouter);

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function runCitizenCardExpirySweepSafely() {
  try {
    const result = await runCitizenCardExpiryNotificationSweep(prisma);
    logger.info({
      event: 'cc-expiry-sweep',
      scanned: result.scannedUsers,
      eligible: result.eligibleUsers,
      created: result.createdNotifications,
    }, 'Citizen card expiry sweep completed');
  } catch (error) {
    logger.error({ err: error }, 'Citizen card expiry sweep failed');
    Sentry.captureException(error);
  }
}

void runCitizenCardExpirySweepSafely();
setInterval(() => {
  void runCitizenCardExpirySweepSafely();
}, ONE_DAY_MS);

async function runJanuaryIrsAlertSweepSafely() {
  try {
    const result = await runJanuaryIrsAlertSweep(prisma);
    if (result.skipped) {
      logger.info({ event: 'january-irs-sweep', skipped: true, reason: result.reason }, 'January IRS sweep skipped');
    } else {
      logger.info({
        event: 'january-irs-sweep',
        skipped: false,
        scanned: result.scannedUsers,
        created: result.createdNotifications,
      }, 'January IRS sweep completed');
    }
  } catch (error) {
    logger.error({ err: error }, 'January IRS sweep failed');
    Sentry.captureException(error);
  }
}

void runJanuaryIrsAlertSweepSafely();
setInterval(() => {
  void runJanuaryIrsAlertSweepSafely();
}, ONE_DAY_MS);

async function runWeeklyHourBankReportSweepSafely() {
  try {
    const result = await runWeeklyHourBankReportSweep(prisma);
    if (result.skipped) {
      logger.info({ event: 'hour-bank-weekly-sweep', skipped: true, reason: result.reason }, 'Hour bank weekly sweep skipped');
    } else {
      logger.info({
        event: 'hour-bank-weekly-sweep',
        skipped: false,
        created: result.createdNotifications,
      }, 'Hour bank weekly sweep completed');
    }
  } catch (error) {
    logger.error({ err: error }, 'Hour bank weekly sweep failed');
    Sentry.captureException(error);
  }
}

void runWeeklyHourBankReportSweepSafely();
setInterval(() => {
  void runWeeklyHourBankReportSweepSafely();
}, ONE_DAY_MS);

async function runOccupationalHealthAlertSweepSafely() {
  try {
    const result = await runOccupationalHealthAlertSweep(prisma);
    if (result.skipped) {
      logger.info({ event: 'occupational-health-sweep', skipped: true, reason: result.reason }, 'Occupational health sweep skipped');
    } else {
      logger.info({
        event: 'occupational-health-sweep',
        skipped: false,
        scanned: result.scannedUsers,
        created: result.createdNotifications,
      }, 'Occupational health sweep completed');
    }
  } catch (error) {
    logger.error({ err: error }, 'Occupational health sweep failed');
    Sentry.captureException(error);
  }
}

void runOccupationalHealthAlertSweepSafely();
setInterval(() => {
  void runOccupationalHealthAlertSweepSafely();
}, ONE_DAY_MS);

async function runTrainingsMonthlySweepSafely() {
  try {
    const result = await runUpcomingTrainingsMonthlySweep(prisma);
    logger.info({ event: 'trainings-monthly-sweep', ...result }, 'Trainings monthly sweep finished');
  } catch (error) {
    logger.error({ err: error }, 'Trainings monthly sweep failed');
    Sentry.captureException(error);
  }
}

void runTrainingsMonthlySweepSafely();
setInterval(() => {
  void runTrainingsMonthlySweepSafely();
}, ONE_DAY_MS);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err: error }, 'Unhandled request error');
  Sentry.captureException(error);

  if (error instanceof ZodError) {
    return res.status(400).json({
      message: "Payload invalido.",
      issues: error.issues
    });
  }

  if (error instanceof Error) {
    return res.status(400).json({ message: error.message });
  }

  return res.status(500).json({ message: "Erro interno do servidor." });
});

app.listen(port, () => {
  logger.info({ port }, 'API a correr');
});
