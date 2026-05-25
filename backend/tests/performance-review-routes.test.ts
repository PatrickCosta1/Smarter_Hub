import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authConfig, prismaMock, permissionEngineMock, serviceMock, competencyServiceMock } = vi.hoisted(() => ({
  authConfig: {
    currentUser: {
      id: 'auth-user',
      username: 'tester',
      email: 'tester@example.com',
      role: 'ADMIN' as const,
      isActive: true,
      isRootAccess: false,
      hasAccessTotal: false,
    },
  },
  prismaMock: {
    performanceReviewCycle: {
      findUnique: vi.fn(),
    },
    performanceReviewSubmission: {
      findUnique: vi.fn(),
    },
  },
  permissionEngineMock: {
    hasPermission: vi.fn(),
  },
  serviceMock: {
    findOrCreatePerformanceReviewCycle: vi.fn(),
    getPerformanceReviewSubmission: vi.fn(),
    createPerformanceReviewSubmission: vi.fn(),
    updatePerformanceReviewSubmission: vi.fn(),
    submitPerformanceReviewSubmission: vi.fn(),
    proposeEditsToSubmission: vi.fn(),
    acceptProposedEdits: vi.fn(),
    rejectProposedEdits: vi.fn(),
    acceptSubmission: vi.fn(),
    getPerformanceReviewSubmissionHistory: vi.fn(),
    getSubmissionsByUserAndCycle: vi.fn(),
  },
  competencyServiceMock: {
    getBehavioralCompetenciesByLevel: vi.fn(),
    getLeadershipReflectionQuestions: vi.fn(),
  },
}));

vi.mock('../src/middleware/auth.js', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.authUser = authConfig.currentUser;
    next();
  },
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../src/lib/permission-engine.js', () => permissionEngineMock);
vi.mock('../src/lib/performance-review.service.js', () => serviceMock);
vi.mock('../src/lib/behavioral-competencies.service.js', () => competencyServiceMock);

import { performanceReviewRouter } from '../src/routes/performance-review.js';

function buildApp(authOverride?: Partial<typeof authConfig.currentUser>) {
  authConfig.currentUser = authOverride ? { ...authConfig.currentUser, ...authOverride } : authConfig.currentUser;
  const app = express();
  app.use(express.json());
  app.use('/api', performanceReviewRouter);
  return app;
}

describe('performance review routes', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    authConfig.currentUser = {
      id: 'auth-user',
      username: 'tester',
      email: 'tester@example.com',
      role: 'ADMIN',
      isActive: true,
      isRootAccess: false,
      hasAccessTotal: false,
    };

    permissionEngineMock.hasPermission.mockResolvedValue(true);
    prismaMock.performanceReviewCycle.findUnique.mockResolvedValue({ id: 'cycle-1', cycleIdentifier: '2026' });
    prismaMock.performanceReviewSubmission.findUnique.mockResolvedValue({ id: 'sub-1', userId: 'auth-user', status: 'DRAFT' });

    serviceMock.findOrCreatePerformanceReviewCycle.mockResolvedValue({ id: 'cycle-1', cycleIdentifier: '2026' });
    serviceMock.getPerformanceReviewSubmission.mockResolvedValue(null);
    serviceMock.createPerformanceReviewSubmission.mockResolvedValue({ id: 'sub-1', status: 'DRAFT' });
    serviceMock.updatePerformanceReviewSubmission.mockResolvedValue({ id: 'sub-1', status: 'DRAFT' });
    serviceMock.submitPerformanceReviewSubmission.mockResolvedValue({ id: 'sub-1', status: 'SUBMITTED' });
    serviceMock.proposeEditsToSubmission.mockResolvedValue({ id: 'sub-1', status: 'AWAITING_RESPONSE' });
    serviceMock.acceptProposedEdits.mockResolvedValue({ id: 'sub-1', status: 'REVISED' });
    serviceMock.rejectProposedEdits.mockResolvedValue({ id: 'sub-1', status: 'SUBMITTED' });
    serviceMock.acceptSubmission.mockResolvedValue({ id: 'sub-1', status: 'ACCEPTED' });
    serviceMock.getPerformanceReviewSubmissionHistory.mockResolvedValue([]);
    serviceMock.getSubmissionsByUserAndCycle.mockResolvedValue([]);

    competencyServiceMock.getBehavioralCompetenciesByLevel.mockResolvedValue([]);
    competencyServiceMock.getLeadershipReflectionQuestions.mockResolvedValue([]);
  });

  it('GET /api/performance-review/cycles/:cycleId returns 404 when cycle does not exist', async () => {
    prismaMock.performanceReviewCycle.findUnique.mockResolvedValue(null);

    const app = buildApp();
    const response = await request(app).get('/api/performance-review/cycles/missing-cycle');

    expect(response.status).toBe(404);
    expect(response.body.message).toContain('não encontrado');
  });

  it('POST /api/performance-review/cycles returns 403 without permission', async () => {
    permissionEngineMock.hasPermission.mockResolvedValue(false);

    const app = buildApp();
    const response = await request(app)
      .post('/api/performance-review/cycles')
      .send({ cycleIdentifier: '2026' });

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('Sem permissões');
  });

  it('POST /api/performance-review/cycles creates cycle with permission', async () => {
    const app = buildApp();
    const response = await request(app)
      .post('/api/performance-review/cycles')
      .send({ cycleIdentifier: '2026' });

    expect(response.status).toBe(201);
    expect(serviceMock.findOrCreatePerformanceReviewCycle).toHaveBeenCalledWith('2026');
  });

  it('POST /api/performance-review/:cycleId/submissions returns 409 for duplicate submission', async () => {
    serviceMock.getPerformanceReviewSubmission.mockResolvedValue({ id: 'sub-duplicate' });

    const app = buildApp();
    const response = await request(app)
      .post('/api/performance-review/cycle-1/submissions')
      .send({
        cycleId: 'cycle-1',
        userId: 'auth-user',
        sectionType: 'REFLECTION_PREVIOUS_CYCLE',
        collaboratorType: 'SELF',
        content: { mainDeliveries: 'X' },
      });

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('já existe');
  });

  it('POST /api/performance-review/:cycleId/submissions creates submission', async () => {
    const app = buildApp();
    const response = await request(app)
      .post('/api/performance-review/cycle-1/submissions')
      .send({
        cycleId: 'cycle-1',
        userId: 'auth-user',
        sectionType: 'REFLECTION_PREVIOUS_CYCLE',
        collaboratorType: 'SELF',
        content: { mainDeliveries: 'Entrega principal' },
      });

    expect(response.status).toBe(201);
    expect(serviceMock.createPerformanceReviewSubmission).toHaveBeenCalled();
  });

  it('POST /api/performance-review/submissions/:submissionId/submit returns 404 when missing submission', async () => {
    prismaMock.performanceReviewSubmission.findUnique.mockResolvedValue(null);

    const app = buildApp();
    const response = await request(app)
      .post('/api/performance-review/submissions/sub-missing/submit')
      .send({});

    expect(response.status).toBe(404);
    expect(response.body.message).toContain('não encontrada');
  });

  it('POST /api/performance-review/submissions/:submissionId/propose-edits returns 403 when actor is same user', async () => {
    prismaMock.performanceReviewSubmission.findUnique.mockResolvedValue({
      id: 'sub-1',
      userId: 'auth-user',
      status: 'SUBMITTED',
    });

    const app = buildApp();
    const response = await request(app)
      .post('/api/performance-review/submissions/sub-1/propose-edits')
      .send({ proposedEdits: { notes: 'Ajustar objetivo' } });

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('Sem permissões');
  });

  it('GET /api/performance-review/:cycleId/submissions/:userId/history returns data for owner', async () => {
    serviceMock.getPerformanceReviewSubmissionHistory.mockResolvedValue([
      {
        id: 'history-1',
        sectionType: 'REFLECTION_PREVIOUS_CYCLE',
        collaboratorType: 'SELF',
        previousStatus: 'DRAFT',
        newStatus: 'SUBMITTED',
        changeType: 'SUBMITTED',
        createdAt: new Date().toISOString(),
      },
    ]);

    const app = buildApp();
    const response = await request(app).get('/api/performance-review/cycle-1/submissions/auth-user/history');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toHaveLength(1);
  });
});
