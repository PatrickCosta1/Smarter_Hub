import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    permissionGrant: { findFirst: vi.fn() },
    userPermission: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    permission: { count: vi.fn() },
  },
}));

import { prisma } from '../src/lib/prisma.js';
import {
  buildUserWhereFromScope,
  canRevokeAccessTotal,
  clearPermissionEngineCache,
  hasPermission,
  isAccessTotal,
  normalizePermissionRestrictionPayload,
} from '../src/lib/permission-engine.js';

const prismaMock = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn> };
  permissionGrant: { findFirst: ReturnType<typeof vi.fn> };
  userPermission: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  permission: { count: ReturnType<typeof vi.fn> };
};

describe('permission-engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPermissionEngineCache();
  });

  it('hasPermission returns true for hasAccessTotal user without querying assignments', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', isRootAccess: false, hasAccessTotal: true });

    const allowed = await hasPermission('u1', 'create_user');

    expect(allowed).toBe(true);
    expect(prismaMock.userPermission.findFirst).not.toHaveBeenCalled();
  });

  it('isAccessTotal returns true when enabled assignments match permission catalog size', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isRootAccess: false, hasAccessTotal: false });
    prismaMock.permission.count.mockResolvedValue(38);
    prismaMock.userPermission.count.mockResolvedValue(38);

    const result = await isAccessTotal('u2');

    expect(result).toBe(true);
  });

  it('canRevokeAccessTotal allows when actor is explicit access total grant author', async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ isRootAccess: false, hasAccessTotal: false })
      .mockResolvedValueOnce({ hasAccessTotal: true, accessTotalGrantedById: 'actor-1' });
    prismaMock.permission.count.mockResolvedValue(38);
    prismaMock.userPermission.count.mockResolvedValue(0);

    const allowed = await canRevokeAccessTotal({ id: 'actor-1', isRootAccess: false }, 'target-1');

    expect(allowed).toBe(true);
  });

  it('canRevokeAccessTotal uses legacy grant-event fallback when explicit author is missing', async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ isRootAccess: false, hasAccessTotal: false })
      .mockResolvedValueOnce({ hasAccessTotal: true, accessTotalGrantedById: null });
    prismaMock.permission.count.mockResolvedValue(38);
    prismaMock.userPermission.count.mockResolvedValue(0);
    prismaMock.userPermission.findMany.mockResolvedValue([]);
    prismaMock.permissionGrant.findFirst.mockResolvedValue({ actorUserId: 'actor-1' });

    const allowed = await canRevokeAccessTotal({ id: 'actor-1', isRootAccess: false }, 'target-1');

    expect(allowed).toBe(true);
  });

  it('normalizePermissionRestrictionPayload fills defaults', () => {
    const normalized = normalizePermissionRestrictionPayload({ notes: '  nota  ' });

    expect(normalized).toEqual({
      restrictedToTeams: [],
      restrictedToCountries: [],
      restrictedToLevels: [],
      customRestrictions: null,
      notes: 'nota',
    });
  });

  it('buildUserWhereFromScope includes restrictions and custom rules', () => {
    const where = buildUserWhereFromScope({
      isGlobal: false,
      restrictedToTeams: ['team-a'],
      restrictedToCountries: ['PT'],
      restrictedToLevels: ['COLABORADOR'],
      customRestrictions: { allowedUserIds: ['u-1'], deniedUserIds: ['u-2'], requireActive: true },
    });

    expect(where).toEqual({
      AND: [
        {
          OR: [
            { teamId: { in: ['team-a'] } },
            { teamMemberships: { some: { isActive: true, teamId: { in: ['team-a'] } } } },
          ],
        },
        { profile: { workCountry: { in: ['PT'] } } },
        { role: { in: ['COLABORADOR'] } },
        { id: { in: ['u-1'] } },
        { id: { notIn: ['u-2'] } },
        { isActive: true },
      ],
    });
  });
});
