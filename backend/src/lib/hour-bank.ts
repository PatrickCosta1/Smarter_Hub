import fs from 'node:fs';
import path from 'node:path';
import type { HourBankEntryType, Prisma, PrismaClient, WorkCountry } from '@prisma/client';
import PDFDocument from 'pdfkit';

import { notifyUsers } from './notifications.js';

type PdfDoc = InstanceType<typeof PDFDocument>;

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

function resolveLogoAbsolutePath() {
  const candidates = [
    path.resolve(process.cwd(), 'public', 'logo.png'),
    path.resolve(process.cwd(), '..', 'public', 'logo.png'),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function drawRoundedRect(pdf: PdfDoc, x: number, y: number, width: number, height: number, radius = 10) {
  pdf.roundedRect(x, y, width, height, radius);
}

function drawStatsCard(params: {
  pdf: PdfDoc;
  x: number;
  y: number;
  width: number;
  label: string;
  value: string;
  accentColor: string;
}) {
  const { pdf, x, y, width, label, value, accentColor } = params;

  pdf.save();
  pdf.fillColor('#ffffff');
  drawRoundedRect(pdf, x, y, width, 62, 10);
  pdf.fill();

  pdf.strokeColor('#d5e4f6').lineWidth(1);
  drawRoundedRect(pdf, x, y, width, 62, 10);
  pdf.stroke();

  pdf.fillColor(accentColor);
  pdf.roundedRect(x, y, width, 5, 3).fill();

  pdf.fillColor('#597090').fontSize(8.2).font('Helvetica-Bold').text(label, x + 10, y + 14, {
    width: width - 20,
  });
  pdf.fillColor('#17365f').fontSize(16).font('Helvetica-Bold').text(value, x + 10, y + 30, {
    width: width - 20,
  });
  pdf.restore();
}

function drawTableHeader(pdf: PdfDoc, y: number, pageWidth: number, margin: number) {
  const tableWidth = pageWidth - margin * 2;
  pdf.save();
  pdf.fillColor('#e9f0fb');
  drawRoundedRect(pdf, margin, y, tableWidth, 24, 6);
  pdf.fill();

  pdf.fillColor('#355376').fontSize(8).font('Helvetica-Bold');
  pdf.text('Colaborador', margin + 8, y + 8, { width: 150, lineBreak: false });
  pdf.text('Equipa', margin + 162, y + 8, { width: 94, lineBreak: false });
  pdf.text('UF', margin + 260, y + 8, { width: 30, align: 'center', lineBreak: false });
  pdf.text('Saldo', margin + 292, y + 8, { width: 64, align: 'right', lineBreak: false });
  pdf.text('Limite', margin + 360, y + 8, { width: 64, align: 'right', lineBreak: false });
  pdf.text('Excedente', margin + 428, y + 8, { width: 86, align: 'right', lineBreak: false });
  pdf.restore();
}

function drawPageHeader(params: {
  pdf: PdfDoc;
  margin: number;
  weekLabel: string;
  periodLabel: string;
  generatedAtLabel: string;
}) {
  const { pdf, margin, weekLabel, periodLabel, generatedAtLabel } = params;
  const pageWidth = pdf.page.width;
  const contentWidth = pageWidth - margin * 2;

  pdf.save();
  pdf.fillColor('#0f3a72');
  drawRoundedRect(pdf, margin, margin - 6, contentWidth, 92, 16);
  pdf.fill();

  const logoPath = resolveLogoAbsolutePath();
  if (logoPath) {
    try {
      pdf.image(logoPath, margin + 16, margin + 10, { width: 108, fit: [108, 36] });
    } catch {
      // Se falhar o carregamento da imagem, continua com o layout textual.
    }
  }

  pdf.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16).text('Relatório Semanal · Banco de Horas (BR)', margin + 140, margin + 14, {
    width: contentWidth - 150,
    align: 'left',
  });
  pdf.font('Helvetica').fontSize(10).fillColor('#dbe8ff').text(`Semana ISO: ${weekLabel}`, margin + 140, margin + 38, {
    width: contentWidth - 150,
  });
  pdf.text(`Período: ${periodLabel}`, margin + 140, margin + 53, { width: contentWidth - 150 });
  pdf.text(`Gerado em: ${generatedAtLabel}`, margin + 140, margin + 68, { width: contentWidth - 150 });
  pdf.restore();
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
  const generatedAtLabel = new Intl.DateTimeFormat('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());

  const reportsDir = ensureUploadsReportDirectory();
  const fileName = `relatorio_banco_horas_${weekLabel}.pdf`;
  const absolutePath = path.join(reportsDir, fileName);

  const pdf = new PDFDocument({ size: 'A4', margin: 40 });
  const output = fs.createWriteStream(absolutePath);

  pdf.pipe(output);
  const margin = 40;
  const pageWidth = pdf.page.width;
  const contentWidth = pageWidth - margin * 2;

  drawPageHeader({
    pdf,
    margin,
    weekLabel,
    periodLabel,
    generatedAtLabel,
  });

  const cardGap = 10;
  const cardWidth = (contentWidth - cardGap * 3) / 4;
  const cardsY = margin + 100;
  drawStatsCard({
    pdf,
    x: margin,
    y: cardsY,
    width: cardWidth,
    label: 'Colaboradores analisados',
    value: String(totals.length),
    accentColor: '#3b82f6',
  });
  drawStatsCard({
    pdf,
    x: margin + cardWidth + cardGap,
    y: cardsY,
    width: cardWidth,
    label: 'Saldos positivos',
    value: String(positive),
    accentColor: '#22c55e',
  });
  drawStatsCard({
    pdf,
    x: margin + (cardWidth + cardGap) * 2,
    y: cardsY,
    width: cardWidth,
    label: 'Saldos negativos',
    value: String(negative),
    accentColor: '#f59e0b',
  });
  drawStatsCard({
    pdf,
    x: margin + (cardWidth + cardGap) * 3,
    y: cardsY,
    width: cardWidth,
    label: 'Com excedente',
    value: String(exceeded),
    accentColor: exceeded > 0 ? '#ef4444' : '#22c55e',
  });

  pdf.fillColor('#4d6788').font('Helvetica').fontSize(9).text(
    'Top 100 colaboradores por maior excedente. Fonte: registos acumulados de banco de horas BR.',
    margin,
    cardsY + 72,
    { width: contentWidth },
  );

  const sorted = [...totals]
    .sort((a, b) => b.exceededBy - a.exceededBy || b.total - a.total)
    .slice(0, 100);

  let y = cardsY + 98;
  drawTableHeader(pdf, y, pageWidth, margin);
  y += 30;

  pdf.font('Helvetica').fontSize(8.5);

  for (let index = 0; index < sorted.length; index += 1) {
    const row = sorted[index]!;

    if (y > pdf.page.height - 62) {
      pdf.addPage();
      drawPageHeader({ pdf, margin, weekLabel, periodLabel, generatedAtLabel });
      y = margin + 104;
      drawTableHeader(pdf, y, pageWidth, margin);
      y += 30;
    }

    if (index % 2 === 0) {
      pdf.save();
      pdf.fillColor('#f8fbff');
      drawRoundedRect(pdf, margin, y - 4, contentWidth, 20, 4);
      pdf.fill();
      pdf.restore();
    }

    const exceededText = `${row.exceededBy.toFixed(2)}h`;
    const balanceText = `${row.total.toFixed(2)}h`;
    const limitText = `${row.limit.toFixed(2)}h`;

    pdf.fillColor('#17365f').font('Helvetica-Bold').text(row.fullName, margin + 8, y, { width: 150, lineBreak: false });
    pdf.fillColor('#647d9d').font('Helvetica').text(row.teamName, margin + 162, y, { width: 94, lineBreak: false });
    pdf.fillColor('#264e80').text(row.brWorkState ?? '-', margin + 260, y, { width: 30, align: 'center', lineBreak: false });
    pdf.fillColor('#17365f').text(balanceText, margin + 292, y, { width: 64, align: 'right', lineBreak: false });
    pdf.fillColor('#17365f').text(limitText, margin + 360, y, { width: 64, align: 'right', lineBreak: false });
    pdf.fillColor(row.exceededBy > 0 ? '#c0262d' : '#1f7a3d').font('Helvetica-Bold').text(exceededText, margin + 428, y, { width: 86, align: 'right', lineBreak: false });

    y += 20;
  }

  pdf.save();
  const footerText = `Smarter Hub · Banco de Horas BR · ${weekLabel}`;
  pdf.fillColor('#7b93b1').font('Helvetica').fontSize(8).text(footerText, margin, pdf.page.height - 24, {
    width: contentWidth,
    align: 'center',
  });
  pdf.restore();

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
