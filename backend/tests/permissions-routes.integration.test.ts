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
      findMany: vi.fn(),
      count: vi.fn(),
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
    prismaMock.permissionGrant.findMany.mockResolvedValue([]);
    prismaMock.permissionGrant.count.mockResolvedValue(0);
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

  it('GET /api/audit/permission-grants returns 400 when pagination is missing', async () => {
    permissionEngineMock.canManagePermissions.mockResolvedValue(true);

    const app = buildApp();
    const response = await request(app).get('/api/audit/permission-grants');

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('expected number');
  });

  it('GET /api/audit/permission-grants returns paginated grants when authorized', async () => {
    permissionEngineMock.canManagePermissions.mockResolvedValue(true);
    prismaMock.permissionGrant.count.mockResolvedValue(2);
    prismaMock.permissionGrant.findMany.mockResolvedValue([
      {
        id: 'grant-1',
        targetUserId: 'target-user',
        actorUserId: 'auth-user',
        permissionId: 'perm-1',
        action: 'GRANT',
        reason: 'Teste',
        createdAt: new Date(),
      },
    ]);

    const app = buildApp();
    const response = await request(app).get('/api/audit/permission-grants?page=1&pageSize=10');

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(2);
    expect(response.body.page).toBe(1);
    expect(response.body.pageSize).toBe(10);
    expect(Array.isArray(response.body.grants)).toBe(true);
  });
});
