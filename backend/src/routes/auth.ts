import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { requireAuth, signAuthToken } from "../middleware/auth.js";

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

router.post("/auth/login", async (req, res, next) => {
  try {
    const { username, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { username: username.trim().toLowerCase() },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        passwordHash: true
      }
    });

    if (!user) {
      return res.status(401).json({ message: "Credenciais invalidas." });
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      return res.status(401).json({ message: "Credenciais invalidas." });
    }

    const token = signAuthToken({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role
    });

    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/auth/me", requireAuth, async (req, res) => {
  return res.json({ user: req.authUser });
});

export { router as authRouter };
