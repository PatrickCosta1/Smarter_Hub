import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, permissionEngineMock, notificationsMock } = vi.hoisted(() => ({
  prismaMock: {
    training: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    team: {
      findMany: vi.fn(),
    },
  },
  permissionEngineMock: {
    hasPermission: vi.fn(),
    getPermissionScope: vi.fn(),
    buildUserWhereFromScope: vi.fn(),
    canAccessUserByPermission: vi.fn(),
    canReviewAccessTotalHierarchy: vi.fn(),
  },
  notificationsMock: {
    notifyUsers: vi.fn(),
    notifyUsersByPermission: vi.fn(),
  },
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../src/lib/permission-engine.js', () => permissionEngineMock);

vi.mock('../src/lib/notifications.js', () => notificationsMock);

vi.mock('../src/middleware/auth.js', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.authUser = {
      id: 'auth-user',
      username: 'tester',
      email: 'tester@example.com',
      role: 'COLABORADOR',
      isActive: true,
      isRootAccess: false,
      hasAccessTotal: false,
    };
    next();
  },
}));

import { trainingsRouter } from '../src/routes/trainings.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', trainingsRouter);
  return app;
}

const sampleTraining = {
  id: 'training-1',
  userId: 'auth-user',
  nome: 'Formação React',
  link: 'https://example.com',
  horas: 8,
  dataInicio: '2026-01-10',
  entidade: 'Entidade A',
  dataConclusao: '',
  status: 'ASSIGNED',
  assignedByUserId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('trainings routes integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prismaMock.training.findMany.mockResolvedValue([]);
    prismaMock.training.count.mockResolvedValue(0);
    prismaMock.training.findFirst.mockResolvedValue(null);
    prismaMock.training.create.mockResolvedValue(sampleTraining);
    prismaMock.training.update.mockResolvedValue(sampleTraining);
    prismaMock.training.delete.mockResolvedValue(sampleTraining);
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.team.findMany.mockResolvedValue([]);
    permissionEngineMock.hasPermission.mockResolvedValue(true);
    permissionEngineMock.getPermissionScope.mockResolvedValue({ isGlobal: true, restrictedToTeams: null });
    permissionEngineMock.buildUserWhereFromScope.mockReturnValue(null);
    permissionEngineMock.canAccessUserByPermission.mockResolvedValue(true);
    permissionEngineMock.canReviewAccessTotalHierarchy.mockResolvedValue(true);
    notificationsMock.notifyUsers.mockResolvedValue(undefined);
    notificationsMock.notifyUsersByPermission.mockResolvedValue(undefined);
  });

  // ─── GET /trainings/me ───────────────────────────────────────────────────

  describe('GET /api/trainings/me', () => {
    it('returns 403 when user lacks view_trainings permission', async () => {
      permissionEngineMock.hasPermission.mockResolvedValue(false);

      const app = buildApp();
      const response = await request(app).get('/api/trainings/me');

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('permissões');
    });

    it('returns array of trainings without pagination', async () => {
      prismaMock.training.findMany.mockResolvedValue([sampleTraining]);

      const app = buildApp();
      const response = await request(app).get('/api/trainings/me');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body[0].id).toBe('training-1');
    });

    it('returns paginated trainings when page param is provided', async () => {
      prismaMock.training.count.mockResolvedValue(3);
      prismaMock.training.findMany.mockResolvedValue([sampleTraining]);

      const app = buildApp();
      const response = await request(app).get('/api/trainings/me?page=1&pageSize=2');

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(3);
      expect(response.body.page).toBe(1);
      expect(Array.isArray(response.body.rows)).toBe(true);
    });
  });

  // ─── GET /trainings/team ─────────────────────────────────────────────────

  describe('GET /api/trainings/team', () => {
    it('returns 403 when user lacks all training permissions', async () => {
      permissionEngineMock.hasPermission.mockResolvedValue(false);

      const app = buildApp();
      const response = await request(app).get('/api/trainings/team');

      expect(response.status).toBe(403);
    });

    it('returns empty array when user leads no teams', async () => {
      permissionEngineMock.hasPermission.mockResolvedValue(true);
      prismaMock.team.findMany.mockResolvedValue([]);

      const app = buildApp();
      const response = await request(app).get('/api/trainings/team');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('returns team trainings when user leads teams', async () => {
      permissionEngineMock.hasPermission.mockResolvedValue(true);
      prismaMock.team.findMany.mockResolvedValue([{ id: 'team-1' }]);
      prismaMock.training.findMany.mockResolvedValue([sampleTraining]);

      const app = buildApp();
      const response = await request(app).get('/api/trainings/team');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  // ─── GET /trainings/hierarchy ─────────────────────────────────────────────

  describe('GET /api/trainings/hierarchy', () => {
    it('returns 403 when user lacks view_all_trainings permission', async () => {
      permissionEngineMock.hasPermission.mockResolvedValue(false);

      const app = buildApp();
      const response = await request(app).get('/api/trainings/hierarchy');

      expect(response.status).toBe(403);
    });

    it('returns 403 when scope is not found', async () => {
      permissionEngineMock.hasPermission.mockResolvedValue(true);
      permissionEngineMock.getPermissionScope.mockResolvedValue(null);

      const app = buildApp();
      const response = await request(app).get('/api/trainings/hierarchy');

      expect(response.status).toBe(403);
    });

    it('returns hierarchy trainings when authorized', async () => {
      permissionEngineMock.hasPermission.mockResolvedValue(true);
      permissionEngineMock.getPermissionScope.mockResolvedValue({ isGlobal: true, restrictedToTeams: null });
      prismaMock.training.findMany.mockResolvedValue([]);

      const app = buildApp();
      const response = await request(app).get('/api/trainings/hierarchy');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  // ─── GET /trainings/assigned ──────────────────────────────────────────────

  describe('GET /api/trainings/assigned', () => {
    it('returns 403 when user lacks view_all_trainings permission', async () => {
      permissionEngineMock.hasPermission.mockResolvedValue(false);

      const app = buildApp();
      const response = await request(app).get('/api/trainings/assigned');

      expect(response.status).toBe(403);
    });

    it('returns assigned trainings list when authorized', async () => {
      permissionEngineMock.hasPermission.mockResolvedValue(true);
      permissionEngineMock.getPermissionScope.mockResolvedValue({ isGlobal: true, restrictedToTeams: null });
      prismaMock.training.findMany.mockResolvedValue([{ ...sampleTraining, assignedByUserId: 'manager-1' }]);

      const app = buildApp();
      const response = await request(app).get('/api/trainings/assigned');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  // ─── POST /trainings ──────────────────────────────────────────────────────

  describe('POST /api/trainings', () => {
    it('returns 403 when user lacks request_training permission', async () => {
      permissionEngineMock.hasPermission.mockResolvedValue(false);

      const app = buildApp();
      const response = await request(app).post('/api/trainings').send({ nome: 'Formação', horas: 4 });

      expect(response.status).toBe(403);
    });

    it('returns 400 when nome is empty', async () => {
      const app = buildApp();
      const response = await request(app).post('/api/trainings').send({ nome: '', horas: 4 });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Nome');
    });

    it('returns 400 when horas is negative', async () => {
      const app = buildApp();
      const response = await request(app).post('/api/trainings').send({ nome: 'Formação', horas: -1 });

      expect(response.status).toBe(400);
    });

    it('creates training and returns 201', async () => {
      prismaMock.training.create.mockResolvedValue(sampleTraining);

      const app = buildApp();
      const response = await request(app).post('/api/trainings').send({
        nome: 'Formação React',
        horas: 8,
        link: 'https://example.com',
        dataInicio: '2026-01-10',
        entidade: 'Entidade A',
      });

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('training-1');
    });
  });

  // ─── POST /trainings/assign ───────────────────────────────────────────────

  describe('POST /api/trainings/assign', () => {
    it('returns 400 when userId is empty', async () => {
      const app = buildApp();
      const response = await request(app).post('/api/trainings/assign').send({
        userId: '',
        nome: 'Formação',
        horas: 4,
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Colaborador');
    });

    it('returns 403 when actor has no assign_training permission and target is different user', async () => {
      permissionEngineMock.hasPermission
        .mockResolvedValueOnce(false)   // assign_training → false
        .mockResolvedValueOnce(false);  // request_training → false

      const app = buildApp();
      const response = await request(app).post('/api/trainings/assign').send({
        userId: 'other-user',
        nome: 'Formação',
        horas: 4,
      });

      expect(response.status).toBe(403);
    });

    it('returns 404 when collaborator is not found', async () => {
      permissionEngineMock.hasPermission.mockResolvedValue(true);
      permissionEngineMock.canAccessUserByPermission.mockResolvedValue(true);
      prismaMock.user.findUnique.mockResolvedValue(null);

      const app = buildApp();
      const response = await request(app).post('/api/trainings/assign').send({
        userId: 'nonexistent',
        nome: 'Formação',
        horas: 4,
      });

      expect(response.status).toBe(404);
      expect(response.body.error).toContain('não encontrado');
    });

    it('assigns training and returns 201', async () => {
      permissionEngineMock.hasPermission.mockResolvedValue(true);
      permissionEngineMock.canAccessUserByPermission.mockResolvedValue(true);
      prismaMock.user.findUnique.mockResolvedValue({ id: 'collab-1', username: 'collab' });
      prismaMock.training.create.mockResolvedValue({ ...sampleTraining, userId: 'collab-1', status: 'ASSIGNED' });

      const app = buildApp();
      const response = await request(app).post('/api/trainings/assign').send({
        userId: 'collab-1',
        nome: 'Formação Avançada',
        horas: 12,
      });

      expect(response.status).toBe(201);
      expect(notificationsMock.notifyUsers).toHaveBeenCalledWith(
        expect.anything(),
        ['collab-1'],
        expect.any(String),
        expect.any(String),
      );
    });
  });

  // ─── POST /trainings/:id/complete ─────────────────────────────────────────

  describe('POST /api/trainings/:id/complete', () => {
    it('returns 403 when user lacks mark_training_completed permission', async () => {
      permissionEngineMock.hasPermission.mockResolvedValue(false);

      const app = buildApp();
      const response = await request(app).post('/api/trainings/training-1/complete');

      expect(response.status).toBe(403);
    });

    it('returns 404 when training is not found', async () => {
      prismaMock.training.findFirst.mockResolvedValue(null);

      const app = buildApp();
      const response = await request(app).post('/api/trainings/nonexistent/complete');

      expect(response.status).toBe(404);
    });

    it('returns 400 when training is not in ASSIGNED status', async () => {
      prismaMock.training.findFirst.mockResolvedValue({ ...sampleTraining, status: 'COMPLETED' });

      const app = buildApp();
      const response = await request(app).post('/api/trainings/training-1/complete');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('não está atribuída');
    });

    it('marks training as completed', async () => {
      prismaMock.training.findFirst.mockResolvedValue({ ...sampleTraining, status: 'ASSIGNED' });
      prismaMock.training.update.mockResolvedValue({ ...sampleTraining, status: 'COMPLETED' });

      const app = buildApp();
      const response = await request(app).post('/api/trainings/training-1/complete');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('COMPLETED');
    });
  });

  // ─── PUT /trainings/:id ───────────────────────────────────────────────────

  describe('PUT /api/trainings/:id', () => {
    it('returns 403 when user lacks request_training permission', async () => {
      permissionEngineMock.hasPermission.mockResolvedValue(false);

      const app = buildApp();
      const response = await request(app).put('/api/trainings/training-1').send({ nome: 'Atualizado', horas: 4 });

      expect(response.status).toBe(403);
    });

    it('returns 404 when training is not found', async () => {
      prismaMock.training.findFirst.mockResolvedValue(null);

      const app = buildApp();
      const response = await request(app).put('/api/trainings/nonexistent').send({ nome: 'Atualizado', horas: 4 });

      expect(response.status).toBe(404);
    });

    it('updates training successfully', async () => {
      prismaMock.training.findFirst.mockResolvedValue(sampleTraining);
      prismaMock.training.update.mockResolvedValue({ ...sampleTraining, nome: 'Atualizado' });

      const app = buildApp();
      const response = await request(app).put('/api/trainings/training-1').send({ nome: 'Atualizado', horas: 4 });

      expect(response.status).toBe(200);
      expect(response.body.nome).toBe('Atualizado');
    });
  });

  // ─── DELETE /trainings/:id ────────────────────────────────────────────────

  describe('DELETE /api/trainings/:id', () => {
    it('returns 403 when user lacks request_training permission', async () => {
      permissionEngineMock.hasPermission.mockResolvedValue(false);

      const app = buildApp();
      const response = await request(app).delete('/api/trainings/training-1');

      expect(response.status).toBe(403);
    });

    it('returns 404 when training is not found', async () => {
      prismaMock.training.findFirst.mockResolvedValue(null);

      const app = buildApp();
      const response = await request(app).delete('/api/trainings/nonexistent');

      expect(response.status).toBe(404);
    });

    it('deletes training and returns success', async () => {
      prismaMock.training.findFirst.mockResolvedValue(sampleTraining);
      prismaMock.training.delete.mockResolvedValue(sampleTraining);

      const app = buildApp();
      const response = await request(app).delete('/api/trainings/training-1');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});
