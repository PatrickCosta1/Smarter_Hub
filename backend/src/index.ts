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

app.use(
  cors({
    origin: process.env.FRONTEND_URL ?? "*"
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
