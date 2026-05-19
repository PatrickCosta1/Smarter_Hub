import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

import { prisma } from "../lib/prisma.js";
import type { AuthUser, JwtPayload } from "../types/auth.js";

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error('JWT_SECRET não está configurado.');
  }
  return secret;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Token de autenticacao em falta." });
  }

  const token = authHeader.replace("Bearer ", "").trim();

  try {
    const payload = jwt.verify(token, getJwtSecret()) as JwtPayload;

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        isActive: true,
        isRootAccess: true,
          hasAccessTotal: true,
      }
    });

    if (!user) {
      return res.status(401).json({ message: "Sessao invalida." });
    }

    if (!user.isActive) {
      return res.status(403).json({ message: 'Conta inativa. Contacta RH para mais informações.' });
    }

    req.authUser = user;
    return next();
  } catch {
    return res.status(401).json({ message: "Token invalido ou expirado." });
  }
}

export function signAuthToken(user: AuthUser) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role,
      isRootAccess: user.isRootAccess,
      hasAccessTotal: Boolean(user.hasAccessTotal),
    },
    getJwtSecret(),
    { expiresIn: "8h" }
  );
}
