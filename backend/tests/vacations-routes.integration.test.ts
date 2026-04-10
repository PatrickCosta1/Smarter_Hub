import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, permissionEngineMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    teamMembership: { findMany: vi.fn() },
    profile: { findUnique: vi.fn() },
  },
  permissionEngineMock: {
    buildUserWhereFromScope: vi.fn(),
    canAccessUserByPermission: vi.fn(),
    getPermissionScope: vi.fn(),
    hasPermission: vi.fn(),
    isAccessTotal: vi.fn(),
  },
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../src/lib/permission-engine.js', () => permissionEngineMock);

vi.mock('../src/lib/notifications.js', () => ({
  notifyUsersByPermission: vi.fn(),
}));

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

import { vacationsRouter } from '../src/routes/vacations.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', vacationsRouter);
  return app;
}

describe('vacations routes integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [],
      }),
    );
  });

  it('POST /api/vacations returns 400 for invalid date range', async () => {
    const app = buildApp();

    const response = await request(app)
      .post('/api/vacations')
      .send({
        dataInicio: '2026-04-20',
        dataFim: '2026-04-10',
        observacoes: '',
        requestType: 'VACATION',
        attachmentLink: '',
        partialDay: 'FULL',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('data de fim');
  });

  it('GET /api/vacations/requests returns 403 without approval/view permissions', async () => {
    permissionEngineMock.hasPermission.mockResolvedValue(false);
    permissionEngineMock.isAccessTotal.mockResolvedValue(false);
    permissionEngineMock.getPermissionScope.mockResolvedValue(null);

    const app = buildApp();
    const response = await request(app).get('/api/vacations/requests');

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('Sem permissões');
  });

  it('POST /api/vacations returns 400 when no approvers are configured', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ teamId: null });
    prismaMock.teamMembership.findMany.mockResolvedValue([]);
    prismaMock.profile.findUnique.mockResolvedValue({
      workCountry: 'PT',
      primeiroNome: 'Teste',
      apelido: 'User',
      nomeAbreviado: 'Teste User',
    });

    const app = buildApp();
    const response = await request(app)
      .post('/api/vacations')
      .send({
        dataInicio: '2026-04-14',
        dataFim: '2026-04-15',
        observacoes: 'Pedido teste',
        requestType: 'VACATION',
        attachmentLink: '',
        partialDay: 'FULL',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Não existem aprovadores');
  });
});
