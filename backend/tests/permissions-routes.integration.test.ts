import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, permissionEngineMock } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    permission: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    userPermission: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
      upsert: vi.fn(),
    },
    permissionGrant: {
      create: vi.fn(),
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  permissionEngineMock: {
    canManagePermissions: vi.fn(),
    canRevokeAccessTotal: vi.fn(),
    canRevokePermission: vi.fn(),
    isAccessTotal: vi.fn(),
    normalizePermissionRestrictionPayload: vi.fn(),
  },
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../src/lib/permission-engine.js', () => permissionEngineMock);

vi.mock('../src/middleware/auth.js', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.authUser = {
      id: 'auth-user',
      username: 'tester',
      email: 'tester@example.com',
      role: 'ADMIN',
      isActive: true,
      isRootAccess: false,
    };
    next();
  },
}));

import { permissionsRouter } from '../src/routes/permissions.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', permissionsRouter);
  return app;
}

describe('permissions routes integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prismaMock.permission.upsert.mockResolvedValue({});
    prismaMock.user.findUnique.mockResolvedValue({ id: 'target-user', hasAccessTotal: false, isRootAccess: false });
    prismaMock.permission.findMany.mockResolvedValue([]);
    prismaMock.$transaction.mockImplementation(async (ops: unknown) => {
      if (typeof ops === 'function') {
        return ops(prismaMock);
      }
      if (Array.isArray(ops)) {
        return Promise.all(ops);
      }
      return undefined;
    });
    permissionEngineMock.isAccessTotal.mockResolvedValue(false);
    permissionEngineMock.normalizePermissionRestrictionPayload.mockImplementation((payload: unknown) => payload);
  });

  it('GET /api/users/:id/permissions returns 403 when actor cannot manage and target is another user', async () => {
    permissionEngineMock.canManagePermissions.mockResolvedValue(false);

    const app = buildApp();
    const response = await request(app).get('/api/users/other-user/permissions');

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('Sem permissões');
  });

  it('POST /api/users/:id/permissions returns 404 when permission does not exist', async () => {
    permissionEngineMock.canManagePermissions.mockResolvedValue(true);
    prismaMock.permission.findUnique.mockResolvedValue(null);

    const app = buildApp();
    const response = await request(app)
      .post('/api/users/target-user/permissions')
      .send({ permissionCode: 'missing_permission', isEnabled: true });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Permissão não encontrada.');
  });

  it('PATCH /api/users/:id/access-total returns 403 when actor cannot revoke access total', async () => {
    permissionEngineMock.canManagePermissions.mockResolvedValue(true);
    permissionEngineMock.canRevokeAccessTotal.mockResolvedValue(false);
    prismaMock.permission.findFirst.mockResolvedValue({ id: 'perm-1' });
    prismaMock.permission.findMany.mockResolvedValue([]);

    const app = buildApp();
    const response = await request(app)
      .patch('/api/users/target-user/access-total')
      .send({ isEnabled: false });

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('Só podes remover o acesso total');
  });
});
