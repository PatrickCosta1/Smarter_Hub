import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import path from "path";
import { ZodError } from "zod";

import { authRouter } from "./routes/auth.js";
import { filesRouter } from "./routes/files.js";
import { permissionsRouter } from "./routes/permissions.js";
import { notificationsRouter } from "./routes/notifications.js";
import { profileRouter } from "./routes/profile.js";
import { trainingsRouter } from "./routes/trainings.js";
import { usersRouter } from "./routes/users.js";
import { vacationsRouter } from "./routes/vacations.js";
import { prisma } from './lib/prisma.js';
import { runCitizenCardExpiryNotificationSweep } from './lib/citizen-card-expiry-notifications.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 4000);
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
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));

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

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function runCitizenCardExpirySweepSafely() {
  try {
    const result = await runCitizenCardExpiryNotificationSweep(prisma);
    console.log(`[CC_EXPIRY_SWEEP] scanned=${result.scannedUsers} eligible=${result.eligibleUsers} created=${result.createdNotifications}`);
  } catch (error) {
    console.error('[CC_EXPIRY_SWEEP] failed', error);
  }
}

void runCitizenCardExpirySweepSafely();
setInterval(() => {
  void runCitizenCardExpirySweepSafely();
}, ONE_DAY_MS);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
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
  console.log(`API a correr em http://localhost:${port}`);
});
