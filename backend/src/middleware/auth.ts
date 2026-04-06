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
  return process.env.JWT_SECRET ?? "smarter-hub-dev-secret";
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
        role: true
      }
    });

    if (!user) {
      return res.status(401).json({ message: "Sessao invalida." });
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
      role: user.role
    },
    getJwtSecret(),
    { expiresIn: "8h" }
  );
}
