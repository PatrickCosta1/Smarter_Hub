import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { prisma } from '../lib/prisma.js';
import {
  buildUserWhereFromScope,
  canAccessUserByPermission,
  getPermissionScope,
  hasPermission,
  isAccessTotal,
} from '../lib/permission-engine.js';
import { requireAuth } from '../middleware/auth.js';
import { notifyUsers } from '../lib/notifications.js';
import { createRequestTimer } from '../lib/request-timing.js';

const router = Router();

const vacationSchema = z
  .object({
    dataInicio: z.string().min(1, 'Data de início é obrigatória'),
    dataFim: z.string().min(1, 'Data de fim é obrigatória'),
    observacoes: z.string().default(''),
    requestType: z.enum(['VACATION', 'ABSENCE_MEDICAL', 'ABSENCE_TRAINING']).default('VACATION'),
    attachmentLink: z.string().default(''),
    contextTeamId: z.string().optional(),
    partialDay: z.enum(['FULL', 'AM', 'PM']).default('FULL'),
  })
  .superRefine((data, ctx) => {
    if (data.dataInicio > data.dataFim) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dataFim'],
        message: 'A data de fim deve ser igual ou posterior à data de início.',
      });
    }

    const start = new Date(`${data.dataInicio}T00:00:00`);
    const end = new Date(`${data.dataFim}T00:00:00`);
    const days = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    if (data.requestType === 'ABSENCE_MEDICAL' && days > 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dataFim'],
        message: 'Ausência médica (SNS24) está limitada a 3 dias.',
      });
    }

    if (data.requestType === 'VACATION') {
      const startDay = start.getDay();
      const endDay = end.getDay();
      const startIsWeekend = startDay === 0 || startDay === 6;
      const endIsWeekend = endDay === 0 || endDay === 6;

      if (startIsWeekend) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dataInicio'],
          message: 'Pedido de férias não pode começar ao fim de semana.',
        });
      }

      if (endIsWeekend) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dataFim'],
          message: 'Pedido de férias não pode terminar ao fim de semana.',
        });
      }
    }

    if (data.partialDay !== 'FULL') {
      if (data.requestType !== 'VACATION') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['partialDay'],
          message: 'Meio-dia só está disponível para pedidos de férias.',
        });
      }

      if (data.dataInicio !== data.dataFim) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dataFim'],
          message: 'Pedidos de meio-dia devem ter início e fim no mesmo dia.',
        });
      }
    }
  });

const approveRejectSchema = z.object({
  reason: z.string().optional(),
});

const assignBalanceCreditSchema = z
  .object({
    userId: z.string().min(1, 'Colaborador é obrigatório.'),
    year: z.number().int().min(2000).max(2100).optional(),
    days: z.number().int().min(1, 'Dias a creditar deve ser pelo menos 1.'),
    reason: z.string().trim().min(3, 'Motivo é obrigatório.'),
  })
  .transform((data) => ({
    ...data,
    year: data.year ?? new Date().getFullYear(),
    reason: data.reason.trim(),
  }));

const companyExtraDayItemSchema = z.object({
  date: z.string().regex(/^\d{2}-\d{2}$/, 'Data inválida. Usa formato MM-DD (ex: 12-25).'),
  label: z.string().trim().min(1).max(120).optional(),
});

const updateCompanyExtraDaysSchema = z.object({
  country: z.enum(['PT', 'BR']).optional(),
  days: z.array(companyExtraDayItemSchema).max(40),
});

const APPROVAL_PENDING = 'PENDING';
const APPROVAL_WAITING = 'WAITING';
const APPROVAL_APPROVED = 'APPROVED';
const APPROVAL_REJECTED = 'REJECTED';
const APPROVAL_SKIPPED = 'SKIPPED';

function toLocalDate(dateText: string) {
  return new Date(`${dateText}T00:00:00`);
}

function dateToISO(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function extractYearFromIsoDate(iso: string) {
  return Number(iso.slice(0, 4));
}

function formatIsoDatePt(iso: string) {
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) {
    return iso;
  }

  return `${day}/${month}/${year}`;
}

function enumerateDates(startText: string, endText: string) {
  const start = toLocalDate(startText);
  const end = toLocalDate(endText);
  const days: string[] = [];

  for (let current = new Date(start); current <= end; current.setDate(current.getDate() + 1)) {
    days.push(dateToISO(new Date(current)));
  }

  return days;
}

function isWeekendIso(iso: string) {
  const day = toLocalDate(iso).getDay();
  return day === 0 || day === 6;
}

function isBusinessDayIso(iso: string, holidayDates: Set<string>) {
  return !isWeekendIso(iso) && !holidayDates.has(iso);
}

function isVacationBusinessRuleError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return [
    'Política PT:',
    'Política BR:',
    'Pedido de férias',
    'Pedidos de férias',
    'Não existem aprovadores configurados',
    'Capacidade da equipa excedida',
  ].some((prefix) => error.message.startsWith(prefix));
}

async function enforceVacationBusinessDays(params: {
  requestType: 'VACATION' | 'ABSENCE_MEDICAL' | 'ABSENCE_TRAINING';
  dataInicio: string;
  dataFim: string;
  country: 'PT' | 'BR';
}) {
  if (params.requestType !== 'VACATION') {
    return;
  }

  const start = toLocalDate(params.dataInicio);
  const end = toLocalDate(params.dataFim);
  const startIsWeekend = start.getDay() === 0 || start.getDay() === 6;
  const endIsWeekend = end.getDay() === 0 || end.getDay() === 6;

  if (startIsWeekend) {
    throw new Error('Pedido de férias não pode começar ao fim de semana.');
  }

  if (endIsWeekend) {
    throw new Error('Pedido de férias não pode terminar ao fim de semana.');
  }

  void params.country;
}

async function validateVacationCountryPolicy(params: {
  db: Pick<Prisma.TransactionClient, 'vacation'>;
  userId: string;
  country: 'PT' | 'BR';
  requestType: 'VACATION' | 'ABSENCE_MEDICAL' | 'ABSENCE_TRAINING';
  dataInicio: string;
  dataFim: string;
  partialDay: 'FULL' | 'AM' | 'PM';
  excludeVacationId?: string;
}) {
  if (params.requestType !== 'VACATION') {
    return [] as string[];
  }

  const year = toLocalDate(params.dataInicio).getFullYear();
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const currentYearPeriods = await params.db.vacation.findMany({
    where: {
      userId: params.userId,
      requestType: 'VACATION',
      status: { in: ['PENDING', 'APPROVED'] },
      ...(params.excludeVacationId ? { id: { not: params.excludeVacationId } } : {}),
      dataInicio: { lte: yearEnd },
      dataFim: { gte: yearStart },
    },
    select: {
      dataInicio: true,
      dataFim: true,
      partialDay: true,
      requestType: true,
    },
  });

  const requestedPeriod = {
    dataInicio: params.dataInicio,
    dataFim: params.dataFim,
    partialDay: params.partialDay,
    requestType: 'VACATION',
  };

  if (params.country === 'PT') {
    const years = new Set<number>([
      toLocalDate(params.dataInicio).getFullYear(),
      toLocalDate(params.dataFim).getFullYear(),
      ...currentYearPeriods.flatMap((period) => [toLocalDate(period.dataInicio).getFullYear(), toLocalDate(period.dataFim).getFullYear()]),
    ]);
    const holidayDates = await collectHolidayDates(params.country, years);
    const hasMandatoryConsecutiveBlock = currentYearPeriods.some((period) => vacationDaysForMetrics(period, holidayDates) >= 10);
    const requestedDays = vacationDaysForMetrics(requestedPeriod, holidayDates);

    if (!hasMandatoryConsecutiveBlock && requestedDays < 10) {
      return [`Política PT: este pedido tem apenas ${requestedDays} dias úteis. No regime PT deve existir pelo menos um período de férias com 10 dias úteis consecutivos no ano.`];
    }

    return [] as string[];
  }

  if (params.partialDay !== 'FULL') {
    throw new Error('Política BR: pedidos de férias fracionados em meio-dia não são permitidos.');
  }

  const allPeriods = [...currentYearPeriods, requestedPeriod];
  if (allPeriods.length > 3) {
    throw new Error('Política BR: férias só podem ser divididas em, no máximo, 3 períodos por ano.');
  }

  const years = new Set<number>([
    toLocalDate(params.dataInicio).getFullYear(),
    toLocalDate(params.dataFim).getFullYear(),
    ...allPeriods.flatMap((period) => [toLocalDate(period.dataInicio).getFullYear(), toLocalDate(period.dataFim).getFullYear()]),
  ]);
  const holidayDates = await collectHolidayDates(params.country, years);
  const periodLengths = allPeriods.map((period) => vacationDaysForMetrics(period, holidayDates));
  if (periodLengths.some((days) => days < 5)) {
    throw new Error('Política BR: cada período de férias deve ter, no mínimo, 5 dias corridos.');
  }

  if (allPeriods.length >= 3 && !periodLengths.some((days) => days >= 14)) {
    throw new Error('Política BR: quando as férias são divididas em 3 períodos, pelo menos um deve ter 14 dias ou mais.');
  }

  return [] as string[];
}

function hasDateOverlap(startA: string, endA: string, startB: string, endB: string) {
  return !(endA < startB || endB < startA);
}

function vacationDaysForMetrics(
  record: { requestType: string; dataInicio: string; dataFim: string; partialDay?: 'FULL' | 'AM' | 'PM' },
  holidayDates: Set<string> = new Set(),
) {
  if (record.requestType !== 'VACATION') {
    return enumerateDates(record.dataInicio, record.dataFim).length;
  }

  if (record.partialDay && record.partialDay !== 'FULL') {
    return 0.5;
  }

  return enumerateDates(record.dataInicio, record.dataFim).filter((iso) => isBusinessDayIso(iso, holidayDates)).length;
}

function vacationDailyWeight(record: { dataInicio: string; partialDay?: 'FULL' | 'AM' | 'PM' }, iso: string, holidayDates: Set<string> = new Set()) {
  if (!isBusinessDayIso(iso, holidayDates)) {
    return 0;
  }

  if (!record.partialDay || record.partialDay === 'FULL') {
    return 1;
  }

  return record.dataInicio === iso ? 0.5 : 1;
}

function easterDate(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function carnivalTuesday(year: number) {
  const easter = easterDate(year);
  const carnival = new Date(easter);
  carnival.setDate(easter.getDate() - 47);
  return carnival;
}

function buildLegacyCompanyExtraDays(params: {
  year: number;
  localidade?: string | null;
}) {
  const extras: string[] = [
    `${params.year}-12-24`,
    `${params.year}-12-31`,
    dateToISO(carnivalTuesday(params.year)),
  ];

  if ((params.localidade ?? '').toLowerCase().includes('porto')) {
    extras.push(`${params.year}-06-24`);
  }

  return Array.from(new Set(extras));
}

async function resolveConfiguredCompanyExtraDays(params: {
  year: number;
  country: 'PT' | 'BR';
  localidade?: string | null;
}) {
  const dbDays = await prisma.vacationCompanyExtraDay.findMany({
    where: { country: params.country },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    select: { date: true, label: true },
  });

  if (dbDays.length > 0) {
    return {
      source: 'configured' as const,
      days: dbDays.map((item) => ({
        // Expand MM-DD → YYYY-MM-DD for the requested year
        date: `${params.year}-${item.date}`,
        label: item.label || 'Dia dado pela empresa',
      })),
    };
  }

  return {
    source: 'legacy' as const,
    days: buildLegacyCompanyExtraDays({ year: params.year, localidade: params.localidade }).map((date) => ({
      date,
      label: 'Dia dado pela empresa',
    })),
  };
}

function nextWorkingDay(baseDate: Date, blockedDays: Set<string>) {
  const candidate = new Date(baseDate);

  while (true) {
    candidate.setDate(candidate.getDate() + 1);
    const day = candidate.getDay();
    const iso = dateToISO(candidate);

    if (day !== 0 && day !== 6 && !blockedDays.has(iso)) {
      return candidate;
    }
  }
}

type PublicHoliday = {
  date: string;
  localName: string;
  name: string;
  global?: boolean;
  counties?: string[] | null;
};

const HOLIDAYS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const holidaysCache = new Map<string, { expiresAt: number; data: PublicHoliday[] }>();

async function fetchHolidays(countryCode: 'PT' | 'BR', year: number) {
  const cacheKey = `${countryCode}-${year}`;
  const cached = holidaysCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const response = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`);

  if (!response.ok) {
    return [] as PublicHoliday[];
  }

  const payload = (await response.json()) as PublicHoliday[];
  const filtered = payload.filter((holiday) => {
    if (countryCode !== 'PT') {
      return true;
    }

    const label = `${holiday.localName} ${holiday.name}`.toLowerCase();
    const isMadeiraOrAcores =
      label.includes('madeira') ||
      label.includes('açores') ||
      label.includes('acores');

    if (isMadeiraOrAcores) {
      return false;
    }

    if (holiday.global === false) {
      return false;
    }

    return true;
  });

  holidaysCache.set(cacheKey, {
    expiresAt: now + HOLIDAYS_CACHE_TTL_MS,
    data: filtered,
  });

  return filtered;
}

async function collectHolidayDates(countryCode: 'PT' | 'BR', years: Iterable<number>) {
  const holidayDates = new Set<string>();

  for (const year of years) {
    const holidays = await fetchHolidays(countryCode, year);
    for (const holiday of holidays) {
      holidayDates.add(holiday.date);
    }
  }

  return holidayDates;
}

export const __vacationTestables = {
  vacationSchema,
  hasDateOverlap,
  vacationDaysForMetrics,
  vacationDailyWeight,
  enforceVacationBusinessDays,
  validateVacationCountryPolicy,
  enumerateDates,
  isWeekendIso,
};

function brVacationDaysByAbsences(absences: number) {
  if (absences <= 5) return 30;
  if (absences <= 14) return 24;
  if (absences <= 23) return 18;
  if (absences <= 32) return 12;
  return 0;
}

async function sumVacationBalanceCreditsByUser(params: { userIds: string[]; year: number }) {
  if (params.userIds.length === 0) {
    return new Map<string, number>();
  }

  const credits = await prisma.vacationBalanceCredit.findMany({
    where: {
      userId: { in: params.userIds },
      year: params.year,
    },
    select: {
      userId: true,
      days: true,
    },
  });

  const result = new Map<string, number>();
  for (const credit of credits) {
    result.set(credit.userId, (result.get(credit.userId) ?? 0) + credit.days);
  }

  return result;
}

async function resolveContextTeamId(userId: string, explicitTeamId?: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { teamId: true },
  });

  const activeMemberships = await prisma.teamMembership.findMany({
    where: { userId, isActive: true },
    select: { teamId: true },
  });

  const membershipTeamIds = activeMemberships.map((item) => item.teamId);
  const eligibleTeamIds = new Set<string>(membershipTeamIds);

  if (user?.teamId) {
    eligibleTeamIds.add(user.teamId);
  }

  if (explicitTeamId) {
    if (eligibleTeamIds.has(explicitTeamId)) {
      return explicitTeamId;
    }

    return null;
  }

  if (membershipTeamIds.length === 1) {
    return membershipTeamIds[0];
  }

  if (user?.teamId) {
    return user.teamId;
  }

  return membershipTeamIds[0] ?? null;
}

function parseApprovalCustomRestrictions(customRestrictions: unknown) {
  if (!customRestrictions || typeof customRestrictions !== 'object' || Array.isArray(customRestrictions)) {
    return {
      allowedUserIds: [] as string[],
    };
  }

  const source = customRestrictions as {
    allowedUserIds?: unknown;
  };

  const allowedUserIds = Array.isArray(source.allowedUserIds)
    ? source.allowedUserIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];

  return {
    allowedUserIds,
  };
}

function describeVacationRequestType(requestType: 'VACATION' | 'ABSENCE_MEDICAL' | 'ABSENCE_TRAINING') {
  if (requestType === 'VACATION') {
    return 'férias';
  }

  if (requestType === 'ABSENCE_MEDICAL') {
    return 'ausência médica';
  }

  return 'ausência por formação';
}

function formatVacationNotificationMessage(params: {
  requesterName: string;
  requestType: 'VACATION' | 'ABSENCE_MEDICAL' | 'ABSENCE_TRAINING';
  dataInicio: string;
  dataFim: string;
  contextTeamName?: string | null;
  observacoes?: string;
}) {
  const header = `${params.requesterName} submeteu um pedido de ${describeVacationRequestType(params.requestType)}.`;
  const period = `Período: ${formatIsoDatePt(params.dataInicio)} até ${formatIsoDatePt(params.dataFim)}.`;
  const team = params.contextTeamName ? `Equipa: ${params.contextTeamName}.` : 'Equipa: sem contexto associado.';
  const notes = params.observacoes?.trim()
    ? `Observações: ${params.observacoes.trim().slice(0, 240)}.`
    : 'Observações: sem detalhes adicionais.';

  return [header, period, team, notes, 'Ação: abre a área de aprovações para decidir.'].join('\n');
}

async function resolveApprovalGroups(userId: string, contextTeamId: string | null) {
  const requester = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      hasAccessTotal: true,
      accessTotalGrantedById: true,
      teamId: true,
    },
  });

  if (!requester) {
    return [] as Array<{ level: number; approverIds: string[] }>;
  }

  const activeMemberships = await prisma.teamMembership.findMany({
    where: { userId, isActive: true },
    select: { teamId: true },
  });

  const teamIds = Array.from(new Set<string>([
    ...activeMemberships.map((item) => item.teamId),
    ...(requester.teamId ? [requester.teamId] : []),
  ]));

  const candidateApproverIds = new Set<string>();

  function addApprover(id: string | null | undefined) {
    if (!id || id === userId) {
      return;
    }

    candidateApproverIds.add(id);
  }

  async function addAccessTotalApprovers() {
    const users = await prisma.user.findMany({
      where: {
        id: { not: userId },
        isActive: true,
        OR: [{ isRootAccess: true }, { hasAccessTotal: true }],
      },
      select: {
        id: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const user of users) {
      addApprover(user.id);
    }
  }

  async function addTPeopleFallback() {
    const fallback = await prisma.user.findFirst({
      where: {
        id: { not: userId },
        isActive: true,
        username: {
          equals: 't.people',
          mode: 'insensitive',
        },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    if (fallback?.id) {
      addApprover(fallback.id);
      return;
    }

    await addAccessTotalApprovers();
  }

  if (teamIds.length > 0) {
    const teams = await prisma.team.findMany({
      where: { id: { in: teamIds } },
      select: {
        id: true,
        managerId: true,
        parentTeamId: true,
      },
    });

    const teamsById = new Map<string, { id: string; managerId: string | null; parentTeamId: string | null }>(
      teams.map((team) => [team.id, team]),
    );

    const unresolvedTeams: string[] = [];

    for (const teamId of teamIds) {
      const visited = new Set<string>();
      let cursorTeamId: string | null = teamId;
      let managerFound = false;

      while (cursorTeamId && !visited.has(cursorTeamId)) {
        visited.add(cursorTeamId);
        const node = teamsById.get(cursorTeamId);
        if (!node) {
          break;
        }

        if (node.managerId && node.managerId !== userId) {
          addApprover(node.managerId);
          managerFound = true;
          break;
        }

        cursorTeamId = node.parentTeamId;
      }

      if (!managerFound) {
        unresolvedTeams.push(teamId);
      }
    }

    if (unresolvedTeams.length > 0) {
      await addAccessTotalApprovers();
    }
  } else if (requester.hasAccessTotal) {
    addApprover(requester.accessTotalGrantedById);

    if (candidateApproverIds.size === 0) {
      await addTPeopleFallback();
    }
  } else {
    await addTPeopleFallback();
  }

  const customApproverAssignments = await prisma.userPermission.findMany({
    where: {
      isEnabled: true,
      permission: {
        code: 'approve_vacation',
      },
    },
    select: {
      userId: true,
      customRestrictions: true,
      user: {
        select: {
          isActive: true,
        },
      },
    },
  });

  for (const assignment of customApproverAssignments) {
    if (!assignment.user.isActive || assignment.userId === userId) {
      continue;
    }

    const custom = parseApprovalCustomRestrictions(assignment.customRestrictions);
    if (custom.allowedUserIds.includes(userId)) {
      addApprover(assignment.userId);
    }
  }

  const activeApprovers = await prisma.user.findMany({
    where: {
      id: { in: Array.from(candidateApproverIds) },
      isActive: true,
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });

  const approverIds = activeApprovers
    .map((user) => user.id)
    .filter((id) => id !== userId);

  if (approverIds.length === 0) {
    return [] as Array<{ level: number; approverIds: string[] }>;
  }

  void contextTeamId;
  return [{ level: 1, approverIds }];
}

async function enforceOneThirdCapacity(
  db: Pick<Prisma.TransactionClient, 'teamMembership' | 'user' | 'vacation'>,
  contextTeamId: string,
  country: 'PT' | 'BR',
  dataInicio: string,
  dataFim: string,
  partialDay: 'FULL' | 'AM' | 'PM',
  excludeVacationId?: string,
) {
  const teamMemberCount = await db.teamMembership.count({
    where: { teamId: contextTeamId, isActive: true },
  });

  const fallbackCount = teamMemberCount === 0
    ? await db.user.count({ where: { teamId: contextTeamId } })
    : teamMemberCount;

  const totalMembers = Math.max(1, fallbackCount);
  const maxSimultaneous = Math.max(1, Math.floor(totalMembers / 3));

  const overlapping = await db.vacation.findMany({
    where: {
      contextTeamId,
      requestType: 'VACATION',
      status: { in: ['APPROVED', 'PENDING'] },
      ...(excludeVacationId ? { id: { not: excludeVacationId } } : {}),
    },
    select: {
      dataInicio: true,
      dataFim: true,
      partialDay: true,
    },
  });

  const targetDates = enumerateDates(dataInicio, dataFim);
  const years = new Set<number>([
    ...targetDates.map((iso) => toLocalDate(iso).getFullYear()),
    ...overlapping.flatMap((item) => [toLocalDate(item.dataInicio).getFullYear(), toLocalDate(item.dataFim).getFullYear()]),
  ]);
  const holidayDates = await collectHolidayDates(country, years);

  for (const iso of targetDates) {
    let usedCapacity = 0;
    for (const item of overlapping) {
      if (hasDateOverlap(iso, iso, item.dataInicio, item.dataFim)) {
        usedCapacity += vacationDailyWeight(item, iso, holidayDates);
      }
    }

    const requestedCapacity = vacationDailyWeight({ dataInicio, partialDay }, iso, holidayDates);

    if (usedCapacity + requestedCapacity > maxSimultaneous) {
      throw new Error(`Capacidade da equipa excedida em ${iso}. Limite: ${maxSimultaneous} colaborador(es) em férias simultâneas.`);
    }
  }
}

async function acquireTeamCapacityLock(tx: Prisma.TransactionClient, teamId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`vacation-capacity:${teamId}`}))`;
}

async function finalizeVacationApproval(
  tx: Prisma.TransactionClient,
  vacationId: string,
  reviewerId: string,
  canBypassApprovalChain: boolean,
) {
  const vacation = await tx.vacation.findUnique({
    where: { id: vacationId },
    include: {
      approvals: true,
      user: {
        select: {
          id: true,
          profile: { select: { workCountry: true } },
        },
      },
    },
  });

  if (!vacation || vacation.status !== 'PENDING') {
    return false;
  }

  const isPt = (vacation.user.profile?.workCountry ?? 'PT') === 'PT';
  if (canBypassApprovalChain && isPt) {
    await tx.vacation.update({
      where: { id: vacationId },
      data: {
        status: 'APPROVED',
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        reviewReason: 'Aprovado por exceção (PT).',
      },
    });

    await tx.vacationApproval.updateMany({
      where: {
        vacationId,
        status: { in: [APPROVAL_PENDING, APPROVAL_WAITING] },
      },
      data: {
        status: APPROVAL_SKIPPED,
        decidedAt: new Date(),
        reason: 'Ignorado por aprovação excecional de admin (PT).',
      },
    });

    return true;
  }

  const myStep = vacation.approvals.find((item) => item.approverId === reviewerId && item.status === APPROVAL_PENDING);
  if (!myStep) {
    return false;
  }

  await tx.vacationApproval.update({
    where: { id: myStep.id },
    data: {
      status: APPROVAL_APPROVED,
      decidedAt: new Date(),
      reason: 'Aprovado.',
    },
  });

  const refreshed = await tx.vacation.findUnique({
    where: { id: vacationId },
    include: { approvals: true },
  });

  if (!refreshed) {
    return false;
  }

  const currentLevel = myStep.approvalLevel;
  const sameLevel = refreshed.approvals.filter((item) => item.approvalLevel === currentLevel);
  const isLevelDone = sameLevel.every((item) => item.status === APPROVAL_APPROVED || item.status === APPROVAL_SKIPPED);

  if (!isLevelDone) {
    return true;
  }

  const nextLevel = refreshed.approvals
    .filter((item) => item.approvalLevel > currentLevel)
    .reduce((acc, item) => Math.min(acc, item.approvalLevel), Number.POSITIVE_INFINITY);

  if (Number.isFinite(nextLevel)) {
    await tx.vacationApproval.updateMany({
      where: {
        vacationId,
        approvalLevel: nextLevel,
        status: APPROVAL_WAITING,
      },
      data: {
        status: APPROVAL_PENDING,
      },
    });

    return true;
  }

  await tx.vacation.update({
    where: { id: vacationId },
    data: {
      status: 'APPROVED',
      reviewedById: reviewerId,
      reviewedAt: new Date(),
      reviewReason: 'Pedido aprovado em todas as linhas.',
    },
  });

  return true;
}

router.get('/vacations/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.id;

    const vacations = await prisma.vacation.findMany({
      where: { userId },
      include: {
        contextTeam: { select: { id: true, name: true } },
        approvals: {
          select: {
            id: true,
            approverId: true,
            approvalLevel: true,
            status: true,
            decidedAt: true,
            reason: true,
          },
          orderBy: [{ approvalLevel: 'asc' }, { createdAt: 'asc' }],
        },
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    res.json(vacations);
  } catch (error) {
    console.error('[GET /vacations/me]', error);
    res.status(500).json({ error: 'Falha ao carregar férias' });
  }
});

router.get('/vacations/company-extra-days', requireAuth, async (req: Request, res: Response) => {
  try {
    const canManageVacationRules = req.authUser!.isRootAccess || await isAccessTotal(req.authUser!.id) || await hasPermission(req.authUser!.id, 'manage_vacation_rules');
    if (!canManageVacationRules) {
      return res.status(403).json({ message: 'Sem permissões para consultar dias automáticos da empresa.' });
    }

    const userProfile = await prisma.profile.findUnique({
      where: { userId: req.authUser!.id },
      select: { workCountry: true },
    });
    const country = (typeof req.query.country === 'string' && (req.query.country === 'PT' || req.query.country === 'BR'))
      ? req.query.country
      : (userProfile?.workCountry ?? 'PT');

    // Return raw MM-DD dates from DB (year-agnostic)
    const dbDays = await prisma.vacationCompanyExtraDay.findMany({
      where: { country },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      select: { date: true, label: true },
    });

    const source = dbDays.length > 0 ? 'configured' : 'legacy';
    const days = dbDays.length > 0
      ? dbDays.map((item) => ({ date: item.date, label: item.label || 'Dia dado pela empresa' }))
      : buildLegacyCompanyExtraDays({ year: new Date().getFullYear(), localidade: null })
          .map((fullDate) => ({ date: fullDate.slice(5), label: 'Dia dado pela empresa' }));

    return res.json({ country, source, days });
  } catch (error) {
    console.error('[GET /vacations/company-extra-days]', error);
    return res.status(500).json({ error: 'Falha ao carregar dias automáticos da empresa.' });
  }
});

router.put('/vacations/company-extra-days', requireAuth, async (req: Request, res: Response) => {
  try {
    const canManageVacationRules = req.authUser!.isRootAccess || await isAccessTotal(req.authUser!.id) || await hasPermission(req.authUser!.id, 'manage_vacation_rules');
    if (!canManageVacationRules) {
      return res.status(403).json({ message: 'Sem permissões para gerir dias automáticos da empresa.' });
    }

    const payload = updateCompanyExtraDaysSchema.parse(req.body);
    const userProfile = await prisma.profile.findUnique({
      where: { userId: req.authUser!.id },
      select: { workCountry: true },
    });
    const country = payload.country ?? userProfile?.workCountry ?? 'PT';

    const seen = new Set<string>();
    const uniqueDays = payload.days
      .map((item) => ({
        date: item.date,
        label: item.label?.trim() || 'Dia dado pela empresa',
      }))
      .filter((item) => {
        if (seen.has(item.date)) return false;
        seen.add(item.date);
        return true;
      });

    await prisma.$transaction(async (tx) => {
      // Replace all days for this country
      await tx.vacationCompanyExtraDay.deleteMany({ where: { country } });

      if (uniqueDays.length > 0) {
        await tx.vacationCompanyExtraDay.createMany({
          data: uniqueDays.map((item) => ({
            country,
            date: item.date,
            label: item.label,
            createdById: req.authUser!.id,
          })),
        });
      }
    });

    return res.json({ country, days: uniqueDays });
  } catch (error) {
    console.error('[PUT /vacations/company-extra-days]', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Payload inválido.', issues: error.issues });
    }
    return res.status(500).json({ error: 'Falha ao guardar dias automáticos da empresa.' });
  }
});

router.get('/vacations/overview', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.id;

    const [profile, vacations] = await Promise.all([
      prisma.profile.findUnique({ where: { userId } }),
      prisma.vacation.findMany({ where: { userId } }),
    ]);

    const country = profile?.workCountry ?? 'PT';
    const currentYear = new Date().getFullYear();
    const extraBalanceDays = (await prisma.vacationBalanceCredit.aggregate({
      where: { userId, year: currentYear },
      _sum: { days: true },
    }))._sum.days ?? 0;
    const holidayDates = await collectHolidayDates(country, [currentYear]);
    const companyExtraDays = await resolveConfiguredCompanyExtraDays({
      year: currentYear,
      country,
      localidade: profile?.localidade,
    });

    if (country === 'PT') {
      const approvedVacationDays = vacations
        .filter((item) => item.status === 'APPROVED' && item.requestType === 'VACATION')
        .reduce((sum, item) => sum + vacationDaysForMetrics(item, holidayDates), 0);

      return res.json({
        country: 'PT',
        year: currentYear,
        rules: {
          baseDays: 22,
          extraDays: companyExtraDays.days.map((item) => `${formatIsoDatePt(item.date)}${item.label ? ` (${item.label})` : ''}`),
          mandatoryConsecutiveDays: 10,
          carryOver: true,
          maxTeamShare: '1/3',
        },
        approvedVacationDays,
        calculation: {
          entitledDays: 22 + extraBalanceDays,
          baseEntitledDays: 22,
          extraBalanceDays,
        },
      });
    }

    const hireDate = profile?.dataInicioContrato ? new Date(`${profile.dataInicioContrato}T00:00:00`) : new Date(`${currentYear}-01-01T00:00:00`);
    const now = new Date();
    const monthsWorked = (now.getFullYear() - hireDate.getFullYear()) * 12 + (now.getMonth() - hireDate.getMonth());
    const acquisitionComplete = monthsWorked >= 12;
    const unjustifiedAbsences = profile?.unjustifiedAbsences ?? 0;
    const baseEntitledDays = brVacationDaysByAbsences(unjustifiedAbsences);
    const entitledDays = baseEntitledDays + extraBalanceDays;

    return res.json({
      country: 'BR',
      year: currentYear,
      rules: {
        acquisitionPeriodMonths: 12,
        concessionPeriodMonths: 12,
        maxSplitPeriods: 3,
        onePeriodMinDays: 14,
        otherPeriodsMinDays: 5,
        canSellDays: 10,
        noStartTwoDaysBeforeHoliday: true,
        noticeDays: 30,
        maxTeamShare: '1/3',
      },
      calculation: {
        monthsWorked,
        acquisitionComplete,
        unjustifiedAbsences,
        baseEntitledDays,
        extraBalanceDays,
        entitledDays,
      },
    });
  } catch (error) {
    console.error('[GET /vacations/overview]', error);
    return res.status(500).json({ error: 'Falha ao carregar visão geral de férias.' });
  }
});

router.get('/vacations/calendar', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.id;
    const year = Number(typeof req.query.year === 'string' ? req.query.year : new Date().getFullYear());

    const [profile, vacations] = await Promise.all([
      prisma.profile.findUnique({ where: { userId } }),
      prisma.vacation.findMany({ where: { userId } }),
    ]);

    const country = profile?.workCountry ?? 'PT';
    const holidays = await fetchHolidays(country, year);
    const holidayDates = new Set(holidays.map((item) => item.date));
    const companyExtraDays = await resolveConfiguredCompanyExtraDays({
      year,
      country,
      localidade: profile?.localidade,
    });

    const weekendDays: string[] = [];
    for (let date = new Date(year, 0, 1); date.getFullYear() === year; date.setDate(date.getDate() + 1)) {
      const day = date.getDay();
      if (day === 0 || day === 6) {
        weekendDays.push(dateToISO(new Date(date)));
      }
    }

    const approved = vacations.filter((item) => item.status === 'APPROVED');
    const pending = vacations.filter((item) => item.status === 'PENDING');

    const approvedDays = approved.flatMap((item) => enumerateDates(item.dataInicio, item.dataFim));
    const pendingDays = pending.flatMap((item) => enumerateDates(item.dataInicio, item.dataFim));
    const absencesDays = vacations
      .filter((item) => item.requestType !== 'VACATION' && item.status !== 'CANCELLED')
      .flatMap((item) => enumerateDates(item.dataInicio, item.dataFim));

    const extras = companyExtraDays.days.map((item) => item.date);

    if (profile?.dataNascimento) {
      const [, month, day] = profile.dataNascimento.split('-');
      if (month && day) {
        const birthdayDate = new Date(`${year}-${month}-${day}T00:00:00`);
        const birthdayIso = dateToISO(birthdayDate);
        if (birthdayDate.getDay() === 0 || birthdayDate.getDay() === 6) {
          extras.push(dateToISO(nextWorkingDay(birthdayDate, holidayDates)));
        } else {
          extras.push(birthdayIso);
        }
      }
    }

    return res.json({
      year,
      country,
      holidays: holidays.map((h) => h.date),
      weekendDays,
      approvedDays: Array.from(new Set(approvedDays)),
      pendingDays: Array.from(new Set(pendingDays)),
      absencesDays: Array.from(new Set(absencesDays)),
      extraDays: Array.from(new Set(extras)),
      extraDayDetails: companyExtraDays.days,
      requests: vacations,
    });
  } catch (error) {
    console.error('[GET /vacations/calendar]', error);
    return res.status(500).json({ error: 'Falha ao carregar calendário de férias.' });
  }
});

router.post('/vacations', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.id;
    const validation = vacationSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: validation.error.issues[0].message });
    }

    const data = validation.data;
    const contextTeamId = await resolveContextTeamId(userId, data.contextTeamId);

    const profile = await prisma.profile.findUnique({
      where: { userId },
      select: { workCountry: true, nomeCompleto: true, nomeAbreviado: true },
    });
    const country = profile?.workCountry ?? 'PT';

    await enforceVacationBusinessDays({
      requestType: data.requestType,
      dataInicio: data.dataInicio,
      dataFim: data.dataFim,
      country,
    });

    const approvalGroups = await resolveApprovalGroups(userId, contextTeamId);
    if (approvalGroups.length === 0) {
      return res.status(400).json({ error: 'Não existem aprovadores configurados para esta equipa.' });
    }

    let policyWarnings: string[] = [];
    const vacation = await prisma.$transaction(async (tx) => {
      policyWarnings = await validateVacationCountryPolicy({
        db: tx,
        userId,
        country,
        requestType: data.requestType,
        dataInicio: data.dataInicio,
        dataFim: data.dataFim,
        partialDay: data.partialDay,
      });

      if (data.requestType === 'VACATION' && contextTeamId) {
        await acquireTeamCapacityLock(tx, contextTeamId);
        await enforceOneThirdCapacity(tx, contextTeamId, country, data.dataInicio, data.dataFim, data.partialDay);
      }

      const created = await tx.vacation.create({
        data: {
          userId,
          contextTeamId,
          dataInicio: data.dataInicio,
          dataFim: data.dataFim,
          observacoes: data.observacoes,
          requestType: data.requestType,
          partialDay: data.partialDay,
          attachmentLink: data.attachmentLink,
          status: 'PENDING',
          versionNumber: 1,
        },
      });

      for (const group of approvalGroups) {
        for (const approverId of group.approverIds) {
          await tx.vacationApproval.create({
            data: {
              vacationId: created.id,
              approverId,
              approvalLevel: group.level,
              status: group.level === approvalGroups[0].level ? APPROVAL_PENDING : APPROVAL_WAITING,
            },
          });
        }
      }

      return created;
    });

    if (approvalGroups.length > 0) {
      const requesterName = String(profile?.nomeAbreviado ?? '').trim()
        || String(profile?.nomeCompleto ?? '').trim()
        || 'Colaborador';
      const approverIds = Array.from(new Set(approvalGroups.flatMap((group) => group.approverIds)));
      await notifyUsers(
        prisma,
        approverIds,
        data.requestType === 'VACATION' ? 'Novo pedido de férias para aprovação' : 'Novo pedido de ausência para aprovação',
        formatVacationNotificationMessage({
          requesterName,
          requestType: data.requestType,
          dataInicio: data.dataInicio,
          dataFim: data.dataFim,
          contextTeamName: vacation.contextTeamId
            ? (await prisma.team.findUnique({ where: { id: vacation.contextTeamId }, select: { name: true } }))?.name
            : null,
          observacoes: data.observacoes,
        }),
      );
    }

    res.status(201).json({
      ...vacation,
      warnings: policyWarnings,
    });
  } catch (error) {
    console.error('[POST /vacations]', error);
    const status = isVacationBusinessRuleError(error) ? 400 : 500;
    res.status(status).json({ error: error instanceof Error ? error.message : 'Falha ao registar pedido.' });
  }
});

async function createVacationBalanceCredit(req: Request, res: Response) {
  try {
    const actorId = req.authUser!.id;
    const actorHasAccessTotal = req.authUser!.isRootAccess || req.authUser!.hasAccessTotal || await isAccessTotal(actorId);
    if (!actorHasAccessTotal) {
      return res.status(403).json({ message: 'Sem permissões para creditar saldo de férias.' });
    }

    const validation = assignBalanceCreditSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: validation.error.issues[0].message });
    }

    const data = validation.data;
    const targetUser = await prisma.user.findUnique({
      where: { id: data.userId },
      select: {
        id: true,
        isActive: true,
        isRootAccess: true,
        hasAccessTotal: true,
        profile: { select: { workCountry: true, nomeAbreviado: true, nomeCompleto: true } },
      },
    });

    if (!targetUser || !targetUser.isActive) {
      return res.status(404).json({ error: 'Colaborador não encontrado ou inativo.' });
    }

    if (targetUser.isRootAccess || targetUser.hasAccessTotal) {
      return res.status(400).json({ error: 'Só é permitido creditar saldo para colaboradores sem acesso total.' });
    }

    if (!req.authUser!.isRootAccess) {
      const canCreditTarget = await canAccessUserByPermission(actorId, 'manage_vacation_rules', targetUser.id);
      if (!canCreditTarget) {
        return res.status(403).json({ error: 'Sem permissões para creditar saldo a este colaborador com as restrições atuais.' });
      }
    }

    const created = await prisma.vacationBalanceCredit.create({
      data: {
        userId: targetUser.id,
        year: data.year,
        days: data.days,
        reason: data.reason,
        createdById: actorId,
      },
    });

    const actorLabel = req.authUser!.username;
    await prisma.notification.create({
      data: {
        userId: targetUser.id,
        title: 'Saldo de férias creditado',
        message: `Foram creditados ${data.days} dia(s) ao teu saldo de férias de ${data.year} por ${actorLabel}. Motivo: ${data.reason}`,
      },
    });

    return res.status(201).json(created);
  } catch (error) {
    console.error('[POST /vacations/assign-balance-days]', error);
    const status = isVacationBusinessRuleError(error) ? 400 : 500;
    return res.status(status).json({ error: error instanceof Error ? error.message : 'Falha ao creditar saldo de férias.' });
  }
}

router.post('/vacations/assign-balance-days', requireAuth, createVacationBalanceCredit);
router.post('/vacations/assign-direct', requireAuth, createVacationBalanceCredit);

router.get('/vacations/requests', requireAuth, async (req: Request, res: Response) => {
  const timer = createRequestTimer('GET /vacations/requests');
  const userId = req.authUser!.id;
  const [canApproveVacation, canRejectVacation, canViewAllVacations, isFullAccess, viewAllScope] = await Promise.all([
    hasPermission(userId, 'approve_vacation'),
    hasPermission(userId, 'reject_vacation'),
    hasPermission(userId, 'view_all_vacations'),
    isAccessTotal(userId),
    getPermissionScope(userId, 'view_all_vacations'),
  ]);
  timer.mark('resolve-permissions-and-scope');

  const canViewPendingVacations = canApproveVacation
    || canRejectVacation
    || canViewAllVacations
    || req.authUser!.isRootAccess
    || isFullAccess;

  if (!canViewPendingVacations) {
    return res.status(403).json({ message: 'Sem permissões para consultar pedidos.' });
  }

  const canViewAllGlobally = Boolean(canViewAllVacations && viewAllScope?.isGlobal);
  const where: Prisma.VacationWhereInput = req.authUser!.isRootAccess || isFullAccess || canViewAllGlobally
    ? { status: 'PENDING', userId: { not: userId } }
    : {
        status: 'PENDING',
      userId: { not: userId },
        OR: [
          {
            approvals: {
              some: {
                approverId: userId,
                status: APPROVAL_PENDING,
              },
            },
          },
          ...(canViewAllVacations && viewAllScope
            ? (() => {
                const userWhere = buildUserWhereFromScope(viewAllScope) as Prisma.UserWhereInput | null;
                return userWhere ? [{ user: userWhere }] : [];
              })()
            : []),
        ],
      };

  const pendingByStep = await prisma.vacation.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          team: { select: { id: true, name: true } },
          profile: { select: { workCountry: true, nomeAbreviado: true, nomeCompleto: true } },
        },
      },
      contextTeam: { select: { id: true, name: true } },
      approvals: {
        select: {
          approverId: true,
          approvalLevel: true,
          status: true,
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }],
  });
  timer.mark('load-pending-vacations');
  timer.done({ count: pendingByStep.length });

  return res.json(pendingByStep);
});

router.post('/vacations/:id/approve', requireAuth, async (req: Request, res: Response) => {
  const userId = req.authUser!.id;
  const [canApproveVacation, isFullAccess] = await Promise.all([
    hasPermission(userId, 'approve_vacation'),
    isAccessTotal(userId),
  ]);

  if (!canApproveVacation) {
    return res.status(403).json({ message: 'Sem permissões para aprovar pedidos.' });
  }

  const id = typeof req.params.id === 'string' ? req.params.id : '';

  const vacation = await prisma.vacation.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      status: true,
      requestType: true,
      dataInicio: true,
      dataFim: true,
      contextTeamId: true,
      partialDay: true,
      user: {
        select: {
          id: true,
          profile: { select: { workCountry: true } },
        },
      },
      approvals: true,
    },
  });

  if (!vacation || vacation.status !== 'PENDING') {
    return res.status(404).json({ message: 'Pedido não encontrado.' });
  }

  if (vacation.userId === userId) {
    return res.status(403).json({ message: 'Não podes aprovar os teus próprios pedidos.' });
  }

  const isPt = (vacation.user.profile?.workCountry ?? 'PT') === 'PT';
  const canApproveByStep = vacation.approvals.some((item) => item.approverId === req.authUser!.id && item.status === APPROVAL_PENDING);
  const canApproveByException = isPt && (req.authUser!.isRootAccess || isFullAccess);
  const canApproveWithinRestrictions = req.authUser!.isRootAccess
    || isFullAccess
    || await canAccessUserByPermission(userId, 'approve_vacation', vacation.userId);

  if (!canApproveWithinRestrictions && !canApproveByException) {
    return res.status(403).json({ message: 'Sem permissões para aprovar este pedido com as restrições atuais.' });
  }

  if (!canApproveByStep && !canApproveByException) {
    return res.status(403).json({ message: 'Este pedido não pertence ao teu nível de aprovação.' });
  }

  const completed = await prisma.$transaction(async (tx) => {
    const currentVacation = await tx.vacation.findUnique({
      where: { id },
      select: {
        id: true,
        requestType: true,
        contextTeamId: true,
        dataInicio: true,
        dataFim: true,
        partialDay: true,
      },
    });

    if (!currentVacation || currentVacation.requestType !== 'VACATION' || !currentVacation.contextTeamId) {
      return finalizeVacationApproval(tx, id, req.authUser!.id, canApproveByException);
    }

    await acquireTeamCapacityLock(tx, currentVacation.contextTeamId);
    await enforceOneThirdCapacity(
      tx,
      currentVacation.contextTeamId,
      (vacation.user.profile?.workCountry ?? 'PT'),
      currentVacation.dataInicio,
      currentVacation.dataFim,
      currentVacation.partialDay,
      currentVacation.id,
    );

    return finalizeVacationApproval(tx, id, req.authUser!.id, canApproveByException);
  });

  if (!completed) {
    return res.status(400).json({ message: 'Não foi possível finalizar esta aprovação.' });
  }

  const refreshedVacation = await prisma.vacation.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      status: true,
      requestType: true,
      dataInicio: true,
      dataFim: true,
      approvals: {
        select: {
          status: true,
        },
      },
    },
  });

  if (!refreshedVacation) {
    return res.json({ success: true });
  }

  const totalApprovals = refreshedVacation.approvals.length;
  const approvedApprovals = refreshedVacation.approvals.filter((item) => item.status === APPROVAL_APPROVED).length;
  const actorLabel = req.authUser?.username || 'Aprovador';

  await prisma.notification.create({
    data: {
      userId: refreshedVacation.userId,
      title: refreshedVacation.status === 'APPROVED'
        ? (refreshedVacation.requestType === 'VACATION' ? 'Pedido de férias aprovado' : 'Pedido de ausência aprovado')
        : (refreshedVacation.requestType === 'VACATION' ? 'Pedido de férias em aprovação' : 'Pedido de ausência em aprovação'),
      message: refreshedVacation.status === 'APPROVED'
        ? [
            `${describeVacationRequestType(refreshedVacation.requestType)} aprovado com sucesso.`,
            `Período: ${formatIsoDatePt(refreshedVacation.dataInicio)} até ${formatIsoDatePt(refreshedVacation.dataFim)}.`,
            `Decisão final por: ${actorLabel}.`,
          ].join('\n')
        : [
            `${actorLabel} aprovou a sua etapa do pedido de ${describeVacationRequestType(refreshedVacation.requestType)}.`,
            `Progresso: ${approvedApprovals}/${Math.max(totalApprovals, 1)} aprovações concluídas.`,
            `Período: ${formatIsoDatePt(refreshedVacation.dataInicio)} até ${formatIsoDatePt(refreshedVacation.dataFim)}.`,
          ].join('\n'),
    },
  });

  return res.json({ success: true });
});

router.post('/vacations/:id/reject', requireAuth, async (req: Request, res: Response) => {
  const userId = req.authUser!.id;
  const [canRejectVacation, isFullAccess] = await Promise.all([
    hasPermission(userId, 'reject_vacation'),
    isAccessTotal(userId),
  ]);

  if (!canRejectVacation) {
    return res.status(403).json({ message: 'Sem permissões para recusar pedidos.' });
  }

  const validation = approveRejectSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ message: validation.error.issues[0].message });
  }

  const id = typeof req.params.id === 'string' ? req.params.id : '';
  const reason = typeof validation.data.reason === 'string' && validation.data.reason.trim()
    ? validation.data.reason.trim()
    : 'Pedido recusado.';

  const vacation = await prisma.vacation.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          profile: { select: { workCountry: true } },
        },
      },
      approvals: true,
    },
  });

  if (!vacation || vacation.status !== 'PENDING') {
    return res.status(404).json({ message: 'Pedido não encontrado.' });
  }

  if (vacation.userId === userId) {
    return res.status(403).json({ message: 'Não podes recusar os teus próprios pedidos.' });
  }

  const isPt = (vacation.user.profile?.workCountry ?? 'PT') === 'PT';
  const canRejectByStep = vacation.approvals.some((item) => item.approverId === req.authUser!.id && item.status === APPROVAL_PENDING);
  const canRejectByException = isPt && (req.authUser!.isRootAccess || isFullAccess);
  const canRejectWithinRestrictions = req.authUser!.isRootAccess
    || isFullAccess
    || await canAccessUserByPermission(userId, 'reject_vacation', vacation.userId);

  if (!canRejectWithinRestrictions && !canRejectByException) {
    return res.status(403).json({ message: 'Sem permissões para recusar este pedido com as restrições atuais.' });
  }

  if (!canRejectByStep && !canRejectByException) {
    return res.status(403).json({ message: 'Este pedido não pertence ao teu nível de aprovação.' });
  }

  await prisma.$transaction(async (tx) => {
    await tx.vacation.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewedById: req.authUser!.id,
        reviewedAt: new Date(),
        reviewReason: reason,
      },
    });

    if (canRejectByException) {
      await tx.vacationApproval.updateMany({
        where: {
          vacationId: id,
          status: { in: [APPROVAL_PENDING, APPROVAL_WAITING] },
        },
        data: {
          status: APPROVAL_REJECTED,
          decidedAt: new Date(),
          reason,
        },
      });
      return;
    }

    await tx.vacationApproval.updateMany({
      where: {
        vacationId: id,
        approverId: req.authUser!.id,
        status: APPROVAL_PENDING,
      },
      data: {
        status: APPROVAL_REJECTED,
        decidedAt: new Date(),
        reason,
      },
    });

    await tx.vacationApproval.updateMany({
      where: {
        vacationId: id,
        approverId: { not: req.authUser!.id },
        status: { in: [APPROVAL_PENDING, APPROVAL_WAITING] },
      },
      data: {
        status: APPROVAL_SKIPPED,
        decidedAt: new Date(),
        reason: 'Fluxo encerrado após rejeição por outro aprovador.',
      },
    });
  });

  await prisma.notification.create({
    data: {
      userId: vacation.userId,
      title: vacation.requestType === 'VACATION' ? 'Pedido de férias recusado' : 'Pedido de ausência recusado',
      message: [
        `O pedido de ${describeVacationRequestType(vacation.requestType as 'VACATION' | 'ABSENCE_MEDICAL' | 'ABSENCE_TRAINING')} foi recusado.`,
        `Motivo: ${reason}`,
        `Decisor: ${req.authUser?.username || 'Aprovador'}.`,
      ].join('\n'),
    },
  });

  return res.json({ success: true });
});

router.put('/vacations/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.id;
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    const validation = vacationSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: validation.error.issues[0].message });
    }

    const existing = await prisma.vacation.findFirst({
      where: {
        id,
        userId,
        status: { in: ['PENDING', 'APPROVED'] },
      },
      include: {
        contextTeam: { select: { id: true } },
      },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Pedido não encontrado para versionamento.' });
    }

    const data = validation.data;
    const contextTeamId = await resolveContextTeamId(userId, data.contextTeamId || existing.contextTeamId || undefined);

    const profile = await prisma.profile.findUnique({
      where: { userId },
      select: { workCountry: true },
    });
    const country = profile?.workCountry ?? 'PT';

    await enforceVacationBusinessDays({
      requestType: data.requestType,
      dataInicio: data.dataInicio,
      dataFim: data.dataFim,
      country,
    });

    const approvalGroups = await resolveApprovalGroups(userId, contextTeamId);
    if (approvalGroups.length === 0) {
      return res.status(400).json({ error: 'Não existem aprovadores configurados para esta equipa.' });
    }

    const rootId = existing.versionOfId || existing.id;
    const maxVersion = await prisma.vacation.findFirst({
      where: {
        OR: [{ id: rootId }, { versionOfId: rootId }],
      },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });

    let policyWarnings: string[] = [];
    const created = await prisma.$transaction(async (tx) => {
      policyWarnings = await validateVacationCountryPolicy({
        db: tx,
        userId,
        country,
        requestType: data.requestType,
        dataInicio: data.dataInicio,
        dataFim: data.dataFim,
        partialDay: data.partialDay,
        excludeVacationId: id,
      });

      if (data.requestType === 'VACATION' && contextTeamId) {
        await acquireTeamCapacityLock(tx, contextTeamId);
        await enforceOneThirdCapacity(tx, contextTeamId, country, data.dataInicio, data.dataFim, data.partialDay, id);
      }

      await tx.vacation.update({
        where: { id: existing.id },
        data: {
          status: 'CANCELLED',
          reviewReason: 'Pedido substituído por nova versão.',
        },
      });

      await tx.vacationApproval.updateMany({
        where: {
          vacationId: existing.id,
          status: { in: [APPROVAL_PENDING, APPROVAL_WAITING] },
        },
        data: {
          status: APPROVAL_SKIPPED,
          decidedAt: new Date(),
          reason: 'Versão substituída.',
        },
      });

      const nextVersion = await tx.vacation.create({
        data: {
          userId,
          contextTeamId,
          versionOfId: rootId,
          versionNumber: (maxVersion?.versionNumber ?? 1) + 1,
          dataInicio: data.dataInicio,
          dataFim: data.dataFim,
          observacoes: data.observacoes,
          requestType: data.requestType,
          partialDay: data.partialDay,
          attachmentLink: data.attachmentLink,
          status: 'PENDING',
        },
      });

      for (const group of approvalGroups) {
        for (const approverId of group.approverIds) {
          await tx.vacationApproval.create({
            data: {
              vacationId: nextVersion.id,
              approverId,
              approvalLevel: group.level,
              status: group.level === approvalGroups[0].level ? APPROVAL_PENDING : APPROVAL_WAITING,
            },
          });
        }
      }

      return nextVersion;
    });

    const requesterProfile = await prisma.profile.findUnique({
      where: { userId },
      select: { nomeAbreviado: true, nomeCompleto: true },
    });

    const contextTeam = created.contextTeamId
      ? await prisma.team.findUnique({ where: { id: created.contextTeamId }, select: { name: true } })
      : null;
    const requesterName = String(requesterProfile?.nomeAbreviado ?? '').trim()
      || String(requesterProfile?.nomeCompleto ?? '').trim()
      || 'Colaborador';

    await notifyUsers(
      prisma,
      Array.from(new Set(approvalGroups.flatMap((group) => group.approverIds))),
      data.requestType === 'VACATION' ? 'Nova versão de pedido de férias para aprovação' : 'Nova versão de pedido de ausência para aprovação',
      formatVacationNotificationMessage({
        requesterName,
        requestType: data.requestType,
        dataInicio: data.dataInicio,
        dataFim: data.dataFim,
        contextTeamName: contextTeam?.name,
        observacoes: data.observacoes,
      }),
    );

    res.json({
      ...created,
      warnings: policyWarnings,
    });
  } catch (error) {
    console.error('[PUT /vacations/:id]', error);
    const status = isVacationBusinessRuleError(error) ? 400 : 500;
    res.status(status).json({ error: error instanceof Error ? error.message : 'Falha ao atualizar pedido.' });
  }
});

router.delete('/vacations/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.id;
    const id = typeof req.params.id === 'string' ? req.params.id : '';

    const existing = await prisma.vacation.findFirst({ where: { id, userId, status: 'PENDING' } });

    if (!existing) {
      return res.status(404).json({ error: 'Pedido não encontrado ou já processado.' });
    }

    await prisma.$transaction([
      prisma.vacation.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          reviewReason: 'Cancelado pelo colaborador.',
        },
      }),
      prisma.vacationApproval.updateMany({
        where: {
          vacationId: id,
          status: { in: [APPROVAL_PENDING, APPROVAL_WAITING] },
        },
        data: {
          status: APPROVAL_SKIPPED,
          decidedAt: new Date(),
          reason: 'Cancelado pelo colaborador.',
        },
      }),
    ]);

    res.json({ success: true });
  } catch (error) {
    console.error('[DELETE /vacations/:id]', error);
    res.status(500).json({ error: 'Falha ao remover pedido.' });
  }
});

// ---------------------------------------------------------------------------
// GET /vacations/export  — Mapa de Férias (XLSX)
// Accessible to users with isAccessTotal or isRootAccess
// Query params: year (required), teamId (optional), userIds (optional, comma-separated)
// ---------------------------------------------------------------------------
router.get('/vacations/export', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.id;
    const canExport = req.authUser!.isRootAccess
      || req.authUser!.hasAccessTotal
      || await isAccessTotal(userId);

    if (!canExport) {
      return res.status(403).json({ message: 'Sem permissões para exportar o mapa de férias.' });
    }

    const year = Number(typeof req.query.year === 'string' ? req.query.year : new Date().getFullYear());
    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ message: 'Ano inválido.' });
    }

    const teamIdFilter = typeof req.query.teamId === 'string' && req.query.teamId ? req.query.teamId : null;
    const userIdsFilter = typeof req.query.userIds === 'string' && req.query.userIds
      ? req.query.userIds.split(',').map((s) => s.trim()).filter(Boolean)
      : null;

    // Build user filter
    const userWhere: Prisma.UserWhereInput = {
      isActive: true,
      username: { not: 't.people' },
    };

    if (userIdsFilter && userIdsFilter.length > 0) {
      userWhere.id = { in: userIdsFilter };
    } else if (teamIdFilter) {
      userWhere.OR = [
        { teamId: teamIdFilter },
        { teamMemberships: { some: { teamId: teamIdFilter, isActive: true } } },
      ];
    }

    const users = await prisma.user.findMany({
      where: userWhere,
      orderBy: [{ team: { name: 'asc' } }, { username: 'asc' }],
      select: {
        id: true,
        username: true,
        team: { select: { name: true } },
        profile: {
          select: {
            nomeCompleto: true,
            nomeAbreviado: true,
            workCountry: true,
            unjustifiedAbsences: true,
          },
        },
      },
    });

    // Pre-fetch holidays for countries we'll need
    const countriesNeeded = new Set(users.map((u) => u.profile?.workCountry ?? 'PT'));
    const holidaysByCountry = new Map<string, Set<string>>();
    for (const c of countriesNeeded) {
      const holidays = await collectHolidayDates(c as 'PT' | 'BR', [year]);
      holidaysByCountry.set(c, holidays);
    }

    // Fetch all vacations for the year in one query
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const allVacations = await prisma.vacation.findMany({
      where: {
        userId: { in: users.map((u) => u.id) },
        status: 'APPROVED',
        requestType: 'VACATION',
        dataInicio: { lte: yearEnd },
        dataFim: { gte: yearStart },
      },
      select: {
        userId: true,
        dataInicio: true,
        dataFim: true,
        requestType: true,
        partialDay: true,
      },
    });

    const vacationsByUser = new Map<string, typeof allVacations>();
    for (const v of allVacations) {
      if (!vacationsByUser.has(v.userId)) vacationsByUser.set(v.userId, []);
      vacationsByUser.get(v.userId)!.push(v);
    }

    const creditByUser = await sumVacationBalanceCreditsByUser({
      userIds: users.map((u) => u.id),
      year,
    });

    const rows: Array<{
      username: string;
      nome: string;
      equipa: string;
      pais: 'PT' | 'BR';
      diasBase: number;
      diasExtra: number;
      diasAprovados: number;
      saldo: number;
      periodos: string;
    }> = [];

    for (const user of users) {
      const country = user.profile?.workCountry ?? 'PT';
      const holidayDates = holidaysByCountry.get(country) ?? new Set<string>();
      const vacations = vacationsByUser.get(user.id) ?? [];

      const baseDays = country === 'PT'
        ? 22
        : brVacationDaysByAbsences(user.profile?.unjustifiedAbsences ?? 0);

      const approvedDays = vacations.reduce(
        (sum, v) => sum + vacationDaysForMetrics(v, holidayDates),
        0,
      );

      const extraDays = creditByUser.get(user.id) ?? 0;
      const saldoEstimado = Math.max(baseDays + extraDays - approvedDays, 0);

      const periods = vacations
        .sort((a, b) => a.dataInicio.localeCompare(b.dataInicio))
        .map((v) => `${v.dataInicio} → ${v.dataFim}`)
        .join('; ');

      rows.push({
        username: user.username,
        nome: user.profile?.nomeCompleto || user.profile?.nomeAbreviado || '',
        equipa: user.team?.name || '',
        pais: country,
        diasBase: baseDays,
        diasExtra: extraDays,
        diasAprovados: approvedDays,
        saldo: saldoEstimado,
        periodos: periods,
      });
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Smarter Hub';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Mapa de Férias', {
      views: [{ state: 'frozen', ySplit: 3 }],
      properties: { defaultColWidth: 18 },
    });

    sheet.mergeCells('A1:I1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = `Mapa de Férias ${year}`;
    titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };

    sheet.mergeCells('A2:I2');
    const metaCell = sheet.getCell('A2');
    metaCell.value = `Gerado em ${new Date().toLocaleString('pt-PT')} | Total de colaboradores: ${rows.length}`;
    metaCell.font = { name: 'Calibri', size: 10, color: { argb: 'FF38516B' } };
    metaCell.alignment = { vertical: 'middle', horizontal: 'left' };
    metaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF2FB' } };

    const headerRow = sheet.getRow(3);
    headerRow.values = [
      'Username',
      'Nome',
      'Equipa',
      'País',
      'Dias Atribuídos',
      'Dias Extra',
      'Dias Gastos',
      'Saldo',
      'Períodos de Férias',
    ];
    headerRow.font = { name: 'Calibri', bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E75B6' } };
    headerRow.height = 22;

    for (const row of rows) {
      sheet.addRow([
        row.username,
        row.nome,
        row.equipa,
        row.pais,
        row.diasBase,
        row.diasExtra,
        row.diasAprovados,
        row.saldo,
        row.periodos,
      ]);
    }

    sheet.columns = [
      { width: 18 },
      { width: 30 },
      { width: 22 },
      { width: 10 },
      { width: 14 },
      { width: 11 },
      { width: 12 },
      { width: 10 },
      { width: 52 },
    ];

    const dataStart = 4;
    const dataEnd = Math.max(4, rows.length + 3);
    for (let i = dataStart; i <= dataEnd; i += 1) {
      const row = sheet.getRow(i);
      const isEven = i % 2 === 0;
      row.eachCell((cell, colNumber) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD9E2F3' } },
          left: { style: 'thin', color: { argb: 'FFD9E2F3' } },
          bottom: { style: 'thin', color: { argb: 'FFD9E2F3' } },
          right: { style: 'thin', color: { argb: 'FFD9E2F3' } },
        };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: isEven ? 'FFF9FCFF' : 'FFFFFFFF' },
        };
        if (colNumber >= 5 && colNumber <= 8) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: colNumber === 9 };
        }
      });
    }

    const totalsRow = sheet.addRow([
      '',
      'Totais',
      '',
      '',
      { formula: `SUM(E4:E${dataEnd})` },
      { formula: `SUM(F4:F${dataEnd})` },
      { formula: `SUM(G4:G${dataEnd})` },
      { formula: `SUM(H4:H${dataEnd})` },
      '',
    ]);
    totalsRow.font = { name: 'Calibri', bold: true, color: { argb: 'FF1D3B58' } };
    totalsRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE4EEF9' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFB8CCE4' } },
        left: { style: 'thin', color: { argb: 'FFB8CCE4' } },
        bottom: { style: 'thin', color: { argb: 'FFB8CCE4' } },
        right: { style: 'thin', color: { argb: 'FFB8CCE4' } },
      };
    });

    const xlsxBuffer = await workbook.xlsx.writeBuffer();
    const filename = `mapa-ferias-${year}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(Buffer.from(xlsxBuffer as ArrayBuffer));
  } catch (error) {
    console.error('[GET /vacations/export]', error);
    return res.status(500).json({ error: 'Falha ao gerar exportação do mapa de férias.' });
  }
});

export { router as vacationsRouter };
