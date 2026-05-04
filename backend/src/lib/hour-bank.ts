import fs from 'node:fs';
import path from 'node:path';
import type { HourBankEntryType, Prisma, PrismaClient, WorkCountry } from '@prisma/client';
import PDFDocument from 'pdfkit';

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

type WeeklyHourBankTotalsRow = {
  userId: string;
  username: string;
  fullName: string;
  teamName: string;
  brWorkState: BrWorkStateCode;
  total: number;
  limit: number;
  exceededBy: number;
};

type WeeklyHourBankSweepData = {
  weekLabel: string;
  periodStart: string;
  periodEnd: string;
  totals: WeeklyHourBankTotalsRow[];
  accessTotalIds: string[];
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

function formatDatePt(inputDate: Date) {
  return new Intl.DateTimeFormat('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(inputDate);
}

function getIsoWeekBounds(inputDate = new Date()) {
  const date = new Date(Date.UTC(inputDate.getUTCFullYear(), inputDate.getUTCMonth(), inputDate.getUTCDate()));
  const day = date.getUTCDay() || 7;
  const start = new Date(date);
  start.setUTCDate(date.getUTCDate() - day + 1);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);

  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
    periodLabel: `${formatDatePt(start)} a ${formatDatePt(end)}`,
  };
}

function ensureUploadsReportDirectory() {
  const reportsDir = path.resolve(process.cwd(), 'uploads', 'hour-bank-reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  return reportsDir;
}

function resolvePublicFileBaseUrl() {
  const configured = (process.env.PUBLIC_FILES_BASE_URL || '').trim().replace(/\/$/, '');
  if (configured) {
    return configured;
  }

  const port = Number(process.env.PORT ?? 4000);
  return `http://localhost:${port}`;
}

function buildWeeklyHourBankPdf(params: {
  weekLabel: string;
  periodLabel: string;
  totals: WeeklyHourBankTotalsRow[];
}) {
  const { weekLabel, periodLabel, totals } = params;
  const positive = totals.filter((item) => item.total > 0).length;
  const negative = totals.filter((item) => item.total < 0).length;
  const exceeded = totals.filter((item) => item.exceededBy > 0).length;

  const reportsDir = ensureUploadsReportDirectory();
  const fileName = `relatorio_banco_horas_${weekLabel}.pdf`;
  const absolutePath = path.join(reportsDir, fileName);

  const pdf = new PDFDocument({ size: 'A4', margin: 42 });
  const output = fs.createWriteStream(absolutePath);

  pdf.pipe(output);
  pdf.fontSize(18).text('Relatório Semanal - Banco de Horas (Brasil)', { align: 'left' });
  pdf.moveDown(0.4);
  pdf.fontSize(11).text(`Período: ${periodLabel}`);
  pdf.fontSize(11).text(`Semana ISO: ${weekLabel}`);
  pdf.moveDown(0.6);

  pdf.fontSize(11).text(`Total colaboradores BR analisados: ${totals.length}`);
  pdf.fontSize(11).text(`Saldos positivos: ${positive}`);
  pdf.fontSize(11).text(`Saldos negativos: ${negative}`);
  pdf.fontSize(11).text(`Com excedente: ${exceeded}`);
  pdf.moveDown(0.8);

  pdf.fontSize(10).text('Detalhe por colaborador (Top 100 por maior excedente):');
  pdf.moveDown(0.3);

  const sorted = [...totals]
    .sort((a, b) => b.exceededBy - a.exceededBy || b.total - a.total)
    .slice(0, 100);

  for (const row of sorted) {
    const line = [
      `${row.fullName}`,
      `@${row.username}`,
      row.teamName,
      `UF ${row.brWorkState ?? '-'}`,
      `Saldo ${row.total.toFixed(2)}h`,
      `Limite ${row.limit.toFixed(2)}h`,
      `Excedente ${row.exceededBy.toFixed(2)}h`,
    ].join(' | ');

    if (pdf.y > 760) {
      pdf.addPage();
    }

    pdf.fontSize(8.8).text(line, { lineGap: 1.6 });
  }

  pdf.end();

  return new Promise<{ fileName: string; linkPath: string; publicUrl: string }>((resolve, reject) => {
    output.on('finish', () => {
      const linkPath = `/uploads/hour-bank-reports/${fileName}`;
      const publicUrl = `${resolvePublicFileBaseUrl()}${linkPath}`;
      resolve({ fileName, linkPath, publicUrl });
    });
    output.on('error', reject);
  });
}

async function collectWeeklyHourBankSweepData(prisma: PrismaClient, weekDate = new Date()): Promise<WeeklyHourBankSweepData> {
  const weekLabel = getIsoWeekLabel(weekDate);
  const { periodStart, periodEnd } = getIsoWeekBounds(weekDate);

  const [users, accessTotalUsers] = await Promise.all([
    prisma.user.findMany({
      where: {
        isActive: true,
        role: { not: 'CONVIDADO' },
        profile: { is: { workCountry: 'BR' } },
      },
      select: {
        id: true,
        username: true,
        teamId: true,
        profile: {
          select: {
            nomeCompleto: true,
            nomeAbreviado: true,
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
        profile: { is: { workCountry: 'BR' } },
      },
      select: { id: true },
    }),
  ]);

  if (users.length === 0) {
    return {
      weekLabel,
      periodStart,
      periodEnd,
      totals: [],
      accessTotalIds: accessTotalUsers.map((item) => item.id),
    };
  }

  const userIds = users.map((u) => u.id);

  const [creditAgg, debitAgg, teams] = await Promise.all([
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
    prisma.team.findMany({
      where: { id: { in: Array.from(new Set(users.map((u) => u.teamId).filter(Boolean))) as string[] } },
      select: { id: true, name: true },
    }),
  ]);

  const teamById = new Map(teams.map((team) => [team.id, team.name]));
  const creditedMap = new Map(creditAgg.map((item) => [item.userId, item._sum.hours ?? 0]));
  const debitedMap = new Map(debitAgg.map((item) => [item.userId, item._sum.hours ?? 0]));

  const totals = users.map((u) => {
    const credited = normalizeHours(creditedMap.get(u.id) ?? 0);
    const debited = normalizeHours(debitedMap.get(u.id) ?? 0);
    const total = normalizeHours(credited - debited);
    const limit = resolveBrHourBankLimit(u.profile?.hourBankLimitHours);
    const exceededBy = normalizeHours(Math.max(Math.abs(total) - limit, 0));

    return {
      userId: u.id,
      username: u.username,
      fullName: u.profile?.nomeAbreviado || u.profile?.nomeCompleto || u.username,
      teamName: (u.teamId ? teamById.get(u.teamId) : null) || 'Sem equipa',
      brWorkState: u.profile?.brWorkState ?? null,
      total,
      limit,
      exceededBy,
    };
  });

  return {
    weekLabel,
    periodStart,
    periodEnd,
    totals,
    accessTotalIds: accessTotalUsers.map((item) => item.id),
  };
}

export async function createOrGetWeeklyHourBankReport(
  prisma: PrismaClient,
  options?: { now?: Date; generatedById?: string | null },
) {
  const now = options?.now ?? new Date();
  const data = await collectWeeklyHourBankSweepData(prisma, now);
  if (data.totals.length === 0) {
    return null;
  }

  const existing = await prisma.weeklyHourBankReport.findUnique({
    where: { weekLabel: data.weekLabel },
  });
  if (existing) {
    return existing;
  }

  const bounds = getIsoWeekBounds(now);
  const pdf = await buildWeeklyHourBankPdf({
    weekLabel: data.weekLabel,
    periodLabel: bounds.periodLabel,
    totals: data.totals,
  });

  return prisma.weeklyHourBankReport.create({
    data: {
      weekLabel: data.weekLabel,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      totalUsers: data.totals.length,
      positiveUsers: data.totals.filter((item) => item.total > 0).length,
      negativeUsers: data.totals.filter((item) => item.total < 0).length,
      exceededUsers: data.totals.filter((item) => item.exceededBy > 0).length,
      pdfFileName: pdf.fileName,
      pdfLinkPath: pdf.linkPath,
      pdfPublicUrl: pdf.publicUrl,
      generatedById: options?.generatedById ?? null,
    },
  });
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

  // O relatório corre às segundas-feiras e deve referenciar a semana ANTERIOR (já concluída)
  const previousWeekDate = new Date(now);
  previousWeekDate.setUTCDate(now.getUTCDate() - 7);

  const weekLabel = getIsoWeekLabel(previousWeekDate);
  const reportTitle = `Relatório semanal banco de horas (${weekLabel})`;
  const exceededTitle = `Banco de horas em excedente (${weekLabel})`;

  const collected = await collectWeeklyHourBankSweepData(prisma, previousWeekDate);
  if (collected.totals.length === 0) {
    return { skipped: false, reason: null, createdNotifications: 0 };
  }
  const totals = collected.totals;
  const userIds = totals.map((item) => item.userId);
  const accessTotalIds = collected.accessTotalIds;

  const [reportRecord, leadershipByUser] = await Promise.all([
    createOrGetWeeklyHourBankReport(prisma, { now: previousWeekDate }),
    Promise.all(
      userIds.map(async (userId) => {
        const recipients = await resolveLeadershipRecipientsForUser(prisma, userId);
        return [userId, recipients] as const;
      }),
    ),
  ]);

  const leadershipMap = new Map(leadershipByUser);

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
    reportRecord ? `Relatório PDF: ${reportRecord.pdfPublicUrl}` : '',
    'Ação: acompanhar compensações por equipa e regularização de excedentes.',
  ].filter(Boolean).join('\n');

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

    const leadership = [...(leadershipMap.get(row.userId) ?? []), ...accessTotalIds]
      .filter(Boolean)
      .filter((id, index, arr) => arr.indexOf(id) === index) as string[];

    const leadershipBrOnly = await filterUserIdsByWorkCountry(prisma, leadership, 'BR');
    const leaderTargets = leadershipBrOnly.filter((id) => id !== row.userId && !existingKey.has(`${id}|${exceededTitle}`));
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
    select: {
      id: true,
      profile: {
        select: {
          workCountry: true,
        },
      },
    },
  });

  return users
    .filter((user) => (user.profile?.workCountry ?? 'PT') === 'BR')
    .map((user) => user.id);
}

export async function filterUserIdsByWorkCountry(prisma: PrismaClient, userIds: string[], workCountry: WorkCountry) {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  if (unique.length === 0) {
    return [] as string[];
  }

  const rows = await prisma.user.findMany({
    where: {
      id: { in: unique },
      isActive: true,
      profile: {
        is: {
          workCountry,
        },
      },
    },
    select: { id: true },
  });

  return rows.map((row) => row.id);
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
