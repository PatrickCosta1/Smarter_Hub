import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, permissionEngineMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(),
    user: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    userPermission: { findMany: vi.fn() },
    team: { findMany: vi.fn(), findUnique: vi.fn() },
    teamMembership: { findMany: vi.fn() },
    profile: { findUnique: vi.fn() },
    vacation: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    vacationApproval: { updateMany: vi.fn(), create: vi.fn() },
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
  notifyUsers: vi.fn(),
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
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock as never));
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.userPermission.findMany.mockResolvedValue([]);
    prismaMock.team.findMany.mockResolvedValue([]);
    prismaMock.team.findUnique.mockResolvedValue(null);
    prismaMock.teamMembership.findMany.mockResolvedValue([]);
    prismaMock.vacation.findMany.mockResolvedValue([]);
    prismaMock.vacation.update.mockResolvedValue(undefined);
    prismaMock.vacation.create.mockResolvedValue(undefined);
    prismaMock.vacationApproval.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.vacationApproval.create.mockResolvedValue(undefined);
    prismaMock.profile.findUnique.mockResolvedValue({
      workCountry: 'PT',
      nomeCompleto: 'Teste User',
      nomeAbreviado: 'Teste User',
    });
    prismaMock.vacation.findFirst.mockResolvedValue(null);
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

  it('GET /api/vacations/requests hides BR collaborator requests when actor is not in pending step', async () => {
    permissionEngineMock.hasPermission.mockImplementation(async (_userId: string, code: string) => code === 'view_all_vacations');
    permissionEngineMock.isAccessTotal.mockResolvedValue(false);
    permissionEngineMock.getPermissionScope.mockResolvedValue({ isGlobal: true });

    prismaMock.vacation.findMany.mockResolvedValue([
      {
        id: 'vac-1',
        userId: 'employee-1',
        status: 'PENDING',
        user: {
          id: 'employee-1',
          username: 'colab.br',
          email: 'colab.br@example.com',
          role: 'COLABORADOR',
          hasAccessTotal: false,
          team: { id: 'team-1', name: 'Equipe BR' },
          profile: { workCountry: 'BR', nomeAbreviado: 'Colab BR', nomeCompleto: 'Colaborador BR' },
        },
        contextTeam: { id: 'team-1', name: 'Equipe BR' },
        approvals: [
          { approverId: 'manager-1', approvalLevel: 1, status: 'PENDING' },
          { approverId: 'auth-user', approvalLevel: 2, status: 'WAITING' },
        ],
      },
    ]);

    const app = buildApp();
    const response = await request(app).get('/api/vacations/requests');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      total: 0,
      page: 1,
      pageSize: 50,
      rows: [],
    });
  });

  it('POST /api/vacations returns 400 when no approvers are configured', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'auth-user', teamId: null, hasAccessTotal: false, accessTotalGrantedById: null });
    prismaMock.teamMembership.findMany.mockResolvedValue([]);
    prismaMock.profile.findUnique.mockResolvedValue({
      workCountry: 'PT',
      nomeCompleto: 'Teste User',
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

  it('POST /api/vacations blocks vacation starting on weekend', async () => {
    const app = buildApp();

    const response = await request(app)
      .post('/api/vacations')
      .send({
        dataInicio: '2026-04-18',
        dataFim: '2026-04-21',
        observacoes: 'Férias fim de semana',
        requestType: 'VACATION',
        attachmentLink: '',
        partialDay: 'FULL',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('dia útil');
  });

  it('POST /api/vacations allows absence starting on weekend', async () => {
    const app = buildApp();

    const response = await request(app)
      .post('/api/vacations')
      .send({
        dataInicio: '2026-04-18',
        dataFim: '2026-04-20',
        observacoes: 'Ausência fim de semana',
        requestType: 'ABSENCE_MEDICAL',
        attachmentLink: '',
        partialDay: 'FULL',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Não existem aprovadores');
  });

  it('PUT /api/vacations/:id blocks vacation ending on weekend', async () => {
    const app = buildApp();

    const response = await request(app)
      .put('/api/vacations/v-1')
      .send({
        dataInicio: '2026-04-16',
        dataFim: '2026-04-19',
        observacoes: 'Edição férias fim de semana',
        requestType: 'VACATION',
        attachmentLink: '',
        partialDay: 'FULL',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('dia útil');
  });

  it('PUT /api/vacations/:id allows absence ending on weekend', async () => {
    prismaMock.vacation.findFirst.mockResolvedValue({
      id: 'v-1',
      userId: 'auth-user',
      status: 'PENDING',
      contextTeamId: null,
      versionOfId: null,
      versionNumber: 1,
      contextTeam: null,
    });

    const app = buildApp();

    const response = await request(app)
      .put('/api/vacations/v-1')
      .send({
        dataInicio: '2026-04-17',
        dataFim: '2026-04-19',
        observacoes: 'Edição ausência fim de semana',
        requestType: 'ABSENCE_TRAINING',
        attachmentLink: '',
        partialDay: 'FULL',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Não existem aprovadores');
  });

  it('PUT /api/vacations/:id versions approved request and sends it back for approval', async () => {
    prismaMock.vacation.findFirst
      .mockResolvedValueOnce({
        id: 'v-approved',
        userId: 'auth-user',
        status: 'APPROVED',
        contextTeamId: 'team-1',
        versionOfId: null,
        versionNumber: 1,
        dataInicio: '2026-05-12',
        contextTeam: { id: 'team-1' },
      })
      .mockResolvedValueOnce({ versionNumber: 1 })
      .mockResolvedValueOnce(null);

    prismaMock.profile.findUnique
      .mockResolvedValueOnce({ workCountry: 'PT', dataInicioContrato: '2024-01-01', isIntern: false })
      .mockResolvedValueOnce({ nomeCompleto: 'Teste User', nomeAbreviado: 'Teste User' });

    prismaMock.user.findUnique.mockResolvedValue({
      id: 'auth-user',
      hasAccessTotal: false,
      accessTotalGrantedById: null,
      teamId: 'team-1',
      profile: { workCountry: 'PT' },
    });
    prismaMock.team.findMany.mockResolvedValue([{ id: 'team-1', managerId: 'manager-1', parentTeamId: null }]);
    prismaMock.user.findMany.mockResolvedValue([{ id: 'manager-1', isActive: true }]);
    prismaMock.team.findUnique.mockResolvedValue({ name: 'Equipa A' });
    prismaMock.vacation.create.mockResolvedValue({
      id: 'v-version-2',
      userId: 'auth-user',
      contextTeamId: 'team-1',
      versionOfId: 'v-approved',
      versionNumber: 2,
      dataInicio: '2026-05-15',
      dataFim: '2026-05-18',
      observacoes: 'Ajuste após aprovação',
      requestType: 'ABSENCE_TRAINING',
      partialDay: 'FULL',
      attachmentLink: '',
      status: 'PENDING',
    });

    const app = buildApp();
    const response = await request(app)
      .put('/api/vacations/v-approved')
      .send({
        dataInicio: '2026-05-15',
        dataFim: '2026-05-18',
        observacoes: 'Ajuste após aprovação',
        requestType: 'ABSENCE_TRAINING',
        attachmentLink: '',
        contextTeamId: 'team-1',
        partialDay: 'FULL',
      });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('PENDING');
    expect(response.body.versionOfId).toBe('v-approved');
    expect(response.body.versionNumber).toBe(2);
    expect(prismaMock.vacation.update).toHaveBeenCalledWith({
      where: { id: 'v-approved' },
      data: {
        status: 'CANCELLED',
        reviewReason: 'Pedido substituído por nova versão.',
      },
    });
    expect(prismaMock.vacationApproval.create).toHaveBeenCalledWith({
      data: {
        vacationId: 'v-version-2',
        approverId: 'manager-1',
        approvalLevel: 1,
        status: 'PENDING',
      },
    });
  });
});
