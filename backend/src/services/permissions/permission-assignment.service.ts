import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

type PermissionUpdatePayload = {
  isEnabled?: boolean;
  notes?: string | null;
  restrictedToTeams?: string[];
  restrictedToCountries?: string[];
  restrictedToLevels?: string[];
  customRestrictions?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
};

export async function findPermissionById(permissionId: string) {
  return prisma.permission.findUnique({ where: { id: permissionId } });
}

export async function findUserPermission(targetUserId: string, permissionId: string) {
  return prisma.userPermission.findUnique({
    where: {
      userId_permissionId: {
        userId: targetUserId,
        permissionId,
      },
    },
  });
}

export async function updateAssignedPermission(params: {
  actorUserId: string;
  targetUserId: string;
  permissionId: string;
  reason: string;
  payload: PermissionUpdatePayload;
}) {
  const { actorUserId, targetUserId, permissionId, reason, payload } = params;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.userPermission.update({
      where: {
        userId_permissionId: {
          userId: targetUserId,
          permissionId,
        },
      },
      data: {
        ...(payload.isEnabled !== undefined ? { isEnabled: payload.isEnabled } : {}),
        ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
        ...(payload.restrictedToTeams !== undefined ? { restrictedToTeams: payload.restrictedToTeams } : {}),
        ...(payload.restrictedToCountries !== undefined ? { restrictedToCountries: payload.restrictedToCountries } : {}),
        ...(payload.restrictedToLevels !== undefined ? { restrictedToLevels: payload.restrictedToLevels } : {}),
        ...(payload.customRestrictions !== undefined ? { customRestrictions: payload.customRestrictions } : {}),
        grantedById: actorUserId,
      },
    });

    await tx.permissionGrant.create({
      data: {
        actorUserId,
        targetUserId,
        permissionId,
        action: 'GRANT',
        reason,
      },
    });

    return updated;
  });
}

export async function revokeAssignedPermission(params: {
  actorUserId: string;
  targetUserId: string;
  permissionId: string;
  reason: string;
}) {
  const { actorUserId, targetUserId, permissionId, reason } = params;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.userPermission.update({
      where: {
        userId_permissionId: {
          userId: targetUserId,
          permissionId,
        },
      },
      data: {
        isEnabled: false,
        grantedById: actorUserId,
      },
    });

    await tx.permissionGrant.create({
      data: {
        actorUserId,
        targetUserId,
        permissionId,
        action: 'REVOKE',
        reason,
      },
    });

    return updated;
  });
}
