import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '../lib/prisma.js';
import { PERMISSION_CATALOG } from '../lib/permissions.js';
import {
  canManagePermissions,
  canReviewAccessTotalHierarchy,
  canRevokeAccessTotal,
  canRevokePermission,
  clearPermissionEngineCacheForUser,
  isAccessTotal,
  normalizePermissionRestrictionPayload,
} from '../lib/permission-engine.js';
import { requireAuth } from '../middleware/auth.js';
import { createRequestTimer } from '../lib/request-timing.js';

const router = Router();
let permissionCatalogSyncPromise: Promise<void> | null = null;

const permissionAssignmentSchema = z.object({
  permissionId: z.string().min(1).optional(),
  permissionCode: z.string().min(1).optional(),
  isEnabled: z.boolean().optional().default(true),
  restrictedToTeams: z.array(z.string().min(1)).optional(),
  restrictedToCountries: z.array(z.enum(['PT', 'BR'])).optional(),
  restrictedToLevels: z.array(z.string().min(1)).optional(),
  customRestrictions: z.any().optional(),
  notes: z.string().optional(),
  reason: z.string().optional(),
}).refine((data) => Boolean(data.permissionId || data.permissionCode), {
  message: 'Indica permissionId ou permissionCode.',
  path: ['permissionId'],
});

const accessTotalSchema = z.object({
  isEnabled: z.boolean(),
  reason: z.string().optional(),
});

const AUTO_DEFAULT_EMPLOYEE_NOTE = '[AUTO_PRESET_DEFAULT_EMPLOYEE]';
const DEFAULT_EMPLOYEE_PERMISSION_CODES = [
  'view_profile',
  'request_profile_change',
  'view_notifications',
  'request_vacation',
  'view_own_vacations',
  'view_team_vacations',
  'request_training',
  'view_trainings',
] as const;

export const __permissionsTestables = {
  permissionAssignmentSchema,
  accessTotalSchema,
};

async function ensurePermissionCatalogSynced() {
  if (!permissionCatalogSyncPromise) {
    permissionCatalogSyncPromise = (async () => {
      for (const item of PERMISSION_CATALOG) {
        await prisma.permission.upsert({
          where: { code: item.code },
          update: {
            label: item.label,
            description: item.description,
            category: item.category,
            requiresRestrictions: item.requiresRestrictions,
          },
          create: {
            code: item.code,
            label: item.label,
            description: item.description,
            category: item.category,
            requiresRestrictions: item.requiresRestrictions,
          },
        });
      }
    })().finally(() => {
      permissionCatalogSyncPromise = null;
    });
  }

  await permissionCatalogSyncPromise;
}

router.use(async (_req, _res, next) => {
  try {
    await ensurePermissionCatalogSynced();
    next();
  } catch (error) {
    next(error);
  }
});

async function resolvePermission(input: { permissionId?: string; permissionCode?: string }) {
  if (input.permissionId) {
    return prisma.permission.findUnique({
      where: { id: input.permissionId },
    });
  }

  if (input.permissionCode) {
    return prisma.permission.findUnique({
      where: { code: input.permissionCode },
    });
  }

  return null;
}

async function assertCanManagePermissionTarget(actorUserId: string, actorIsRoot: boolean, targetUserId: string) {
  if (actorIsRoot || actorUserId === targetUserId) {
    return { ok: true as const };
  }

  const [actorHasAccessTotal, target] = await Promise.all([
    isAccessTotal(actorUserId),
    prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, hasAccessTotal: true, isRootAccess: true },
    }),
  ]);

  if (!target) {
    return { ok: false as const, status: 404, message: 'Utilizador não encontrado.' };
  }

  if (target.isRootAccess) {
    return { ok: false as const, status: 403, message: 'Sem permissões para gerir este utilizador.' };
  }

  if (actorHasAccessTotal && target.hasAccessTotal) {
    const canManageByHierarchy = await canReviewAccessTotalHierarchy(actorUserId, targetUserId);
    if (!canManageByHierarchy) {
      return { ok: false as const, status: 403, message: 'Não podes gerir permissões de utilizadores com acesso total no mesmo nível hierárquico.' };
    }
  }

  return { ok: true as const };
}

router.get('/permissions', requireAuth, async (_req, res) => {
  const permissions = await prisma.permission.findMany({
    orderBy: [{ category: 'asc' }, { label: 'asc' }],
  });

  return res.json({ permissions });
});

router.get('/users/:id/permissions', requireAuth, async (req, res) => {
  const timer = createRequestTimer('GET /users/:id/permissions');
  const targetUserId = String(req.params.id || '');

  const [hierarchyCheck, canManage] = await Promise.all([
    assertCanManagePermissionTarget(req.authUser!.id, req.authUser!.isRootAccess, targetUserId),
    canManagePermissions(req.authUser!),
  ]);
  timer.mark('check-can-manage');

  if (!hierarchyCheck.ok) {
    return res.status(hierarchyCheck.status).json({ message: hierarchyCheck.message });
  }

  if (!canManage && req.authUser!.id !== targetUserId) {
    return res.status(403).json({ message: 'Sem permissões para consultar permissões de outros utilizadores.' });
  }

  const [user, permissions, assignments] = await Promise.all([
    prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        username: true,
        email: true,
        isActive: true,
        isRootAccess: true,
        hasAccessTotal: true,
        profile: {
          select: {
            nomeAbreviado: true,
            nomeCompleto: true,
          },
        },
      },
    }),
    prisma.permission.findMany({ orderBy: [{ category: 'asc' }, { label: 'asc' }] }),
    prisma.userPermission.findMany({
      where: { userId: targetUserId },
      select: {
        permissionId: true,
        isEnabled: true,
        restrictedToTeams: true,
        restrictedToCountries: true,
        restrictedToLevels: true,
        customRestrictions: true,
        notes: true,
        grantedById: true,
        grantedAt: true,
        updatedAt: true,
        grantedBy: {
          select: {
            id: true,
            username: true,
            profile: {
              select: {
                nomeAbreviado: true,
                nomeCompleto: true,
              },
            },
          },
        },
      },
    }),
  ]);
  timer.mark('load-user-permissions-data');

  if (!user) {
    return res.status(404).json({ message: 'Utilizador não encontrado.' });
  }

  const assignmentByPermissionId = new Map(assignments.map((item) => [item.permissionId, item]));
  timer.mark('build-assignment-map');
  timer.done({ permissions: permissions.length, assignments: assignments.length });

  return res.json({
    user,
    accessTotal: Boolean(user.isRootAccess || user.hasAccessTotal),
    permissions: permissions.map((permission) => {
      const assignment = assignmentByPermissionId.get(permission.id);

      return {
        ...permission,
        assignment: assignment
          ? {
              isEnabled: assignment.isEnabled,
              restrictedToTeams: assignment.restrictedToTeams,
              restrictedToCountries: assignment.restrictedToCountries,
              restrictedToLevels: assignment.restrictedToLevels,
              customRestrictions: assignment.customRestrictions,
              notes: assignment.notes,
              grantedById: assignment.grantedById,
              grantedAt: assignment.grantedAt,
              updatedAt: assignment.updatedAt,
              grantedBy: assignment.grantedBy,
            }
          : null,
      };
    }),
  });
});

router.post('/users/:id/permissions', requireAuth, async (req, res) => {
  const canManage = await canManagePermissions(req.authUser!);
  if (!canManage) {
    return res.status(403).json({ message: 'Sem permissões para gerir permissões.' });
  }

  const targetUserId = String(req.params.id || '');
  const hierarchyCheck = await assertCanManagePermissionTarget(req.authUser!.id, req.authUser!.isRootAccess, targetUserId);
  if (!hierarchyCheck.ok) {
    return res.status(hierarchyCheck.status).json({ message: hierarchyCheck.message });
  }

  const payload = permissionAssignmentSchema.safeParse(req.body);
  if (!payload.success) {
    return res.status(400).json({ message: payload.error.issues[0].message });
  }

  const permission = await resolvePermission(payload.data);
  if (!permission) {
    return res.status(404).json({ message: 'Permissão não encontrada.' });
  }

  const restrictionPayload = normalizePermissionRestrictionPayload(payload.data);
  const customRestrictions = payload.data.customRestrictions === undefined
    ? undefined
    : (payload.data.customRestrictions ?? Prisma.JsonNull);

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.userPermission.upsert({
      where: {
        userId_permissionId: {
          userId: targetUserId,
          permissionId: permission.id,
        },
      },
      create: {
        userId: targetUserId,
        permissionId: permission.id,
        isEnabled: payload.data.isEnabled ?? true,
        grantedById: req.authUser!.id,
        ...restrictionPayload,
        ...(customRestrictions !== undefined ? { customRestrictions } : {}),
      },
      update: {
        isEnabled: payload.data.isEnabled ?? true,
        grantedById: req.authUser!.id,
        ...restrictionPayload,
        ...(customRestrictions !== undefined ? { customRestrictions } : {}),
      },
      include: {
        permission: true,
        grantedBy: {
          select: {
            id: true,
            username: true,
            profile: {
              select: {
                nomeAbreviado: true,
                nomeCompleto: true,
              },
            },
          },
        },
      },
    });

    await tx.permissionGrant.create({
      data: {
        actorUserId: req.authUser!.id,
        targetUserId,
        permissionId: permission.id,
        action: 'GRANT',
        reason: payload.data.reason?.trim() || payload.data.notes?.trim() || 'Permissão concedida manualmente.',
      },
    });

    return next;
  });

  clearPermissionEngineCacheForUser(targetUserId);
  clearPermissionEngineCacheForUser(req.authUser!.id);

  return res.json({ permission: updated });
});

router.patch('/users/:id/permissions/:permissionId', requireAuth, async (req, res) => {
  const canManage = await canManagePermissions(req.authUser!);
  if (!canManage) {
    return res.status(403).json({ message: 'Sem permissões para gerir permissões.' });
  }

  const targetUserId = String(req.params.id || '');
  const hierarchyCheck = await assertCanManagePermissionTarget(req.authUser!.id, req.authUser!.isRootAccess, targetUserId);
  if (!hierarchyCheck.ok) {
    return res.status(hierarchyCheck.status).json({ message: hierarchyCheck.message });
  }

  const permissionId = String(req.params.permissionId || '');

  const payload = permissionAssignmentSchema.partial().safeParse(req.body);
  if (!payload.success) {
    return res.status(400).json({ message: payload.error.issues[0].message });
  }

  const permission = await prisma.permission.findUnique({ where: { id: permissionId } });
  if (!permission) {
    return res.status(404).json({ message: 'Permissão não encontrada.' });
  }

  const existing = await prisma.userPermission.findUnique({
    where: {
      userId_permissionId: {
        userId: targetUserId,
        permissionId,
      },
    },
  });

  if (!existing) {
    return res.status(404).json({ message: 'O utilizador ainda não tem esta permissão.' });
  }

  const restrictionPayload = normalizePermissionRestrictionPayload(payload.data);
  const customRestrictions = payload.data.customRestrictions === undefined
    ? undefined
    : (payload.data.customRestrictions ?? Prisma.JsonNull);

  const updated = await prisma.userPermission.update({
    where: {
      userId_permissionId: {
        userId: targetUserId,
        permissionId,
      },
    },
    data: {
      ...(payload.data.isEnabled !== undefined ? { isEnabled: payload.data.isEnabled } : {}),
      ...(payload.data.notes !== undefined ? { notes: payload.data.notes?.trim() || null } : {}),
      ...(payload.data.restrictedToTeams !== undefined ? { restrictedToTeams: restrictionPayload.restrictedToTeams } : {}),
      ...(payload.data.restrictedToCountries !== undefined ? { restrictedToCountries: restrictionPayload.restrictedToCountries } : {}),
      ...(payload.data.restrictedToLevels !== undefined ? { restrictedToLevels: restrictionPayload.restrictedToLevels } : {}),
      ...(customRestrictions !== undefined ? { customRestrictions } : {}),
      grantedById: req.authUser!.id,
    },
  });

  await prisma.permissionGrant.create({
    data: {
      actorUserId: req.authUser!.id,
      targetUserId,
      permissionId,
      action: 'GRANT',
      reason: payload.data.reason?.trim() || 'Permissão atualizada manualmente.',
    },
  });

  clearPermissionEngineCacheForUser(targetUserId);
  clearPermissionEngineCacheForUser(req.authUser!.id);

  return res.json({ permission: updated });
});

router.delete('/users/:id/permissions/:permissionId', requireAuth, async (req, res) => {
  const targetUserId = String(req.params.id || '');
  const hierarchyCheck = await assertCanManagePermissionTarget(req.authUser!.id, req.authUser!.isRootAccess, targetUserId);
  if (!hierarchyCheck.ok) {
    return res.status(hierarchyCheck.status).json({ message: hierarchyCheck.message });
  }

  const permissionId = String(req.params.permissionId || '');

  const allowed = await canRevokePermission(req.authUser!, targetUserId, permissionId);
  if (!allowed) {
    return res.status(403).json({ message: 'Não tens permissões para revogar esta permissão.' });
  }

  const existing = await prisma.userPermission.findUnique({
    where: {
      userId_permissionId: {
        userId: targetUserId,
        permissionId,
      },
    },
  });

  if (!existing) {
    return res.status(404).json({ message: 'O utilizador não tem esta permissão.' });
  }

  const updated = await prisma.userPermission.update({
    where: {
      userId_permissionId: {
        userId: targetUserId,
        permissionId,
      },
    },
    data: {
      isEnabled: false,
      grantedById: req.authUser!.id,
    },
  });

  await prisma.permissionGrant.create({
    data: {
      actorUserId: req.authUser!.id,
      targetUserId,
      permissionId,
      action: 'REVOKE',
      reason: 'Permissão revogada manualmente.',
    },
  });

  clearPermissionEngineCacheForUser(targetUserId);
  clearPermissionEngineCacheForUser(req.authUser!.id);

  return res.json({ permission: updated });
});

router.patch('/users/:id/access-total', requireAuth, async (req, res) => {
  const canManage = await canManagePermissions(req.authUser!);
  if (!canManage) {
    return res.status(403).json({ message: 'Sem permissões para gerir acesso total.' });
  }

  const targetUserId = String(req.params.id || '');
  const hierarchyCheck = await assertCanManagePermissionTarget(req.authUser!.id, req.authUser!.isRootAccess, targetUserId);
  if (!hierarchyCheck.ok) {
    return res.status(hierarchyCheck.status).json({ message: hierarchyCheck.message });
  }

  const payload = accessTotalSchema.safeParse(req.body);
  if (!payload.success) {
    return res.status(400).json({ message: payload.error.issues[0].message });
  }

  const [allPermissions, defaultEmployeePermissions] = await Promise.all([
    prisma.permission.findMany({ select: { id: true } }),
    prisma.permission.findMany({
      where: { code: { in: [...DEFAULT_EMPLOYEE_PERMISSION_CODES] } },
      select: { id: true },
    }),
  ]);

  if (payload.data.isEnabled) {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: targetUserId },
        data: {
          hasAccessTotal: true,
          accessTotalGrantedById: req.authUser!.id,
          accessTotalGrantedAt: new Date(),
        },
      });

      // Compact mode: once access total is enabled, explicit per-permission rows become unnecessary.
      await tx.userPermission.deleteMany({
        where: { userId: targetUserId },
      });

      if (allPermissions.length > 0) {
        await tx.permissionGrant.createMany({
          data: allPermissions.map((permission) => ({
            actorUserId: req.authUser!.id,
            targetUserId,
            permissionId: permission.id,
            action: 'GRANT',
            reason: payload.data.reason?.trim() || 'Acesso total concedido (modo compacto, auditoria expandida).',
          })),
        });
      }
    });
  } else {
    const allowed = await canRevokeAccessTotal(req.authUser!, targetUserId);
    if (!allowed) {
      return res.status(403).json({ message: 'Só podes remover o acesso total que foi concedido por ti.' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: targetUserId },
        data: {
          hasAccessTotal: false,
          accessTotalGrantedById: null,
          accessTotalGrantedAt: null,
        },
      });

      // Remove o modo compacto e repõe permissões padrão de funcionário com operações em lote.
      await tx.userPermission.deleteMany({
        where: { userId: targetUserId },
      });

      if (defaultEmployeePermissions.length > 0) {
        await tx.userPermission.createMany({
          data: defaultEmployeePermissions.map((permission) => ({
            userId: targetUserId,
            permissionId: permission.id,
            isEnabled: true,
            grantedById: req.authUser!.id,
            notes: AUTO_DEFAULT_EMPLOYEE_NOTE,
          })),
        });
      }

      if (allPermissions.length > 0) {
        await tx.permissionGrant.createMany({
          data: allPermissions.map((permission) => ({
            actorUserId: req.authUser!.id,
            targetUserId,
            permissionId: permission.id,
            action: 'REVOKE',
            reason: payload.data.reason?.trim() || 'Acesso total revogado (modo compacto, auditoria expandida).',
          })),
        });
      }
    });
  }

  clearPermissionEngineCacheForUser(targetUserId);
  clearPermissionEngineCacheForUser(req.authUser!.id);

  const accessTotal = await isAccessTotal(targetUserId);
  return res.json({ success: true, accessTotal });
});

router.get('/audit/permission-grants', requireAuth, async (req, res) => {
  const canManage = await canManagePermissions(req.authUser!);
  if (!canManage) {
    return res.status(403).json({ message: 'Sem permissões para consultar auditoria de permissões.' });
  }

  const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
  const limit = Math.min(100, Math.max(1, Number(typeof req.query.limit === 'string' ? req.query.limit : '50') || 50));
  const offset = Math.max(0, Number(typeof req.query.offset === 'string' ? req.query.offset : '0') || 0);

  const grants = await prisma.permissionGrant.findMany({
    where: {
      ...(userId ? { targetUserId: userId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    skip: offset,
    take: limit,
    include: {
      actorUser: {
        select: {
          id: true,
          username: true,
          profile: {
            select: {
              nomeAbreviado: true,
              nomeCompleto: true,
            },
          },
        },
      },
      targetUser: {
        select: {
          id: true,
          username: true,
          profile: {
            select: {
              nomeAbreviado: true,
              nomeCompleto: true,
            },
          },
        },
      },
      permission: true,
    },
  });

  const total = await prisma.permissionGrant.count({
    where: {
      ...(userId ? { targetUserId: userId } : {}),
    },
  });

  return res.json({ total, limit, offset, grants });
});

export { router as permissionsRouter };