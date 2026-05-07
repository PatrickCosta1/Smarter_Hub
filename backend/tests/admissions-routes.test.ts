import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, permissionEngineMock, authConfig, emailMock, notificationsMock } = vi.hoisted(() => ({
  authConfig: { currentUser: {} as Record<string, unknown> },
  prismaMock: {
    employeeAdmission: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
    profile: {
      findUnique: vi.fn(),
    },
  },
  permissionEngineMock: {
    hasPermission: vi.fn(),
    isAccessTotal: vi.fn(),
  },
  emailMock: {
    sendTransactionalEmail: vi.fn(),
  },
  notificationsMock: {
    notifyUsers: vi.fn(),
  },
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../src/lib/permission-engine.js', () => ({
  hasPermission: permissionEngineMock.hasPermission,
  isAccessTotal: permissionEngineMock.isAccessTotal,
  getPermissionScope: vi.fn(),
  buildUserWhereFromScope: vi.fn(),
  canAccessUserByPermission: vi.fn(),
  canReviewAccessTotalHierarchy: vi.fn(),
}));

vi.mock('../src/lib/email.js', () => emailMock);
vi.mock('../src/lib/notifications.js', () => notificationsMock);

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

describe('admissions routes integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authConfig.currentUser = defaultAuthUser;

    permissionEngineMock.hasPermission.mockResolvedValue(true);
    permissionEngineMock.isAccessTotal.mockResolvedValue(true);

    prismaMock.employeeAdmission.findFirst.mockResolvedValue(null);
    prismaMock.employeeAdmission.create.mockResolvedValue({
      id: 'adm-1',
      fullName: 'Ana Silva',
      personalEmail: 'ana@gmail.com',
      workCountry: 'PT',
      brWorkState: null,
      status: 'INVITED',
      tokenExpiresAt: new Date('2026-05-14T12:00:00.000Z'),
    });
    prismaMock.employeeAdmission.findUnique.mockResolvedValue(null);
    prismaMock.employeeAdmission.update.mockResolvedValue({});
    prismaMock.employeeAdmission.findMany.mockResolvedValue([]);
    prismaMock.user.findMany.mockResolvedValue([{ id: 'rh-1' }]);
    prismaMock.profile.findUnique.mockResolvedValue({ workCountry: 'PT' });

    emailMock.sendTransactionalEmail.mockResolvedValue({ delivered: true });
    notificationsMock.notifyUsers.mockResolvedValue(undefined);
  });

  it('POST /api/users/admissions returns 403 without access total', async () => {
    const app = buildApp({ isRootAccess: false, hasAccessTotal: false });
    permissionEngineMock.isAccessTotal.mockResolvedValue(false);

    const response = await request(app)
      .post('/api/users/admissions')
      .send({
        fullName: 'Ana Silva',
        personalEmail: 'ana@gmail.com',
        workCountry: 'PT',
      });

    expect(response.status).toBe(403);
  });

  it('POST /api/users/admissions creates invitation', async () => {
    const app = buildApp();

    const response = await request(app)
      .post('/api/users/admissions')
      .send({
        fullName: 'Ana Silva',
        personalEmail: 'ana@gmail.com',
        workCountry: 'PT',
      });

    expect(response.status).toBe(201);
    expect(response.body.fullName).toBe('Ana Silva');
    expect(prismaMock.employeeAdmission.create).toHaveBeenCalledTimes(1);
    expect(emailMock.sendTransactionalEmail).toHaveBeenCalledTimes(1);
  });

  it('POST /api/users/admissions returns 409 when active process exists', async () => {
    const app = buildApp();
    prismaMock.employeeAdmission.findFirst.mockResolvedValue({ id: 'adm-existing' });

    const response = await request(app)
      .post('/api/users/admissions')
      .send({
        fullName: 'Ana Silva',
        personalEmail: 'ana@gmail.com',
        workCountry: 'PT',
      });

    expect(response.status).toBe(409);
  });

  it('GET /api/users/admissions/public/:token returns admission payload', async () => {
    const app = buildApp();
    prismaMock.employeeAdmission.findUnique.mockResolvedValue({
      id: 'adm-1',
      fullName: 'Ana Silva',
      personalEmail: 'ana@gmail.com',
      workCountry: 'PT',
      brWorkState: null,
      status: 'INVITED',
      reviewReason: '',
      tokenExpiresAt: new Date('2026-05-14T12:00:00.000Z'),
      personalData: { nomeCompleto: 'Ana Silva' },
    });

    const response = await request(app).get('/api/users/admissions/public/sample-token');

    expect(response.status).toBe(200);
    expect(response.body.id).toBe('adm-1');
    expect(response.body.fullName).toBe('Ana Silva');
  });

  it('POST /api/users/admissions/public/:token/submit updates request and notifies RH', async () => {
    const app = buildApp();
    prismaMock.employeeAdmission.findUnique.mockResolvedValue({
      id: 'adm-1',
      fullName: 'Ana Silva',
      personalEmail: 'ana@gmail.com',
      workCountry: 'PT',
      brWorkState: null,
      status: 'INVITED',
      reviewReason: '',
      tokenExpiresAt: new Date('2026-05-14T12:00:00.000Z'),
      personalData: {},
    });

    const response = await request(app)
      .post('/api/users/admissions/public/sample-token/submit')
      .send({
        nomeCompleto: 'Ana Silva',
        nomeAbreviado: 'Ana',
        dataNascimento: '1995-03-20',
        genero: 'Feminino',
        estadoCivil: 'Solteira',
        habilitacoesLiterarias: 'Licenciatura',
        emailPessoal: 'ana@gmail.com',
        telemovel: '912345678',
        moradaFiscal: 'Rua A, 10',
        endereco: 'Rua A, 10',
        localidade: 'Porto',
        codigoPostal: '4000-001',
        contactoEmergenciaNome: 'Maria Silva',
        contactoEmergenciaParentesco: 'Mãe',
        contactoEmergenciaNumero: '919999999',
      });

    expect(response.status).toBe(200);
    expect(prismaMock.employeeAdmission.update).toHaveBeenCalledTimes(1);
    expect(notificationsMock.notifyUsers).toHaveBeenCalledTimes(1);
  });
});
