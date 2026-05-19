import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  prismaMock,
  permissionEngineMock,
  hourBankLibMock,
  occupationalHealthAlertsMock,
  authState,
} = vi.hoisted(() => ({
  prismaMock: {
    user: {
      findUnique: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    hourBankEntry: {
      groupBy: vi.fn(),
    },
    weeklyHourBankReport: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    team: {
      findMany: vi.fn(),
    },
    teamMembership: {
      findMany: vi.fn(),
    },
  },
  permissionEngineMock: {
    hasPermission: vi.fn(),
    isAccessTotal: vi.fn(),
    canAccessUserByPermission: vi.fn(),
    canReviewAccessTotalHierarchy: vi.fn(),
  },
  hourBankLibMock: {
    appendHourBankEntry: vi.fn(),
    createOrGetWeeklyHourBankReport: vi.fn(),
    filterUserIdsByWorkCountry: vi.fn(),
    getHourBankTotalsByUserId: vi.fn(),
    getNextClosingDateByPolicy: vi.fn(),
    notifyHourBankExceedance: vi.fn(),
    resolveAccessTotalRecipientIds: vi.fn(),
    resolveBrClosingPolicy: vi.fn(),
    resolveBrHourBankLimit: vi.fn(),
    resolveLeadershipRecipientsForUser: vi.fn(),
  },
  occupationalHealthAlertsMock: {
    getOccupationalHealthAlertsEnabled: vi.fn(),
    setOccupationalHealthAlertsEnabled: vi.fn(),
  },
  authState: {
    user: {
      id: 'auth-user',
      username: 'tester',
      email: 'tester@example.com',
      role: 'COLABORADOR',
      isActive: true,
      isRootAccess: false,
      hasAccessTotal: false,
    },
  },
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../src/lib/permission-engine.js', () => permissionEngineMock);
vi.mock('../src/lib/hour-bank.js', () => hourBankLibMock);
vi.mock('../src/lib/occupational-health-alerts.js', () => occupationalHealthAlertsMock);

vi.mock('../src/middleware/auth.js', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.authUser = { ...authState.user };
    next();
  },
}));

import { hourBankRouter } from '../src/routes/hour-bank.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', hourBankRouter);
  return app;
}

describe('hour bank routes integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    authState.user = {
      id: 'auth-user',
      username: 'tester',
      email: 'tester@example.com',
      role: 'COLABORADOR',
      isActive: true,
      isRootAccess: false,
      hasAccessTotal: false,
    };

    prismaMock.user.findUnique.mockResolvedValue({
      id: 'auth-user',
      username: 'tester',
      profile: { workCountry: 'BR' },
      teamId: null,
    });
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.user.findMany.mockResolvedValue([
      {
        id: 'user-1',
        username: 'alice',
        email: 'alice@example.com',
        team: { id: 'team-1', name: 'Equipe A' },
        profile: {
          nomeCompleto: 'Alice Example',
          nomeAbreviado: 'Alice',
          workCountry: 'BR',
          brWorkState: 'SP',
          hourBankLimitHours: 40,
        },
      },
    ]);
    prismaMock.hourBankEntry.groupBy.mockResolvedValue([{ userId: 'user-1', _sum: { hours: 10 } }]);
    prismaMock.weeklyHourBankReport.count.mockResolvedValue(2);
    prismaMock.weeklyHourBankReport.findMany.mockResolvedValue([
      {
        id: 'report-1',
        weekLabel: '2026-W10',
        generatedAt: new Date('2026-03-12T10:00:00.000Z'),
        periodStart: '2026-03-02',
        periodEnd: '2026-03-08',
        totalUsers: 10,
        positiveUsers: 5,
        negativeUsers: 3,
        exceededUsers: 2,
        pdfFileName: 'report-1.pdf',
        pdfPublicUrl: 'https://example.com/report-1.pdf',
      },
    ]);

    permissionEngineMock.hasPermission.mockResolvedValue(true);
    permissionEngineMock.isAccessTotal.mockResolvedValue(false);
    permissionEngineMock.canAccessUserByPermission.mockResolvedValue(true);
    permissionEngineMock.canReviewAccessTotalHierarchy.mockResolvedValue(true);

    hourBankLibMock.resolveBrHourBankLimit.mockImplementation((value: number | null | undefined) => value ?? 40);
    hourBankLibMock.resolveBrClosingPolicy.mockReturnValue({ label: 'Fechamento BR' });
    hourBankLibMock.getHourBankTotalsByUserId.mockResolvedValue({
      creditedHours: 10,
      debitedHours: 2,
      totalHours: 8,
      limitHours: 40,
      exceededByHours: 0,
    });
    hourBankLibMock.getNextClosingDateByPolicy.mockReturnValue(new Date('2026-12-31T00:00:00.000Z'));
  });

  describe('GET /api/hours-bank/overview', () => {
    it('returns 403 when actor is not from BR', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'auth-user',
        username: 'tester',
        profile: { workCountry: 'PT' },
      });

      const app = buildApp();
      const response = await request(app).get('/api/hours-bank/overview?page=1&pageSize=10');

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('Brasil');
    });

    it('returns 400 when pagination is missing', async () => {
      const app = buildApp();
      const response = await request(app).get('/api/hours-bank/overview');

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('expected number');
    });

    it('returns paginated overview when query is valid', async () => {
      const app = buildApp();
      const response = await request(app).get('/api/hours-bank/overview?page=1&pageSize=10');

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1);
      expect(response.body.page).toBe(1);
      expect(response.body.pageSize).toBe(10);
      expect(Array.isArray(response.body.rows)).toBe(true);
    });
  });

  describe('GET /api/hours-bank/reports', () => {
    it('returns 400 when pagination is missing', async () => {
      const app = buildApp();
      const response = await request(app).get('/api/hours-bank/reports');

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('expected number');
    });

    it('returns paginated reports when query is valid', async () => {
      const app = buildApp();
      const response = await request(app).get('/api/hours-bank/reports?page=1&pageSize=10');

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(2);
      expect(response.body.page).toBe(1);
      expect(response.body.pageSize).toBe(10);
      expect(Array.isArray(response.body.rows)).toBe(true);
    });
  });
});
