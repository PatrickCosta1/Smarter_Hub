import { Request, Response, Router } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';

import { prisma } from '../lib/prisma.js';
import { hasPermission, isAccessTotal } from '../lib/permission-engine.js';
import {
  appendHourBankEntry,
  createOrGetWeeklyHourBankReport,
  filterUserIdsByWorkCountry,
  getHourBankTotalsByUserId,
  getNextClosingDateByPolicy,
  notifyHourBankExceedance,
  resolveAccessTotalRecipientIds,
  resolveBrClosingPolicy,
  resolveBrHourBankLimit,
  resolveLeadershipRecipientsForUser,
} from '../lib/hour-bank.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const createEntrySchema = z.object({
  userId: z.string().min(1, 'Colaborador é obrigatório.'),
  type: z.enum(['CREDIT', 'DEBIT']),
  hours: z.number().positive('Horas devem ser superiores a 0.').max(200, 'Horas acima do limite permitido.'),
  reason: z.string().trim().min(3, 'Motivo é obrigatório.'),
});

const updateLimitSchema = z.object({
  limitHours: z.number().min(0, 'Limite deve ser >= 0.').max(400, 'Limite acima do permitido.'),
});

function normalizeHours(value: number) {
  return Math.round(value * 100) / 100;
}

function parsePagination(query: Request['query']) {
  const pageRaw = Number(typeof query.page === 'string' ? query.page : '1');
  const pageSizeRaw = Number(typeof query.pageSize === 'string' ? query.pageSize : '50');
  const page = Number.isFinite(pageRaw) ? Math.max(1, pageRaw) : 1;
  const pageSize = Number.isFinite(pageSizeRaw) ? Math.min(200, Math.max(1, pageSizeRaw)) : 50;

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
}

async function canManageHourBank(userId: string, isRootAccessFlag: boolean) {
  if (isRootAccessFlag) {
    return true;
  }

  if (await isAccessTotal(userId)) {
    return true;
  }

  return hasPermission(userId, 'manage_hours_bank');
}

async function canViewHourBank(userId: string, isRootAccessFlag: boolean, role: string) {
  if (isRootAccessFlag) {
    return true;
  }

  if (await isAccessTotal(userId)) {
    return true;
  }

  if (await hasPermission(userId, 'view_hours_bank')) {
    return true;
  }

  // Chefias podem consultar saldo da sua equipa
  return role === 'MANAGER' || role === 'COORDENADOR';
}

async function resolveViewerTeamIds(userId: string) {
  const [managed, memberships, ownUser] = await Promise.all([
    prisma.team.findMany({
      where: {
        OR: [{ managerId: userId }, { coordinatorId: userId }],
      },
      select: { id: true },
    }),
    prisma.teamMembership.findMany({
      where: {
        userId,
        isActive: true,
        isApprover: true,
      },
      select: { teamId: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { teamId: true },
    }),
  ]);

  const ids = new Set<string>();
  if (ownUser?.teamId) {
    ids.add(ownUser.teamId);
  }
  for (const item of managed) {
    ids.add(item.id);
  }
  for (const item of memberships) {
    ids.add(item.teamId);
  }

  return Array.from(ids);
}

async function isActorFromBrazil(userId: string) {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { workCountry: true },
  });

  return (profile?.workCountry ?? 'PT') === 'BR';
}

router.get('/hours-bank/me', requireAuth, async (req: Request, res: Response) => {
  const userId = req.authUser!.id;

  if (!(await isActorFromBrazil(userId))) {
    return res.status(403).json({ message: 'Banco de horas disponível apenas para colaboradores RH/gestão do Brasil.' });
  }

  const [profile, entries] = await Promise.all([
    prisma.profile.findUnique({
      where: { userId },
      select: {
        workCountry: true,
        brWorkState: true,
        hourBankLimitHours: true,
      },
    }),
    prisma.hourBankEntry.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 120,
      select: {
        id: true,
        type: true,
        hours: true,
        reason: true,
        source: true,
        createdAt: true,
        createdBy: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    }),
  ]);

  const isBr = (profile?.workCountry ?? 'PT') === 'BR';
  const limitHours = isBr ? resolveBrHourBankLimit(profile?.hourBankLimitHours) : Math.max(profile?.hourBankLimitHours ?? 40, 0);
  const totals = await getHourBankTotalsByUserId(prisma, userId, limitHours);
  const closingPolicy = isBr ? resolveBrClosingPolicy(profile?.brWorkState ?? null) : null;

  return res.json({
    geo: profile?.workCountry ?? 'PT',
    brWorkState: profile?.brWorkState ?? null,
    closingPolicyLabel: closingPolicy?.label ?? null,
    nextClosingDate: closingPolicy ? getNextClosingDateByPolicy(closingPolicy).toISOString().slice(0, 10) : null,
    ...totals,
    entries,
  });
});

router.get('/hours-bank/overview', requireAuth, async (req: Request, res: Response) => {
  const actorId = req.authUser!.id;

  if (!(await isActorFromBrazil(actorId))) {
    return res.status(403).json({ message: 'Banco de horas disponível apenas para colaboradores RH/gestão do Brasil.' });
  }

  const canView = await canViewHourBank(actorId, Boolean(req.authUser!.isRootAccess), req.authUser!.role);

  if (!canView) {
    return res.status(403).json({ message: 'Sem permissões para consultar banco de horas.' });
  }

  const { skip, take, page, pageSize } = parsePagination(req.query);
  const query = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  const workCountry = typeof req.query.workCountry === 'string' ? req.query.workCountry : 'BR';
  const teamId = typeof req.query.teamId === 'string' ? req.query.teamId : '';

  const canManage = await canManageHourBank(actorId, Boolean(req.authUser!.isRootAccess));
  const scopedTeamIds = canManage ? null : await resolveViewerTeamIds(actorId);

  const usersWhere: any = {
    id: { not: actorId },
    isActive: true,
    role: { not: 'CONVIDADO' },
    profile: workCountry === 'ALL'
      ? { isNot: null }
      : { is: { workCountry: workCountry === 'PT' ? 'PT' : 'BR' } },
  };

  if (teamId) {
    usersWhere.teamId = teamId;
  }

  if (!canManage) {
    if (!scopedTeamIds || scopedTeamIds.length === 0) {
      return res.json({ rows: [], total: 0, page, pageSize });
    }

    usersWhere.teamId = usersWhere.teamId
      ? { in: scopedTeamIds.filter((id) => id === usersWhere.teamId) }
      : { in: scopedTeamIds };
  }

  if (query) {
    usersWhere.OR = [
      { username: { contains: query, mode: 'insensitive' } },
      { email: { contains: query, mode: 'insensitive' } },
      { profile: { is: { nomeCompleto: { contains: query, mode: 'insensitive' } } } },
      { profile: { is: { nomeAbreviado: { contains: query, mode: 'insensitive' } } } },
    ];
  }

  const [total, users] = await Promise.all([
    prisma.user.count({ where: usersWhere }),
    prisma.user.findMany({
      where: usersWhere,
      skip,
      take,
      orderBy: [{ username: 'asc' }],
      select: {
        id: true,
        username: true,
        email: true,
        team: { select: { id: true, name: true } },
        profile: {
          select: {
            nomeCompleto: true,
            nomeAbreviado: true,
            workCountry: true,
            brWorkState: true,
            hourBankLimitHours: true,
          },
        },
      },
    }),
  ]);

  const userIds = users.map((u) => u.id);

  const [creditAgg, debitAgg] = await Promise.all([
    prisma.hourBankEntry.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, type: 'CREDIT' },
      _sum: { hours: true },
    }),
    prisma.hourBankEntry.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, type: 'DEBIT' },
      _sum: { hours: true },
    }),
  ]);

  const creditedMap = new Map(creditAgg.map((item) => [item.userId, item._sum.hours ?? 0]));
  const debitedMap = new Map(debitAgg.map((item) => [item.userId, item._sum.hours ?? 0]));

  const rows = users.map((user) => {
    const creditedHours = normalizeHours(creditedMap.get(user.id) ?? 0);
    const debitedHours = normalizeHours(debitedMap.get(user.id) ?? 0);
    const totalHours = normalizeHours(creditedHours - debitedHours);
    const limitHours = (user.profile?.workCountry ?? 'PT') === 'BR'
      ? resolveBrHourBankLimit(user.profile?.hourBankLimitHours)
      : Math.max(0, user.profile?.hourBankLimitHours ?? 40);
    const exceededByHours = normalizeHours(Math.max(Math.abs(totalHours) - limitHours, 0));

    return {
      userId: user.id,
      username: user.username,
      fullName: user.profile?.nomeAbreviado || user.profile?.nomeCompleto || user.username,
      email: user.email,
      team: user.team,
      geo: user.profile?.workCountry ?? 'PT',
      brWorkState: user.profile?.brWorkState ?? null,
      closingPolicyLabel: (user.profile?.workCountry ?? 'PT') === 'BR' ? resolveBrClosingPolicy(user.profile?.brWorkState ?? null).label : null,
      creditedHours,
      debitedHours,
      totalHours,
      limitHours,
      isExceeded: exceededByHours > 0,
      exceededByHours,
    };
  });

  return res.json({
    rows,
    total,
    page,
    pageSize,
  });
});

router.post('/hours-bank/entries', requireAuth, async (req: Request, res: Response) => {
  const actorId = req.authUser!.id;

  if (!(await isActorFromBrazil(actorId))) {
    return res.status(403).json({ message: 'Banco de horas disponível apenas para colaboradores RH/gestão do Brasil.' });
  }

  const canManage = await canManageHourBank(actorId, Boolean(req.authUser!.isRootAccess));

  if (!canManage) {
    return res.status(403).json({ message: 'Sem permissões para lançar horas no banco.' });
  }

  const parsed = createEntrySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0].message });
  }

  const { userId, type, hours, reason } = parsed.data;

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      isActive: true,
      profile: {
        select: {
          workCountry: true,
          brWorkState: true,
          hourBankLimitHours: true,
        },
      },
    },
  });

  if (!target || !target.isActive) {
    return res.status(404).json({ message: 'Colaborador não encontrado ou inativo.' });
  }

  if ((target.profile?.workCountry ?? 'PT') !== 'BR') {
    return res.status(400).json({ message: 'Banco de horas está disponível apenas para colaboradores BR.' });
  }

  const entry = await appendHourBankEntry({
    prisma,
    userId,
    createdById: actorId,
    type,
    hours,
    reason,
    source: 'MANUAL',
  });

  const totals = await getHourBankTotalsByUserId(prisma, userId, resolveBrHourBankLimit(target.profile?.hourBankLimitHours));

  const [leaderIds, accessTotalIds] = await Promise.all([
    resolveLeadershipRecipientsForUser(prisma, userId),
    resolveAccessTotalRecipientIds(prisma),
  ]);

  const leaderIdsBr = await filterUserIdsByWorkCountry(prisma, leaderIds, 'BR');

  await notifyHourBankExceedance({
    prisma,
    userId,
    username: target.username,
    limitHours: totals.limitHours,
    totalHours: totals.totalHours,
    exceededByHours: totals.exceededByHours,
    leaderIds: leaderIdsBr,
    accessTotalIds,
  });

  return res.status(201).json({
    entry,
    totals,
  });
});

router.patch('/hours-bank/limits/:userId', requireAuth, async (req: Request, res: Response) => {
  const actorId = req.authUser!.id;

  if (!(await isActorFromBrazil(actorId))) {
    return res.status(403).json({ message: 'Banco de horas disponível apenas para colaboradores RH/gestão do Brasil.' });
  }

  const canManage = await canManageHourBank(actorId, Boolean(req.authUser!.isRootAccess));

  if (!canManage) {
    return res.status(403).json({ message: 'Sem permissões para atualizar limite de banco de horas.' });
  }

  const userId = typeof req.params.userId === 'string' ? req.params.userId : '';
  const parsed = updateLimitSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0].message });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      isActive: true,
      profile: {
        select: { workCountry: true },
      },
    },
  });

  if (!user || !user.isActive) {
    return res.status(404).json({ message: 'Colaborador não encontrado ou inativo.' });
  }

  if ((user.profile?.workCountry ?? 'PT') !== 'BR') {
    return res.status(400).json({ message: 'Limite de banco de horas só se aplica a colaboradores BR.' });
  }

  await prisma.profile.update({
    where: { userId },
    data: {
      hourBankLimitHours: parsed.data.limitHours,
    },
  });

  return res.json({ success: true, userId, limitHours: parsed.data.limitHours });
});

router.get('/hours-bank/export', requireAuth, async (req: Request, res: Response) => {
  const actorId = req.authUser!.id;

  if (!(await isActorFromBrazil(actorId))) {
    return res.status(403).json({ message: 'Banco de horas disponível apenas para colaboradores RH/gestão do Brasil.' });
  }

  const canView = await canViewHourBank(actorId, Boolean(req.authUser!.isRootAccess), req.authUser!.role);

  if (!canView) {
    return res.status(403).json({ message: 'Sem permissões para exportar banco de horas.' });
  }

  const workCountry = typeof req.query.workCountry === 'string' ? req.query.workCountry : 'BR';
  const teamId = typeof req.query.teamId === 'string' ? req.query.teamId : '';
  const query = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

  const canManage = await canManageHourBank(actorId, Boolean(req.authUser!.isRootAccess));
  const scopedTeamIds = canManage ? null : await resolveViewerTeamIds(actorId);

  const usersWhere: any = {
    isActive: true,
    role: { not: 'CONVIDADO' },
    profile: workCountry === 'ALL'
      ? { isNot: null }
      : { is: { workCountry: workCountry === 'PT' ? 'PT' : 'BR' } },
  };

  if (teamId) {
    usersWhere.teamId = teamId;
  }

  if (!canManage) {
    if (!scopedTeamIds || scopedTeamIds.length === 0) {
      return res.status(400).json({ message: 'Não existem equipas no teu âmbito para exportação.' });
    }

    usersWhere.teamId = usersWhere.teamId
      ? { in: scopedTeamIds.filter((id) => id === usersWhere.teamId) }
      : { in: scopedTeamIds };
  }

  if (query) {
    usersWhere.OR = [
      { username: { contains: query, mode: 'insensitive' } },
      { email: { contains: query, mode: 'insensitive' } },
      { profile: { is: { nomeCompleto: { contains: query, mode: 'insensitive' } } } },
      { profile: { is: { nomeAbreviado: { contains: query, mode: 'insensitive' } } } },
    ];
  }

  const users = await prisma.user.findMany({
    where: usersWhere,
    orderBy: [{ username: 'asc' }],
    select: {
      id: true,
      username: true,
      email: true,
      team: { select: { id: true, name: true } },
      profile: {
        select: {
          nomeCompleto: true,
          nomeAbreviado: true,
          workCountry: true,
          brWorkState: true,
          hourBankLimitHours: true,
        },
      },
    },
  });

  const userIds = users.map((u) => u.id);

  const [creditAgg, debitAgg] = await Promise.all([
    prisma.hourBankEntry.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, type: 'CREDIT' },
      _sum: { hours: true },
    }),
    prisma.hourBankEntry.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, type: 'DEBIT' },
      _sum: { hours: true },
    }),
  ]);

  const creditedMap = new Map(creditAgg.map((item) => [item.userId, item._sum.hours ?? 0]));
  const debitedMap = new Map(debitAgg.map((item) => [item.userId, item._sum.hours ?? 0]));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Banco de Horas');

  sheet.columns = [
    { header: 'Colaborador', key: 'colaborador', width: 34 },
    { header: 'Username', key: 'username', width: 24 },
    { header: 'Email', key: 'email', width: 32 },
    { header: 'Equipa', key: 'equipa', width: 28 },
    { header: 'Geo', key: 'geo', width: 8 },
    { header: 'Estado BR', key: 'estado', width: 12 },
    { header: 'Política fecho', key: 'fecho', width: 38 },
    { header: 'Saldo creditado (h)', key: 'creditado', width: 20 },
    { header: 'Saldo debitado (h)', key: 'debitado', width: 20 },
    { header: 'Total (h)', key: 'total', width: 14 },
    { header: 'Limite (h)', key: 'limite', width: 14 },
    { header: 'Excedente (h)', key: 'excedente', width: 16 },
    { header: 'Status', key: 'status', width: 16 },
  ];

  const header = sheet.getRow(1);
  header.font = { bold: true };

  for (const user of users) {
    const creditedHours = normalizeHours(creditedMap.get(user.id) ?? 0);
    const debitedHours = normalizeHours(debitedMap.get(user.id) ?? 0);
    const totalHours = normalizeHours(creditedHours - debitedHours);
    const limitHours = (user.profile?.workCountry ?? 'PT') === 'BR'
      ? resolveBrHourBankLimit(user.profile?.hourBankLimitHours)
      : Math.max(0, user.profile?.hourBankLimitHours ?? 40);
    const exceededByHours = normalizeHours(Math.max(Math.abs(totalHours) - limitHours, 0));

    sheet.addRow({
      colaborador: user.profile?.nomeAbreviado || user.profile?.nomeCompleto || user.username,
      username: user.username,
      email: user.email,
      equipa: user.team?.name || 'Sem equipa',
      geo: user.profile?.workCountry ?? 'PT',
      estado: user.profile?.brWorkState ?? '',
      fecho: (user.profile?.workCountry ?? 'PT') === 'BR' ? resolveBrClosingPolicy(user.profile?.brWorkState ?? null).label : '',
      creditado: creditedHours,
      debitado: debitedHours,
      total: totalHours,
      limite: limitHours,
      excedente: exceededByHours,
      status: exceededByHours > 0 ? 'EXCEDENTE' : 'OK',
    });
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="banco_horas_${new Date().toISOString().slice(0, 10)}.xlsx"`);

  await workbook.xlsx.write(res);
  res.end();
});

router.get('/hours-bank/reports', requireAuth, async (req: Request, res: Response) => {
  const actorId = req.authUser!.id;

  if (!(await isActorFromBrazil(actorId))) {
    return res.status(403).json({ message: 'Banco de horas disponível apenas para colaboradores RH/gestão do Brasil.' });
  }

  const canView = await canViewHourBank(actorId, Boolean(req.authUser!.isRootAccess), req.authUser!.role);
  if (!canView) {
    return res.status(403).json({ message: 'Sem permissões para consultar relatórios semanais.' });
  }

  const reports = await prisma.weeklyHourBankReport.findMany({
    orderBy: { generatedAt: 'desc' },
    take: 104,
    select: {
      id: true,
      weekLabel: true,
      generatedAt: true,
      periodStart: true,
      periodEnd: true,
      totalUsers: true,
      positiveUsers: true,
      negativeUsers: true,
      exceededUsers: true,
      pdfFileName: true,
      pdfPublicUrl: true,
    },
  });

  return res.json({
    rows: reports,
    total: reports.length,
  });
});

router.post('/hours-bank/reports/generate-weekly', requireAuth, async (req: Request, res: Response) => {
  const actorId = req.authUser!.id;

  if (!(await isActorFromBrazil(actorId))) {
    return res.status(403).json({ message: 'Banco de horas disponível apenas para colaboradores RH/gestão do Brasil.' });
  }

  const canManage = await canManageHourBank(actorId, Boolean(req.authUser!.isRootAccess));
  if (!canManage) {
    return res.status(403).json({ message: 'Sem permissões para gerar relatório semanal.' });
  }

  const report = await createOrGetWeeklyHourBankReport(prisma, { generatedById: actorId });

  if (!report) {
    return res.status(400).json({ message: 'Não existem colaboradores BR para gerar relatório semanal.' });
  }

  return res.json({
    id: report.id,
    weekLabel: report.weekLabel,
    generatedAt: report.generatedAt,
    periodStart: report.periodStart,
    periodEnd: report.periodEnd,
    pdfPublicUrl: report.pdfPublicUrl,
  });
});

export { router as hourBankRouter };
