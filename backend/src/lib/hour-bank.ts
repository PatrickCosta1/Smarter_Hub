import type { HourBankEntryType, Prisma, PrismaClient } from '@prisma/client';

import { notifyUsers } from './notifications.js';

export const HOURS_BANK_HOURS_PER_DAY = 8;
export const BR_HOUR_BANK_DEFAULT_LIMIT_HOURS = 100;

export type BrWorkStateCode = 'SP' | 'RS' | null;

export type HourBankClosingPolicy = {
  code: 'QUADRIMESTRAL' | 'SEMESTRAL';
  label: string;
  closeMonths: number[];
};

export type HourBankTotals = {
  creditedHours: number;
  debitedHours: number;
  totalHours: number;
  limitHours: number;
  isExceeded: boolean;
  exceededByHours: number;
};

function normalizeHours(value: number) {
  return Math.round(value * 100) / 100;
}

export function resolveBrHourBankLimit(limitHours?: number | null) {
  if (typeof limitHours !== 'number' || !Number.isFinite(limitHours)) {
    return BR_HOUR_BANK_DEFAULT_LIMIT_HOURS;
  }

  return Math.max(limitHours, BR_HOUR_BANK_DEFAULT_LIMIT_HOURS);
}

export function resolveBrClosingPolicy(brWorkState: BrWorkStateCode): HourBankClosingPolicy {
  if (brWorkState === 'RS') {
    return {
      code: 'SEMESTRAL',
      label: 'Fecho semestral (abril e outubro)',
      closeMonths: [4, 10],
    };
  }

  return {
    code: 'QUADRIMESTRAL',
    label: 'Fecho quadrimestral (fevereiro, junho e outubro)',
    closeMonths: [2, 6, 10],
  };
}

export function getNextClosingDateByPolicy(policy: HourBankClosingPolicy, fromDate = new Date()) {
  const currentYear = fromDate.getFullYear();
  const currentMonth = fromDate.getMonth() + 1;
  const sortedMonths = [...policy.closeMonths].sort((a, b) => a - b);

  const nextMonth = sortedMonths.find((month) => month >= currentMonth);
  if (nextMonth) {
    return new Date(currentYear, nextMonth, 0);
  }

  return new Date(currentYear + 1, sortedMonths[0], 0);
}

export function getIsoWeekLabel(inputDate = new Date()) {
  const date = new Date(Date.UTC(inputDate.getUTCFullYear(), inputDate.getUTCMonth(), inputDate.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-S${String(weekNum).padStart(2, '0')}`;
}

export function isFolgaAbsenceForHourBank(requestType: 'VACATION' | 'ABSENCE_MEDICAL' | 'ABSENCE_TRAINING', observacoes?: string | null) {
  if (requestType === 'VACATION') {
    return false;
  }

  const normalized = String(observacoes || '').toLowerCase();
  return normalized.includes('justificada - folga');
}

export function calculateHourBankDebitFromAbsence(dataInicio: string, dataFim: string) {
  const start = new Date(`${dataInicio}T00:00:00`);
  const end = new Date(`${dataFim}T00:00:00`);
  const diffDays = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  const days = Number.isFinite(diffDays) && diffDays > 0 ? diffDays : 1;
  return normalizeHours(days * HOURS_BANK_HOURS_PER_DAY);
}

export async function getHourBankTotalsByUserId(
  prisma: PrismaClient,
  userId: string,
  limitHours = 40,
): Promise<HourBankTotals> {
  const [credit, debit] = await Promise.all([
    prisma.hourBankEntry.aggregate({
      where: {
        userId,
        type: 'CREDIT',
      },
      _sum: { hours: true },
    }),
    prisma.hourBankEntry.aggregate({
      where: {
        userId,
        type: 'DEBIT',
      },
      _sum: { hours: true },
    }),
  ]);

  const creditedHours = normalizeHours(credit._sum.hours ?? 0);
  const debitedHours = normalizeHours(debit._sum.hours ?? 0);
  const totalHours = normalizeHours(creditedHours - debitedHours);
  const exceededByHours = normalizeHours(Math.max(Math.abs(totalHours) - Math.max(limitHours, 0), 0));

  return {
    creditedHours,
    debitedHours,
    totalHours,
    limitHours,
    isExceeded: exceededByHours > 0,
    exceededByHours,
  };
}

export async function notifyHourBankExceedance(params: {
  prisma: PrismaClient;
  userId: string;
  username: string;
  limitHours: number;
  totalHours: number;
  exceededByHours: number;
  leaderIds: string[];
  accessTotalIds: string[];
}) {
  const {
    prisma,
    userId,
    username,
    limitHours,
    totalHours,
    exceededByHours,
    leaderIds,
    accessTotalIds,
  } = params;

  if (exceededByHours <= 0) {
    return;
  }

  const title = 'Banco de horas em excedente';

  await notifyUsers(
    prisma,
    [userId],
    title,
    [
      `O teu saldo total (${totalHours.toFixed(2)}h) ultrapassou o limite definido (${limitHours.toFixed(2)}h).`,
      `Excedente atual: ${exceededByHours.toFixed(2)}h.`,
      'Ação: verifica com a chefia e RH a compensação/regularização do saldo.',
    ].join('\n'),
  );

  const leadershipTargets = Array.from(new Set([...leaderIds, ...accessTotalIds])).filter((id) => id !== userId);
  if (leadershipTargets.length === 0) {
    return;
  }

  await notifyUsers(
    prisma,
    leadershipTargets,
    title,
    [
      `O colaborador ${username} ultrapassou o limite de banco de horas.`,
      `Saldo atual: ${totalHours.toFixed(2)}h | Limite: ${limitHours.toFixed(2)}h | Excedente: ${exceededByHours.toFixed(2)}h.`,
      'Ação: acompanhar regularização do saldo pela equipa/RH.',
    ].join('\n'),
  );
}

export async function runWeeklyHourBankReportSweep(prisma: PrismaClient) {
  const now = new Date();
  const utcDay = now.getUTCDay();

  // 1 = Monday
  if (utcDay !== 1) {
    return { skipped: true, reason: 'not-monday', createdNotifications: 0 };
  }

  const weekLabel = getIsoWeekLabel(now);
  const reportTitle = `Relatório semanal banco de horas (${weekLabel})`;
  const exceededTitle = `Banco de horas em excedente (${weekLabel})`;

  const [users, accessTotalUsers] = await Promise.all([
    prisma.user.findMany({
      where: {
        isActive: true,
        role: { not: 'CONVIDADO' },
        profile: { isNot: null },
      },
      select: {
        id: true,
        username: true,
        teamId: true,
        managedTeams: { select: { id: true, managerId: true, coordinatorId: true } },
        coordinatedTeams: { select: { id: true, managerId: true, coordinatorId: true } },
        profile: {
          select: {
            workCountry: true,
            brWorkState: true,
            hourBankLimitHours: true,
          },
        },
      },
    }),
    prisma.user.findMany({
      where: {
        isActive: true,
        OR: [{ isRootAccess: true }, { hasAccessTotal: true }],
      },
      select: { id: true },
    }),
  ]);

  const brUsers = users.filter((u) => u.profile?.workCountry === 'BR');

  if (brUsers.length === 0) {
    return { skipped: false, reason: null, createdNotifications: 0 };
  }

  const userIds = brUsers.map((u) => u.id);

  const [creditAgg, debitAgg] = await Promise.all([
    prisma.hourBankEntry.groupBy({
      by: ['userId'],
      where: {
        userId: { in: userIds },
        type: 'CREDIT',
      },
      _sum: { hours: true },
    }),
    prisma.hourBankEntry.groupBy({
      by: ['userId'],
      where: {
        userId: { in: userIds },
        type: 'DEBIT',
      },
      _sum: { hours: true },
    }),
  ]);

  const creditedMap = new Map(creditAgg.map((item) => [item.userId, item._sum.hours ?? 0]));
  const debitedMap = new Map(debitAgg.map((item) => [item.userId, item._sum.hours ?? 0]));

  const totals = brUsers.map((u) => {
    const credited = creditedMap.get(u.id) ?? 0;
    const debited = debitedMap.get(u.id) ?? 0;
    const total = normalizeHours(credited - debited);
    const limit = resolveBrHourBankLimit(u.profile?.hourBankLimitHours);
    const exceededBy = normalizeHours(Math.max(Math.abs(total) - limit, 0));

    return {
      userId: u.id,
      username: u.username,
      teamId: u.teamId,
      brWorkState: u.profile?.brWorkState ?? null,
      total,
      limit,
      exceededBy,
    };
  });

  const teamIds = Array.from(new Set(totals.map((t) => t.teamId).filter(Boolean))) as string[];
  const teams = teamIds.length > 0
    ? await prisma.team.findMany({
        where: { id: { in: teamIds } },
        select: { id: true, managerId: true, coordinatorId: true, name: true },
      })
    : [];

  const teamById = new Map(teams.map((t) => [t.id, t]));
  const accessTotalIds = accessTotalUsers.map((u) => u.id);

  const existingThisWeek = await prisma.notification.findMany({
    where: {
      OR: [{ title: reportTitle }, { title: exceededTitle }],
      userId: { in: [...accessTotalIds, ...userIds] },
    },
    select: { userId: true, title: true },
  });

  const existingKey = new Set(existingThisWeek.map((n) => `${n.userId}|${n.title}`));

  let createdNotifications = 0;

  // Weekly global report for access total
  const positive = totals.filter((t) => t.total > 0).length;
  const negative = totals.filter((t) => t.total < 0).length;
  const exceeded = totals.filter((t) => t.exceededBy > 0).length;

  const globalMessage = [
    `Período: ${weekLabel}.`,
    `Colaboradores BR analisados: ${totals.length}.`,
    `Saldos positivos: ${positive}.`,
    `Saldos negativos: ${negative}.`,
    `Com excedente face ao limite: ${exceeded}.`,
    'Ação: acompanhar compensações por equipa e regularização de excedentes.',
  ].join('\n');

  const globalRecipients = accessTotalIds.filter((id) => !existingKey.has(`${id}|${reportTitle}`));
  if (globalRecipients.length > 0) {
    await notifyUsers(prisma, globalRecipients, reportTitle, globalMessage);
    createdNotifications += globalRecipients.length;
  }

  // Exceedance notifications for collaborators and leadership
  for (const row of totals) {
    if (row.exceededBy <= 0) {
      continue;
    }

    if (!existingKey.has(`${row.userId}|${exceededTitle}`)) {
      await notifyUsers(
        prisma,
        [row.userId],
        exceededTitle,
        [
          `O teu saldo (${row.total.toFixed(2)}h) está acima do limite (${row.limit.toFixed(2)}h).`,
          `Excedente na semana: ${row.exceededBy.toFixed(2)}h.`,
          'Ação: coordena com a chefia e RH a compensação de horas.',
        ].join('\n'),
      );
      createdNotifications += 1;
    }

    const team = row.teamId ? teamById.get(row.teamId) : null;
    const leadership = [team?.managerId, team?.coordinatorId, ...accessTotalIds]
      .filter(Boolean)
      .filter((id, index, arr) => arr.indexOf(id) === index) as string[];

    const leaderTargets = leadership.filter((id) => id !== row.userId && !existingKey.has(`${id}|${exceededTitle}`));
    if (leaderTargets.length > 0) {
      await notifyUsers(
        prisma,
        leaderTargets,
        exceededTitle,
        [
          `Colaborador ${row.username} com excedente no banco de horas.`,
          `Saldo atual: ${row.total.toFixed(2)}h | Limite: ${row.limit.toFixed(2)}h | Excedente: ${row.exceededBy.toFixed(2)}h.`,
          'Ação: analisar compensação por folga/ausência e plano de regularização.',
        ].join('\n'),
      );
      createdNotifications += leaderTargets.length;
    }
  }

  return { skipped: false, reason: null, createdNotifications };
}

export async function resolveLeadershipRecipientsForUser(prisma: PrismaClient, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      teamId: true,
      teamMemberships: {
        where: { isActive: true },
        select: { teamId: true, isApprover: true },
      },
    },
  });

  const teamIds = new Set<string>();
  if (user?.teamId) {
    teamIds.add(user.teamId);
  }
  for (const membership of user?.teamMemberships ?? []) {
    if (membership.isApprover) {
      teamIds.add(membership.teamId);
    }
  }

  if (teamIds.size === 0) {
    return [] as string[];
  }

  const teams = await prisma.team.findMany({
    where: { id: { in: Array.from(teamIds) } },
    select: { managerId: true, coordinatorId: true },
  });

  return Array.from(
    new Set(
      teams.flatMap((team) => [team.managerId, team.coordinatorId]).filter(Boolean) as string[],
    ),
  );
}

export async function resolveAccessTotalRecipientIds(prisma: PrismaClient) {
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      OR: [{ isRootAccess: true }, { hasAccessTotal: true }],
    },
    select: { id: true },
  });

  return users.map((user) => user.id);
}

export async function appendHourBankEntry(params: {
  prisma: PrismaClient;
  userId: string;
  createdById?: string | null;
  type: HourBankEntryType;
  hours: number;
  reason: string;
  source?: string;
}) {
  const { prisma, userId, createdById, type, hours, reason, source = 'MANUAL' } = params;

  return prisma.hourBankEntry.create({
    data: {
      userId,
      createdById: createdById ?? null,
      type,
      hours: normalizeHours(Math.max(hours, 0)),
      reason: reason.trim(),
      source,
    },
  });
}
