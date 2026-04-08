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

const updateAdminMembershipsSchema = z.object({
  memberships: z.array(z.object({
    teamId: z.string().min(1),
    membershipRole: z.string().optional(),
    isApprover: z.boolean().optional(),
    approvalLevel: z.number().int().positive().optional(),
    isActive: z.boolean().optional(),
  })).default([]),
});

const adminTeamSchema = z.object({
  name: z.string().min(2),
  country: countrySchema.default('PT'),
  managerId: z.string().nullable().optional(),
  coordinatorId: z.string().nullable().optional(),
  parentTeamId: z.string().nullable().optional(),
});

const managerTeamMemberUpdateSchema = z.object({
  teamId: z.string().nullable().optional(),
  cargo: z.string().optional(),
  funcao: z.string().optional(),
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
            OR: [
              {
                team: {
                  managerId: req.authUser!.id,
                },
              },
              {
                teamMemberships: {
                  some: {
                    isActive: true,
                    team: { managerId: req.authUser!.id },
                  },
                },
              },
            ],
          }
        : {}),
      ...(req.authUser!.role === 'COORDENADOR'
        ? {
            OR: [
              {
                team: {
                  coordinatorId: req.authUser!.id,
                },
              },
              {
                teamMemberships: {
                  some: {
                    isActive: true,
                    team: { coordinatorId: req.authUser!.id },
                  },
                },
              },
            ],
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
      teamMemberships: {
        where: { isActive: true },
        select: {
          teamId: true,
          membershipRole: true,
          isApprover: true,
          approvalLevel: true,
          team: { select: { id: true, name: true } },
        },
      },
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

router.get('/users/me/teams', requireAuth, async (req, res) => {
  const userId = req.authUser!.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      teamId: true,
      team: { select: { id: true, name: true } },
      teamMemberships: {
        where: { isActive: true },
        select: {
          teamId: true,
          membershipRole: true,
          isApprover: true,
          approvalLevel: true,
          team: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!user) {
    return res.status(404).json({ message: 'Utilizador não encontrado.' });
  }

  const teamMap = new Map<string, {
    teamId: string;
    teamName: string;
    membershipRole: string;
    isApprover: boolean;
    approvalLevel: number | null;
    isPrimary: boolean;
  }>();

  for (const item of user.teamMemberships) {
    teamMap.set(item.teamId, {
      teamId: item.teamId,
      teamName: item.team.name,
      membershipRole: item.membershipRole,
      isApprover: item.isApprover,
      approvalLevel: item.approvalLevel,
      isPrimary: user.teamId === item.teamId,
    });
  }

  if (user.teamId && user.team) {
    const existing = teamMap.get(user.teamId);
    if (existing) {
      existing.isPrimary = true;
      teamMap.set(user.teamId, existing);
    } else {
      teamMap.set(user.teamId, {
        teamId: user.team.id,
        teamName: user.team.name,
        membershipRole: 'PARTICIPANT',
        isApprover: false,
        approvalLevel: null,
        isPrimary: true,
      });
    }
  }

  return res.json(Array.from(teamMap.values()).sort((a, b) => a.teamName.localeCompare(b.teamName, 'pt-PT')));
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
      _count: { select: { members: true, memberships: true } },
    },
    orderBy: { name: 'asc' },
  });

  return res.json(
    teams.map((team) => ({
      ...team,
      _count: {
        members: Math.max(team._count.members, team._count.memberships),
        memberships: team._count.memberships,
      },
    })),
  );
});

router.get('/teams/me', requireAuth, async (req, res) => {
  const role = req.authUser!.role;
  const userId = req.authUser!.id;
  const detailsMode = typeof req.query.details === 'string' ? req.query.details.toLowerCase() : 'full';
  const includeMembers = detailsMode !== 'none';
  const year = Number(typeof req.query.year === 'string' ? req.query.year : new Date().getFullYear());
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const teamWhere =
    role === 'ADMIN'
      ? undefined
      : role === 'MANAGER'
        ? {
            OR: [
              { managerId: userId },
              { memberships: { some: { userId, isActive: true } } },
            ],
          }
        : role === 'COORDENADOR'
          ? {
              OR: [
                { coordinatorId: userId },
                { memberships: { some: { userId, isActive: true } } },
              ],
            }
          : {
              OR: [
                { memberships: { some: { userId, isActive: true } } },
                { members: { some: { id: userId } } },
              ],
            };

  if (!includeMembers) {
    const teams = await prisma.team.findMany({
      where: teamWhere,
      select: {
        id: true,
        name: true,
        country: true,
        parentTeamId: true,
        manager: {
          select: {
            id: true,
            username: true,
            profile: { select: { primeiroNome: true, apelido: true } },
          },
        },
        coordinator: {
          select: {
            id: true,
            username: true,
            profile: { select: { primeiroNome: true, apelido: true } },
          },
        },
        parentTeam: { select: { id: true, name: true } },
        _count: { select: { memberships: true } },
      },
      orderBy: { name: 'asc' },
    });

    return res.json(teams.map((team) => ({
      ...team,
      _count: {
        members: team._count.memberships,
        memberships: team._count.memberships,
      },
    })));
  }

  const teams = await prisma.team.findMany({
    where: teamWhere,
    select: {
      id: true,
      name: true,
      country: true,
      managerId: true,
      coordinatorId: true,
      parentTeamId: true,
      manager: {
        select: {
          id: true,
          username: true,
          profile: { select: { primeiroNome: true, apelido: true } },
        },
      },
      coordinator: {
        select: {
          id: true,
          username: true,
          profile: { select: { primeiroNome: true, apelido: true } },
        },
      },
      parentTeam: { select: { id: true, name: true } },
      memberships: {
        where: { isActive: true },
        select: {
          userId: true,
          membershipRole: true,
          isApprover: true,
          approvalLevel: true,
          user: {
            select: {
              id: true,
              username: true,
              email: true,
              role: true,
              teamId: true,
              profile: {
                select: {
                  primeiroNome: true,
                  apelido: true,
                  cargo: true,
                  funcao: true,
                },
              },
              vacations: {
                where: {
                  AND: [
                    { dataInicio: { lte: yearEnd } },
                    { dataFim: { gte: yearStart } },
                  ],
                },
                select: {
                  id: true,
                  dataInicio: true,
                  dataFim: true,
                  status: true,
                  requestType: true,
                  partialDay: true,
                  reviewReason: true,
                  attachmentLink: true,
                  contextTeamId: true,
                  versionNumber: true,
                  contextTeam: { select: { id: true, name: true } },
                },
                orderBy: [{ dataInicio: 'desc' }, { createdAt: 'desc' }],
              },
            },
          },
        },
      },
      _count: { select: { memberships: true } },
    },
    orderBy: { name: 'asc' },
  });

  return res.json(teams.map((team) => ({
    ...team,
    members: team.memberships.map((membership) => ({
      id: membership.user.id,
      username: membership.user.username,
      email: membership.user.email,
      role: membership.user.role,
      teamId: membership.user.teamId,
      profile: membership.user.profile,
      membershipRole: membership.membershipRole,
      isApprover: membership.isApprover,
      approvalLevel: membership.approvalLevel,
      vacations: membership.user.vacations,
    })),
    _count: {
      members: team._count.memberships,
      memberships: team._count.memberships,
    },
  })));
});

router.get('/teams/me/:teamId', requireAuth, async (req, res) => {
  const role = req.authUser!.role;
  const userId = req.authUser!.id;
  const teamId = String(req.params.teamId || '');
  const year = Number(typeof req.query.year === 'string' ? req.query.year : new Date().getFullYear());
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const teamWhere =
    role === 'ADMIN'
      ? { id: teamId }
      : role === 'MANAGER'
        ? {
            id: teamId,
            OR: [
              { managerId: userId },
              { memberships: { some: { userId, isActive: true } } },
            ],
          }
        : role === 'COORDENADOR'
          ? {
              id: teamId,
              OR: [
                { coordinatorId: userId },
                { memberships: { some: { userId, isActive: true } } },
              ],
            }
          : {
              id: teamId,
              OR: [
                { memberships: { some: { userId, isActive: true } } },
                { members: { some: { id: userId } } },
              ],
            };

  const team = await prisma.team.findFirst({
    where: teamWhere,
    select: {
      id: true,
      name: true,
      country: true,
      managerId: true,
      coordinatorId: true,
      parentTeamId: true,
      manager: {
        select: {
          id: true,
          username: true,
          profile: { select: { primeiroNome: true, apelido: true } },
        },
      },
      coordinator: {
        select: {
          id: true,
          username: true,
          profile: { select: { primeiroNome: true, apelido: true } },
        },
      },
      parentTeam: { select: { id: true, name: true } },
      memberships: {
        where: { isActive: true },
        select: {
          userId: true,
          membershipRole: true,
          isApprover: true,
          approvalLevel: true,
          user: {
            select: {
              id: true,
              username: true,
              email: true,
              role: true,
              teamId: true,
              profile: {
                select: {
                  primeiroNome: true,
                  apelido: true,
                  cargo: true,
                  funcao: true,
                },
              },
              vacations: {
                where: {
                  AND: [
                    { dataInicio: { lte: yearEnd } },
                    { dataFim: { gte: yearStart } },
                  ],
                },
                select: {
                  id: true,
                  dataInicio: true,
                  dataFim: true,
                  status: true,
                  requestType: true,
                  partialDay: true,
                  reviewReason: true,
                  attachmentLink: true,
                  contextTeamId: true,
                  versionNumber: true,
                  contextTeam: { select: { id: true, name: true } },
                },
                orderBy: [{ dataInicio: 'desc' }, { createdAt: 'desc' }],
              },
            },
          },
        },
      },
      _count: { select: { memberships: true } },
    },
  });

  if (!team) {
    return res.status(404).json({ message: 'Equipa não encontrada.' });
  }

  return res.json({
    ...team,
    members: team.memberships.map((membership) => ({
      id: membership.user.id,
      username: membership.user.username,
      email: membership.user.email,
      role: membership.user.role,
      teamId: membership.user.teamId,
      profile: membership.user.profile,
      membershipRole: membership.membershipRole,
      isApprover: membership.isApprover,
      approvalLevel: membership.approvalLevel,
      vacations: membership.user.vacations,
    })),
    _count: {
      members: team._count.memberships,
      memberships: team._count.memberships,
    },
  });
});

router.patch('/manager/team-members/:id', requireAuth, async (req, res) => {
  if (req.authUser!.role !== 'MANAGER') {
    return res.status(403).json({ message: 'Apenas manager pode gerir membros da equipa.' });
  }

  const targetUserId = String(req.params.id || '');
  const payload = managerTeamMemberUpdateSchema.safeParse(req.body);

  if (!payload.success) {
    return res.status(400).json({ message: payload.error.issues[0].message });
  }

  const data = payload.data;

  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    include: {
      team: true,
      teamMemberships: {
        where: { isActive: true },
        include: { team: true },
      },
    },
  });

  if (!targetUser) {
    return res.status(404).json({ message: 'Colaborador não encontrado.' });
  }

  if (targetUser.role !== 'COLABORADOR') {
    return res.status(400).json({ message: 'Só é possível gerir utilizadores com role COLABORADOR.' });
  }

  const currentTeamAllowed =
    targetUser.team?.managerId === req.authUser!.id ||
    targetUser.teamMemberships.some((item) => item.team.managerId === req.authUser!.id);
  if (!currentTeamAllowed) {
    return res.status(403).json({ message: 'Este colaborador não pertence à tua equipa.' });
  }

  let nextTeamId: string | null | undefined = data.teamId;

  if (nextTeamId !== undefined && nextTeamId !== null) {
    const nextTeam = await prisma.team.findFirst({
      where: { id: nextTeamId, managerId: req.authUser!.id },
      select: { id: true },
    });

    if (!nextTeam) {
      return res.status(403).json({ message: 'Só podes mover para equipas geridas por ti.' });
    }
  }

  if (nextTeamId !== undefined) {
    if (nextTeamId === null) {
      await prisma.teamMembership.updateMany({
        where: { userId: targetUserId, isActive: true },
        data: { isActive: false },
      });
      await prisma.user.update({
        where: { id: targetUserId },
        data: { teamId: null },
      });
    } else {
      await prisma.teamMembership.upsert({
        where: {
          userId_teamId: {
            userId: targetUserId,
            teamId: nextTeamId,
          },
        },
        update: {
          isActive: true,
        },
        create: {
          userId: targetUserId,
          teamId: nextTeamId,
          membershipRole: 'PARTICIPANT',
          isApprover: false,
          isActive: true,
        },
      });

      await prisma.user.update({
        where: { id: targetUserId },
        data: { teamId: nextTeamId },
      });
    }
  }

  if (data.cargo !== undefined || data.funcao !== undefined) {
    await prisma.profile.upsert({
      where: { userId: targetUserId },
      update: {
        ...(data.cargo !== undefined ? { cargo: data.cargo } : {}),
        ...(data.funcao !== undefined ? { funcao: data.funcao } : {}),
      },
      create: {
        userId: targetUserId,
        ...(data.cargo !== undefined ? { cargo: data.cargo } : {}),
        ...(data.funcao !== undefined ? { funcao: data.funcao } : {}),
      },
    });
  }

  return res.json({ success: true });
});

router.get('/admin/users', requireAuth, async (req, res) => {
  if (!requireAdmin(req.authUser!.role)) {
    return res.status(403).json({ message: 'Apenas admin pode gerir perfis.' });
  }

  const users = await prisma.user.findMany({
    include: {
      team: { select: { id: true, name: true } },
      teamMemberships: {
        where: { isActive: true },
        include: {
          team: { select: { id: true, name: true } },
        },
      },
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
    teams: user.teamMemberships.map((item) => ({
      teamId: item.teamId,
      teamName: item.team.name,
      membershipRole: item.membershipRole,
      isApprover: item.isApprover,
      approvalLevel: item.approvalLevel,
    })),
    workCountry: user.profile?.workCountry ?? 'PT',
    localidade: user.profile?.localidade ?? '',
  })));
});

router.get('/admin/teams', requireAuth, async (req, res) => {
  if (!requireAdmin(req.authUser!.role)) {
    return res.status(403).json({ message: 'Apenas admin pode gerir equipas.' });
  }

  const teams = await prisma.team.findMany({
    select: {
      id: true,
      name: true,
      country: true,
      managerId: true,
      coordinatorId: true,
      parentTeamId: true,
      manager: { select: { id: true, username: true } },
      coordinator: { select: { id: true, username: true } },
      parentTeam: { select: { id: true, name: true } },
      _count: { select: { members: true, memberships: true, subTeams: true } },
    },
    orderBy: [{ name: 'asc' }],
  });

  return res.json(teams.map((team) => ({
    ...team,
    _count: {
      members: Math.max(team._count.members, team._count.memberships),
      memberships: team._count.memberships,
      subTeams: team._count.subTeams,
    },
  })));
});

router.post('/admin/teams', requireAuth, async (req, res) => {
  if (!requireAdmin(req.authUser!.role)) {
    return res.status(403).json({ message: 'Apenas admin pode criar equipas.' });
  }

  const payload = adminTeamSchema.safeParse(req.body);
  if (!payload.success) {
    return res.status(400).json({ message: payload.error.issues[0].message });
  }

  const team = await prisma.team.create({
    data: {
      name: payload.data.name.trim(),
      country: payload.data.country,
      managerId: payload.data.managerId ?? null,
      coordinatorId: payload.data.coordinatorId ?? null,
      parentTeamId: payload.data.parentTeamId ?? null,
    },
  });

  return res.status(201).json(team);
});

router.patch('/admin/teams/:id', requireAuth, async (req, res) => {
  if (!requireAdmin(req.authUser!.role)) {
    return res.status(403).json({ message: 'Apenas admin pode editar equipas.' });
  }

  const teamId = String(req.params.id || '');
  const payload = adminTeamSchema.partial().safeParse(req.body);

  if (!payload.success) {
    return res.status(400).json({ message: payload.error.issues[0].message });
  }

  const existing = await prisma.team.findUnique({ where: { id: teamId } });
  if (!existing) {
    return res.status(404).json({ message: 'Equipa não encontrada.' });
  }

  const updated = await prisma.team.update({
    where: { id: teamId },
    data: {
      ...(payload.data.name ? { name: payload.data.name.trim() } : {}),
      ...(payload.data.country ? { country: payload.data.country } : {}),
      ...(payload.data.managerId !== undefined ? { managerId: payload.data.managerId } : {}),
      ...(payload.data.coordinatorId !== undefined ? { coordinatorId: payload.data.coordinatorId } : {}),
      ...(payload.data.parentTeamId !== undefined ? { parentTeamId: payload.data.parentTeamId } : {}),
    },
  });

  return res.json(updated);
});

router.delete('/admin/teams/:id', requireAuth, async (req, res) => {
  if (!requireAdmin(req.authUser!.role)) {
    return res.status(403).json({ message: 'Apenas admin pode remover equipas.' });
  }

  const teamId = String(req.params.id || '');

  await prisma.$transaction([
    prisma.teamMembership.deleteMany({ where: { teamId } }),
    prisma.user.updateMany({ where: { teamId }, data: { teamId: null } }),
    prisma.team.update({ where: { id: teamId }, data: { managerId: null, coordinatorId: null, parentTeamId: null } }),
    prisma.team.delete({ where: { id: teamId } }),
  ]);

  return res.json({ success: true });
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

  if (data.teamId !== undefined) {
    if (data.teamId === null) {
      await prisma.teamMembership.updateMany({
        where: { userId },
        data: { isActive: false },
      });
    } else {
      await prisma.teamMembership.upsert({
        where: {
          userId_teamId: {
            userId,
            teamId: data.teamId,
          },
        },
        update: { isActive: true },
        create: {
          userId,
          teamId: data.teamId,
          membershipRole: 'PARTICIPANT',
          isApprover: false,
          isActive: true,
        },
      });
    }
  }

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

router.patch('/admin/users/:id/memberships', requireAuth, async (req, res) => {
  if (!requireAdmin(req.authUser!.role)) {
    return res.status(403).json({ message: 'Apenas admin pode gerir memberships.' });
  }

  const userId = String(req.params.id || '');
  const payload = updateAdminMembershipsSchema.safeParse(req.body);

  if (!payload.success) {
    return res.status(400).json({ message: payload.error.issues[0].message });
  }

  const existing = await prisma.user.findUnique({ where: { id: userId } });

  if (!existing) {
    return res.status(404).json({ message: 'Utilizador não encontrado.' });
  }

  const memberships = payload.data.memberships;

  await prisma.$transaction(async (tx) => {
    await tx.teamMembership.updateMany({
      where: { userId },
      data: { isActive: false },
    });

    for (const item of memberships) {
      await tx.teamMembership.upsert({
        where: {
          userId_teamId: {
            userId,
            teamId: item.teamId,
          },
        },
        update: {
          isActive: item.isActive ?? true,
          membershipRole: item.membershipRole ?? 'PARTICIPANT',
          isApprover: item.isApprover ?? false,
          approvalLevel: item.approvalLevel ?? null,
        },
        create: {
          userId,
          teamId: item.teamId,
          isActive: item.isActive ?? true,
          membershipRole: item.membershipRole ?? 'PARTICIPANT',
          isApprover: item.isApprover ?? false,
          approvalLevel: item.approvalLevel ?? null,
        },
      });
    }

    await tx.user.update({
      where: { id: userId },
      data: {
        teamId: memberships[0]?.teamId ?? null,
      },
    });
  });

  return res.json({ success: true });
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
        ...(data.teamId
          ? {
              teamMemberships: {
                create: {
                  teamId: data.teamId,
                  membershipRole: 'PARTICIPANT',
                  isApprover: false,
                  isActive: true,
                },
              },
            }
          : {}),
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
