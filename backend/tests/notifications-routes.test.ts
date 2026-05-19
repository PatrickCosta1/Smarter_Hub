import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const defaultNotifUser = {
  id: 'auth-user',
  username: 'tester',
  email: 'tester@example.com',
  role: 'COLABORADOR' as const,
  isActive: true,
  isRootAccess: false,
};

const { prismaMock, citizenCardMock, authConfig } = vi.hoisted(() => ({
  prismaMock: {
    notification: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    profile: {
      findUnique: vi.fn(),
    },
    profileChangeRequest: {
      findMany: vi.fn(),
    },
  },
  authConfig: { currentUser: {} as typeof defaultNotifUser },
  citizenCardMock: {
    canReadCitizenCardExpiryNotification: vi.fn(),
    isCitizenCardExpiryNotification: vi.fn(),
    CITIZEN_CARD_EXPIRY_NOTIFICATION_TITLE: 'Validade do cartão de cidadão a expirar',
  },
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../src/lib/citizen-card-expiry-notifications.js', () => citizenCardMock);

vi.mock('../src/middleware/auth.js', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.authUser = authConfig.currentUser;
    next();
  },
}));

import { notificationsRouter } from '../src/routes/notifications.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', notificationsRouter);
  return app;
}

describe('notifications routes integration', () => {
  beforeEach(() => {
    authConfig.currentUser = defaultNotifUser;
    vi.resetAllMocks();
    prismaMock.notification.findMany.mockResolvedValue([]);
    prismaMock.notification.count.mockResolvedValue(0);
    prismaMock.notification.findFirst.mockResolvedValue(null);
    prismaMock.notification.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.notification.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.profile.findUnique.mockResolvedValue(null);
    prismaMock.profileChangeRequest.findMany.mockResolvedValue([]);
    citizenCardMock.canReadCitizenCardExpiryNotification.mockResolvedValue(true);
    citizenCardMock.isCitizenCardExpiryNotification.mockReturnValue(false);
  });

  // ─── GET /notifications/me ────────────────────────────────────────────────

  describe('GET /api/notifications/me', () => {
    it('returns 400 when pagination is missing', async () => {

      const app = buildApp();
      const response = await request(app).get('/api/notifications/me');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('paginação');
    });

    it('returns paginated response when page and pageSize are provided', async () => {
      prismaMock.notification.count.mockResolvedValue(5);
      prismaMock.notification.findMany.mockResolvedValue([
        { id: 'n1', userId: 'auth-user', title: 'Aviso', isRead: false, createdAt: new Date() },
      ]);

      const app = buildApp();
      const response = await request(app).get('/api/notifications/me?page=1&pageSize=2');

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(5);
      expect(response.body.page).toBe(1);
      expect(response.body.pageSize).toBe(2);
      expect(Array.isArray(response.body.rows)).toBe(true);
    });

    it('returns empty paginated rows when no notifications exist', async () => {
      prismaMock.notification.count.mockResolvedValue(0);
      prismaMock.notification.findMany.mockResolvedValue([]);

      const app = buildApp();
      const response = await request(app).get('/api/notifications/me?page=1&pageSize=20');

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(0);
      expect(response.body.rows).toEqual([]);
    });
  });

  // ─── PATCH /notifications/:id/read ───────────────────────────────────────

  describe('PATCH /api/notifications/:id/read', () => {
    it('returns 404 when notification is not found or belongs to another user', async () => {
      prismaMock.notification.findFirst.mockResolvedValue(null);

      const app = buildApp();
      const response = await request(app).patch('/api/notifications/nonexistent/read');

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('não encontrada');
    });

    it('returns updated: 0 when notification is already read', async () => {
      prismaMock.notification.findFirst.mockResolvedValue({
        id: 'n1',
        userId: 'auth-user',
        title: 'Aviso',
        isRead: true,
        createdAt: new Date(),
      });

      const app = buildApp();
      const response = await request(app).patch('/api/notifications/n1/read');

      expect(response.status).toBe(200);
      expect(response.body.updated).toBe(0);
    });

    it('returns 409 when citizen card notification cannot be read yet', async () => {
      prismaMock.notification.findFirst.mockResolvedValue({
        id: 'n1',
        userId: 'auth-user',
        title: 'Validade do cartão de cidadão a expirar',
        isRead: false,
        createdAt: new Date(),
      });
      citizenCardMock.canReadCitizenCardExpiryNotification.mockResolvedValue(false);

      const app = buildApp();
      const response = await request(app).patch('/api/notifications/n1/read');

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('cartão de cidadão');
    });

    it('marks notification as read successfully', async () => {
      prismaMock.notification.findFirst.mockResolvedValue({
        id: 'n1',
        userId: 'auth-user',
        title: 'Aviso',
        isRead: false,
        createdAt: new Date(),
      });
      citizenCardMock.canReadCitizenCardExpiryNotification.mockResolvedValue(true);
      prismaMock.notification.updateMany.mockResolvedValue({ count: 1 });

      const app = buildApp();
      const response = await request(app).patch('/api/notifications/n1/read');

      expect(response.status).toBe(200);
      expect(response.body.updated).toBe(1);
    });
  });

  // ─── PATCH /notifications/read-all ───────────────────────────────────────

  describe('PATCH /api/notifications/read-all', () => {
    it('returns updated and skipped counts', async () => {
      prismaMock.profile.findUnique.mockResolvedValue({
        updatedAt: new Date(),
        validadeCartaoCidadao: '2030-01-01',
        comprovativoCartaoCidadao: 'link.pdf',
      });
      // Return empty batch to immediately stop loop
      prismaMock.notification.findMany.mockResolvedValue([]);

      const app = buildApp();
      const response = await request(app).patch('/api/notifications/read-all');

      expect(response.status).toBe(200);
      expect(typeof response.body.updated).toBe('number');
      expect(typeof response.body.skipped).toBe('number');
    });

    it('processes a batch of plain notifications without skipping', async () => {
      prismaMock.profile.findUnique.mockResolvedValue(null);
      prismaMock.notification.findMany
        .mockResolvedValueOnce([
          { id: 'n1', userId: 'auth-user', title: 'Aviso', createdAt: new Date() },
          { id: 'n2', userId: 'auth-user', title: 'Outro aviso', createdAt: new Date() },
        ])
        .mockResolvedValue([]); // next iteration returns empty → stop
      citizenCardMock.isCitizenCardExpiryNotification.mockReturnValue(false);
      prismaMock.notification.updateMany.mockResolvedValue({ count: 2 });

      const app = buildApp();
      const response = await request(app).patch('/api/notifications/read-all');

      expect(response.status).toBe(200);
      expect(response.body.updated).toBe(2);
      expect(response.body.skipped).toBe(0);
    });
  });

  // ─── DELETE /notifications/:id ────────────────────────────────────────────

  describe('DELETE /api/notifications/:id', () => {
    it('deletes notification and returns deleted count', async () => {
      prismaMock.notification.deleteMany.mockResolvedValue({ count: 1 });

      const app = buildApp();
      const response = await request(app).delete('/api/notifications/n1');

      expect(response.status).toBe(200);
      expect(response.body.deleted).toBe(1);
    });

    it('returns deleted: 0 when notification not found', async () => {
      prismaMock.notification.deleteMany.mockResolvedValue({ count: 0 });

      const app = buildApp();
      const response = await request(app).delete('/api/notifications/notexist');

      expect(response.status).toBe(200);
      expect(response.body.deleted).toBe(0);
    });
  });

  // ─── DELETE /notifications ────────────────────────────────────────────────

  describe('DELETE /api/notifications', () => {
    it('deletes all notifications for user and returns count', async () => {
      prismaMock.notification.deleteMany.mockResolvedValue({ count: 5 });

      const app = buildApp();
      const response = await request(app).delete('/api/notifications');

      expect(response.status).toBe(200);
      expect(response.body.deleted).toBe(5);
    });
  });

  // ─── DELETE /notifications/cleanup ───────────────────────────────────────

  describe('DELETE /api/notifications/cleanup', () => {
    it('returns 403 for non-admin user', async () => {
      const app = buildApp();
      const response = await request(app).delete('/api/notifications/cleanup');

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('permissões');
    });

    it('allows ADMIN to execute cleanup', async () => {
      authConfig.currentUser = {
        id: 'admin-user',
        username: 't.people',
        email: 'admin@example.com',
        role: 'ADMIN',
        isActive: true,
        isRootAccess: true,
      };
      prismaMock.notification.deleteMany.mockResolvedValue({ count: 10 });

      const app = buildApp();
      const response = await request(app).delete('/api/notifications/cleanup?olderThanDays=30');

      expect(response.status).toBe(200);
      expect(response.body.deleted).toBe(10);
      expect(response.body.olderThanDays).toBe(30);
    });
  });
});
