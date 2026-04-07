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

const updateAccountSchema = z
  .object({
    username: z.string().min(3).optional(),
    currentPassword: z.string().min(1),
    newPassword: z.string().min(4).optional(),
  })
  .refine((data) => Boolean(data.username?.trim()) || Boolean(data.newPassword?.trim()), {
    message: 'Indica um novo username ou uma nova password.',
    path: ['username'],
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

router.patch('/auth/account', requireAuth, async (req, res, next) => {
  try {
    const { username, currentPassword, newPassword } = updateAccountSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { id: req.authUser!.id },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        passwordHash: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'Utilizador não encontrado.' });
    }

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isCurrentPasswordValid) {
      return res.status(401).json({ message: 'Password atual incorreta.' });
    }

    const nextUsername = username?.trim().toLowerCase() || user.username;

    if (nextUsername !== user.username) {
      const existingByUsername = await prisma.user.findUnique({ where: { username: nextUsername } });
      if (existingByUsername && existingByUsername.id !== user.id) {
        return res.status(409).json({ message: 'Esse username já está em uso.' });
      }
    }

    const nextPasswordHash = newPassword ? await bcrypt.hash(newPassword, 10) : user.passwordHash;

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        username: nextUsername,
        passwordHash: nextPasswordHash,
      },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
      },
    });

    const token = signAuthToken(updatedUser);

    return res.json({
      token,
      user: updatedUser,
    });
  } catch (error) {
    return next(error);
  }
});

export { router as authRouter };
