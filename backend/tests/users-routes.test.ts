import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { prismaMock, permissionEngineMock, authConfig } = vi.hoisted(() => ({
  authConfig: { currentUser: {} as Record<string, unknown> },
  prismaMock: {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    team: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    teamMembership: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
    profile: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    permission: {
      findMany: vi.fn(),
    },
    userPermission: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    vacation: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    training: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
    profileChangeRequest: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  permissionEngineMock: {
    hasPermission: vi.fn(),
    getPermissionScope: vi.fn(),
    buildUserWhereFromScope: vi.fn(),
    canAccessUserByPermission: vi.fn(),
    isAccessTotal: vi.fn(),
    canReviewAccessTotalHierarchy: vi.fn(),
  },
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../src/lib/permission-engine.js', () => permissionEngineMock);

// Default auth user - ADMIN with full access
const defaultAuthUser = {
  id: 'auth-user',
  username: 'admin',
  email: 'admin@example.com',
  role: 'ADMIN' as const,
  isActive: true,
  isRootAccess: true,
  hasAccessTotal: true,
};

vi.mock('../src/middleware/auth.js', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.authUser = authConfig.currentUser as typeof defaultAuthUser;
    next();
  },
}));

import { usersRouter } from '../src/routes/users.js';

function buildApp(authOverride?: Partial<typeof defaultAuthUser>) {
  authConfig.currentUser = authOverride ? { ...defaultAuthUser, ...authOverride } : defaultAuthUser;
  const app = express();
  app.use(express.json());
  app.use('/api', usersRouter);
  return app;
}

const sampleUser = {
  id: 'user-1',
  username: 'joao',
  email: 'joao@example.com',
  role: 'COLABORADOR',
  isRootAccess: false,
  hasAccessTotal: false,
  isActive: true,
  deactivatedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  teamId: null,
  team: null,
  teamMemberships: [],
  managedTeams: [],
  profile: null,
};

const sampleTeam = {
  id: 'team-1',
  name: 'Equipa Alpha',
  managerId: null,
  coordinatorId: null,
  parentTeamId: null,
  costCenter: null,
  color: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  manager: null,
  coordinator: null,
  memberships: [],
  _count: { subTeams: 0 },
};

describe('users routes integration', () => {
  beforeEach(() => {
    authConfig.currentUser = defaultAuthUser;
    vi.resetAllMocks();

    // Default permission engine responses - all authorized with global scope
    permissionEngineMock.hasPermission.mockResolvedValue(true);
    permissionEngineMock.getPermissionScope.mockResolvedValue({ isGlobal: true, restrictedToTeams: null });
    permissionEngineMock.buildUserWhereFromScope.mockReturnValue(null);
    permissionEngineMock.canAccessUserByPermission.mockResolvedValue(true);
    permissionEngineMock.isAccessTotal.mockResolvedValue(true);
    permissionEngineMock.canReviewAccessTotalHierarchy.mockResolvedValue(true);

    // Default Prisma responses
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.create.mockResolvedValue(sampleUser);
    prismaMock.user.update.mockResolvedValue(sampleUser);
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.user.delete.mockResolvedValue(sampleUser);
    prismaMock.team.findMany.mockResolvedValue([]);
    prismaMock.team.findUnique.mockResolvedValue(null);
    prismaMock.team.findFirst.mockResolvedValue(null);
    prismaMock.team.create.mockResolvedValue(sampleTeam);
    prismaMock.team.update.mockResolvedValue(sampleTeam);
    prismaMock.team.delete.mockResolvedValue(sampleTeam);
    prismaMock.team.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.teamMembership.createMany.mockResolvedValue({ count: 0 });
    prismaMock.teamMembership.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.teamMembership.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.teamMembership.upsert.mockResolvedValue({});
    prismaMock.teamMembership.findMany.mockResolvedValue([]);
    prismaMock.profile.findUnique.mockResolvedValue(null);
    prismaMock.profile.upsert.mockResolvedValue({});
    prismaMock.profile.update.mockResolvedValue({});
    prismaMock.permission.findMany.mockResolvedValue([]);
    prismaMock.userPermission.upsert.mockResolvedValue({});
    prismaMock.userPermission.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.vacation.findMany.mockResolvedValue([]);
    prismaMock.vacation.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.training.count.mockResolvedValue(0);
    prismaMock.training.findMany.mockResolvedValue([]);
    prismaMock.notification.create.mockResolvedValue({});
    prismaMock.profileChangeRequest.findMany.mockResolvedValue([]);
    prismaMock.$transaction.mockImplementation(async (ops: unknown) => {
      if (Array.isArray(ops)) {
        return Promise.all(ops);
      }
      if (typeof ops === 'function') {
        return ops(prismaMock);
      }
    });
  });

  // ─── GET /users ────────────────────────────────────────────────────────────

  describe('GET /api/users', () => {
    it('returns 403 when user lacks view_user_list permission', async () => {
      permissionEngineMock.hasPermission.mockResolvedValue(false);

      const app = buildApp();
      const response = await request(app).get('/api/users');

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('permissões');
    });

    it('returns 403 when permission scope is null', async () => {
      permissionEngineMock.hasPermission.mockResolvedValue(true);
      permissionEngineMock.getPermissionScope.mockResolvedValue(null);

      const app = buildApp();
      const response = await request(app).get('/api/users');

      expect(response.status).toBe(403);
    });

    it('returns user list when authorized', async () => {
      prismaMock.user.findMany.mockResolvedValue([{
        ...sampleUser,
        teamMemberships: [],
        managedTeams: [],
      }]);

      const app = buildApp();
      const response = await request(app).get('/api/users');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body[0].id).toBe('user-1');
    });

    it('returns empty array when no users found', async () => {
      prismaMock.user.findMany.mockResolvedValue([]);

      const app = buildApp();
      const response = await request(app).get('/api/users');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });
  });

  // ─── GET /users/collaborators ─────────────────────────────────────────────

  describe('GET /api/users/collaborators', () => {
    it('returns 403 when permission scope is null', async () => {
      permissionEngineMock.getPermissionScope.mockResolvedValue(null);

      const app = buildApp();
      const response = await request(app).get('/api/users/collaborators');

      expect(response.status).toBe(403);
    });

    it('returns paginated collaborators list', async () => {
      prismaMock.user.count.mockResolvedValue(2);
      prismaMock.user.findMany.mockResolvedValue([{
        ...sampleUser,
        teamMemberships: [],
        managedTeams: [],
      }]);

      const app = buildApp();
      const response = await request(app).get('/api/users/collaborators');

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(2);
      expect(response.body.page).toBe(1);
      expect(Array.isArray(response.body.rows)).toBe(true);
    });
  });

  // ─── PATCH /users/:id/active ──────────────────────────────────────────────

  describe('PATCH /api/users/:id/active', () => {
    it('returns 403 when user lacks manage_user_active permission', async () => {
      permissionEngineMock.hasPermission.mockResolvedValue(false);

      const app = buildApp();
      const response = await request(app)
        .patch('/api/users/user-1/active')
        .send({ isActive: false });

      expect(response.status).toBe(403);
    });

    it('returns 400 when body isActive field is missing', async () => {
      const app = buildApp();
      const response = await request(app)
        .patch('/api/users/user-1/active')
        .send({});

      expect(response.status).toBe(400);
    });

    it('returns 400 when user tries to deactivate themselves', async () => {
      const app = buildApp({ id: 'auth-user' });
      const response = await request(app)
        .patch('/api/users/auth-user/active')
        .send({ isActive: false });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('própria conta');
    });

    it('returns 404 when user does not exist', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      const app = buildApp();
      const response = await request(app)
        .patch('/api/users/nonexistent/active')
        .send({ isActive: false });

      expect(response.status).toBe(404);
    });

    it('updates user active state successfully', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', isActive: true });
      prismaMock.user.update.mockResolvedValue({ id: 'user-1', isActive: false, deactivatedAt: new Date(), updatedAt: new Date() });

      const app = buildApp();
      const response = await request(app)
        .patch('/api/users/user-1/active')
        .send({ isActive: false });

      expect(response.status).toBe(200);
      expect(response.body.isActive).toBe(false);
    });
  });

  // ─── GET /users/me/teams ──────────────────────────────────────────────────

  describe('GET /api/users/me/teams', () => {
    it('returns 404 when auth user is not in database', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      const app = buildApp();
      const response = await request(app).get('/api/users/me/teams');

      expect(response.status).toBe(404);
    });

    it('returns empty array when user has no team memberships', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        teamId: null,
        team: null,
        teamMemberships: [],
      });

      const app = buildApp();
      const response = await request(app).get('/api/users/me/teams');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('returns merged team list for user with memberships', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        teamId: 'team-1',
        team: { id: 'team-1', name: 'Equipa Alpha' },
        teamMemberships: [
          {
            teamId: 'team-1',
            membershipRole: 'PARTICIPANT',
            isApprover: false,
            approvalLevel: null,
            team: { id: 'team-1', name: 'Equipa Alpha' },
          },
        ],
      });

      const app = buildApp();
      const response = await request(app).get('/api/users/me/teams');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body[0].teamId).toBe('team-1');
      expect(response.body[0].isPrimary).toBe(true);
    });
  });

  // ─── GET /teams ───────────────────────────────────────────────────────────

  describe('GET /api/teams', () => {
    it('returns 403 when user lacks view_teams permission', async () => {
      permissionEngineMock.hasPermission.mockResolvedValue(false);

      const app = buildApp();
      const response = await request(app).get('/api/teams');

      expect(response.status).toBe(403);
    });

    it('returns 403 when scope is null', async () => {
      permissionEngineMock.hasPermission.mockResolvedValue(true);
      permissionEngineMock.getPermissionScope.mockResolvedValue(null);

      const app = buildApp();
      const response = await request(app).get('/api/teams');

      expect(response.status).toBe(403);
    });

    it('returns teams list when authorized', async () => {
      prismaMock.team.findMany.mockResolvedValue([{
        ...sampleTeam,
        memberships: [],
      }]);

      const app = buildApp();
      const response = await request(app).get('/api/teams');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body[0].id).toBe('team-1');
      expect(response.body[0]._count).toBeDefined();
    });
  });

  // ─── GET /teams/me ────────────────────────────────────────────────────────

  describe('GET /api/teams/me', () => {
    it('returns teams for the authenticated user (details=none)', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        teamId: null,
        teamMemberships: [],
      });
      prismaMock.team.findMany.mockResolvedValue([{
        ...sampleTeam,
        memberships: [],
      }]);

      const app = buildApp();
      const response = await request(app).get('/api/teams/me?details=none');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('returns team members when details=full (default)', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        teamId: null,
        teamMemberships: [],
      });
      prismaMock.team.findMany.mockResolvedValue([{
        ...sampleTeam,
        memberships: [],
      }]);

      const app = buildApp();
      const response = await request(app).get('/api/teams/me');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  // ─── GET /teams/me/:teamId ────────────────────────────────────────────────

  describe('GET /api/teams/me/:teamId', () => {
    it('returns 403 when team is outside scope', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        teamId: null,
        teamMemberships: [],
      });
      // Non-global scope with no allowed teams
      permissionEngineMock.getPermissionScope.mockResolvedValue({ isGlobal: false, restrictedToTeams: [] });
      permissionEngineMock.isAccessTotal.mockResolvedValue(false);

      const app = buildApp({ isRootAccess: false });
      const response = await request(app).get('/api/teams/me/team-other');

      expect(response.status).toBe(403);
    });

    it('returns 404 when team is not found', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        teamId: null,
        teamMemberships: [],
      });
      prismaMock.team.findFirst.mockResolvedValue(null);

      const app = buildApp();
      const response = await request(app).get('/api/teams/me/team-1');

      expect(response.status).toBe(404);
    });

    it('returns team details when found and in scope', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        teamId: null,
        teamMemberships: [],
      });
      prismaMock.team.findFirst.mockResolvedValue({
        ...sampleTeam,
        memberships: [],
      });

      const app = buildApp();
      const response = await request(app).get('/api/teams/me/team-1');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('team-1');
      expect(Array.isArray(response.body.members)).toBe(true);
    });
  });

  // ─── GET /admin/users ─────────────────────────────────────────────────────

  describe('GET /api/admin/users', () => {
    it('returns 403 when user lacks view_user_list permission', async () => {
      permissionEngineMock.hasPermission.mockResolvedValue(false);

      const app = buildApp();
      const response = await request(app).get('/api/admin/users');

      expect(response.status).toBe(403);
    });

    it('returns admin user list when authorized', async () => {
      prismaMock.user.findMany.mockResolvedValue([{
        ...sampleUser,
        team: null,
        teamMemberships: [],
        profile: { nomeAbreviado: 'João', nomeCompleto: 'João Silva', workCountry: 'PT', localidade: '' },
      }]);

      const app = buildApp();
      const response = await request(app).get('/api/admin/users');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body[0].id).toBe('user-1');
    });
  });

  // ─── GET /admin/teams ─────────────────────────────────────────────────────

  describe('GET /api/admin/teams', () => {
    it('returns 403 when user lacks view_teams permission', async () => {
      permissionEngineMock.hasPermission.mockResolvedValue(false);

      const app = buildApp();
      const response = await request(app).get('/api/admin/teams');

      expect(response.status).toBe(403);
    });

    it('returns teams list for admin', async () => {
      prismaMock.team.findMany.mockResolvedValue([{
        ...sampleTeam,
        memberships: [],
        _count: { subTeams: 0 },
      }]);

      const app = buildApp();
      const response = await request(app).get('/api/admin/teams');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  // ─── POST /admin/teams ────────────────────────────────────────────────────

  describe('POST /api/admin/teams', () => {
    it('returns 403 when user lacks create_team permission', async () => {
      permissionEngineMock.hasPermission.mockResolvedValue(false);

      const app = buildApp();
      const response = await request(app).post('/api/admin/teams').send({ name: 'Nova Equipa' });

      expect(response.status).toBe(403);
    });

    it('returns 400 when team name is too short', async () => {
      const app = buildApp();
      const response = await request(app).post('/api/admin/teams').send({ name: 'A' });

      expect(response.status).toBe(400);
    });

    it('returns 400 when sub-team has cost center', async () => {
      const app = buildApp();
      const response = await request(app).post('/api/admin/teams').send({
        name: 'Sub Equipa',
        parentTeamId: 'parent-team',
        costCenter: 'CC-001',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Centro de custo');
    });

    it('returns 400 when leader is also a member', async () => {
      const app = buildApp();
      const response = await request(app).post('/api/admin/teams').send({
        name: 'Equipa Beta',
        leaderId: 'user-leader',
        memberIds: ['user-leader', 'user-member'],
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('chefe de equipa');
    });

    it('creates team and returns 201', async () => {
      prismaMock.user.findMany.mockResolvedValue([]); // no users to validate
      prismaMock.team.findMany.mockResolvedValue([]); // for syncTeamLeaderPreset
      prismaMock.user.findUnique.mockResolvedValue({ id: 'auth-user', isRootAccess: false });

      const app = buildApp();
      const response = await request(app).post('/api/admin/teams').send({ name: 'Equipa Nova' });

      expect(response.status).toBe(201);
    });
  });

  // ─── PATCH /admin/teams/:id ───────────────────────────────────────────────

  describe('PATCH /api/admin/teams/:id', () => {
    it('returns 403 when user lacks edit_team permission', async () => {
      permissionEngineMock.hasPermission.mockResolvedValue(false);

      const app = buildApp();
      const response = await request(app).patch('/api/admin/teams/team-1').send({ name: 'Atualizada' });

      expect(response.status).toBe(403);
    });

    it('returns 404 when team does not exist', async () => {
      prismaMock.team.findUnique.mockResolvedValue(null);

      const app = buildApp();
      const response = await request(app).patch('/api/admin/teams/nonexistent').send({ name: 'Atualizada' });

      expect(response.status).toBe(404);
    });

    it('updates team name successfully', async () => {
      prismaMock.team.findUnique.mockResolvedValue(sampleTeam);
      prismaMock.team.update.mockResolvedValue({ ...sampleTeam, name: 'Equipa Atualizada' });
      prismaMock.team.findMany.mockResolvedValue([]); // for syncTeamLeaderPreset
      prismaMock.user.findUnique.mockResolvedValue({ id: 'auth-user', isRootAccess: false });

      const app = buildApp();
      const response = await request(app).patch('/api/admin/teams/team-1').send({ name: 'Equipa Atualizada' });

      expect(response.status).toBe(200);
    });
  });

  // ─── DELETE /admin/teams/:id ──────────────────────────────────────────────

  describe('DELETE /api/admin/teams/:id', () => {
    it('returns 403 when user lacks delete_team permission', async () => {
      permissionEngineMock.hasPermission.mockResolvedValue(false);

      const app = buildApp();
      const response = await request(app).delete('/api/admin/teams/team-1');

      expect(response.status).toBe(403);
    });

    it('deletes team and returns success', async () => {
      prismaMock.team.findUnique.mockResolvedValue({ managerId: null });
      prismaMock.$transaction.mockResolvedValue([
        { count: 0 }, // deleteMany memberships
        { count: 0 }, // updateMany users
        sampleTeam,   // update team
        sampleTeam,   // delete team
      ]);

      const app = buildApp();
      const response = await request(app).delete('/api/admin/teams/team-1');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  // ─── PATCH /admin/users/:id ───────────────────────────────────────────────

  describe('PATCH /api/admin/users/:id', () => {
    it('returns 403 when user lacks edit_user permission', async () => {
      permissionEngineMock.hasPermission.mockResolvedValue(false);

      const app = buildApp();
      const response = await request(app).patch('/api/admin/users/user-1').send({ nomeAbreviado: 'João' });

      expect(response.status).toBe(403);
    });

    it('returns 404 when user does not exist', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      const app = buildApp();
      const response = await request(app).patch('/api/admin/users/nonexistent').send({ nomeAbreviado: 'João' });

      expect(response.status).toBe(404);
    });

    it('updates user profile fields', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        isRootAccess: false,
        hasAccessTotal: false,
        profile: { workCountry: 'PT' },
      });
      prismaMock.user.update.mockResolvedValue({ id: 'user-1', role: 'COLABORADOR', teamId: null, isActive: true });

      const app = buildApp();
      const response = await request(app).patch('/api/admin/users/user-1').send({ nomeAbreviado: 'João S.' });

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('user-1');
    });

    it('returns 400 when actor tries to deactivate themselves', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'auth-user',
        isRootAccess: false,
        hasAccessTotal: false,
        profile: { workCountry: 'PT' },
      });

      const app = buildApp({ id: 'auth-user' });
      const response = await request(app).patch('/api/admin/users/auth-user').send({ isActive: false });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('própria conta');
    });
  });

  // ─── DELETE /admin/users/:id ──────────────────────────────────────────────

  describe('DELETE /api/admin/users/:id', () => {
    it('returns 403 when user lacks edit_user permission', async () => {
      permissionEngineMock.hasPermission.mockResolvedValue(false);

      const app = buildApp();
      const response = await request(app).delete('/api/admin/users/user-1');

      expect(response.status).toBe(403);
    });

    it('returns 400 when user tries to delete themselves', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'auth-user', isRootAccess: false });

      const app = buildApp({ id: 'auth-user' });
      const response = await request(app).delete('/api/admin/users/auth-user');

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('própria conta');
    });

    it('returns 404 when user does not exist', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      const app = buildApp();
      const response = await request(app).delete('/api/admin/users/nonexistent');

      expect(response.status).toBe(404);
    });

    it('deletes user and returns success', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', isRootAccess: false });
      prismaMock.user.delete.mockResolvedValue(sampleUser);

      const app = buildApp();
      const response = await request(app).delete('/api/admin/users/user-1');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  // ─── PATCH /admin/users/:id/credentials ──────────────────────────────────

  describe('PATCH /api/admin/users/:id/credentials', () => {
    it('returns 403 when actor is not t.people', async () => {
      const app = buildApp({ username: 'other-admin' });
      const response = await request(app)
        .patch('/api/admin/users/user-1/credentials')
        .send({ username: 'newname' });

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('t.people');
    });

    it('returns 400 when neither username nor email is provided', async () => {
      const app = buildApp({ username: 't.people' });
      const response = await request(app)
        .patch('/api/admin/users/user-1/credentials')
        .send({});

      expect(response.status).toBe(400);
    });

    it('returns 404 when user is not found', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      const app = buildApp({ username: 't.people' });
      const response = await request(app)
        .patch('/api/admin/users/nonexistent/credentials')
        .send({ username: 'novousername' });

      expect(response.status).toBe(404);
    });

    it('returns 409 when username is already taken', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', username: 'joao', email: 'joao@example.com' });
      prismaMock.user.findFirst.mockResolvedValue({ id: 'other-user' }); // duplicate found

      const app = buildApp({ username: 't.people' });
      const response = await request(app)
        .patch('/api/admin/users/user-1/credentials')
        .send({ username: 'existinguser' });

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('em uso');
    });

    it('updates credentials successfully', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', username: 'joao', email: 'joao@example.com' });
      prismaMock.user.findFirst.mockResolvedValue(null); // no duplicate
      prismaMock.user.update.mockResolvedValue({ id: 'user-1', username: 'novousername', email: 'joao@example.com', updatedAt: new Date() });

      const app = buildApp({ username: 't.people' });
      const response = await request(app)
        .patch('/api/admin/users/user-1/credentials')
        .send({ username: 'novousername' });

      expect(response.status).toBe(200);
      expect(response.body.username).toBe('novousername');
    });
  });

  // ─── PATCH /admin/users/:id/memberships ──────────────────────────────────

  describe('PATCH /api/admin/users/:id/memberships', () => {
    it('returns 403 when user lacks manage_team_members permission', async () => {
      permissionEngineMock.hasPermission.mockResolvedValue(false);

      const app = buildApp();
      const response = await request(app)
        .patch('/api/admin/users/user-1/memberships')
        .send({ memberships: [{ teamId: 'team-1' }] });

      expect(response.status).toBe(403);
    });

    it('returns 404 when user does not exist', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      const app = buildApp();
      const response = await request(app)
        .patch('/api/admin/users/nonexistent/memberships')
        .send({ memberships: [] });

      expect(response.status).toBe(404);
    });

    it('updates memberships and returns success', async () => {
      prismaMock.user.findUnique.mockResolvedValue(sampleUser);

      const app = buildApp();
      const response = await request(app)
        .patch('/api/admin/users/user-1/memberships')
        .send({ memberships: [{ teamId: 'team-1', membershipRole: 'PARTICIPANT' }] });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('clears all memberships when empty array is provided', async () => {
      prismaMock.user.findUnique.mockResolvedValue(sampleUser);

      const app = buildApp();
      const response = await request(app)
        .patch('/api/admin/users/user-1/memberships')
        .send({ memberships: [] });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  // ─── PATCH /manager/team-members/:id ─────────────────────────────────────

  describe('PATCH /api/manager/team-members/:id', () => {
    it('returns 403 when user lacks manage_team_members permission', async () => {
      permissionEngineMock.hasPermission.mockResolvedValue(false);

      const app = buildApp();
      const response = await request(app)
        .patch('/api/manager/team-members/user-1')
        .send({ cargo: 'Engenheiro' });

      expect(response.status).toBe(403);
    });

    it('returns 404 when target user is not found', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      const app = buildApp();
      const response = await request(app)
        .patch('/api/manager/team-members/nonexistent')
        .send({ cargo: 'Engenheiro' });

      expect(response.status).toBe(404);
    });

    it('returns 400 when target user is not COLABORADOR', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        ...sampleUser,
        role: 'ADMIN',
        team: null,
        teamMemberships: [],
      });

      const app = buildApp();
      const response = await request(app)
        .patch('/api/manager/team-members/user-1')
        .send({ cargo: 'Engenheiro' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('COLABORADOR');
    });

    it('updates team member profile fields', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        ...sampleUser,
        role: 'COLABORADOR',
        team: null,
        teamMemberships: [],
      });

      const app = buildApp();
      const response = await request(app)
        .patch('/api/manager/team-members/user-1')
        .send({ cargo: 'Engenheiro Sénior' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});
