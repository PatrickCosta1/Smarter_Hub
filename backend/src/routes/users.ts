import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma.js';
import {
  buildUserWhereFromScope,
  canAccessUserByPermission,
  canReviewAccessTotalHierarchy,
  getPermissionScope,
  hasPermission,
  isAccessTotal,
} from '../lib/permission-engine.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const roleSchema = z.enum(['COLABORADOR', 'MANAGER', 'COORDENADOR', 'ADMIN', 'CONVIDADO']);
const countrySchema = z.enum(['PT', 'BR']);

const createUserSchema = z.object({
  username: z.string().min(3),
  email: z.string().email(),
  fullName: z.string().min(2),
  role: roleSchema.optional(),
  teamId: z.string().optional(),
  workCountry: countrySchema.optional(),
});

const updateAdminUserSchema = z.object({
  primeiroNome: z.string().optional(),
  apelido: z.string().optional(),
  nomeAbreviado: z.string().optional(),
  dataNascimento: z.string().optional(),
  genero: z.string().optional(),
  estadoCivil: z.string().optional(),
  habilitacoesLiterarias: z.string().optional(),
  curso: z.string().optional(),
  faculdade: z.string().optional(),
  emailPessoal: z.string().optional(),
  telemovel: z.string().optional(),
  moradaFiscal: z.string().optional(),
  endereco: z.string().optional(),
  role: roleSchema.optional(),
  teamId: z.string().nullable().optional(),
  codigoPostal: z.string().optional(),
  matriculaCarro: z.string().optional(),
  cartaoCidadao: z.string().optional(),
  nif: z.string().optional(),
  niss: z.string().optional(),
  iban: z.string().optional(),
  situacaoIrs: z.string().optional(),
  numeroDependentes: z.string().optional(),
  irsJovem: z.string().optional(),
  anoPrimeiroDesconto: z.string().optional(),
  numeroCartaoContinente: z.string().optional(),
  voucherNosData: z.string().optional(),
  comprovativoMoradaFiscal: z.string().optional(),
  comprovativoCartaoCidadao: z.string().optional(),
  comprovativoIban: z.string().optional(),
  comprovativoCartaoContinente: z.string().optional(),
  contactoEmergenciaNome: z.string().optional(),
  contactoEmergenciaParentesco: z.string().optional(),
  contactoEmergenciaNumero: z.string().optional(),
  cargo: z.string().optional(),
  funcao: z.string().optional(),
  dataInicioContrato: z.string().optional(),
  dataFimContrato: z.string().optional(),
  remuneracao: z.string().optional(),
  tipoContrato: z.string().optional(),
  regimeHorario: z.string().optional(),
  workCountry: countrySchema.optional(),
  localidade: z.string().optional(),
  isActive: z.boolean().optional(),
});

const updateUserActiveSchema = z.object({
  isActive: z.boolean(),
});

const updateAdminUserCredentialsSchema = z.object({
  username: z.string().min(3).optional(),
  email: z.string().email().optional(),
}).refine((data) => Boolean(data.username || data.email), {
  message: 'Indica pelo menos um campo para atualizar.',
  path: ['username'],
});

const updateAdminMembershipsSchema = z.object({
  memberships: z.array(z.object({
    teamId: z.string().min(1),
    membershipRole: z.string().optional(),
    isApprover: z.boolean().optional(),
    approvalLevel: z.number().int().positive().optional(),
    isActive: z.boolean().optional(),
  })).default([]),
});

const adminTeamSchema = z.object({
  name: z.string().min(2),
  leaderId: z.string().nullable().optional(),
  memberIds: z.array(z.string().min(1)).optional().default([]),
  parentTeamId: z.string().nullable().optional(),
});

const managerTeamMemberUpdateSchema = z.object({
  teamId: z.string().nullable().optional(),
  cargo: z.string().optional(),
  funcao: z.string().optional(),
});

const AUTO_DEFAULT_EMPLOYEE_NOTE = '[AUTO_PRESET_DEFAULT_EMPLOYEE]';
const AUTO_TEAM_LEADER_NOTE = '[AUTO_PRESET_TEAM_LEADER]';

function parseIsoDate(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function yearsBetween(start: Date, end = new Date()) {
  const diff = end.getTime() - start.getTime();
  if (!Number.isFinite(diff) || diff <= 0) {
    return 0;
  }

  return diff / (365.25 * 24 * 60 * 60 * 1000);
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeGender(value?: string) {
  const normalized = (value || '').trim().toLowerCase();

  if (!normalized) {
    return 'Não informado';
  }

  if (['m', 'masculino', 'male', 'homem'].includes(normalized)) {
    return 'Masculino';
  }

  if (['f', 'feminino', 'female', 'mulher'].includes(normalized)) {
    return 'Feminino';
  }

  return 'Outro';
}

const DEFAULT_EMPLOYEE_PERMISSION_CODES = [
  'view_profile',
  'request_profile_change',
  'view_notifications',
  'request_vacation',
  'view_own_vacations',
  'request_training',
  'view_trainings',
  'view_receipts',
  'download_receipt',
] as const;

const TEAM_LEADER_PERMISSION_CODES = [
  'view_teams',
  'manage_team_members',
  'view_team_vacations',
  'approve_vacation',
  'reject_vacation',
  'assign_training',
] as const;

async function upsertPresetPermissions(params: {
  userId: string;
  actorUserId?: string;
  codes: readonly string[];
  note: string;
  restrictedToTeams?: string[];
  restrictedToCountries?: Array<'PT' | 'BR'>;
  restrictedToLevels?: string[];
}) {
  const permissions = await prisma.permission.findMany({
    where: { code: { in: [...params.codes] } },
    select: { id: true },
  });

  if (permissions.length === 0) {
    return;
  }

  for (const permission of permissions) {
    await prisma.userPermission.upsert({
      where: {
        userId_permissionId: {
          userId: params.userId,
          permissionId: permission.id,
        },
      },
      create: {
        userId: params.userId,
        permissionId: permission.id,
        isEnabled: true,
        restrictedToTeams: params.restrictedToTeams ?? [],
        restrictedToCountries: params.restrictedToCountries ?? [],
        restrictedToLevels: params.restrictedToLevels ?? [],
        notes: params.note,
        grantedById: params.actorUserId,
      },
      update: {
        isEnabled: true,
        restrictedToTeams: params.restrictedToTeams ?? [],
        restrictedToCountries: params.restrictedToCountries ?? [],
        restrictedToLevels: params.restrictedToLevels ?? [],
        notes: params.note,
        grantedById: params.actorUserId,
      },
    });
  }
}

async function disablePresetPermissions(userId: string, codes: readonly string[], actorUserId?: string) {
  const permissions = await prisma.permission.findMany({
    where: { code: { in: [...codes] } },
    select: { id: true },
  });

  if (permissions.length === 0) {
    return;
  }

  await prisma.userPermission.updateMany({
    where: {
      userId,
      permissionId: { in: permissions.map((item) => item.id) },
    },
    data: {
      isEnabled: false,
      grantedById: actorUserId,
    },
  });
}

async function syncTeamLeaderPreset(userId: string, actorUserId?: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isRootAccess: true },
  });

  if (!user) {
    return;
  }

  // Quem tem acesso total/root não deve ser limitado pelo preset de chefe.
  if (user.isRootAccess || await isAccessTotal(userId)) {
    return;
  }

  const ledTeams = await prisma.team.findMany({
    where: { managerId: userId },
    select: { id: true },
  });

  const ledTeamIds = ledTeams.map((team) => team.id);

  if (ledTeamIds.length === 0) {
    await disablePresetPermissions(userId, TEAM_LEADER_PERMISSION_CODES, actorUserId);
    return;
  }

  await upsertPresetPermissions({
    userId,
    actorUserId,
    codes: TEAM_LEADER_PERMISSION_CODES,
    note: AUTO_TEAM_LEADER_NOTE,
    restrictedToTeams: ledTeamIds,
  });
}

function parseBooleanQuery(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'sim', 'yes'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'nao', 'não', 'no'].includes(normalized)) {
    return false;
  }

  return undefined;
}

async function resolveTeamScopeForUser(userId: string, isRootAccess: boolean) {
  const [scope, isFullAccess, user] = await Promise.all([
    getPermissionScope(userId, 'view_teams'),
    isAccessTotal(userId),
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        teamId: true,
        teamMemberships: {
          where: { isActive: true },
          select: { teamId: true },
        },
      },
    }),
  ]);

  const hasTeamViewPermission = Boolean(scope);
  const restrictedTeamsForView = scope?.restrictedToTeams ?? null;

  const ownTeamIds = new Set<string>();
  if (user?.teamId) {
    ownTeamIds.add(user.teamId);
  }
  for (const membership of user?.teamMemberships ?? []) {
    ownTeamIds.add(membership.teamId);
  }

  const canViewGlobally = isRootAccess || isFullAccess || (hasTeamViewPermission && restrictedTeamsForView === null);
  if (canViewGlobally) {
    return { isGlobal: true, teamIds: [] as string[] };
  }

  const allowed = new Set<string>([...ownTeamIds]);
  if (hasTeamViewPermission && restrictedTeamsForView && restrictedTeamsForView.length > 0) {
    for (const teamId of restrictedTeamsForView) {
      allowed.add(teamId);
    }
  }

  return { isGlobal: false, teamIds: [...allowed] };
}

router.get('/users', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'view_user_list')) {
    return res.status(403).json({ message: 'Sem permissões para consultar utilizadores.' });
  }

  const scope = await getPermissionScope(req.authUser!.id, 'view_user_list');
  if (!scope) {
    return res.status(403).json({ message: 'Sem permissões para consultar utilizadores.' });
  }

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const email = typeof req.query.email === 'string' ? req.query.email : undefined;
  const parsedLimit = Number(typeof req.query.limit === 'string' ? req.query.limit : '40');
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 40;

  const baseWhere: Prisma.UserWhereInput = {
      isActive: true,
      ...(email ? { email } : {}),
      role: {
        in: ['COLABORADOR', 'MANAGER', 'COORDENADOR'],
      },
      ...(q
        ? {
            OR: [
              { username: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              { profile: { primeiroNome: { contains: q, mode: 'insensitive' } } },
              { profile: { apelido: { contains: q, mode: 'insensitive' } } },
              { profile: { cargo: { contains: q, mode: 'insensitive' } } },
              { profile: { funcao: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

  const scopeWhere = buildUserWhereFromScope(scope) as Prisma.UserWhereInput | null;
  const where: Prisma.UserWhereInput = scopeWhere
    ? { AND: [baseWhere, scopeWhere] }
    : baseWhere;

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      teamId: true,
      team: { select: { id: true, name: true } },
      teamMemberships: {
        where: { isActive: true },
        select: {
          teamId: true,
          membershipRole: true,
          isApprover: true,
          approvalLevel: true,
          team: { select: { id: true, name: true } },
        },
      },
      managedTeams: {
        select: { id: true, name: true },
      },
      profile: {
        select: {
          nomeAbreviado: true,
          primeiroNome: true,
          apelido: true,
          dataNascimento: true,
          genero: true,
          estadoCivil: true,
          habilitacoesLiterarias: true,
          curso: true,
          faculdade: true,
          emailPessoal: true,
          telemovel: true,
          moradaFiscal: true,
          endereco: true,
          codigoPostal: true,
          matriculaCarro: true,
          cartaoCidadao: true,
          nif: true,
          niss: true,
          iban: true,
          situacaoIrs: true,
          numeroDependentes: true,
          irsJovem: true,
          anoPrimeiroDesconto: true,
          numeroCartaoContinente: true,
          voucherNosData: true,
          comprovativoMoradaFiscal: true,
          comprovativoCartaoCidadao: true,
          comprovativoIban: true,
          comprovativoCartaoContinente: true,
          contactoEmergenciaNome: true,
          contactoEmergenciaParentesco: true,
          contactoEmergenciaNumero: true,
          cargo: true,
          funcao: true,
          dataInicioContrato: true,
          dataFimContrato: true,
          remuneracao: true,
          tipoContrato: true,
          regimeHorario: true,
          workCountry: true,
          localidade: true,
        },
      },
    },
    take: limit,
    orderBy: {
      createdAt: 'desc',
    },
  });

  const normalizedUsers = users.map((user) => ({
    ...user,
    team: user.team ?? user.teamMemberships[0]?.team ?? user.managedTeams[0] ?? null,
    teamRole: (user.team ? user.team.id : user.teamMemberships[0]?.team?.id ?? user.managedTeams[0]?.id)
      && user.managedTeams.some((team) => team.id === (user.team ? user.team.id : user.teamMemberships[0]?.team?.id ?? user.managedTeams[0]?.id))
      ? 'LEADER'
      : user.team || user.teamMemberships[0]?.team || user.managedTeams[0]
        ? 'MEMBER'
        : null,
  }));

  return res.json(normalizedUsers);
});

router.get('/users/collaborators', requireAuth, async (req, res) => {
    const scope = await getPermissionScope(req.authUser!.id, 'view_user_list');
    if (!scope) {
      return res.status(403).json({ message: 'Sem permissões para consultar colaboradores.' });
    }

  if (!await hasPermission(req.authUser!.id, 'view_user_list')) {
    return res.status(403).json({ message: 'Sem permissões para consultar colaboradores.' });
  }

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const role = typeof req.query.role === 'string' ? req.query.role.trim().toUpperCase() : '';
  const teamId = typeof req.query.teamId === 'string' ? req.query.teamId.trim() : '';
  const workCountry = typeof req.query.workCountry === 'string' ? req.query.workCountry.trim().toUpperCase() : '';
  const active = parseBooleanQuery(req.query.active);
  const sortBy = typeof req.query.sortBy === 'string' ? req.query.sortBy : 'createdAt';
  const sortDirection = typeof req.query.sortDirection === 'string' && req.query.sortDirection.toLowerCase() === 'asc' ? 'asc' : 'desc';
  const page = Math.max(1, Number(typeof req.query.page === 'string' ? req.query.page : '1') || 1);
  const pageSize = Math.min(100, Math.max(1, Number(typeof req.query.pageSize === 'string' ? req.query.pageSize : '20') || 20));
  const parsedRole = roleSchema.safeParse(role);

  const andConditions: Prisma.UserWhereInput[] = [];
  if (teamId) {
    andConditions.push({
      OR: [
        { teamId },
        { teamMemberships: { some: { teamId, isActive: true } } },
      ],
    });
  }

  if (q) {
    andConditions.push({
      OR: [
        { username: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { profile: { nomeAbreviado: { contains: q, mode: 'insensitive' } } },
        { profile: { primeiroNome: { contains: q, mode: 'insensitive' } } },
        { profile: { apelido: { contains: q, mode: 'insensitive' } } },
        { profile: { cargo: { contains: q, mode: 'insensitive' } } },
        { profile: { funcao: { contains: q, mode: 'insensitive' } } },
      ],
    });
  }

  const orderByMap: Record<string, { [key: string]: 'asc' | 'desc' }> = {
    createdAt: { createdAt: sortDirection },
    updatedAt: { updatedAt: sortDirection },
    username: { username: sortDirection },
    email: { email: sortDirection },
    role: { role: sortDirection },
  };

  const where: Prisma.UserWhereInput = {
    role: parsedRole.success ? parsedRole.data : { in: ['COLABORADOR', 'MANAGER', 'COORDENADOR', 'ADMIN'] },
    ...(workCountry && countrySchema.safeParse(workCountry).success ? { profile: { workCountry: workCountry as 'PT' | 'BR' } } : {}),
    ...(typeof active === 'boolean' ? { isActive: active } : {}),
    ...(andConditions.length > 0 ? { AND: andConditions } : {}),
  };

  const scopeWhere = buildUserWhereFromScope(scope) as Prisma.UserWhereInput | null;
  const scopedWhere: Prisma.UserWhereInput = scopeWhere
    ? { AND: [where, scopeWhere] }
    : where;

  const [total, rows] = await Promise.all([
    prisma.user.count({ where: scopedWhere }),
    prisma.user.findMany({
      where: scopedWhere,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: orderByMap[sortBy] || orderByMap.createdAt,
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        isActive: true,
        deactivatedAt: true,
        createdAt: true,
        updatedAt: true,
        teamId: true,
        team: { select: { id: true, name: true } },
        teamMemberships: {
          where: { isActive: true },
          select: {
            teamId: true,
            membershipRole: true,
            team: { select: { id: true, name: true } },
          },
        },
        managedTeams: {
          select: { id: true, name: true },
        },
        profile: {
          select: {
            nomeAbreviado: true,
            primeiroNome: true,
            apelido: true,
            dataNascimento: true,
            genero: true,
            estadoCivil: true,
            habilitacoesLiterarias: true,
            curso: true,
            faculdade: true,
            emailPessoal: true,
            telemovel: true,
            moradaFiscal: true,
            endereco: true,
            codigoPostal: true,
            matriculaCarro: true,
            cartaoCidadao: true,
            nif: true,
            niss: true,
            iban: true,
            situacaoIrs: true,
            numeroDependentes: true,
            irsJovem: true,
            anoPrimeiroDesconto: true,
            numeroCartaoContinente: true,
            voucherNosData: true,
            comprovativoMoradaFiscal: true,
            comprovativoCartaoCidadao: true,
            comprovativoIban: true,
            comprovativoCartaoContinente: true,
            contactoEmergenciaNome: true,
            contactoEmergenciaParentesco: true,
            contactoEmergenciaNumero: true,
            cargo: true,
            funcao: true,
            dataInicioContrato: true,
            dataFimContrato: true,
            remuneracao: true,
            tipoContrato: true,
            regimeHorario: true,
            workCountry: true,
            localidade: true,
          },
        },
      },
    }),
  ]);

  const normalizedRows = rows.map((user) => ({
    ...user,
    team: user.team ?? user.teamMemberships[0]?.team ?? user.managedTeams[0] ?? null,
    teamRole: (user.team ? user.team.id : user.teamMemberships[0]?.team?.id ?? user.managedTeams[0]?.id)
      && user.managedTeams.some((team) => team.id === (user.team ? user.team.id : user.teamMemberships[0]?.team?.id ?? user.managedTeams[0]?.id))
      ? 'LEADER'
      : user.team || user.teamMemberships[0]?.team || user.managedTeams[0]
        ? 'MEMBER'
        : null,
  }));

  return res.json({ total, page, pageSize, rows: normalizedRows });
});

router.get('/users/dashboard-summary', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'view_user_list')) {
    return res.status(403).json({ message: 'Sem permissões para consultar o dashboard.' });
  }

  const scope = await getPermissionScope(req.authUser!.id, 'view_user_list');
  if (!scope) {
    return res.status(403).json({ message: 'Sem permissões para consultar o dashboard.' });
  }

  const scopeWhere = buildUserWhereFromScope(scope) as Prisma.UserWhereInput | null;
  const collaboratorWhere: Prisma.UserWhereInput = {
    role: { in: ['COLABORADOR', 'MANAGER', 'COORDENADOR', 'ADMIN'] },
    ...(scopeWhere ? { AND: [scopeWhere] } : {}),
  };

  const requestScopeWhere = scopeWhere ? { user: scopeWhere } : {};

  const [usersResult, profileRequestsResult, vacationsResult, trainingsResult, historyResult] = await Promise.allSettled([
    prisma.user.findMany({
      where: collaboratorWhere,
      select: {
        id: true,
        isActive: true,
        team: { select: { name: true } },
        profile: {
          select: {
            dataNascimento: true,
            dataInicioContrato: true,
            genero: true,
            habilitacoesLiterarias: true,
            cargo: true,
            funcao: true,
          },
        },
      },
    }),
    prisma.profileChangeRequest.count({
      where: {
        status: 'PENDING',
        ...requestScopeWhere,
      },
    }),
    prisma.vacation.count({
      where: {
        status: 'PENDING',
        ...requestScopeWhere,
      },
    }),
    Promise.all([
      prisma.training.count({
        where: {
          status: { in: ['ASSIGNED', 'ATRIBUIDA', 'ATRIBUÍDA'] },
          ...requestScopeWhere,
        },
      }),
      prisma.training.count({
        where: {
          status: { in: ['COMPLETED', 'CONCLUIDA', 'CONCLUÍDA'] },
          ...requestScopeWhere,
        },
      }),
      prisma.training.findMany({
        where: requestScopeWhere,
        select: { horas: true },
      }),
    ]),
    prisma.profileChangeRequest.findMany({
      where: {
        status: { in: ['APPROVED', 'PARTIALLY_REJECTED', 'REJECTED'] },
        reviewedAt: { not: null },
        ...requestScopeWhere,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            profile: {
              select: {
                nomeAbreviado: true,
                primeiroNome: true,
                apelido: true,
              },
            },
          },
        },
      },
      orderBy: [{ reviewedAt: 'desc' }, { createdAt: 'desc' }],
      take: 120,
    }),
  ]);

  const collaboratorRows = usersResult.status === 'fulfilled' ? usersResult.value : [];
  const teamCount = new Set(
    collaboratorRows
      .map((item) => item.team?.name?.trim())
      .filter((value): value is string => Boolean(value)),
  ).size;
  const pendingProfileRequests = profileRequestsResult.status === 'fulfilled' ? profileRequestsResult.value : 0;
  const pendingVacationRequests = vacationsResult.status === 'fulfilled' ? vacationsResult.value : 0;
  const assignedTrainings = trainingsResult.status === 'fulfilled' ? trainingsResult.value[0] : 0;
  const completedTrainings = trainingsResult.status === 'fulfilled' ? trainingsResult.value[1] : 0;
  const trainingHoursAvg = trainingsResult.status === 'fulfilled'
    ? average(trainingsResult.value[2].map((item) => Number(item.horas || 0)).filter((value) => value > 0))
    : 0;
  const historyRows = historyResult.status === 'fulfilled' ? historyResult.value : [];

  const activeUsers = collaboratorRows.filter((user) => user.isActive !== false).length;
  const inactiveUsers = Math.max(0, collaboratorRows.length - activeUsers);

  const ageValues = collaboratorRows
    .map((item) => parseIsoDate(item.profile?.dataNascimento || ''))
    .filter((value): value is Date => value !== null)
    .map((birthDate) => yearsBetween(birthDate));

  const tenureValues = collaboratorRows
    .map((item) => parseIsoDate(item.profile?.dataInicioContrato || ''))
    .filter((value): value is Date => value !== null)
    .map((startDate) => yearsBetween(startDate));

  const educationMap = new Map<string, number>();
  const areaGenderMap = new Map<string, { Masculino: number; Feminino: number; Outro: number; 'Não informado': number }>();
  const timeInLevelMap = new Map<string, number[]>();

  const promotionEvents = historyRows
    .filter((item) => Boolean(item.reviewedAt))
    .filter((item) => {
      const requestedData = (item.requestedData as Record<string, unknown>) || {};
      const approvedFields = (item.approvedFields as Record<string, unknown>) || {};
      const changedFields = Object.keys(requestedData);
      const approvedFieldNames = Object.keys(approvedFields);
      const requestedCargo = String(requestedData.cargo || '').trim();
      const approvedCargo = String(approvedFields.cargo || '').trim();

      const approvedWithCargo = item.status === 'APPROVED' && changedFields.includes('cargo') && requestedCargo.length > 0;
      const partialWithApprovedCargo = item.status === 'PARTIALLY_REJECTED' && approvedFieldNames.includes('cargo') && approvedCargo.length > 0;

      return approvedWithCargo || partialWithApprovedCargo;
    })
    .map((item) => ({
      id: item.id,
      userId: item.user?.id || '',
      collaborator: item.user?.profile?.nomeAbreviado?.trim()
        || `${item.user?.profile?.primeiroNome || ''} ${item.user?.profile?.apelido || ''}`.trim()
        || item.user?.username
        || 'Colaborador',
      promotedTo: String(((item.approvedFields as Record<string, unknown>)?.cargo || (item.requestedData as Record<string, unknown>)?.cargo || '')).trim() || 'Nível atualizado',
      reviewedAt: item.reviewedAt?.toISOString() || item.createdAt.toISOString(),
    }))
    .filter((item) => Boolean(item.userId))
    .sort((a, b) => new Date(b.reviewedAt).getTime() - new Date(a.reviewedAt).getTime());

  const latestPromotionByUser = new Map<string, string>();
  for (const event of promotionEvents) {
    if (!latestPromotionByUser.has(event.userId)) {
      latestPromotionByUser.set(event.userId, event.reviewedAt);
    }
  }

  for (const collaborator of collaboratorRows) {
    const education = (collaborator.profile?.habilitacoesLiterarias || '').trim() || 'Não informado';
    educationMap.set(education, (educationMap.get(education) || 0) + 1);

    const area = (collaborator.team?.name || collaborator.profile?.funcao || 'Sem área').trim() || 'Sem área';
    if (!areaGenderMap.has(area)) {
      areaGenderMap.set(area, { Masculino: 0, Feminino: 0, Outro: 0, 'Não informado': 0 });
    }

    const genderBucket = areaGenderMap.get(area)!;
    const gender = normalizeGender(collaborator.profile?.genero);
    genderBucket[gender as keyof typeof genderBucket] += 1;

    const currentLevel = (collaborator.profile?.cargo || collaborator.profile?.funcao || 'Sem nível').trim() || 'Sem nível';
    const promotionDate = latestPromotionByUser.get(collaborator.id);
    const baseDate = promotionDate ? new Date(promotionDate) : parseIsoDate(collaborator.profile?.dataInicioContrato || '');

    if (baseDate) {
      if (!timeInLevelMap.has(currentLevel)) {
        timeInLevelMap.set(currentLevel, []);
      }

      timeInLevelMap.get(currentLevel)!.push(yearsBetween(baseDate));
    }
  }

  const educationDistribution = Array.from(educationMap.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const genderByArea = Array.from(areaGenderMap.entries())
    .map(([area, counts]) => ({
      area,
      counts,
      total: Object.values(counts).reduce((sum, value) => sum + value, 0),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  const timeInCurrentLevelByCargo = Array.from(timeInLevelMap.entries())
    .map(([cargo, durations]) => ({
      cargo,
      averageYears: average(durations),
      people: durations.length,
    }))
    .sort((a, b) => b.people - a.people)
    .slice(0, 6);

  return res.json({
    refreshedAt: new Date().toISOString(),
    totals: {
      collaborators: collaboratorRows.length,
      activeUsers,
      inactiveUsers,
      teams: teamCount,
      pendingProfileRequests,
      pendingVacationRequests,
      trainingsAssigned: assignedTrainings,
      trainingsCompleted: completedTrainings,
      trainingHoursAvg,
      promotionEvents: promotionEvents.length,
    },
    averages: {
      age: average(ageValues),
      tenure: average(tenureValues),
    },
    charts: {
      educationDistribution,
      genderByArea,
      timeInCurrentLevelByCargo,
    },
    recentPromotions: promotionEvents.slice(0, 8),
  });
});

router.patch('/users/:id/active', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'manage_user_active')) {
    return res.status(403).json({ message: 'Sem permissões para alterar estado de colaboradores.' });
  }

  const userId = String(req.params.id || '');
  const payload = updateUserActiveSchema.safeParse(req.body);

  if (!payload.success) {
    return res.status(400).json({ message: payload.error.issues[0].message });
  }

  if (req.authUser!.id === userId && payload.data.isActive === false) {
    return res.status(400).json({ message: 'Não é permitido desativar a tua própria conta.' });
  }

  const existing = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true } });
  if (!existing) {
    return res.status(404).json({ message: 'Utilizador não encontrado.' });
  }

  if (!req.authUser!.isRootAccess && !await isAccessTotal(req.authUser!.id)) {
    const canManageTarget = await canAccessUserByPermission(req.authUser!.id, 'manage_user_active', userId);
    if (!canManageTarget) {
      return res.status(403).json({ message: 'Sem permissões para alterar este colaborador com as restrições atuais.' });
    }
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      isActive: payload.data.isActive,
      deactivatedAt: payload.data.isActive ? null : new Date(),
    },
    select: {
      id: true,
      isActive: true,
      deactivatedAt: true,
      updatedAt: true,
    },
  });

  return res.json(updated);
});

router.get('/users/me/teams', requireAuth, async (req, res) => {
  const userId = req.authUser!.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      teamId: true,
      team: { select: { id: true, name: true } },
      teamMemberships: {
        where: { isActive: true },
        select: {
          teamId: true,
          membershipRole: true,
          isApprover: true,
          approvalLevel: true,
          team: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!user) {
    return res.status(404).json({ message: 'Utilizador não encontrado.' });
  }

  const teamMap = new Map<string, {
    teamId: string;
    teamName: string;
    membershipRole: string;
    isApprover: boolean;
    approvalLevel: number | null;
    isPrimary: boolean;
  }>();

  for (const item of user.teamMemberships) {
    teamMap.set(item.teamId, {
      teamId: item.teamId,
      teamName: item.team.name,
      membershipRole: item.membershipRole,
      isApprover: item.isApprover,
      approvalLevel: item.approvalLevel,
      isPrimary: user.teamId === item.teamId,
    });
  }

  if (user.teamId && user.team) {
    const existing = teamMap.get(user.teamId);
    if (existing) {
      existing.isPrimary = true;
      teamMap.set(user.teamId, existing);
    } else {
      teamMap.set(user.teamId, {
        teamId: user.team.id,
        teamName: user.team.name,
        membershipRole: 'PARTICIPANT',
        isApprover: false,
        approvalLevel: null,
        isPrimary: true,
      });
    }
  }

  return res.json(Array.from(teamMap.values()).sort((a, b) => a.teamName.localeCompare(b.teamName, 'pt-PT')));
});

router.get('/teams', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'view_teams')) {
    return res.status(403).json({ message: 'Sem permissões para consultar equipas.' });
  }

  const scope = await getPermissionScope(req.authUser!.id, 'view_teams');
  if (!scope) {
    return res.status(403).json({ message: 'Sem permissões para consultar equipas.' });
  }

  const teams = await prisma.team.findMany({
    where: scope.isGlobal
      ? undefined
      : {
          ...(scope.restrictedToTeams && scope.restrictedToTeams.length > 0
            ? { id: { in: scope.restrictedToTeams } }
            : {}),
        },
    select: {
      id: true,
      name: true,
      managerId: true,
      coordinatorId: true,
      manager: { select: { id: true, username: true } },
      coordinator: { select: { id: true, username: true } },
      _count: { select: { members: true, memberships: true } },
    },
    orderBy: { name: 'asc' },
  });

  return res.json(
    teams.map((team) => ({
      ...team,
      _count: {
        members: Math.max(team._count.members, team._count.memberships),
        memberships: team._count.memberships,
      },
    })),
  );
});

router.get('/teams/me', requireAuth, async (req, res) => {
  const userId = req.authUser!.id;
  const detailsMode = typeof req.query.details === 'string' ? req.query.details.toLowerCase() : 'full';
  const includeMembers = detailsMode !== 'none';
  const year = Number(typeof req.query.year === 'string' ? req.query.year : new Date().getFullYear());
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const teamScope = await resolveTeamScopeForUser(userId, req.authUser!.isRootAccess);

  const teamWhere: Prisma.TeamWhereInput | undefined = teamScope.isGlobal
    ? undefined
    : teamScope.teamIds.length > 0
      ? { id: { in: teamScope.teamIds } }
      : { id: '__no_team_scope__' };

  if (!includeMembers) {
    const teams = await prisma.team.findMany({
      where: teamWhere,
      select: {
        id: true,
        name: true,
        parentTeamId: true,
        manager: {
          select: {
            id: true,
            username: true,
            profile: { select: { nomeAbreviado: true, primeiroNome: true, apelido: true } },
          },
        },
        coordinator: {
          select: {
            id: true,
            username: true,
            profile: { select: { nomeAbreviado: true, primeiroNome: true, apelido: true } },
          },
        },
        parentTeam: { select: { id: true, name: true } },
        _count: { select: { memberships: true } },
      },
      orderBy: { name: 'asc' },
    });

    return res.json(teams.map((team) => ({
      ...team,
      _count: {
        members: team._count.memberships,
        memberships: team._count.memberships,
      },
    })));
  }

  const teams = await prisma.team.findMany({
    where: teamWhere,
    select: {
      id: true,
      name: true,
      managerId: true,
      coordinatorId: true,
      parentTeamId: true,
      manager: {
        select: {
          id: true,
          username: true,
          profile: { select: { nomeAbreviado: true, primeiroNome: true, apelido: true } },
        },
      },
      coordinator: {
        select: {
          id: true,
          username: true,
          profile: { select: { nomeAbreviado: true, primeiroNome: true, apelido: true } },
        },
      },
      parentTeam: { select: { id: true, name: true } },
      memberships: {
        where: { isActive: true },
        select: {
          userId: true,
          membershipRole: true,
          isApprover: true,
          approvalLevel: true,
          user: {
            select: {
              id: true,
              username: true,
              email: true,
              role: true,
              teamId: true,
              profile: {
                select: {
                  nomeAbreviado: true,
                  primeiroNome: true,
                  apelido: true,
                  cargo: true,
                  funcao: true,
                },
              },
              vacations: {
                where: {
                  AND: [
                    { dataInicio: { lte: yearEnd } },
                    { dataFim: { gte: yearStart } },
                  ],
                },
                select: {
                  id: true,
                  dataInicio: true,
                  dataFim: true,
                  status: true,
                  requestType: true,
                  partialDay: true,
                  reviewReason: true,
                  attachmentLink: true,
                  contextTeamId: true,
                  versionNumber: true,
                  contextTeam: { select: { id: true, name: true } },
                },
                orderBy: [{ dataInicio: 'desc' }, { createdAt: 'desc' }],
              },
            },
          },
        },
      },
      _count: { select: { memberships: true } },
    },
    orderBy: { name: 'asc' },
  });

  return res.json(teams.map((team) => ({
    ...team,
    members: team.memberships.map((membership) => ({
      id: membership.user.id,
      username: membership.user.username,
      email: membership.user.email,
      role: membership.user.role,
      teamId: membership.user.teamId,
      profile: membership.user.profile,
      membershipRole: membership.membershipRole,
      isApprover: membership.isApprover,
      approvalLevel: membership.approvalLevel,
      vacations: membership.user.vacations,
    })),
    _count: {
      members: team._count.memberships,
      memberships: team._count.memberships,
    },
  })));
});

router.get('/teams/me/:teamId', requireAuth, async (req, res) => {
  const userId = req.authUser!.id;
  const teamId = String(req.params.teamId || '');
  const year = Number(typeof req.query.year === 'string' ? req.query.year : new Date().getFullYear());
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const teamScope = await resolveTeamScopeForUser(userId, req.authUser!.isRootAccess);
  if (!teamScope.isGlobal && !teamScope.teamIds.includes(teamId)) {
    return res.status(403).json({ message: 'Sem permissões para consultar esta equipa.' });
  }

  const teamWhere: Prisma.TeamWhereInput = { id: teamId };

  const team = await prisma.team.findFirst({
    where: teamWhere,
    select: {
      id: true,
      name: true,
      managerId: true,
      coordinatorId: true,
      parentTeamId: true,
      manager: {
        select: {
          id: true,
          username: true,
          profile: { select: { nomeAbreviado: true, primeiroNome: true, apelido: true } },
        },
      },
      coordinator: {
        select: {
          id: true,
          username: true,
          profile: { select: { nomeAbreviado: true, primeiroNome: true, apelido: true } },
        },
      },
      parentTeam: { select: { id: true, name: true } },
      memberships: {
        where: { isActive: true },
        select: {
          userId: true,
          membershipRole: true,
          isApprover: true,
          approvalLevel: true,
          user: {
            select: {
              id: true,
              username: true,
              email: true,
              role: true,
              teamId: true,
              profile: {
                select: {
                  nomeAbreviado: true,
                  primeiroNome: true,
                  apelido: true,
                  cargo: true,
                  funcao: true,
                },
              },
              vacations: {
                where: {
                  AND: [
                    { dataInicio: { lte: yearEnd } },
                    { dataFim: { gte: yearStart } },
                  ],
                },
                select: {
                  id: true,
                  dataInicio: true,
                  dataFim: true,
                  status: true,
                  requestType: true,
                  partialDay: true,
                  reviewReason: true,
                  attachmentLink: true,
                  contextTeamId: true,
                  versionNumber: true,
                  contextTeam: { select: { id: true, name: true } },
                },
                orderBy: [{ dataInicio: 'desc' }, { createdAt: 'desc' }],
              },
            },
          },
        },
      },
      _count: { select: { memberships: true } },
    },
  });

  if (!team) {
    return res.status(404).json({ message: 'Equipa não encontrada.' });
  }

  return res.json({
    ...team,
    members: team.memberships.map((membership) => ({
      id: membership.user.id,
      username: membership.user.username,
      email: membership.user.email,
      role: membership.user.role,
      teamId: membership.user.teamId,
      profile: membership.user.profile,
      membershipRole: membership.membershipRole,
      isApprover: membership.isApprover,
      approvalLevel: membership.approvalLevel,
      vacations: membership.user.vacations,
    })),
    _count: {
      members: team._count.memberships,
      memberships: team._count.memberships,
    },
  });
});

router.patch('/manager/team-members/:id', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'manage_team_members')) {
    return res.status(403).json({ message: 'Sem permissões para gerir membros da equipa.' });
  }

  const targetUserId = String(req.params.id || '');
  const payload = managerTeamMemberUpdateSchema.safeParse(req.body);

  if (!payload.success) {
    return res.status(400).json({ message: payload.error.issues[0].message });
  }

  const data = payload.data;

  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    include: {
      team: true,
      teamMemberships: {
        where: { isActive: true },
        include: { team: true },
      },
    },
  });

  if (!targetUser) {
    return res.status(404).json({ message: 'Colaborador não encontrado.' });
  }

  if (targetUser.role !== 'COLABORADOR') {
    return res.status(400).json({ message: 'Só é possível gerir utilizadores com role COLABORADOR.' });
  }

  const [scope, fullAccess] = await Promise.all([
    getPermissionScope(req.authUser!.id, 'manage_team_members'),
    isAccessTotal(req.authUser!.id),
  ]);

  if (!scope) {
    return res.status(403).json({ message: 'Sem permissões para gerir membros da equipa.' });
  }

  const canManageAllTeams = req.authUser!.isRootAccess || fullAccess || scope.isGlobal;
  const isManageableTeam = (teamId?: string | null) => {
    if (canManageAllTeams) {
      return true;
    }

    return !scope.restrictedToTeams || scope.restrictedToTeams.length === 0 || (Boolean(teamId) && scope.restrictedToTeams.includes(String(teamId)));
  };

  const currentTeamAllowed = await canAccessUserByPermission(req.authUser!.id, 'manage_team_members', targetUserId)
    || isManageableTeam(targetUser.teamId)
    || targetUser.teamMemberships.some((item) => isManageableTeam(item.teamId));
  if (!currentTeamAllowed) {
    return res.status(403).json({ message: 'Este colaborador está fora do teu escopo de gestão.' });
  }

  let nextTeamId: string | null | undefined = data.teamId;

  if (nextTeamId !== undefined && nextTeamId !== null) {
    const nextTeam = await prisma.team.findFirst({ where: { id: nextTeamId }, select: { id: true } });

    if (!nextTeam) {
      return res.status(404).json({ message: 'Equipa de destino não encontrada.' });
    }

    if (!isManageableTeam(nextTeam.id)) {
      return res.status(403).json({ message: 'Só podes mover para equipas geridas por ti.' });
    }
  }

  if (nextTeamId !== undefined) {
    if (nextTeamId === null) {
      await prisma.teamMembership.updateMany({
        where: { userId: targetUserId, isActive: true },
        data: { isActive: false },
      });
      await prisma.user.update({
        where: { id: targetUserId },
        data: { teamId: null },
      });
    } else {
      await prisma.teamMembership.upsert({
        where: {
          userId_teamId: {
            userId: targetUserId,
            teamId: nextTeamId,
          },
        },
        update: {
          isActive: true,
        },
        create: {
          userId: targetUserId,
          teamId: nextTeamId,
          membershipRole: 'PARTICIPANT',
          isApprover: false,
          isActive: true,
        },
      });

      await prisma.user.update({
        where: { id: targetUserId },
        data: { teamId: nextTeamId },
      });
    }
  }

  if (data.cargo !== undefined || data.funcao !== undefined) {
    await prisma.profile.upsert({
      where: { userId: targetUserId },
      update: {
        ...(data.cargo !== undefined ? { cargo: data.cargo } : {}),
        ...(data.funcao !== undefined ? { funcao: data.funcao } : {}),
      },
      create: {
        userId: targetUserId,
        ...(data.cargo !== undefined ? { cargo: data.cargo } : {}),
        ...(data.funcao !== undefined ? { funcao: data.funcao } : {}),
      },
    });
  }

  return res.json({ success: true });
});

router.get('/admin/users', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'view_user_list')) {
    return res.status(403).json({ message: 'Sem permissões para consultar utilizadores.' });
  }

  const scope = await getPermissionScope(req.authUser!.id, 'view_user_list');
  if (!scope) {
    return res.status(403).json({ message: 'Sem permissões para consultar utilizadores.' });
  }

  const scopeWhere = buildUserWhereFromScope(scope) as Prisma.UserWhereInput | null;

  const users = await prisma.user.findMany({
    ...(scopeWhere ? { where: scopeWhere } : {}),
    include: {
      team: { select: { id: true, name: true } },
      teamMemberships: {
        where: { isActive: true },
        include: {
          team: { select: { id: true, name: true } },
        },
      },
      profile: {
        select: {
          nomeAbreviado: true,
          primeiroNome: true,
          apelido: true,
          workCountry: true,
          localidade: true,
        },
      },
    },
    orderBy: [{ role: 'asc' }, { username: 'asc' }],
  });

  return res.json(users.map((user) => ({
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    isRootAccess: user.isRootAccess,
    isActive: user.isActive,
    profile: user.profile
      ? {
          nomeAbreviado: user.profile.nomeAbreviado,
          primeiroNome: user.profile.primeiroNome,
          apelido: user.profile.apelido,
        }
      : null,
    teamId: user.teamId,
    teamName: user.team?.name ?? null,
    teams: user.teamMemberships.map((item) => ({
      teamId: item.teamId,
      teamName: item.team.name,
      membershipRole: item.membershipRole,
      isApprover: item.isApprover,
      approvalLevel: item.approvalLevel,
    })),
    workCountry: user.profile?.workCountry ?? 'PT',
    localidade: user.profile?.localidade ?? '',
  })));
});

router.get('/admin/teams', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'view_teams')) {
    return res.status(403).json({ message: 'Apenas admin pode gerir equipas.' });
  }

  const scope = await getPermissionScope(req.authUser!.id, 'view_teams');
  if (!scope) {
    return res.status(403).json({ message: 'Sem permissões para gerir equipas.' });
  }

  const teamWhere: Prisma.TeamWhereInput = {
    ...(scope.restrictedToTeams && scope.restrictedToTeams.length > 0
      ? { id: { in: scope.restrictedToTeams } }
      : {}),
  };

  const teams = await prisma.team.findMany({
    ...(scope.isGlobal ? {} : { where: teamWhere }),
    select: {
      id: true,
      name: true,
      managerId: true,
      parentTeamId: true,
      manager: {
        select: {
          id: true,
          username: true,
          profile: { select: { nomeAbreviado: true, primeiroNome: true, apelido: true } },
        },
      },
      parentTeam: { select: { id: true, name: true } },
      _count: { select: { members: true, memberships: true, subTeams: true } },
    },
    orderBy: [{ name: 'asc' }],
  });

  return res.json(teams.map((team) => ({
    ...team,
    leaderId: team.managerId ?? null,
    leader: team.manager ?? null,
    _count: {
      members: Math.max(team._count.members, team._count.memberships),
      memberships: team._count.memberships,
      subTeams: team._count.subTeams,
    },
  })));
});

router.post('/admin/teams', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'create_team')) {
    return res.status(403).json({ message: 'Apenas admin pode criar equipas.' });
  }

  const payload = adminTeamSchema.safeParse(req.body);
  if (!payload.success) {
    return res.status(400).json({ message: payload.error.issues[0].message });
  }

  const leaderId = payload.data.leaderId ?? null;
  const memberIds = Array.from(new Set(payload.data.memberIds ?? []));

  if (leaderId && memberIds.includes(leaderId)) {
    return res.status(400).json({ message: 'O chefe de equipa não pode ser membro participante da mesma equipa.' });
  }

  const usersToValidate = [
    ...(leaderId ? [leaderId] : []),
    ...memberIds,
  ];

  if (usersToValidate.length > 0) {
    const candidates = await prisma.user.findMany({
      where: { id: { in: usersToValidate } },
      select: { id: true, username: true, isActive: true },
    });

    const byId = new Map(candidates.map((item) => [item.id, item]));

    for (const userId of usersToValidate) {
      const user = byId.get(userId);
      if (!user) {
        return res.status(400).json({ message: 'Um dos utilizadores selecionados não existe.' });
      }
      if (!user.isActive) {
        return res.status(400).json({ message: `O utilizador ${user.username} está inativo e não pode ser associado à equipa.` });
      }
      if (user.username === 't.people') {
        return res.status(400).json({ message: 'A conta t.people não pode ser associada como chefe ou membro de equipa.' });
      }
    }
  }

  const team = await prisma.$transaction(async (tx) => {
    const createdTeam = await tx.team.create({
      data: {
        // A lógica atual usa um único chefe de equipa.
        // Mantemos managerId como campo persistido e limpamos coordinatorId.
        managerId: leaderId,
        coordinatorId: null,
        name: payload.data.name.trim(),
        parentTeamId: payload.data.parentTeamId ?? null,
      },
      select: {
        id: true,
        name: true,
        managerId: true,
        coordinatorId: true,
        parentTeamId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (memberIds.length > 0) {
      await tx.teamMembership.createMany({
        data: memberIds.map((userId) => ({
          userId,
          teamId: createdTeam.id,
          membershipRole: 'PARTICIPANT',
          isApprover: false,
          isActive: true,
        })),
        skipDuplicates: true,
      });
    }

    return createdTeam;
  });

  if (leaderId) {
    await syncTeamLeaderPreset(leaderId, req.authUser!.id);
  }

  return res.status(201).json(team);
});

router.patch('/admin/teams/:id', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'edit_team')) {
    return res.status(403).json({ message: 'Apenas admin pode editar equipas.' });
  }

  const teamId = String(req.params.id || '');
  const payload = adminTeamSchema.partial().safeParse(req.body);

  if (!payload.success) {
    return res.status(400).json({ message: payload.error.issues[0].message });
  }

  const existing = await prisma.team.findUnique({ where: { id: teamId } });
  if (!existing) {
    return res.status(404).json({ message: 'Equipa não encontrada.' });
  }

  const previousLeaderId = existing.managerId ?? null;
  const nextLeaderId = payload.data.leaderId !== undefined
    ? payload.data.leaderId
    : previousLeaderId;

  const updated = await prisma.team.update({
    where: { id: teamId },
    data: {
      ...(payload.data.name ? { name: payload.data.name.trim() } : {}),
      ...(
        payload.data.leaderId !== undefined
          ? { managerId: payload.data.leaderId, coordinatorId: null }
          : {}
      ),
      ...(payload.data.parentTeamId !== undefined ? { parentTeamId: payload.data.parentTeamId } : {}),
    },
    select: {
      id: true,
      name: true,
      managerId: true,
      coordinatorId: true,
      parentTeamId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (previousLeaderId && previousLeaderId !== nextLeaderId) {
    await syncTeamLeaderPreset(previousLeaderId, req.authUser!.id);
  }
  if (nextLeaderId) {
    await syncTeamLeaderPreset(nextLeaderId, req.authUser!.id);
  }

  return res.json(updated);
});

router.delete('/admin/teams/:id', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'delete_team')) {
    return res.status(403).json({ message: 'Apenas admin pode remover equipas.' });
  }

  const teamId = String(req.params.id || '');

  const existing = await prisma.team.findUnique({
    where: { id: teamId },
    select: { managerId: true },
  });

  await prisma.$transaction([
    prisma.teamMembership.deleteMany({ where: { teamId } }),
    prisma.user.updateMany({ where: { teamId }, data: { teamId: null } }),
    prisma.team.update({ where: { id: teamId }, data: { managerId: null, coordinatorId: null, parentTeamId: null } }),
    prisma.team.delete({ where: { id: teamId } }),
  ]);

  const previousLeaderId = existing?.managerId ?? null;
  if (previousLeaderId) {
    await syncTeamLeaderPreset(previousLeaderId, req.authUser!.id);
  }

  return res.json({ success: true });
});

router.patch('/admin/users/:id', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'edit_user')) {
    return res.status(403).json({ message: 'Apenas admin pode gerir perfis.' });
  }

  const userId = String(req.params.id || '');
  const payload = updateAdminUserSchema.safeParse(req.body);

  if (!payload.success) {
    return res.status(400).json({ message: payload.error.issues[0].message });
  }

  const data = payload.data;
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      isRootAccess: true,
      hasAccessTotal: true,
    },
  });

  if (!existing) {
    return res.status(404).json({ message: 'Utilizador não encontrado.' });
  }

  if (existing.isRootAccess && !req.authUser!.isRootAccess) {
    return res.status(403).json({ message: 'Sem permissões para editar este utilizador.' });
  }

  if (!req.authUser!.isRootAccess) {
    const actorHasAccessTotal = await isAccessTotal(req.authUser!.id);

    if (actorHasAccessTotal) {
      if (existing.hasAccessTotal) {
        const canManageByHierarchy = await canReviewAccessTotalHierarchy(req.authUser!.id, userId);
        if (!canManageByHierarchy) {
          return res.status(403).json({ message: 'Sem permissões para editar este utilizador acima de ti na hierarquia de acesso total.' });
        }
      }
    } else {
      const canManageTarget = await canAccessUserByPermission(req.authUser!.id, 'edit_user', userId);
      if (!canManageTarget) {
        return res.status(403).json({ message: 'Sem permissões para editar este utilizador com as restrições atuais.' });
      }
    }
  }

  if (data.role === 'ADMIN') {
    data.teamId = null;
  }

  if (req.authUser!.id === userId && data.isActive === false) {
    return res.status(400).json({ message: 'Não é permitido desativar a tua própria conta.' });
  }

  const profilePayload = {
    ...(data.primeiroNome !== undefined ? { primeiroNome: data.primeiroNome } : {}),
    ...(data.apelido !== undefined ? { apelido: data.apelido } : {}),
    ...(data.nomeAbreviado !== undefined ? { nomeAbreviado: data.nomeAbreviado } : {}),
    ...(data.dataNascimento !== undefined ? { dataNascimento: data.dataNascimento } : {}),
    ...(data.genero !== undefined ? { genero: data.genero } : {}),
    ...(data.estadoCivil !== undefined ? { estadoCivil: data.estadoCivil } : {}),
    ...(data.habilitacoesLiterarias !== undefined ? { habilitacoesLiterarias: data.habilitacoesLiterarias } : {}),
    ...(data.curso !== undefined ? { curso: data.curso } : {}),
    ...(data.faculdade !== undefined ? { faculdade: data.faculdade } : {}),
    ...(data.emailPessoal !== undefined ? { emailPessoal: data.emailPessoal } : {}),
    ...(data.telemovel !== undefined ? { telemovel: data.telemovel } : {}),
    ...(data.moradaFiscal !== undefined ? { moradaFiscal: data.moradaFiscal } : {}),
    ...(data.endereco !== undefined ? { endereco: data.endereco } : {}),
    ...(data.localidade !== undefined ? { localidade: data.localidade } : {}),
    ...(data.codigoPostal !== undefined ? { codigoPostal: data.codigoPostal } : {}),
    ...(data.matriculaCarro !== undefined ? { matriculaCarro: data.matriculaCarro } : {}),
    ...(data.cartaoCidadao !== undefined ? { cartaoCidadao: data.cartaoCidadao } : {}),
    ...(data.nif !== undefined ? { nif: data.nif } : {}),
    ...(data.niss !== undefined ? { niss: data.niss } : {}),
    ...(data.iban !== undefined ? { iban: data.iban } : {}),
    ...(data.situacaoIrs !== undefined ? { situacaoIrs: data.situacaoIrs } : {}),
    ...(data.numeroDependentes !== undefined ? { numeroDependentes: data.numeroDependentes } : {}),
    ...(data.irsJovem !== undefined ? { irsJovem: data.irsJovem } : {}),
    ...(data.anoPrimeiroDesconto !== undefined ? { anoPrimeiroDesconto: data.anoPrimeiroDesconto } : {}),
    ...(data.numeroCartaoContinente !== undefined ? { numeroCartaoContinente: data.numeroCartaoContinente } : {}),
    ...(data.voucherNosData !== undefined ? { voucherNosData: data.voucherNosData } : {}),
    ...(data.comprovativoMoradaFiscal !== undefined ? { comprovativoMoradaFiscal: data.comprovativoMoradaFiscal } : {}),
    ...(data.comprovativoCartaoCidadao !== undefined ? { comprovativoCartaoCidadao: data.comprovativoCartaoCidadao } : {}),
    ...(data.comprovativoIban !== undefined ? { comprovativoIban: data.comprovativoIban } : {}),
    ...(data.comprovativoCartaoContinente !== undefined ? { comprovativoCartaoContinente: data.comprovativoCartaoContinente } : {}),
    ...(data.contactoEmergenciaNome !== undefined ? { contactoEmergenciaNome: data.contactoEmergenciaNome } : {}),
    ...(data.contactoEmergenciaParentesco !== undefined ? { contactoEmergenciaParentesco: data.contactoEmergenciaParentesco } : {}),
    ...(data.contactoEmergenciaNumero !== undefined ? { contactoEmergenciaNumero: data.contactoEmergenciaNumero } : {}),
    ...(data.cargo !== undefined ? { cargo: data.cargo } : {}),
    ...(data.funcao !== undefined ? { funcao: data.funcao } : {}),
    ...(data.dataInicioContrato !== undefined ? { dataInicioContrato: data.dataInicioContrato } : {}),
    ...(data.dataFimContrato !== undefined ? { dataFimContrato: data.dataFimContrato } : {}),
    ...(data.remuneracao !== undefined ? { remuneracao: data.remuneracao } : {}),
    ...(data.tipoContrato !== undefined ? { tipoContrato: data.tipoContrato } : {}),
    ...(data.regimeHorario !== undefined ? { regimeHorario: data.regimeHorario } : {}),
    ...(data.workCountry !== undefined ? { workCountry: data.workCountry } : {}),
  };

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(data.role ? { role: data.role } : {}),
      ...(data.teamId !== undefined ? { teamId: data.teamId } : {}),
      ...(data.isActive !== undefined
        ? { isActive: data.isActive, deactivatedAt: data.isActive ? null : new Date() }
        : {}),
    },
  });

  if (data.teamId !== undefined) {
    if (data.teamId === null) {
      await prisma.teamMembership.updateMany({
        where: { userId },
        data: { isActive: false },
      });
    } else {
      await prisma.teamMembership.upsert({
        where: {
          userId_teamId: {
            userId,
            teamId: data.teamId,
          },
        },
        update: { isActive: true },
        create: {
          userId,
          teamId: data.teamId,
          membershipRole: 'PARTICIPANT',
          isApprover: false,
          isActive: true,
        },
      });
    }
  }

  if (Object.keys(profilePayload).length > 0 || data.localidade !== undefined) {
    await prisma.profile.upsert({
      where: { userId },
      update: {
        ...profilePayload,
        ...(data.localidade !== undefined ? { localidade: data.localidade } : {}),
      },
      create: {
        userId,
        ...profilePayload,
        workCountry: data.workCountry ?? 'PT',
        localidade: data.localidade ?? '',
      },
    });
  }

  return res.json({
    id: updatedUser.id,
    role: updatedUser.role,
    teamId: updatedUser.teamId,
    isActive: updatedUser.isActive,
  });
});

router.delete('/admin/users/:id', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'edit_user')) {
    return res.status(403).json({ message: 'Apenas admin pode apagar utilizadores.' });
  }

  const userId = String(req.params.id || '');
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isRootAccess: true },
  });

  if (!existing) {
    return res.status(404).json({ message: 'Utilizador não encontrado.' });
  }

  if (req.authUser!.id === userId) {
    return res.status(400).json({ message: 'Não é permitido apagar a tua própria conta.' });
  }

  if (existing.isRootAccess && !req.authUser!.isRootAccess) {
    return res.status(403).json({ message: 'Sem permissões para apagar este utilizador.' });
  }

  if (!req.authUser!.isRootAccess && !await isAccessTotal(req.authUser!.id)) {
    const canManageTarget = await canAccessUserByPermission(req.authUser!.id, 'edit_user', userId);
    if (!canManageTarget) {
      return res.status(403).json({ message: 'Sem permissões para apagar este utilizador com as restrições atuais.' });
    }
  }

  await prisma.user.delete({ where: { id: userId } });

  return res.json({ success: true });
});

router.patch('/admin/users/:id/credentials', requireAuth, async (req, res) => {
  if (req.authUser?.username !== 't.people') {
    return res.status(403).json({ message: 'Apenas t.people pode editar credenciais de utilizadores.' });
  }

  const userId = String(req.params.id || '');
  const payload = updateAdminUserCredentialsSchema.safeParse(req.body);

  if (!payload.success) {
    return res.status(400).json({ message: payload.error.issues[0].message });
  }

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, email: true },
  });

  if (!existing) {
    return res.status(404).json({ message: 'Utilizador não encontrado.' });
  }

  const nextUsername = payload.data.username?.trim().toLowerCase();
  const nextEmail = payload.data.email?.trim().toLowerCase();

  if (nextUsername || nextEmail) {
    const duplicate = await prisma.user.findFirst({
      where: {
        id: { not: userId },
        OR: [
          ...(nextUsername ? [{ username: nextUsername }] : []),
          ...(nextEmail ? [{ email: nextEmail }] : []),
        ],
      },
      select: { id: true },
    });

    if (duplicate) {
      return res.status(409).json({ message: 'Username ou email já está em uso por outro utilizador.' });
    }
  }

  const data: {
    username?: string;
    email?: string;
  } = {};

  if (nextUsername) {
    data.username = nextUsername;
  }
  if (nextEmail) {
    data.email = nextEmail;
  }
  const updated = await prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      username: true,
      email: true,
      updatedAt: true,
    },
  });

  return res.json(updated);
});

router.patch('/admin/users/:id/memberships', requireAuth, async (req, res) => {
  if (!await hasPermission(req.authUser!.id, 'manage_team_members')) {
    return res.status(403).json({ message: 'Apenas admin pode gerir memberships.' });
  }

  const userId = String(req.params.id || '');
  const payload = updateAdminMembershipsSchema.safeParse(req.body);

  if (!payload.success) {
    return res.status(400).json({ message: payload.error.issues[0].message });
  }

  const existing = await prisma.user.findUnique({ where: { id: userId } });

  if (!existing) {
    return res.status(404).json({ message: 'Utilizador não encontrado.' });
  }

  const memberships = payload.data.memberships;

  await prisma.$transaction(async (tx) => {
    await tx.teamMembership.updateMany({
      where: { userId },
      data: { isActive: false },
    });

    for (const item of memberships) {
      await tx.teamMembership.upsert({
        where: {
          userId_teamId: {
            userId,
            teamId: item.teamId,
          },
        },
        update: {
          isActive: item.isActive ?? true,
          membershipRole: item.membershipRole ?? 'PARTICIPANT',
          isApprover: item.isApprover ?? false,
          approvalLevel: item.approvalLevel ?? null,
        },
        create: {
          userId,
          teamId: item.teamId,
          isActive: item.isActive ?? true,
          membershipRole: item.membershipRole ?? 'PARTICIPANT',
          isApprover: item.isApprover ?? false,
          approvalLevel: item.approvalLevel ?? null,
        },
      });
    }

    await tx.user.update({
      where: { id: userId },
      data: {
        teamId: memberships[0]?.teamId ?? null,
      },
    });
  });

  return res.json({ success: true });
});

router.post('/users', requireAuth, async (req, res, next) => {
  try {
    if (!await hasPermission(req.authUser!.id, 'create_user')) {
      return res.status(403).json({ message: 'Sem permissões para criar utilizadores.' });
    }

    const data = createUserSchema.parse(req.body);
    const passwordHash = await bcrypt.hash('pola123', 10);

    // Parse fullName into firstName, lastName, and shortName
    const nameParts = data.fullName.trim().split(/\s+/).filter(Boolean);
    const firstName = nameParts[0] || data.fullName;
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
    const shortName = `${firstName}${lastName ? ` ${lastName}` : ''}`.trim();

    // Get current date as dataInicioContrato default
    const today = new Date();
    const dataInicioContrato = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const user = await prisma.user.create({
      data: {
        username: data.username.trim().toLowerCase(),
        email: data.email,
        passwordHash,
        role: data.role ?? 'COLABORADOR',
        teamId: data.teamId,
        ...(data.teamId
          ? {
              teamMemberships: {
                create: {
                  teamId: data.teamId,
                  membershipRole: 'PARTICIPANT',
                  isApprover: false,
                  isActive: true,
                },
              },
            }
          : {}),
        profile: {
          create: {
            primeiroNome: firstName,
            apelido: lastName,
            nomeAbreviado: shortName,
            emailPessoal: data.email,
            dataInicioContrato,
            tipoContrato: '',
            regimeHorario: '',
            cargo: '',
            funcao: '',
            workCountry: data.workCountry ?? 'PT',
          },
        },
      },
      include: {
        profile: true,
      },
    });

    const createdRole = data.role ?? 'COLABORADOR';

    if (createdRole !== 'CONVIDADO') {
      await upsertPresetPermissions({
        userId: user.id,
        actorUserId: req.authUser!.id,
        codes: DEFAULT_EMPLOYEE_PERMISSION_CODES,
        note: AUTO_DEFAULT_EMPLOYEE_NOTE,
      });
    }

    // Se o utilizador já estiver como líder em alguma equipa (ex.: fluxo importado), sincroniza o preset de chefe.
    await syncTeamLeaderPreset(user.id, req.authUser!.id);

    const { passwordHash: _ignored, ...safeUser } = user;

    return res.status(201).json(safeUser);
  } catch (error) {
    return next(error);
  }
});

export { router as usersRouter };
