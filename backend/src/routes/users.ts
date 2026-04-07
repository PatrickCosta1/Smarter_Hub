import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const roleSchema = z.enum(['COLABORADOR', 'MANAGER', 'COORDENADOR', 'ADMIN', 'CONVIDADO']);
const countrySchema = z.enum(['PT', 'BR']);

const createUserSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(4),
  email: z.string().email(),
  fullName: z.string().min(2),
  role: roleSchema.optional(),
  teamId: z.string().optional(),
});

const updateAdminUserSchema = z.object({
  role: roleSchema.optional(),
  teamId: z.string().nullable().optional(),
  workCountry: countrySchema.optional(),
  localidade: z.string().optional(),
});

function requireAdmin(reqRole: string) {
  return reqRole === 'ADMIN';
}

router.get('/users', requireAuth, async (req, res) => {
  if (!['MANAGER', 'COORDENADOR', 'ADMIN'].includes(req.authUser!.role)) {
    return res.status(403).json({ message: 'Sem permissões para consultar utilizadores.' });
  }

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const email = typeof req.query.email === 'string' ? req.query.email : undefined;
  const parsedLimit = Number(typeof req.query.limit === 'string' ? req.query.limit : '40');
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 40;

  const users = await prisma.user.findMany({
    where: {
      ...(email ? { email } : {}),
      role: {
        in: ['COLABORADOR', 'MANAGER', 'COORDENADOR'],
      },
      ...(q
        ? {
            OR: [
              { username: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              { profile: { primeiroNome: { contains: q, mode: 'insensitive' } } },
              { profile: { apelido: { contains: q, mode: 'insensitive' } } },
              { profile: { cargo: { contains: q, mode: 'insensitive' } } },
              { profile: { funcao: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
      ...(req.authUser!.role === 'MANAGER'
        ? {
            team: {
              managerId: req.authUser!.id,
            },
          }
        : {}),
      ...(req.authUser!.role === 'COORDENADOR'
        ? {
            team: {
              coordinatorId: req.authUser!.id,
            },
          }
        : {}),
    },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      teamId: true,
      team: { select: { id: true, name: true } },
      profile: {
        select: {
          primeiroNome: true,
          apelido: true,
          cargo: true,
          funcao: true,
          workCountry: true,
          localidade: true,
        },
      },
    },
    take: limit,
    orderBy: {
      createdAt: 'desc',
    },
  });

  return res.json(users);
});

router.get('/teams', requireAuth, async (req, res) => {
  if (!['COORDENADOR', 'ADMIN', 'MANAGER'].includes(req.authUser!.role)) {
    return res.status(403).json({ message: 'Sem permissões para consultar equipas.' });
  }

  const teams = await prisma.team.findMany({
    where:
      req.authUser!.role === 'MANAGER'
        ? { managerId: req.authUser!.id }
        : req.authUser!.role === 'COORDENADOR'
          ? { coordinatorId: req.authUser!.id }
          : undefined,
    select: {
      id: true,
      name: true,
      country: true,
      managerId: true,
      coordinatorId: true,
      manager: { select: { id: true, username: true } },
      coordinator: { select: { id: true, username: true } },
      _count: { select: { members: true } },
    },
    orderBy: { name: 'asc' },
  });

  return res.json(teams);
});

router.get('/admin/users', requireAuth, async (req, res) => {
  if (!requireAdmin(req.authUser!.role)) {
    return res.status(403).json({ message: 'Apenas admin pode gerir perfis.' });
  }

  const users = await prisma.user.findMany({
    include: {
      team: { select: { id: true, name: true } },
      profile: {
        select: {
          primeiroNome: true,
          apelido: true,
          workCountry: true,
          localidade: true,
        },
      },
    },
    orderBy: [{ role: 'asc' }, { username: 'asc' }],
  });

  return res.json(users.map((user) => ({
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    teamId: user.teamId,
    teamName: user.team?.name ?? null,
    workCountry: user.profile?.workCountry ?? 'PT',
    localidade: user.profile?.localidade ?? '',
  })));
});

router.patch('/admin/users/:id', requireAuth, async (req, res) => {
  if (!requireAdmin(req.authUser!.role)) {
    return res.status(403).json({ message: 'Apenas admin pode gerir perfis.' });
  }

  const userId = String(req.params.id || '');
  const payload = updateAdminUserSchema.safeParse(req.body);

  if (!payload.success) {
    return res.status(400).json({ message: payload.error.issues[0].message });
  }

  const data = payload.data;
  const existing = await prisma.user.findUnique({ where: { id: userId } });

  if (!existing) {
    return res.status(404).json({ message: 'Utilizador não encontrado.' });
  }

  if (data.role === 'ADMIN') {
    data.teamId = null;
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(data.role ? { role: data.role } : {}),
      ...(data.teamId !== undefined ? { teamId: data.teamId } : {}),
    },
  });

  if (data.workCountry || data.localidade !== undefined) {
    await prisma.profile.upsert({
      where: { userId },
      update: {
        ...(data.workCountry ? { workCountry: data.workCountry } : {}),
        ...(data.localidade !== undefined ? { localidade: data.localidade } : {}),
      },
      create: {
        userId,
        workCountry: data.workCountry ?? 'PT',
        localidade: data.localidade ?? '',
      },
    });
  }

  return res.json({
    id: updatedUser.id,
    role: updatedUser.role,
    teamId: updatedUser.teamId,
  });
});

router.post('/users', async (req, res, next) => {
  try {
    const data = createUserSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(data.password, 10);

    const user = await prisma.user.create({
      data: {
        username: data.username.trim().toLowerCase(),
        email: data.email,
        passwordHash,
        role: data.role ?? 'COLABORADOR',
        teamId: data.teamId,
        profile: {
          create: {
            primeiroNome: data.fullName,
          },
        },
      },
      include: {
        profile: true,
      },
    });

    const { passwordHash: _ignored, ...safeUser } = user;

    return res.status(201).json(safeUser);
  } catch (error) {
    return next(error);
  }
});

export { router as usersRouter };
