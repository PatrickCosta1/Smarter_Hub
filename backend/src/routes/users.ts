import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { prisma } from "../lib/prisma.js";

const router = Router();
const roleSchema = z.enum(["COLABORADOR", "COORDENADOR", "RH", "ADMIN", "CONVIDADO"]);

const createUserSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(4),
  email: z.string().email(),
  fullName: z.string().min(2),
  role: roleSchema.optional()
});

router.get("/users", async (req, res) => {
  const email = typeof req.query.email === "string" ? req.query.email : undefined;

  const users = await prisma.user.findMany({
    where: email ? { email } : undefined,
    include: {
      profile: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return res.json(users);
});

router.post("/users", async (req, res, next) => {
  try {
    const data = createUserSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(data.password, 10);

    const user = await prisma.user.create({
      data: {
        username: data.username.trim().toLowerCase(),
        email: data.email,
        passwordHash,
        role: data.role ?? "COLABORADOR",
        profile: {
          create: {
            primeiroNome: data.fullName
          }
        }
      },
      include: {
        profile: true,
      }
    });

    const { passwordHash: _ignored, ...safeUser } = user;

    return res.status(201).json(safeUser);
  } catch (error) {
    return next(error);
  }
});

export { router as usersRouter };
