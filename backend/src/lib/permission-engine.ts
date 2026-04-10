import type { AuthUser } from '../types/auth.js';
import { prisma } from './prisma.js';

export type PermissionRestrictionPayload = {
  restrictedToTeams?: string[];
  restrictedToCountries?: Array<'PT' | 'BR'>;
  restrictedToLevels?: string[];
  customRestrictions?: unknown;
  notes?: string | null;
};

export type PermissionScope = {
  isGlobal: boolean;
  restrictedToTeams: string[] | null;
  restrictedToCountries: Array<'PT' | 'BR'> | null;
  restrictedToLevels: string[] | null;
  customRestrictions: unknown;
};

export function isRootAccess(user: Pick<AuthUser, 'isRootAccess'>) {
  return Boolean(user.isRootAccess);
}

export async function hasPermission(userId: string, permissionCode: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isRootAccess: true, hasAccessTotal: true },
  });

  if (!user) {
    return false;
  }

  if (user.isRootAccess || user.hasAccessTotal) {
    return true;
  }

  const assignment = await prisma.userPermission.findFirst({
    where: {
      userId,
      isEnabled: true,
      permission: { code: permissionCode },
    },
    select: { id: true },
  });

  return Boolean(assignment);
}

export async function canManagePermissions(user: Pick<AuthUser, 'id' | 'isRootAccess'>) {
  if (user.isRootAccess) {
    return true;
  }

  return hasPermission(user.id, 'manage_permissions');
}

export async function canRevokePermission(actor: Pick<AuthUser, 'id' | 'isRootAccess'>, targetUserId: string, permissionId: string) {
  if (actor.isRootAccess) {
    return true;
  }

  const assignment = await prisma.userPermission.findUnique({
    where: {
      userId_permissionId: {
        userId: targetUserId,
        permissionId,
      },
    },
    select: {
      isEnabled: true,
      grantedById: true,
    },
  });

  if (!assignment || !assignment.isEnabled) {
    return false;
  }

  return assignment.grantedById === actor.id;
}

export async function canRevokeAccessTotal(actor: Pick<AuthUser, 'id' | 'isRootAccess'>, targetUserId: string) {
  if (actor.isRootAccess) {
    return true;
  }

  if (await isAccessTotal(actor.id)) {
    return true;
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      hasAccessTotal: true,
      accessTotalGrantedById: true,
    },
  });

  if (!targetUser?.hasAccessTotal) {
    return false;
  }

  if (targetUser.accessTotalGrantedById) {
    return targetUser.accessTotalGrantedById === actor.id;
  }

  const assignments = await prisma.userPermission.findMany({
    where: {
      userId: targetUserId,
      isEnabled: true,
    },
    select: {
      grantedById: true,
    },
  });

  if (assignments.length === 0) {
    const latestAccessTotalGrant = await prisma.permissionGrant.findFirst({
      where: {
        targetUserId,
        action: 'GRANT',
        reason: {
          contains: 'Acesso total concedido',
          mode: 'insensitive',
        },
      },
      orderBy: { createdAt: 'desc' },
      select: { actorUserId: true },
    });

    return latestAccessTotalGrant?.actorUserId === actor.id;
  }

  return assignments.every((assignment) => assignment.grantedById === actor.id);
}

export async function isAccessTotal(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isRootAccess: true, hasAccessTotal: true },
  });

  if (!user) {
    return false;
  }

  if (user.isRootAccess || user.hasAccessTotal) {
    return true;
  }

  const [totalPermissions, enabledAssignments] = await Promise.all([
    prisma.permission.count(),
    prisma.userPermission.count({
      where: {
        userId,
        isEnabled: true,
      },
    }),
  ]);

  return totalPermissions > 0 && enabledAssignments === totalPermissions;
}

export function normalizePermissionRestrictionPayload(payload: PermissionRestrictionPayload) {
  return {
    restrictedToTeams: payload.restrictedToTeams ?? [],
    restrictedToCountries: payload.restrictedToCountries ?? [],
    restrictedToLevels: payload.restrictedToLevels ?? [],
    customRestrictions: payload.customRestrictions ?? null,
    notes: payload.notes?.trim() || null,
  };
}

export async function getRestrictedTeamsForPermission(userId: string, permissionCode: string): Promise<string[] | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isRootAccess: true, hasAccessTotal: true },
  });

  if (!user) {
    return [];
  }

  if (user.isRootAccess || user.hasAccessTotal) {
    return null;
  }

  const assignment = await prisma.userPermission.findFirst({
    where: {
      userId,
      isEnabled: true,
      permission: { code: permissionCode },
    },
    select: {
      restrictedToTeams: true,
    },
  });

  if (!assignment) {
    return [];
  }

  if (!assignment.restrictedToTeams || assignment.restrictedToTeams.length === 0) {
    return null;
  }

  return assignment.restrictedToTeams;
}

function parseCustomRestrictions(customRestrictions: unknown) {
  if (!customRestrictions || typeof customRestrictions !== 'object' || Array.isArray(customRestrictions)) {
    return {
      allowedUserIds: [] as string[],
      deniedUserIds: [] as string[],
      requireActive: false,
    };
  }

  const source = customRestrictions as {
    allowedUserIds?: unknown;
    deniedUserIds?: unknown;
    requireActive?: unknown;
  };

  const allowedUserIds = Array.isArray(source.allowedUserIds)
    ? source.allowedUserIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const deniedUserIds = Array.isArray(source.deniedUserIds)
    ? source.deniedUserIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const requireActive = source.requireActive === true;

  return {
    allowedUserIds,
    deniedUserIds,
    requireActive,
  };
}

export async function getPermissionScope(userId: string, permissionCode: string): Promise<PermissionScope | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isRootAccess: true, hasAccessTotal: true },
  });

  if (!user) {
    return null;
  }

  if (user.isRootAccess || user.hasAccessTotal) {
    return {
      isGlobal: true,
      restrictedToTeams: null,
      restrictedToCountries: null,
      restrictedToLevels: null,
      customRestrictions: null,
    };
  }

  const assignment = await prisma.userPermission.findFirst({
    where: {
      userId,
      isEnabled: true,
      permission: { code: permissionCode },
    },
    select: {
      restrictedToTeams: true,
      restrictedToCountries: true,
      restrictedToLevels: true,
      customRestrictions: true,
    },
  });

  if (!assignment) {
    return null;
  }

  const restrictedToTeams = assignment.restrictedToTeams.length > 0 ? assignment.restrictedToTeams : null;
  const restrictedToCountries = assignment.restrictedToCountries.length > 0 ? assignment.restrictedToCountries as Array<'PT' | 'BR'> : null;
  const restrictedToLevels = assignment.restrictedToLevels.length > 0 ? assignment.restrictedToLevels : null;
  const customRestrictions = assignment.customRestrictions;

  const isGlobal = !restrictedToTeams && !restrictedToCountries && !restrictedToLevels && !customRestrictions;

  return {
    isGlobal,
    restrictedToTeams,
    restrictedToCountries,
    restrictedToLevels,
    customRestrictions,
  };
}

export function buildUserWhereFromScope(scope: PermissionScope): Record<string, unknown> | null {
  if (scope.isGlobal) {
    return null;
  }

  const andConditions: Array<Record<string, unknown>> = [];

  if (scope.restrictedToTeams && scope.restrictedToTeams.length > 0) {
    andConditions.push({
      OR: [
        { teamId: { in: scope.restrictedToTeams } },
        {
          teamMemberships: {
            some: {
              isActive: true,
              teamId: { in: scope.restrictedToTeams },
            },
          },
        },
      ],
    });
  }

  if (scope.restrictedToCountries && scope.restrictedToCountries.length > 0) {
    andConditions.push({
      profile: {
        workCountry: {
          in: scope.restrictedToCountries,
        },
      },
    });
  }

  if (scope.restrictedToLevels && scope.restrictedToLevels.length > 0) {
    andConditions.push({
      role: {
        in: scope.restrictedToLevels,
      },
    });
  }

  const custom = parseCustomRestrictions(scope.customRestrictions);
  if (custom.allowedUserIds.length > 0) {
    andConditions.push({
      id: {
        in: custom.allowedUserIds,
      },
    });
  }
  if (custom.deniedUserIds.length > 0) {
    andConditions.push({
      id: {
        notIn: custom.deniedUserIds,
      },
    });
  }
  if (custom.requireActive) {
    andConditions.push({ isActive: true });
  }

  if (andConditions.length === 0) {
    return null;
  }

  return { AND: andConditions };
}

export async function canAccessUserByPermission(actorUserId: string, permissionCode: string, targetUserId: string) {
  const scope = await getPermissionScope(actorUserId, permissionCode);
  if (!scope) {
    return false;
  }

  if (scope.isGlobal) {
    return true;
  }

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      role: true,
      teamId: true,
      isActive: true,
      profile: {
        select: { workCountry: true },
      },
      teamMemberships: {
        where: { isActive: true },
        select: { teamId: true },
      },
    },
  });

  if (!target) {
    return false;
  }

  if (scope.restrictedToLevels && scope.restrictedToLevels.length > 0 && !scope.restrictedToLevels.includes(target.role)) {
    return false;
  }

  if (
    scope.restrictedToCountries
    && scope.restrictedToCountries.length > 0
    && !scope.restrictedToCountries.includes((target.profile?.workCountry ?? 'PT') as 'PT' | 'BR')
  ) {
    return false;
  }

  if (scope.restrictedToTeams && scope.restrictedToTeams.length > 0) {
    const targetTeamIds = new Set<string>();
    if (target.teamId) {
      targetTeamIds.add(target.teamId);
    }
    for (const membership of target.teamMemberships) {
      targetTeamIds.add(membership.teamId);
    }

    const hasIntersection = scope.restrictedToTeams.some((teamId) => targetTeamIds.has(teamId));
    if (!hasIntersection) {
      return false;
    }
  }

  const custom = parseCustomRestrictions(scope.customRestrictions);
  if (custom.allowedUserIds.length > 0 && !custom.allowedUserIds.includes(target.id)) {
    return false;
  }
  if (custom.deniedUserIds.length > 0 && custom.deniedUserIds.includes(target.id)) {
    return false;
  }
  if (custom.requireActive && !target.isActive) {
    return false;
  }

  return true;
}