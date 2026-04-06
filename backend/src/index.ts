import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { ZodError } from "zod";

import { authRouter } from "./routes/auth.js";
import { notificationsRouter } from "./routes/notifications.js";
import { profileRouter } from "./routes/profile.js";
import { usersRouter } from "./routes/users.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 4000);

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

const allowedOrigins = (process.env.FRONTEND_URL ?? '')
  .split(',')
  .map((item) => normalizeOrigin(item))
  .filter(Boolean);

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

app.get("/health", (_req, res) => {
  return res.json({ status: "ok" });
});

app.use("/api", authRouter);
app.use("/api", usersRouter);
app.use("/api", profileRouter);
app.use("/api", notificationsRouter);

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
