import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { prisma } from '../lib/prisma.js';
import { getUserVacations } from '../services/vacations/get-vacations.service.js';
import {
  buildUserWhereFromScope,
  canAccessUserByPermission,
  canReviewAccessTotalHierarchy,
  getPermissionScope,
  hasPermission,
  isAccessTotal,
} from '../lib/permission-engine.js';
import { requireAuth } from '../middleware/auth.js';
import { notifyUsers } from '../lib/notifications.js';
import { createRequestTimer } from '../lib/request-timing.js';
import {
  findMaxVacationVersionNumber,
  findTeamNameById,
  findVacationRequesterProfile,
  findVacationVersionProfile,
  findVersionableVacationByIdAndUser,
} from '../repositories/vacations.repository.js';
import { cancelVacationForOwner } from '../services/vacations/cancel-vacation.service.js';
import { assignVacationBalanceCredit } from '../services/vacations/assign-vacation-balance-credit.service.js';
import {
  createVacationRequestTransaction,
  findVacationCreateProfile,
  findVacationTargetUserById,
} from '../services/vacations/create-vacation-request.service.js';
import { sellVacationDays } from '../services/vacations/sell-vacation-days.service.js';
import { versionVacationRequest } from '../services/vacations/version-vacation-request.service.js';
import {
  appendHourBankEntry,
  calculateHourBankDebitFromAbsence,
  filterUserIdsByWorkCountry,
  getHourBankTotalsByUserId,
  isFolgaAbsenceForHourBank,
  notifyHourBankExceedance,
  resolveAccessTotalRecipientIds,
  resolveBrHourBankLimit,
  resolveLeadershipRecipientsForUser,
} from '../lib/hour-bank.js';

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
    targetUserId: z.string().optional(),
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

    if (data.requestType === 'VACATION') {
      const startDay = start.getDay();
      const endDay = end.getDay();
      const startIsWeekend = startDay === 0 || startDay === 6;
      const endIsWeekend = endDay === 0 || endDay === 6;

      if (startIsWeekend) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dataInicio'],
          message: 'A data de início das férias tem de ser num dia útil.',
        });
      }

      if (endIsWeekend) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dataFim'],
          message: 'A data de fim das férias tem de ser num dia útil.',
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
    userId: z.string().min(1, 'Colaborador é obrigatório.').optional(),
    userIds: z.array(z.string().min(1, 'Colaborador é obrigatório.')).min(1, 'Seleciona pelo menos um colaborador.').optional(),
    year: z.number().int().min(2000).max(2100).optional(),
    days: z.number()
      .min(0.5, 'Dias a creditar deve ser pelo menos 0,5.')
      .refine((value) => Math.abs(value * 2 - Math.round(value * 2)) < 1e-9, 'Dias a creditar deve ser em múltiplos de 0,5.'),
    reason: z.string().trim().min(3, 'Motivo é obrigatório.'),
  })
  .refine((data) => Boolean(data.userId || (data.userIds && data.userIds.length > 0)), {
    message: 'Colaborador é obrigatório.',
    path: ['userId'],
  })
  .transform((data) => ({
    ...data,
    userIds: Array.from(new Set([...(data.userIds ?? []), ...(data.userId ? [data.userId] : [])])),
    year: data.year ?? new Date().getFullYear(),
    reason: data.reason.trim(),
  }));

const companyExtraDayItemSchema = z.object({
  date: z.string().regex(/^\d{2}-\d{2}$/, 'Data inválida. Usa formato MM-DD (ex: 12-25).'),
  label: z.string().trim().min(1).max(120).optional(),
});

const companyExtraScopeValues = ['ALL', 'PT', 'BR', 'BR_SP', 'BR_RS'] as const;
type CompanyExtraScope = typeof companyExtraScopeValues[number];

const updateCompanyExtraDaysSchema = z.object({
  scope: z.enum(companyExtraScopeValues).optional(),
  year: z.number().int().min(2000).max(2100).optional(),
  days: z.array(companyExtraDayItemSchema).max(40),
});

const APPROVAL_PENDING = 'PENDING';
const APPROVAL_WAITING = 'WAITING';
const APPROVAL_APPROVED = 'APPROVED';
const APPROVAL_REJECTED = 'REJECTED';
const APPROVAL_SKIPPED = 'SKIPPED';

function parsePagination(query: Request['query']) {
  const pageRaw = typeof query.page === 'string' ? query.page.trim() : '1';
  const pageSizeRaw = typeof query.pageSize === 'string' ? query.pageSize.trim() : '50';

  const pageNum = Number(pageRaw);
  const pageSizeNum = Number(pageSizeRaw);

  const page = Number.isFinite(pageNum) && pageNum >= 1 ? pageNum : 1;
  const pageSize = Number.isFinite(pageSizeNum) && pageSizeNum >= 1 && pageSizeNum <= 200 ? pageSizeNum : 50;

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
}

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

function resolvePtBaseEntitlementForYear(dataInicioContrato: string | null | undefined, year: number) {
  if (!dataInicioContrato || !isIsoDate(dataInicioContrato)) {
    return {
      baseEntitledDays: 22,
      isFirstYearProportional: false,
      monthsInFirstContractYear: 12,
    };
  }

  const contractStart = toLocalDate(dataInicioContrato);
  const yearStart = toLocalDate(`${year}-01-01`);
  const isFirstYearProportional = contractStart.getFullYear() === year && contractStart > yearStart;

  if (!isFirstYearProportional) {
    return {
      baseEntitledDays: 22,
      isFirstYearProportional: false,
      monthsInFirstContractYear: 12,
    };
  }

  // Cálculo único do 1.º ano de contrato: meses de contratação até dezembro (inclusive), não por acumulação mensal.
  const monthsInFirstContractYear = 12 - contractStart.getMonth();
  const baseEntitledDays = Math.min(20, Math.max(0, monthsInFirstContractYear * 2));

  return {
    baseEntitledDays,
    isFirstYearProportional: true,
    monthsInFirstContractYear,
  };
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function clipRange(startA: string, endA: string, startB: string, endB: string) {
  const start = startA > startB ? startA : startB;
  const end = endA < endB ? endA : endB;
  if (start > end) {
    return null;
  }

  return { start, end };
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
    'Conflito de período:',
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
    throw new Error('Pedido inválido: a data de início das férias tem de ser num dia útil.');
  }

  if (endIsWeekend) {
    throw new Error('Pedido inválido: a data de fim das férias tem de ser num dia útil.');
  }

  void params.country;
}

async function validateVacationCountryPolicy(params: {
  db: Pick<Prisma.TransactionClient, 'vacation'>;
  userId: string;
  country: 'PT' | 'BR';
  brWorkState?: 'SP' | 'RS' | null;
  requestType: 'VACATION' | 'ABSENCE_MEDICAL' | 'ABSENCE_TRAINING';
  dataInicio: string;
  dataFim: string;
  partialDay: 'FULL' | 'AM' | 'PM';
  excludeVacationId?: string;
  // Extra profile fields for additional policy checks
  dataInicioContrato?: string | null;
  isIntern?: boolean;
}) {
  if (params.requestType !== 'VACATION') {
    return [] as string[];
  }

  const year = toLocalDate(params.dataInicio).getFullYear();

  // PT 30/04 deadline blocker (with test bypass for April)
  if (params.country === 'PT') {
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const deadline = `${today.getFullYear()}-04-30`;
    const currentMonth = today.getMonth() + 1; // 1-12
    const bypassDeadline = process.env.VACATION_PT_DEADLINE_BYPASS === 'true' || currentMonth === 4;

    if (year === today.getFullYear() && todayIso > deadline && !bypassDeadline) {
      throw new Error('Política PT: já não é possível submeter férias para este ano após 30 de abril.');
    }
  }

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
    const holidayDates = await collectHolidayDates(params.country, years, params.brWorkState);
    const hasMandatoryConsecutiveBlock = currentYearPeriods.some((period) => vacationDaysForMetrics(period, holidayDates) >= 10);
    const requestedDays = vacationDaysForMetrics(requestedPeriod, holidayDates);
    const warnings: string[] = [];

    if (!hasMandatoryConsecutiveBlock && requestedDays < 10) {
      warnings.push(`Política PT: este pedido tem ${requestedDays} dia(s) útil(eis). Deve existir pelo menos um período anual com 10 dias úteis consecutivos.`);
    }

    // Phase 2B: 1st-year proportional cap - cálculo único do 1.º ano de contrato,
    // sem distribuição mês a mês.
    if (params.dataInicioContrato) {
      const requestYear = toLocalDate(params.dataInicio).getFullYear();
      const ptEntitlement = resolvePtBaseEntitlementForYear(params.dataInicioContrato, requestYear);

      if (ptEntitlement.isFirstYearProportional) {
        const maxAllowed = ptEntitlement.baseEntitledDays;
        const allPeriodsIncludingNew = [...currentYearPeriods, requestedPeriod];
        const totalUsedDays = allPeriodsIncludingNew.reduce((sum, p) => sum + vacationDaysForMetrics(p, holidayDates), 0);
        if (totalUsedDays > maxAllowed) {
          throw new Error(
            `Política PT: no 1.º ano de contrato, o teu limite anual é ${maxAllowed} dia(s) útil(eis) (2 dias por mês do 1.º ano, máx. 20). Com este pedido ficarias com ${totalUsedDays} dia(s) no total.`,
          );
        }
      }
    }

    return warnings;
  }

  if (params.partialDay !== 'FULL') {
    throw new Error('Política BR: férias em meio-dia não são permitidas. Seleciona um período de dia inteiro.');
  }

  // BR Estagiário - só pode tirar férias após 12 meses completos de estágio
  if (params.isIntern && params.dataInicioContrato) {
    const contractStart = toLocalDate(params.dataInicioContrato);
    const today = new Date();
    const internMonths = (today.getFullYear() - contractStart.getFullYear()) * 12 + (today.getMonth() - contractStart.getMonth());
    if (internMonths < 12) {
      throw new Error(`Política BR: ainda não podes marcar férias. Estagiários só podem marcar após 12 meses completos (atualmente: ${internMonths} meses).`);
    }
  }

  // Phase 2C: BR Thursday blocker - férias não podem começar quinta-feira
  const startDayOfWeek = toLocalDate(params.dataInicio).getDay(); // 0=Sun, 4=Thu, 5=Fri
  if (startDayOfWeek === 4) {
    throw new Error('Política BR: a data de início das férias não pode ser à quinta-feira.');
  }

  // BR Friday blocker - férias não podem começar sexta-feira
  if (startDayOfWeek === 5) {
    throw new Error('Política BR: a data de início das férias não pode ser à sexta-feira.');
  }

  // Phase 2C: BR Post-holiday blocker - não pode começar no dia útil imediatamente após feriado
  const startYear = toLocalDate(params.dataInicio).getFullYear();
  const brHolidayDatesForStart = await collectHolidayDates('BR', [startYear, startYear - 1], params.brWorkState);
  {
    // Find the previous business day before dataInicio
    const startDate = toLocalDate(params.dataInicio);
    const dayBefore = new Date(startDate);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const dayBeforeIso = dateToISO(dayBefore);
    const twoDaysBefore = new Date(startDate);
    twoDaysBefore.setDate(twoDaysBefore.getDate() - 2);
    const twoDaysBeforeIso = dateToISO(twoDaysBefore);
    // If the day immediately before is a holiday (or weekend before a holiday), block
    if (brHolidayDatesForStart.has(dayBeforeIso)) {
      throw new Error('Política BR: a data de início não pode ser no primeiro dia útil após feriado.');
    }
    // Also block if dayBefore is weekend and twoDaysBefore is a holiday
    const dayBeforeIsWeekend = isWeekendIso(dayBeforeIso);
    if (dayBeforeIsWeekend && brHolidayDatesForStart.has(twoDaysBeforeIso)) {
      throw new Error('Política BR: a data de início não pode ser no primeiro dia útil após feriado.');
    }
  }

  const allPeriods = [...currentYearPeriods, requestedPeriod];
  if (allPeriods.length > 3) {
    throw new Error('Política BR: só podes dividir férias em até 3 períodos no ano.');
  }

  const years = new Set<number>([
    toLocalDate(params.dataInicio).getFullYear(),
    toLocalDate(params.dataFim).getFullYear(),
    ...allPeriods.flatMap((period) => [toLocalDate(period.dataInicio).getFullYear(), toLocalDate(period.dataFim).getFullYear()]),
  ]);
  const holidayDates = await collectHolidayDates(params.country, years, params.brWorkState);

  const effectivePeriodDays = (period: { dataInicio: string; dataFim: string; requestType?: string; partialDay?: 'FULL' | 'AM' | 'PM' }) =>
    vacationDaysForMetrics({ requestType: 'VACATION', partialDay: 'FULL', ...period }, holidayDates);

  const periodLengths = allPeriods.map((period) => effectivePeriodDays(period));
  if (periodLengths.some((days) => days < 5)) {
    throw new Error('Política BR: cada período de férias deve ter pelo menos 5 dias corridos.');
  }

  if (allPeriods.length >= 3 && !periodLengths.some((days) => days >= 14)) {
    throw new Error('Política BR: ao dividir em 3 períodos, pelo menos um deles deve ter 14 dias ou mais.');
  }

  // BR Concessivo rule - deve marcar férias com pelo menos 30 dias de antecedência
  if (params.dataInicioContrato) {
    const contractStart = toLocalDate(params.dataInicioContrato);
    const todayConc = new Date();
    todayConc.setHours(0, 0, 0, 0);
    // Find the next anniversary of the hire date (boundary of the current concessivo period)
    let anniversaryYear = todayConc.getFullYear();
    const anniversaryThisYear = new Date(anniversaryYear, contractStart.getMonth(), contractStart.getDate());
    if (anniversaryThisYear <= todayConc) {
      anniversaryYear++;
    }
    const concessivoEnd = new Date(anniversaryYear, contractStart.getMonth(), contractStart.getDate());
    concessivoEnd.setDate(concessivoEnd.getDate() - 1); // day before next anniversary
    const daysUntilConcessivoEnd = Math.floor((concessivoEnd.getTime() - todayConc.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntilConcessivoEnd >= 0 && daysUntilConcessivoEnd < 30) {
      throw new Error(
        `Política BR: este pedido já não cumpre a antecedência mínima de 30 dias para o fim do período concessivo (${dateToISO(concessivoEnd)}). Faltam ${daysUntilConcessivoEnd} dia(s).`,
      );
    }
  }

  return [] as string[];
}

function hasDateOverlap(startA: string, endA: string, startB: string, endB: string) {
  return !(endA < startB || endB < startA);
}

async function enforceNoRequestOverlap(params: {
  db: Pick<Prisma.TransactionClient, 'vacation'>;
  userId: string;
  dataInicio: string;
  dataFim: string;
  excludeVacationId?: string;
}) {
  const overlapping = await params.db.vacation.findFirst({
    where: {
      userId: params.userId,
      status: { in: ['PENDING', 'APPROVED'] },
      ...(params.excludeVacationId ? { id: { not: params.excludeVacationId } } : {}),
      dataInicio: { lte: params.dataFim },
      dataFim: { gte: params.dataInicio },
    },
    select: {
      id: true,
      requestType: true,
      dataInicio: true,
      dataFim: true,
      status: true,
    },
    orderBy: [{ dataInicio: 'asc' }],
  });

  if (!overlapping) {
    return;
  }

  const overlapType = describeVacationRequestType(overlapping.requestType);
  const overlapStatus = overlapping.status === 'APPROVED' ? 'aprovado' : 'pendente';
  throw new Error(
    `Conflito de período: já existe um pedido de ${overlapType} (${overlapStatus}) entre ${formatIsoDatePt(overlapping.dataInicio)} e ${formatIsoDatePt(overlapping.dataFim)}. Remove ou altera esse pedido antes de continuar.`,
  );
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

function resolveCompanyExtraScopeFromCountryAndState(params: {
  country: 'PT' | 'BR';
  brWorkState?: 'SP' | 'RS' | null;
}): CompanyExtraScope {
  if (params.country === 'PT') {
    return 'PT';
  }

  if (params.brWorkState === 'SP') {
    return 'BR_SP';
  }

  if (params.brWorkState === 'RS') {
    return 'BR_RS';
  }

  return 'BR';
}

function resolveApplicableCompanyExtraScopes(params: {
  country: 'PT' | 'BR';
  brWorkState?: 'SP' | 'RS' | null;
}) {
  const directScope = resolveCompanyExtraScopeFromCountryAndState(params);

  if (directScope === 'PT') {
    return ['ALL', 'PT'] as CompanyExtraScope[];
  }

  if (directScope === 'BR_SP') {
    return ['ALL', 'BR', 'BR_SP'] as CompanyExtraScope[];
  }

  if (directScope === 'BR_RS') {
    return ['ALL', 'BR', 'BR_RS'] as CompanyExtraScope[];
  }

  return ['ALL', 'BR'] as CompanyExtraScope[];
}

function isPastDateInCurrentYear(mmdd: string, year: number) {
  const today = new Date();
  const currentYear = today.getFullYear();
  if (year !== currentYear) {
    return false;
  }

  const [monthRaw, dayRaw] = mmdd.split('-');
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }

  const candidate = new Date(year, month - 1, day);
  candidate.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return candidate < today;
}

async function resolveConfiguredCompanyExtraDays(params: {
  year: number;
  country: 'PT' | 'BR';
  brWorkState?: 'SP' | 'RS' | null;
  localidade?: string | null;
}) {
  const currentYear = new Date().getFullYear();
  const allowLegacyFallback = params.year <= currentYear;
  const applicableScopes = resolveApplicableCompanyExtraScopes({
    country: params.country,
    brWorkState: params.brWorkState,
  });

  const dbDays = await prisma.vacationCompanyExtraDay.findMany({
    where: {
      scope: {
        in: applicableScopes,
      },
    },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    select: { date: true, label: true, scope: true },
  });

  const yearPrefix = `${params.year}-`;
  const scopedDays = dbDays.filter((item) => isIsoDate(item.date) && item.date.startsWith(yearPrefix));
  const legacyConfiguredDays = dbDays.filter((item) => /^\d{2}-\d{2}$/.test(item.date));

  const scopePriority = (scope: CompanyExtraScope) => {
    if (scope === 'BR_SP' || scope === 'BR_RS') {
      return 3;
    }
    if (scope === 'PT' || scope === 'BR') {
      return 2;
    }
    return 1;
  };

  const uniqueDaysMap = new Map<string, { label: string; priority: number }>();
  const registerDay = (date: string, label: string, scope: CompanyExtraScope) => {
    const current = uniqueDaysMap.get(date);
    const priority = scopePriority(scope);
    if (!current || priority >= current.priority) {
      uniqueDaysMap.set(date, { label, priority });
    }
  };

  if (scopedDays.length > 0) {
    for (const item of scopedDays) {
      registerDay(item.date, item.label || 'Dia dado pela empresa', item.scope as CompanyExtraScope);
    }

    return {
      source: 'configured' as const,
      days: Array.from(uniqueDaysMap.entries()).map(([date, value]) => ({ date, label: value.label })),
    };
  }

  if (legacyConfiguredDays.length > 0) {
    for (const item of legacyConfiguredDays) {
      registerDay(`${params.year}-${item.date}`, item.label || 'Dia dado pela empresa', item.scope as CompanyExtraScope);
    }

    return {
      source: 'configured' as const,
      days: Array.from(uniqueDaysMap.entries()).map(([date, value]) => ({ date, label: value.label })),
    };
  }

  if (allowLegacyFallback) {
    return {
      source: 'legacy' as const,
      days: buildLegacyCompanyExtraDays({ year: params.year, localidade: params.localidade }).map((date) => ({
        date,
        label: 'Dia dado pela empresa',
      })),
    };
  }

  return {
    source: 'configured' as const,
    days: [],
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

async function fetchHolidays(countryCode: 'PT' | 'BR', year: number, brWorkState?: 'SP' | 'RS' | null) {
  const stateCacheKey = countryCode === 'BR' ? brWorkState ?? 'ALL' : 'ALL';
  const cacheKey = `${countryCode}-${year}-${stateCacheKey}`;
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
  const brCountyCode = brWorkState ? `BR-${brWorkState}` : null;
  const filtered = payload.filter((holiday) => {
    if (countryCode === 'PT') {
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
    }

    if (holiday.global === true) {
      return true;
    }

    if (Array.isArray(holiday.counties) && holiday.counties.length > 0) {
      if (!brCountyCode) {
        return false;
      }
      return holiday.counties.includes(brCountyCode);
    }

    return holiday.global !== false;
  });

  holidaysCache.set(cacheKey, {
    expiresAt: now + HOLIDAYS_CACHE_TTL_MS,
    data: filtered,
  });

  return filtered;
}

async function collectHolidayDates(countryCode: 'PT' | 'BR', years: Iterable<number>, brWorkState?: 'SP' | 'RS' | null) {
  const holidayDates = new Set<string>();
  const yearList = Array.from(years);
  const holidaysByYear = await Promise.all(
    yearList.map((year) => fetchHolidays(countryCode, year, brWorkState)),
  );

  for (const holidays of holidaysByYear) {
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
  buildApprovalGroups,
  getPreviousApproverIdsForRejection,
};

function brVacationDaysByAbsences(absences: number) {
  if (absences <= 5) return 30;
  if (absences <= 14) return 24;
  if (absences <= 23) return 18;
  if (absences <= 32) return 12;
  return 0;
}

async function sumVacationBalanceCreditsByUser(params: { userIds: string[]; years: number[] }) {
  if (params.userIds.length === 0) {
    return new Map<string, number>();
  }

  const years = Array.from(new Set(params.years));
  if (years.length === 0) {
    return new Map<string, number>();
  }

  const credits = await prisma.vacationBalanceCredit.findMany({
    where: {
      userId: { in: params.userIds },
      year: { in: years },
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
  const header = `Novo pedido de ${describeVacationRequestType(params.requestType)} recebido.`;
  const requester = `Solicitado por: ${params.requesterName}.`;
  const type = `Tipo: ${describeVacationRequestType(params.requestType)}.`;
  const period = `Período: ${formatIsoDatePt(params.dataInicio)} até ${formatIsoDatePt(params.dataFim)}.`;
  const team = params.contextTeamName ? `Equipa: ${params.contextTeamName}.` : 'Equipa: sem contexto associado.';
  const notes = params.observacoes?.trim()
    ? `Observações: ${params.observacoes.trim().slice(0, 240)}.`
    : 'Observações: sem detalhes adicionais.';

  return [header, requester, type, period, team, notes, 'Ação: abre a área de aprovações para decidir.'].join('\n');
}

function buildApprovalGroups(params: {
  country: 'PT' | 'BR';
  primaryApproverIds: string[];
  rhApproverIds: string[];
}) {
  const primaryApproverIds = Array.from(new Set(params.primaryApproverIds));
  const rhApproverIds = Array.from(new Set(params.rhApproverIds)).filter((id) => !primaryApproverIds.includes(id));

  if (params.country === 'BR') {
    if (primaryApproverIds.length === 0 && rhApproverIds.length === 0) {
      return [] as Array<{ level: number; approverIds: string[] }>;
    }

    if (primaryApproverIds.length === 0) {
      return [{ level: 1, approverIds: rhApproverIds }];
    }

    if (rhApproverIds.length === 0) {
      return [{ level: 1, approverIds: primaryApproverIds }];
    }

    return [
      { level: 1, approverIds: primaryApproverIds },
      { level: 2, approverIds: rhApproverIds },
    ];
  }

  const approverIds = Array.from(new Set([...primaryApproverIds, ...rhApproverIds]));
  if (approverIds.length === 0) {
    return [] as Array<{ level: number; approverIds: string[] }>;
  }

  return [{ level: 1, approverIds }];
}

function getPreviousApproverIdsForRejection(
  approvals: Array<{ approverId: string; approvalLevel: number; status: string }>,
  reviewerId: string,
) {
  const rejectingStep = approvals.find((item) => item.approverId === reviewerId && item.status === APPROVAL_PENDING);
  if (!rejectingStep) {
    return [] as string[];
  }

  return Array.from(
    new Set(
      approvals
        .filter((item) => item.approvalLevel < rejectingStep.approvalLevel && item.status === APPROVAL_APPROVED)
        .map((item) => item.approverId)
        .filter((id) => id !== reviewerId),
    ),
  );
}

async function resolveApprovalGroups(userId: string, contextTeamId: string | null) {
  const requester = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      hasAccessTotal: true,
      accessTotalGrantedById: true,
      teamId: true,
      profile: { select: { workCountry: true } },
    },
  });

  if (!requester) {
    return [] as Array<{ level: number; approverIds: string[] }>;
  }

  const requesterCountry = requester.profile?.workCountry ?? 'PT';

  const requesterHasAccessTotal = Boolean(requester.hasAccessTotal);

  const activeMemberships = await prisma.teamMembership.findMany({
    where: { userId, isActive: true },
    select: { teamId: true },
  });

  const teamIds = Array.from(new Set<string>([
    ...activeMemberships.map((item) => item.teamId),
    ...(requester.teamId ? [requester.teamId] : []),
  ]));

  const primaryApproverIds = new Set<string>();
  const rhApproverIds = new Set<string>();

  function addApprover(target: Set<string>, id: string | null | undefined) {
    if (!id || id === userId) {
      return;
    }

    target.add(id);
  }

  async function addAccessTotalApprovers(target: Set<string>) {
    const users = await prisma.user.findMany({
      where: {
        id: { not: userId },
        isActive: true,
        OR: [{ isRootAccess: true }, { hasAccessTotal: true }],
        AND: [
          {
            OR: [
              {
                profile: {
                  workCountry: requesterCountry,
                },
              },
              {
                username: {
                  equals: 't.people',
                  mode: 'insensitive',
                },
              },
            ],
          },
        ],
      },
      select: {
        id: true,
        isRootAccess: true,
        hasAccessTotal: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const user of users) {
      if (requesterHasAccessTotal && user.hasAccessTotal && !user.isRootAccess) {
        const canReview = await canReviewAccessTotalHierarchy(user.id, userId);
        if (!canReview) {
          continue;
        }
      }

      addApprover(target, user.id);
    }
  }

  async function addTPeopleFallback(target: Set<string>) {
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
      addApprover(target, fallback.id);
      return;
    }

    await addAccessTotalApprovers(target);
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
          addApprover(primaryApproverIds, node.managerId);
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
      await addAccessTotalApprovers(requesterCountry === 'BR' ? rhApproverIds : primaryApproverIds);
    }

    if (requesterCountry === 'BR') {
      await addAccessTotalApprovers(rhApproverIds);

      if (rhApproverIds.size === 0) {
        await addTPeopleFallback(rhApproverIds);
      }
    }
  } else if (requester.hasAccessTotal) {
    addApprover(requesterCountry === 'BR' ? rhApproverIds : primaryApproverIds, requester.accessTotalGrantedById);

    if (primaryApproverIds.size === 0 && rhApproverIds.size === 0) {
      await addTPeopleFallback(requesterCountry === 'BR' ? rhApproverIds : primaryApproverIds);
    }
  } else {
    await addTPeopleFallback(requesterCountry === 'BR' ? rhApproverIds : primaryApproverIds);
  }

  const customApproverAssignments = await prisma.userPermission.findMany({
    where: {
      isEnabled: true,
      permission: {
        code: 'approve_vacation',
      },
      user: {
        OR: [
          {
            profile: {
              workCountry: requesterCountry,
            },
          },
          {
            username: {
              equals: 't.people',
              mode: 'insensitive',
            },
          },
        ],
      },
    },
    select: {
      userId: true,
      customRestrictions: true,
      user: {
        select: {
          isActive: true,
          hasAccessTotal: true,
          isRootAccess: true,
        },
      },
    },
  });

  for (const assignment of customApproverAssignments) {
    if (!assignment.user.isActive || assignment.userId === userId) {
      continue;
    }

    if (requesterHasAccessTotal && assignment.user.hasAccessTotal && !assignment.user.isRootAccess) {
      const canReview = await canReviewAccessTotalHierarchy(assignment.userId, userId);
      if (!canReview) {
        continue;
      }
    }

    const custom = parseApprovalCustomRestrictions(assignment.customRestrictions);
    if (custom.allowedUserIds.includes(userId)) {
      const targetApproverIds = requesterCountry === 'BR' && (assignment.user.hasAccessTotal || assignment.user.isRootAccess)
        ? rhApproverIds
        : primaryApproverIds;
      addApprover(targetApproverIds, assignment.userId);
    }
  }

  const activeApprovers = await prisma.user.findMany({
    where: {
      id: { in: Array.from(new Set([...primaryApproverIds, ...rhApproverIds])) },
      isActive: true,
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });

  const orderedPrimaryApproverIds = activeApprovers
    .map((user) => user.id)
    .filter((id) => id !== userId && primaryApproverIds.has(id));

  const orderedRhApproverIds = activeApprovers
    .map((user) => user.id)
    .filter((id) => id !== userId && rhApproverIds.has(id) && !primaryApproverIds.has(id));

  void contextTeamId;
  return buildApprovalGroups({
    country: requesterCountry,
    primaryApproverIds: orderedPrimaryApproverIds,
    rhApproverIds: orderedRhApproverIds,
  });
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

// ─── Absence override helpers ─────────────────────────────────────────────────

function addDaysToIso(dateStr: string, days: number): string {
  const parts = dateStr.split('-');
  const dt = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function dateRangesOverlap(s1: string, e1: string, s2: string, e2: string): boolean {
  return s1 <= e2 && e1 >= s2;
}

function computeVacationSplitSegments(
  vStart: string,
  vEnd: string,
  aStart: string,
  aEnd: string,
): Array<{ dataInicio: string; dataFim: string }> {
  const segments: Array<{ dataInicio: string; dataFim: string }> = [];
  if (vStart < aStart) {
    segments.push({ dataInicio: vStart, dataFim: addDaysToIso(aStart, -1) });
  }
  if (vEnd > aEnd) {
    segments.push({ dataInicio: addDaysToIso(aEnd, 1), dataFim: vEnd });
  }
  return segments;
}

async function applyAbsenceOverrideVacations(
  db: typeof prisma,
  absence: {
    id: string;
    userId: string;
    dataInicio: string;
    dataFim: string;
    contextTeamId?: string | null;
  },
) {
  const allVacations = await db.vacation.findMany({
    where: {
      userId: absence.userId,
      requestType: 'VACATION',
      status: { in: ['APPROVED', 'PENDING'] },
    },
    select: {
      id: true,
      userId: true,
      contextTeamId: true,
      dataInicio: true,
      dataFim: true,
      partialDay: true,
      observacoes: true,
      attachmentLink: true,
      status: true,
      reviewedById: true,
      reviewedAt: true,
      approvedByRole: true,
      versionNumber: true,
    },
  });

  const overlapping = allVacations.filter((v) =>
    dateRangesOverlap(v.dataInicio, v.dataFim, absence.dataInicio, absence.dataFim),
  );

  if (overlapping.length === 0) return;

  // Pre-fetch approval groups for PENDING vacations (outside tx - uses global prisma)
  const approvalGroupsCache = new Map<string, Array<{ level: number; approverIds: string[] }>>();
  for (const vacation of overlapping) {
    if (vacation.status !== 'PENDING') continue;
    const cacheKey = vacation.contextTeamId ?? '';
    if (!approvalGroupsCache.has(cacheKey)) {
      const groups = await resolveApprovalGroups(vacation.userId, vacation.contextTeamId);
      approvalGroupsCache.set(cacheKey, groups);
    }
  }

  await db.$transaction(async (tx) => {
    for (const vacation of overlapping) {
      const segments = computeVacationSplitSegments(
        vacation.dataInicio,
        vacation.dataFim,
        absence.dataInicio,
        absence.dataFim,
      );

      await tx.vacation.update({
        where: { id: vacation.id },
        data: {
          status: 'CANCELLED',
          reviewReason: `Anulado por ausência aprovada (${absence.dataInicio} a ${absence.dataFim}).`,
        },
      });

      for (const segment of segments) {
        if (vacation.status === 'APPROVED') {
          await tx.vacation.create({
            data: {
              userId: vacation.userId,
              contextTeamId: vacation.contextTeamId,
              dataInicio: segment.dataInicio,
              dataFim: segment.dataFim,
              partialDay: 'FULL',
              observacoes: vacation.observacoes,
              requestType: 'VACATION',
              attachmentLink: vacation.attachmentLink,
              status: 'APPROVED',
              reviewedById: vacation.reviewedById,
              reviewedAt: vacation.reviewedAt,
              reviewReason: `Reajustado automaticamente após ausência aprovada (${absence.dataInicio} a ${absence.dataFim}).`,
              approvedByRole: vacation.approvedByRole,
              versionOfId: vacation.id,
              versionNumber: (vacation.versionNumber ?? 1) + 1,
            },
          });
        } else {
          const cacheKey = vacation.contextTeamId ?? '';
          const approvalGroups = approvalGroupsCache.get(cacheKey) ?? [];
          if (approvalGroups.length === 0) continue;

          const newVacation = await tx.vacation.create({
            data: {
              userId: vacation.userId,
              contextTeamId: vacation.contextTeamId,
              dataInicio: segment.dataInicio,
              dataFim: segment.dataFim,
              partialDay: 'FULL',
              observacoes: vacation.observacoes,
              requestType: 'VACATION',
              attachmentLink: vacation.attachmentLink,
              status: 'PENDING',
              reviewReason: `Resubmetido automaticamente após ausência aprovada (${absence.dataInicio} a ${absence.dataFim}).`,
              versionOfId: vacation.id,
              versionNumber: (vacation.versionNumber ?? 1) + 1,
            },
          });

          for (const group of approvalGroups) {
            for (const approverId of group.approverIds) {
              await tx.vacationApproval.create({
                data: {
                  vacationId: newVacation.id,
                  approverId,
                  approvalLevel: group.level,
                  status: group.level === approvalGroups[0]!.level ? APPROVAL_PENDING : APPROVAL_WAITING,
                },
              });
            }
          }
        }
      }
    }
  });

  for (const vacation of overlapping) {
    const segments = computeVacationSplitSegments(
      vacation.dataInicio,
      vacation.dataFim,
      absence.dataInicio,
      absence.dataFim,
    );
    const verb = vacation.status === 'PENDING' ? 'resubmetidos' : 'reagendados';
    await db.notification.create({
      data: {
        userId: vacation.userId,
        title: 'Férias ajustadas por ausência aprovada',
        message:
          segments.length > 0
            ? [
                `As tuas férias de ${formatIsoDatePt(vacation.dataInicio)} a ${formatIsoDatePt(vacation.dataFim)} foram ajustadas devido a uma ausência aprovada.`,
                `Os dias não cobertos pela ausência foram ${verb} automaticamente.`,
              ].join('\n')
            : `As tuas férias de ${formatIsoDatePt(vacation.dataInicio)} a ${formatIsoDatePt(vacation.dataFim)} foram anuladas na totalidade pois a ausência cobre o mesmo período.`,
      },
    });
  }
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
    const pagination = parsePagination(req.query);
    const data = await getUserVacations(userId, pagination.skip, pagination.take);
    
    return res.json({
      ...data,
      page: pagination.page,
      pageSize: pagination.pageSize,
    });
  } catch (error) {
    console.error('[GET /vacations/me]', error);
    return res.status(500).json({ error: 'Falha ao carregar férias' });
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
      select: { workCountry: true, brWorkState: true },
    });

    const defaultScope = resolveCompanyExtraScopeFromCountryAndState({
      country: userProfile?.workCountry === 'BR' ? 'BR' : 'PT',
      brWorkState: userProfile?.brWorkState ?? null,
    });

    const rawScope = typeof req.query.scope === 'string' ? req.query.scope : '';
    const scope = companyExtraScopeValues.includes(rawScope as CompanyExtraScope)
      ? (rawScope as CompanyExtraScope)
      : defaultScope;

    const requestedYear = Number(req.query.year);
    const year = Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= 2100
      ? requestedYear
      : new Date().getFullYear();
    const currentYear = new Date().getFullYear();
    const allowLegacyFallback = year <= currentYear;

    const dbDays = await prisma.vacationCompanyExtraDay.findMany({
      where: { scope },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      select: { date: true, label: true },
    });

    const yearPrefix = `${year}-`;
    const scopedDays = dbDays
      .filter((item) => isIsoDate(item.date) && item.date.startsWith(yearPrefix))
      .map((item) => ({ date: item.date.slice(5), label: item.label || 'Dia dado pela empresa' }));
    const legacyConfiguredDays = dbDays
      .filter((item) => /^\d{2}-\d{2}$/.test(item.date))
      .map((item) => ({ date: item.date, label: item.label || 'Dia dado pela empresa' }));

    const scopeUsesLegacyFallback = allowLegacyFallback;
    const source = scopedDays.length > 0 || legacyConfiguredDays.length > 0
      ? 'configured'
      : scopeUsesLegacyFallback
        ? 'legacy'
        : 'configured';
    const days = scopedDays.length > 0
      ? scopedDays
      : legacyConfiguredDays.length > 0
        ? legacyConfiguredDays
        : scopeUsesLegacyFallback
          ? buildLegacyCompanyExtraDays({ year, localidade: null }).map((fullDate) => ({
              date: fullDate.slice(5),
              label: 'Dia dado pela empresa',
            }))
          : [];

    return res.json({ scope, year, source, days });
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
      select: { workCountry: true, brWorkState: true },
    });

    const defaultScope = resolveCompanyExtraScopeFromCountryAndState({
      country: userProfile?.workCountry === 'BR' ? 'BR' : 'PT',
      brWorkState: userProfile?.brWorkState ?? null,
    });

    const scope = payload.scope ?? defaultScope;
    const year = payload.year ?? new Date().getFullYear();

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

    const yearPrefix = `${year}-`;

    const pastDatesInCurrentYear = uniqueDays
      .map((item) => item.date)
      .filter((date) => isPastDateInCurrentYear(date, year));

    if (pastDatesInCurrentYear.length > 0) {
      return res.status(400).json({
        message: 'Para o ano atual, só é possível configurar dias automáticos a partir de hoje. Seleciona o próximo ano para datas passadas.',
      });
    }

    await prisma.$transaction(async (tx) => {
      // Replace only this year's scoped config, preserving other years and legacy records.
      await tx.vacationCompanyExtraDay.deleteMany({ where: { scope, date: { startsWith: yearPrefix } } });

      if (uniqueDays.length > 0) {
        await tx.vacationCompanyExtraDay.createMany({
          data: uniqueDays.map((item) => ({
            scope,
            date: `${yearPrefix}${item.date}`,
            label: item.label,
            createdById: req.authUser!.id,
          })),
        });
      }
    });

    return res.json({ scope, year, source: 'configured', days: uniqueDays });
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
      brWorkState: profile?.brWorkState ?? null,
      localidade: profile?.localidade,
    });

    if (country === 'PT') {
      const ptEntitlement = resolvePtBaseEntitlementForYear(profile?.dataInicioContrato ?? null, currentYear);
      const approvedVacationDays = vacations
        .filter((item) => item.status === 'APPROVED' && item.requestType === 'VACATION')
        .reduce((sum, item) => sum + vacationDaysForMetrics(item, holidayDates), 0);
      const pendingVacationDays = vacations
        .filter((item) => item.status === 'PENDING' && item.requestType === 'VACATION')
        .reduce((sum, item) => sum + vacationDaysForMetrics(item, holidayDates), 0);
      const approvedAbsenceDays = vacations
        .filter((item) => item.status === 'APPROVED' && item.requestType !== 'VACATION')
        .reduce((sum, item) => sum + vacationDaysForMetrics(item, holidayDates), 0);
      const pendingAbsenceDays = vacations
        .filter((item) => item.status === 'PENDING' && item.requestType !== 'VACATION')
        .reduce((sum, item) => sum + vacationDaysForMetrics(item, holidayDates), 0);

      return res.json({
        country: 'PT',
        year: currentYear,
        rules: {
          baseDays: ptEntitlement.baseEntitledDays,
          extraDays: companyExtraDays.days.map((item) => `${formatIsoDatePt(item.date)}${item.label ? ` (${item.label})` : ''}`),
          mandatoryConsecutiveDays: 10,
          carryOver: true,
          maxTeamShare: '1/3',
        },
        approvedVacationDays,
        pendingVacationDays,
        approvedAbsenceDays,
        pendingAbsenceDays,
        calculation: {
          entitledDays: ptEntitlement.baseEntitledDays + extraBalanceDays,
          baseEntitledDays: ptEntitlement.baseEntitledDays,
          extraBalanceDays,
          monthsWorked: ptEntitlement.monthsInFirstContractYear,
          acquisitionComplete: !ptEntitlement.isFirstYearProportional,
        },
      });
    }

    const hireDate = profile?.dataInicioContrato ? new Date(`${profile.dataInicioContrato}T00:00:00`) : new Date(`${currentYear}-01-01T00:00:00`);
    const now = new Date();
    const monthsWorked = (now.getFullYear() - hireDate.getFullYear()) * 12 + (now.getMonth() - hireDate.getMonth());
    const acquisitionComplete = monthsWorked >= 12;
    const unjustifiedAbsences = profile?.unjustifiedAbsences ?? 0;
    const isInternUser = profile?.isIntern ?? false;
    // Interns: 30 days per 12 months (2.5/month), unlocked after completing 12 months
    const internProportionalDays = Math.min(30, Math.floor(monthsWorked * 2.5));
    const baseEntitledDays = isInternUser
      ? (monthsWorked < 12 ? 0 : internProportionalDays)
      : brVacationDaysByAbsences(unjustifiedAbsences);
    const entitledDays = baseEntitledDays + extraBalanceDays;
    const soldVacationDays = (profile as { soldVacationDays?: number } | null)?.soldVacationDays ?? 0;
    const availableEntitledDays = Math.max(entitledDays - soldVacationDays, 0);
    const approvedVacationDays = vacations
      .filter((item) => item.status === 'APPROVED' && item.requestType === 'VACATION')
      .reduce((sum, item) => sum + vacationDaysForMetrics(item, holidayDates), 0);
    const pendingVacationDays = vacations
      .filter((item) => item.status === 'PENDING' && item.requestType === 'VACATION')
      .reduce((sum, item) => sum + vacationDaysForMetrics(item, holidayDates), 0);
    const approvedAbsenceDays = vacations
      .filter((item) => item.status === 'APPROVED' && item.requestType !== 'VACATION')
      .reduce((sum, item) => sum + vacationDaysForMetrics(item, holidayDates), 0);
    const pendingAbsenceDays = vacations
      .filter((item) => item.status === 'PENDING' && item.requestType !== 'VACATION')
      .reduce((sum, item) => sum + vacationDaysForMetrics(item, holidayDates), 0);

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
      approvedVacationDays,
      pendingVacationDays,
      approvedAbsenceDays,
      pendingAbsenceDays,
      calculation: {
        monthsWorked,
        acquisitionComplete,
        unjustifiedAbsences,
        baseEntitledDays,
        extraBalanceDays,
        entitledDays,
        soldVacationDays,
        availableEntitledDays,
        maxSellableDays: Math.min(10, Math.floor(entitledDays / 3)),
      },
    });
  } catch (error) {
    console.error('[GET /vacations/overview]', error);
    return res.status(500).json({ error: 'Falha ao carregar visão geral de férias.' });
  }
});

router.get('/vacations/calendar', requireAuth, async (req: Request, res: Response) => {
  try {
    const actorUserId = req.authUser!.id;
    const year = Number(typeof req.query.year === 'string' ? req.query.year : new Date().getFullYear());
    const actorIsFullAccess = await isAccessTotal(actorUserId);
    let targetUserId = actorUserId;
    const requestedTargetUserId = typeof req.query.targetUserId === 'string' ? req.query.targetUserId.trim() : '';

    if (requestedTargetUserId && requestedTargetUserId !== actorUserId) {
      if (!req.authUser!.isRootAccess && !actorIsFullAccess) {
        return res.status(403).json({ error: 'Só utilizadores com acesso total podem consultar o calendário de outros colaboradores.' });
      }

      const targetUser = await prisma.user.findUnique({
        where: { id: requestedTargetUserId },
        select: {
          id: true,
          isActive: true,
          hasAccessTotal: true,
        },
      });

      if (!targetUser || !targetUser.isActive) {
        return res.status(404).json({ error: 'Colaborador alvo não encontrado ou inativo.' });
      }

      if (targetUser.hasAccessTotal && !req.authUser!.isRootAccess) {
        const canReview = await canReviewAccessTotalHierarchy(actorUserId, targetUser.id);
        if (!canReview) {
          return res.status(403).json({ error: 'Não podes consultar o calendário de utilizadores acima de ti na hierarquia de acesso total.' });
        }
      }

      targetUserId = targetUser.id;
    }

    const [profile, vacations] = await Promise.all([
      prisma.profile.findUnique({ where: { userId: targetUserId } }),
      prisma.vacation.findMany({ where: { userId: targetUserId } }),
    ]);

    const country = profile?.workCountry ?? 'PT';
    const holidays = await fetchHolidays(country, year);
    const holidayDates = new Set(holidays.map((item) => item.date));
    const companyExtraDays = await resolveConfiguredCompanyExtraDays({
      year,
      country,
      brWorkState: profile?.brWorkState ?? null,
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
    const actorUserId = req.authUser!.id;
    const validation = vacationSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: validation.error.issues[0].message });
    }

    const data = validation.data;
    const actorIsFullAccess = await isAccessTotal(actorUserId);

    let targetUserId = actorUserId;
    let directApproveByAccessTotal = false;
    const requestedTargetUserId = typeof data.targetUserId === 'string' ? data.targetUserId.trim() : '';

    if (requestedTargetUserId && requestedTargetUserId !== actorUserId) {
      if (!req.authUser!.isRootAccess && !actorIsFullAccess) {
        return res.status(403).json({ error: 'Só utilizadores com acesso total podem registar pedidos para outros colaboradores.' });
      }

      const targetUser = await findVacationTargetUserById(requestedTargetUserId);

      if (!targetUser || !targetUser.isActive) {
        return res.status(404).json({ error: 'Colaborador alvo não encontrado ou inativo.' });
      }

      if (targetUser.hasAccessTotal && !req.authUser!.isRootAccess) {
        const canReview = await canReviewAccessTotalHierarchy(actorUserId, targetUser.id);
        if (!canReview) {
          return res.status(403).json({ error: 'Não podes registar pedidos para utilizadores acima de ti na hierarquia de acesso total.' });
        }
      }

      targetUserId = targetUser.id;
      directApproveByAccessTotal = true;
    }

    const contextTeamId = await resolveContextTeamId(targetUserId, data.contextTeamId);

    const profile = await findVacationCreateProfile(targetUserId);
    const country = profile?.workCountry ?? 'PT';

    await enforceVacationBusinessDays({
      requestType: data.requestType,
      dataInicio: data.dataInicio,
      dataFim: data.dataFim,
      country,
    });

    const approvalGroups = directApproveByAccessTotal ? [] : await resolveApprovalGroups(targetUserId, contextTeamId);
    if (!directApproveByAccessTotal && approvalGroups.length === 0) {
      return res.status(400).json({ error: 'Não existem aprovadores configurados para esta equipa.' });
    }

    const { vacation, policyWarnings } = await createVacationRequestTransaction({
      actorUserId,
      targetUserId,
      contextTeamId,
      directApproveByAccessTotal,
      approvalGroups,
      data: {
        dataInicio: data.dataInicio,
        dataFim: data.dataFim,
        observacoes: data.observacoes,
        requestType: data.requestType,
        partialDay: data.partialDay,
        attachmentLink: data.attachmentLink,
      },
      beforeCreate: async (tx) => {
        await enforceNoRequestOverlap({
          db: tx,
          userId: targetUserId,
          dataInicio: data.dataInicio,
          dataFim: data.dataFim,
        });

        const warnings = await validateVacationCountryPolicy({
          db: tx,
          userId: targetUserId,
          country,
          brWorkState: profile?.brWorkState ?? null,
          requestType: data.requestType,
          dataInicio: data.dataInicio,
          dataFim: data.dataFim,
          partialDay: data.partialDay,
          dataInicioContrato: profile?.dataInicioContrato || null,
          isIntern: profile?.isIntern ?? false,
        });

        if (data.requestType === 'VACATION' && contextTeamId) {
          await acquireTeamCapacityLock(tx, contextTeamId);
          await enforceOneThirdCapacity(tx, contextTeamId, country, data.dataInicio, data.dataFim, data.partialDay);
        }

        return warnings;
      },
    });

    if (directApproveByAccessTotal && data.requestType !== 'VACATION') {
      await applyAbsenceOverrideVacations(prisma, {
        id: vacation.id,
        userId: targetUserId,
        dataInicio: data.dataInicio,
        dataFim: data.dataFim,
        contextTeamId,
      });
    }

    if (!directApproveByAccessTotal && approvalGroups.length > 0) {
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

    if (directApproveByAccessTotal && targetUserId !== actorUserId) {
      await prisma.notification.create({
        data: {
          userId: targetUserId,
          title: data.requestType === 'VACATION' ? 'Férias registadas diretamente' : 'Ausência registada diretamente',
          message: [
            `Foi registado um pedido de ${describeVacationRequestType(data.requestType)} por utilizador com acesso total.`,
            `Período: ${formatIsoDatePt(data.dataInicio)} até ${formatIsoDatePt(data.dataFim)}.`,
            'Estado: aprovado diretamente (sem fluxo de aprovação).',
          ].join('\n'),
        },
      });
    }

    res.status(201).json({
      ...vacation,
      warnings: policyWarnings,
      bypassedApproval: directApproveByAccessTotal,
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
    const result = await assignVacationBalanceCredit({
      actorId,
      actorLabel: req.authUser!.username,
      year: data.year,
      days: data.days,
      reason: data.reason,
      targetUserIds: data.userIds,
      validateTargetAccess: req.authUser!.isRootAccess
        ? undefined
        : async (targetUserId) => canAccessUserByPermission(actorId, 'manage_vacation_rules', targetUserId),
    });

    if (!result.ok) {
      if (result.code === 'TARGET_NOT_FOUND' || result.code === 'TARGET_INACTIVE') {
        return res.status(404).json({ error: result.message });
      }

      if (result.code === 'TARGET_PROTECTED') {
        return res.status(400).json({ error: result.message });
      }

      return res.status(403).json({ error: result.message });
    }

    return res.status(201).json({ count: result.createdCount, items: result.createdItems });
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
  const pagination = parsePagination(req.query);

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
  const actorHasAccessTotal = Boolean(req.authUser!.isRootAccess || isFullAccess);
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
          hasAccessTotal: true,
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

  const filteredPendingByStep: typeof pendingByStep = [];
  for (const request of pendingByStep) {
    const hasMyPendingStep = request.approvals.some((item) => item.approverId === userId && item.status === APPROVAL_PENDING);
    const isBrRegularCollaborator = request.user.profile?.workCountry === 'BR' && request.user.role === 'COLABORADOR';

    // BR (colaborador normal): o pedido só deve aparecer a cada aprovador quando a etapa dele estiver ativa.
    if (isBrRegularCollaborator && !req.authUser!.isRootAccess && !hasMyPendingStep) {
      continue;
    }

    if (actorHasAccessTotal && request.user.hasAccessTotal && !req.authUser!.isRootAccess && !hasMyPendingStep) {
      const canReview = await canReviewAccessTotalHierarchy(userId, request.userId);
      if (!canReview) {
        continue;
      }
    }

    filteredPendingByStep.push(request);
  }

  const pagedRows = filteredPendingByStep.slice(
    pagination.skip,
    pagination.skip + pagination.take,
  );

  timer.done({ count: filteredPendingByStep.length, page: pagination.page });
  return res.json({
    total: filteredPendingByStep.length,
    page: pagination.page,
    pageSize: pagination.pageSize,
    rows: pagedRows,
  });
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
      observacoes: true,
      dataInicio: true,
      dataFim: true,
      contextTeamId: true,
      partialDay: true,
      user: {
        select: {
          id: true,
          username: true,
          hasAccessTotal: true,
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

  if (isFullAccess && vacation.user.hasAccessTotal && !req.authUser!.isRootAccess && !canApproveByStep && !canApproveByException) {
    const canReview = await canReviewAccessTotalHierarchy(userId, vacation.userId);
    if (!canReview) {
      return res.status(403).json({ message: 'Não podes aprovar pedidos de utilizadores com acesso total no mesmo nível hierárquico.' });
    }
  }

  const canApproveWithinRestrictions = req.authUser!.isRootAccess
    || isFullAccess
    || await canAccessUserByPermission(userId, 'approve_vacation', vacation.userId);

  if (!canApproveWithinRestrictions && !canApproveByException && !canApproveByStep) {
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
        userId: true,
        requestType: true,
        contextTeamId: true,
        dataInicio: true,
        dataFim: true,
        partialDay: true,
      },
    });

    if (currentVacation) {
      await enforceNoRequestOverlap({
        db: tx,
        userId: currentVacation.userId,
        dataInicio: currentVacation.dataInicio,
        dataFim: currentVacation.dataFim,
        excludeVacationId: currentVacation.id,
      });
    }

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
            `Resultado: ${describeVacationRequestType(refreshedVacation.requestType)} aprovado.`,
            `Período: ${formatIsoDatePt(refreshedVacation.dataInicio)} até ${formatIsoDatePt(refreshedVacation.dataFim)}.`,
            `Decisor final: ${actorLabel}.`,
            'Ação: consulta o teu mapa de férias para confirmar o impacto no saldo.',
          ].join('\n')
        : [
            `${actorLabel} aprovou a etapa atual do pedido de ${describeVacationRequestType(refreshedVacation.requestType)}.`,
            `Progresso: ${approvedApprovals}/${Math.max(totalApprovals, 1)} aprovações concluídas.`,
            `Período: ${formatIsoDatePt(refreshedVacation.dataInicio)} até ${formatIsoDatePt(refreshedVacation.dataFim)}.`,
            'Ação: acompanha o estado na área de férias.',
          ].join('\n'),
    },
  });

  if (
    refreshedVacation.status === 'APPROVED' &&
    refreshedVacation.requestType !== 'VACATION'
  ) {
    await applyAbsenceOverrideVacations(prisma, {
      id: refreshedVacation.id,
      userId: refreshedVacation.userId,
      dataInicio: refreshedVacation.dataInicio,
      dataFim: refreshedVacation.dataFim,
    });

    if (isFolgaAbsenceForHourBank(vacation.requestType, vacation.observacoes)) {
      const debitHours = calculateHourBankDebitFromAbsence(vacation.dataInicio, vacation.dataFim);

      if (debitHours > 0) {
        const profile = await prisma.profile.findUnique({
          where: { userId: vacation.userId },
          select: {
            workCountry: true,
            hourBankLimitHours: true,
          },
        });

        if ((profile?.workCountry ?? 'PT') === 'BR') {
          await appendHourBankEntry({
            prisma,
            userId: vacation.userId,
            createdById: req.authUser!.id,
            type: 'DEBIT',
            hours: debitHours,
            reason: `Débito automático por folga aprovada (${vacation.dataInicio} a ${vacation.dataFim}).`,
            source: 'AUTO_FOLGA_APPROVAL',
          });

          const totals = await getHourBankTotalsByUserId(prisma, vacation.userId, resolveBrHourBankLimit(profile?.hourBankLimitHours));

          const [leaderIds, accessTotalIds] = await Promise.all([
            resolveLeadershipRecipientsForUser(prisma, vacation.userId),
            resolveAccessTotalRecipientIds(prisma),
          ]);

          const leaderIdsBr = await filterUserIdsByWorkCountry(prisma, leaderIds, 'BR');

          await notifyHourBankExceedance({
            prisma,
            userId: vacation.userId,
            username: vacation.user.username,
            limitHours: totals.limitHours,
            totalHours: totals.totalHours,
            exceededByHours: totals.exceededByHours,
            leaderIds: leaderIdsBr,
            accessTotalIds,
          });
        }
      }
    }
  }

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
  const reason = typeof validation.data.reason === 'string' ? validation.data.reason.trim() : '';

  if (!reason) {
    return res.status(400).json({ message: 'Motivo da rejeição é obrigatório.' });
  }

  const vacation = await prisma.vacation.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          hasAccessTotal: true,
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

  if (isFullAccess && vacation.user.hasAccessTotal && !req.authUser!.isRootAccess && !canRejectByStep && !canRejectByException) {
    const canReview = await canReviewAccessTotalHierarchy(userId, vacation.userId);
    if (!canReview) {
      return res.status(403).json({ message: 'Não podes recusar pedidos de utilizadores com acesso total no mesmo nível hierárquico.' });
    }
  }

  const canRejectWithinRestrictions = req.authUser!.isRootAccess
    || isFullAccess
    || await canAccessUserByPermission(userId, 'reject_vacation', vacation.userId);

  if (!canRejectWithinRestrictions && !canRejectByException && !canRejectByStep) {
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
        `Resultado: pedido de ${describeVacationRequestType(vacation.requestType as 'VACATION' | 'ABSENCE_MEDICAL' | 'ABSENCE_TRAINING')} recusado.`,
        `Período: ${formatIsoDatePt(vacation.dataInicio)} até ${formatIsoDatePt(vacation.dataFim)}.`,
        `Motivo: ${reason}`,
        `Decisor: ${req.authUser?.username || 'Aprovador'}.`,
        'Ação: ajusta o pedido e submete uma nova versão se necessário.',
      ].join('\n'),
    },
  });

  const previousApproverIds = getPreviousApproverIdsForRejection(vacation.approvals, req.authUser!.id);
  if (previousApproverIds.length > 0) {
    await notifyUsers(
      prisma,
      previousApproverIds,
      vacation.requestType === 'VACATION' ? 'Pedido de férias recusado após revisão RH' : 'Pedido de ausência recusado após revisão RH',
      [
        `O pedido de ${describeVacationRequestType(vacation.requestType as 'VACATION' | 'ABSENCE_MEDICAL' | 'ABSENCE_TRAINING')} de ${formatIsoDatePt(vacation.dataInicio)} até ${formatIsoDatePt(vacation.dataFim)} foi recusado numa etapa posterior.`,
        `Motivo: ${reason}`,
        `Decisor: ${req.authUser?.username || 'Aprovador'}.`,
        'Ação: acompanha o colaborador caso seja necessária nova submissão.',
      ].join('\n'),
    );
  }

  return res.json({ success: true });
});

router.post('/vacations/:id/mark-processado', requireAuth, async (req: Request, res: Response) => {
  const userId = req.authUser!.id;
  const [isFullAccess, canManageVacations] = await Promise.all([
    isAccessTotal(userId),
    hasPermission(userId, 'manage_vacation_rules'),
  ]);

  if (!isFullAccess && !canManageVacations && !req.authUser!.isRootAccess) {
    return res.status(403).json({ message: 'Sem permissões para marcar férias como processado.' });
  }

  const id = typeof req.params.id === 'string' ? req.params.id : '';

  const vacation = await prisma.vacation.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      userId: true,
      processadoAt: true,
      dataInicio: true,
      dataFim: true,
    },
  });

  if (!vacation) {
    return res.status(404).json({ message: 'Pedido de férias não encontrado.' });
  }

  if (vacation.status !== 'APPROVED') {
    return res.status(400).json({ message: 'Apenas pedidos aprovados podem ser marcados como processado.' });
  }

  if (vacation.processadoAt) {
    return res.status(400).json({ message: 'Este pedido já foi marcado como processado.' });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.vacation.update({
      where: { id },
      data: {
        processadoAt: new Date(),
        processadoById: userId,
      },
    });

    await tx.notification.create({
      data: {
        userId: vacation.userId,
        title: 'Férias processadas',
        message: `Tuas férias de ${formatIsoDatePt(vacation.dataInicio)} até ${formatIsoDatePt(vacation.dataFim)} foram marcadas como processadas. Confirmação de realização será solicitada após o período.`,
      },
    });

    return result;
  });

  return res.json({ success: true, data: updated });
});

router.post('/vacations/:id/mark-realizado', requireAuth, async (req: Request, res: Response) => {
  const userId = req.authUser!.id;
  const id = typeof req.params.id === 'string' ? req.params.id : '';

  const vacation = await prisma.vacation.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      userId: true,
      dataFim: true,
      realizadoByIds: true,
      processadoAt: true,
    },
  });

  if (!vacation) {
    return res.status(404).json({ message: 'Pedido de férias não encontrado.' });
  }

  if (vacation.status !== 'APPROVED') {
    return res.status(400).json({ message: 'Apenas pedidos aprovados podem ser marcados como realizado.' });
  }

  if (!vacation.processadoAt) {
    return res.status(400).json({ message: 'Este pedido ainda não foi processado. Aguarde confirmação de pagamento da RH.' });
  }

  // Dual-confirm logic: first collaborator confirms, then RH validates
  const realizadoByIds: string[] = vacation.realizadoByIds ? JSON.parse(vacation.realizadoByIds as any) : [];
  const isCollaboratorConfirm = vacation.userId === userId;
  const isRHConfirm = !isCollaboratorConfirm && (req.authUser!.isRootAccess || await isAccessTotal(userId));

  if (!isCollaboratorConfirm && !isRHConfirm) {
    return res.status(403).json({ message: 'Sem permissões para confirmar realização.' });
  }

  if (realizadoByIds.includes(userId)) {
    return res.status(400).json({ message: 'Tu já confirmaste a realização deste período.' });
  }

  realizadoByIds.push(userId);

  const isFullyConfirmed = realizadoByIds.length >= 2; // Both collab and RH

  const updated = await prisma.vacation.update({
    where: { id },
    data: {
      realizadoByIds: JSON.stringify(realizadoByIds),
      ...(isFullyConfirmed ? { realizadoAt: new Date() } : {}),
    },
  });

  if (isCollaboratorConfirm) {
    // Notify RH to validate
    const rhUsers = await prisma.user.findMany({
      where: {
        isActive: true,
        OR: [{ isRootAccess: true }, { hasAccessTotal: true }],
      },
      select: { id: true },
    });

    const recipientIds = rhUsers.map((rh) => rh.id).filter((rhId) => rhId !== vacation.userId);
    if (recipientIds.length > 0) {
      await prisma.notification.createMany({
        data: recipientIds.map((recipientId) => ({
          userId: recipientId,
          title: 'Confirmação de realização de férias pendente',
          message: `O colaborador confirmou que realizou as suas férias. Favor validar a realização.`,
        })),
      });
    }
  } else if (isRHConfirm && isFullyConfirmed) {
    // Notify collaborator that vacation is fully confirmed
    await prisma.notification.create({
      data: {
        userId: vacation.userId,
        title: 'Férias validadas',
        message: 'Tuas férias foram validadas e finalizadas. Obrigado!',
      },
    });
  }

  return res.json({ success: true, data: updated, fully_confirmed: isFullyConfirmed });
});

// ─── BR: Venda de férias (abono de férias) ─────────────────────────────────
router.post('/vacations/sell-days', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.id;
    const { days } = req.body as { days: unknown };

    if (typeof days !== 'number' || !Number.isInteger(days) || days < 0) {
      return res.status(400).json({ error: 'Campo "days" deve ser um número inteiro não negativo.' });
    }

    const result = await sellVacationDays({ userId, days });

    if (!result.ok) {
      return res.status(400).json({ error: result.message });
    }

    return res.json(result);
  } catch (error) {
    console.error('[POST /vacations/sell-days]', error);
    return res.status(500).json({ error: 'Falha ao processar venda de dias de férias.' });
  }
});

router.put('/vacations/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.id;
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    const validation = vacationSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: validation.error.issues[0].message });
    }

    const existing = await findVersionableVacationByIdAndUser(id, userId);

    if (!existing) {
      return res.status(404).json({ error: 'Pedido não encontrado para versionamento.' });
    }

    const data = validation.data;
    const contextTeamId = await resolveContextTeamId(userId, data.contextTeamId || existing.contextTeamId || undefined);

    const profile = await findVacationVersionProfile(userId);
    const country = profile?.workCountry ?? 'PT';

    // BR: alterações de férias devem ser feitas com pelo menos 10 dias de antecedência
    if (country === 'BR' && data.requestType === 'VACATION') {
      const existingStart = toLocalDate(existing.dataInicio);
      const todayForNotice = new Date();
      todayForNotice.setHours(0, 0, 0, 0);
      const daysUntilStart = Math.floor((existingStart.getTime() - todayForNotice.getTime()) / (1000 * 60 * 60 * 24));
      if (daysUntilStart < 10) {
        return res.status(400).json({ error: 'Política BR: alterações de férias devem ser feitas com pelo menos 10 dias de antecedência em relação ao início das férias existentes.' });
      }
    }

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
    const maxVersionNumber = await findMaxVacationVersionNumber(rootId);

    let policyWarnings: string[] = [];
    const created = await versionVacationRequest({
      existingVacationId: existing.id,
      rootId,
      maxVersionNumber,
      userId,
      contextTeamId,
      approvalGroups,
      data,
      beforePersist: async (tx) => {
        await enforceNoRequestOverlap({
          db: tx,
          userId,
          dataInicio: data.dataInicio,
          dataFim: data.dataFim,
          excludeVacationId: id,
        });

        policyWarnings = await validateVacationCountryPolicy({
          db: tx,
          userId,
          country,
          brWorkState: profile?.brWorkState ?? null,
          requestType: data.requestType,
          dataInicio: data.dataInicio,
          dataFim: data.dataFim,
          partialDay: data.partialDay,
          excludeVacationId: id,
          dataInicioContrato: profile?.dataInicioContrato || null,
          isIntern: profile?.isIntern ?? false,
        });

        if (data.requestType === 'VACATION' && contextTeamId) {
          await acquireTeamCapacityLock(tx, contextTeamId);
          await enforceOneThirdCapacity(tx, contextTeamId, country, data.dataInicio, data.dataFim, data.partialDay, id);
        }
      },
    });

    const requesterProfile = await findVacationRequesterProfile(userId);

    const contextTeam = created.contextTeamId
      ? await findTeamNameById(created.contextTeamId)
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

    const result = await cancelVacationForOwner({
      vacationId: id,
      userId,
    });

    if (!result.cancelled) {
      return res.status(404).json({ error: 'Pedido não encontrado ou já processado.' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[DELETE /vacations/:id]', error);
    res.status(500).json({ error: 'Falha ao remover pedido.' });
  }
});

// ---------------------------------------------------------------------------
// GET /vacations/export  - Mapa de Férias (XLSX)
// Accessible to users with isAccessTotal or isRootAccess
// Query params:
// - year (optional)
// - startDate/endDate (optional pair, YYYY-MM-DD)
// - teamId (optional)
// - userIds (optional, comma-separated)
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

    const rawTeamIdQuery = typeof req.query.teamId === 'string' ? req.query.teamId.trim() : '';
    if (rawTeamIdQuery && !/^[A-Za-z0-9-]{6,80}$/.test(rawTeamIdQuery)) {
      return res.status(400).json({ message: 'teamId inválido.' });
    }

    const rawUserIdsQuery = typeof req.query.userIds === 'string' ? req.query.userIds.trim() : '';
    let userIdsFilter: string[] | null = null;
    if (rawUserIdsQuery) {
      const parsedUserIds = rawUserIdsQuery
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

      if (parsedUserIds.length === 0) {
        return res.status(400).json({ message: 'userIds inválido.' });
      }

      if (parsedUserIds.length > 500) {
        return res.status(400).json({ message: 'Número máximo de userIds excedido (500).' });
      }

      const invalidUserId = parsedUserIds.find((item) => !/^[A-Za-z0-9-]{6,80}$/.test(item));
      if (invalidUserId) {
        return res.status(400).json({ message: 'userIds inválido.' });
      }

      userIdsFilter = Array.from(new Set(parsedUserIds));
    }

    const teamIdFilter = rawTeamIdQuery || null;

    const yearQuery = typeof req.query.year === 'string' ? req.query.year : '';
    const startDateQuery = typeof req.query.startDate === 'string' ? req.query.startDate.trim() : '';
    const endDateQuery = typeof req.query.endDate === 'string' ? req.query.endDate.trim() : '';

    const usingCustomPeriod = startDateQuery.length > 0 || endDateQuery.length > 0;

    let periodStart: string;
    let periodEnd: string;
    let periodLabel: string;

    if (usingCustomPeriod) {
      if (!startDateQuery || !endDateQuery) {
        return res.status(400).json({ message: 'Para período personalizado, indica data inicial e final.' });
      }

      if (!isIsoDate(startDateQuery) || !isIsoDate(endDateQuery)) {
        return res.status(400).json({ message: 'Formato de data inválido. Usa YYYY-MM-DD.' });
      }

      if (startDateQuery > endDateQuery) {
        return res.status(400).json({ message: 'A data final deve ser igual ou posterior à data inicial.' });
      }

      periodStart = startDateQuery;
      periodEnd = endDateQuery;
      periodLabel = `${formatIsoDatePt(periodStart)} - ${formatIsoDatePt(periodEnd)}`;
    } else {
      const year = Number(yearQuery || new Date().getFullYear());
      if (!Number.isFinite(year) || year < 2000 || year > 2100) {
        return res.status(400).json({ message: 'Ano inválido.' });
      }

      periodStart = `${year}-01-01`;
      periodEnd = `${year}-12-31`;
      periodLabel = String(year);
    }

    const yearsInPeriod: number[] = [];
    for (let year = extractYearFromIsoDate(periodStart); year <= extractYearFromIsoDate(periodEnd); year += 1) {
      yearsInPeriod.push(year);
    }

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
    const countriesNeeded = Array.from(new Set(users.map((u) => u.profile?.workCountry ?? 'PT')));
    const holidaysPairs = await Promise.all(
      countriesNeeded.map(async (country) => [country, await collectHolidayDates(country as 'PT' | 'BR', yearsInPeriod)] as const),
    );
    const holidaysByCountry = new Map<string, Set<string>>(holidaysPairs);

    // Fetch approved vacations that overlap the requested period
    const allVacations = await prisma.vacation.findMany({
      where: {
        userId: { in: users.map((u) => u.id) },
        status: 'APPROVED',
        requestType: 'VACATION',
        dataInicio: { lte: periodEnd },
        dataFim: { gte: periodStart },
      },
      select: {
        id: true,
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
      years: yearsInPeriod,
    });

    const rows: Array<{
      username: string;
      nome: string;
      equipa: string;
      pais: 'PT' | 'BR';
      periodoInicio: string;
      periodoFim: string;
      diasBase: number;
      diasExtra: number;
      diasAprovados: number;
      saldo: number;
      pedidosAprovados: number;
      periodos: string;
    }> = [];

    const detailRows: Array<{
      username: string;
      nome: string;
      equipa: string;
      pais: 'PT' | 'BR';
      pedidoInicio: string;
      pedidoFim: string;
      recorteInicio: string;
      recorteFim: string;
      diasNoPeriodo: number;
      parcial: 'FULL' | 'AM' | 'PM';
    }> = [];

    for (const user of users) {
      const country = user.profile?.workCountry ?? 'PT';
      const holidayDates = holidaysByCountry.get(country) ?? new Set<string>();
      const vacations = vacationsByUser.get(user.id) ?? [];

      const vacationsInPeriod = vacations
        .map((vacation) => {
          const clipped = clipRange(vacation.dataInicio, vacation.dataFim, periodStart, periodEnd);
          if (!clipped) {
            return null;
          }

          const clippedVacation = {
            ...vacation,
            dataInicio: clipped.start,
            dataFim: clipped.end,
            partialDay: vacation.partialDay,
            requestType: vacation.requestType,
          };

          const daysInPeriod = vacationDaysForMetrics(clippedVacation, holidayDates);
          if (daysInPeriod <= 0) {
            return null;
          }

          return {
            ...vacation,
            clippedStart: clipped.start,
            clippedEnd: clipped.end,
            daysInPeriod,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item));

      const baseDaysPerYear = country === 'PT'
        ? 22
        : brVacationDaysByAbsences(user.profile?.unjustifiedAbsences ?? 0);
      const baseDays = baseDaysPerYear * yearsInPeriod.length;

      const approvedDays = vacationsInPeriod.reduce(
        (sum, v) => sum + v.daysInPeriod,
        0,
      );

      const extraDays = creditByUser.get(user.id) ?? 0;
      const saldoEstimado = Math.max(baseDays + extraDays - approvedDays, 0);

      const sortedVacationsInPeriod = vacationsInPeriod
        .slice()
        .sort((a, b) => a.clippedStart.localeCompare(b.clippedStart));

      const periods = sortedVacationsInPeriod
        .map((v) => `${formatIsoDatePt(v.clippedStart)} - ${formatIsoDatePt(v.clippedEnd)} (${v.daysInPeriod})`)
        .join('; ');

      for (const vacation of sortedVacationsInPeriod) {
        detailRows.push({
          username: user.username,
          nome: user.profile?.nomeCompleto || user.profile?.nomeAbreviado || '',
          equipa: user.team?.name || '',
          pais: country,
          pedidoInicio: vacation.dataInicio,
          pedidoFim: vacation.dataFim,
          recorteInicio: vacation.clippedStart,
          recorteFim: vacation.clippedEnd,
          diasNoPeriodo: vacation.daysInPeriod,
          parcial: vacation.partialDay,
        });
      }

      rows.push({
        username: user.username,
        nome: user.profile?.nomeCompleto || user.profile?.nomeAbreviado || '',
        equipa: user.team?.name || '',
        pais: country,
        periodoInicio: periodStart,
        periodoFim: periodEnd,
        diasBase: baseDays,
        diasExtra: extraDays,
        diasAprovados: approvedDays,
        saldo: saldoEstimado,
        pedidosAprovados: sortedVacationsInPeriod.length,
        periodos: periods,
      });
    }

    rows.sort((a, b) => {
      const teamCmp = a.equipa.localeCompare(b.equipa);
      if (teamCmp !== 0) {
        return teamCmp;
      }

      return a.username.localeCompare(b.username);
    });

    detailRows.sort((a, b) => {
      const userCmp = a.username.localeCompare(b.username);
      if (userCmp !== 0) {
        return userCmp;
      }

      return a.recorteInicio.localeCompare(b.recorteInicio);
    });

    const totalBaseDays = rows.reduce((sum, row) => sum + row.diasBase, 0);
    const totalExtraDays = rows.reduce((sum, row) => sum + row.diasExtra, 0);
    const totalApprovedDays = rows.reduce((sum, row) => sum + row.diasAprovados, 0);
    const totalSaldo = rows.reduce((sum, row) => sum + row.saldo, 0);
    const totalCapacity = totalBaseDays + totalExtraDays;
    const utilizationRate = totalCapacity > 0 ? (totalApprovedDays / totalCapacity) * 100 : 0;

    const teamAggMap = new Map<string, { team: string; collaborators: number; approved: number; saldo: number }>();
    for (const row of rows) {
      const key = row.equipa || 'Sem equipa';
      const current = teamAggMap.get(key);
      if (current) {
        current.collaborators += 1;
        current.approved += row.diasAprovados;
        current.saldo += row.saldo;
      } else {
        teamAggMap.set(key, {
          team: key,
          collaborators: 1,
          approved: row.diasAprovados,
          saldo: row.saldo,
        });
      }
    }

    const topTeams = Array.from(teamAggMap.values())
      .sort((a, b) => b.approved - a.approved)
      .slice(0, 8);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Smarter Hub';
    workbook.created = new Date();
    workbook.modified = new Date();

    const executiveSheet = workbook.addWorksheet('Visão Executiva', {
      properties: { defaultColWidth: 22 },
    });

    executiveSheet.mergeCells('A1:F1');
    const execTitle = executiveSheet.getCell('A1');
    execTitle.value = 'Mapa de Férias - Visão Executiva';
    execTitle.font = { name: 'Calibri', size: 17, bold: true, color: { argb: 'FFFFFFFF' } };
    execTitle.alignment = { vertical: 'middle', horizontal: 'left' };
    execTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B4F8A' } };

    executiveSheet.mergeCells('A2:F2');
    const execMeta = executiveSheet.getCell('A2');
    execMeta.value = `Período ${periodLabel} | Gerado em ${new Date().toLocaleString('pt-PT')}`;
    execMeta.font = { name: 'Calibri', size: 10, color: { argb: 'FF31537C' } };
    execMeta.alignment = { vertical: 'middle', horizontal: 'left' };
    execMeta.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF2FB' } };

    executiveSheet.getRow(4).values = ['Indicador', 'Valor', 'Leitura', 'Indicador', 'Valor', 'Leitura'];
    executiveSheet.getRow(4).font = { name: 'Calibri', bold: true, color: { argb: 'FFFFFFFF' } };
    executiveSheet.getRow(4).alignment = { vertical: 'middle', horizontal: 'center' };
    executiveSheet.getRow(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E75B6' } };

    executiveSheet.getRow(5).values = [
      'Colaboradores',
      rows.length,
      rows.length > 0 ? 'Base preenchida' : 'Sem dados',
      'Capacidade (dias)',
      totalCapacity,
      'Base + extra no período',
    ];
    executiveSheet.getRow(6).values = [
      'Dias aprovados',
      totalApprovedDays,
      totalApprovedDays > 0 ? 'Consumo real no período' : 'Sem consumo',
      'Saldo estimado',
      totalSaldo,
      totalSaldo > 0 ? 'Folga disponível' : 'Sem folga',
    ];
    executiveSheet.getRow(7).values = [
      'Taxa de utilização',
      `${utilizationRate.toFixed(1)}%`,
      utilizationRate >= 85 ? 'Alto consumo' : utilizationRate >= 60 ? 'Equilibrado' : 'Baixo consumo',
      'Pedidos aprovados',
      detailRows.length,
      'Eventos no intervalo',
    ];

    for (let rowIndex = 5; rowIndex <= 7; rowIndex += 1) {
      const row = executiveSheet.getRow(rowIndex);
      const isEven = rowIndex % 2 === 0;
      row.eachCell((cell) => {
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
      });
    }

    executiveSheet.getRow(9).values = ['Top equipas por dias aprovados', '', '', '', '', ''];
    executiveSheet.mergeCells('A9:F9');
    executiveSheet.getCell('A9').font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF1B4F8A' } };
    executiveSheet.getCell('A9').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF2FB' } };

    executiveSheet.getRow(10).values = ['Equipa', 'Colaboradores', 'Dias aprovados', 'Saldo estimado', 'Consumo médio/colaborador', 'Observação'];
    executiveSheet.getRow(10).font = { name: 'Calibri', bold: true, color: { argb: 'FFFFFFFF' } };
    executiveSheet.getRow(10).alignment = { vertical: 'middle', horizontal: 'center' };
    executiveSheet.getRow(10).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E75B6' } };

    for (const team of topTeams) {
      const avgPerCollaborator = team.collaborators > 0 ? team.approved / team.collaborators : 0;
      const observation = avgPerCollaborator >= 12 ? 'Carga alta' : avgPerCollaborator >= 6 ? 'Carga moderada' : 'Carga baixa';
      executiveSheet.addRow([
        team.team,
        team.collaborators,
        team.approved,
        team.saldo,
        Number(avgPerCollaborator.toFixed(1)),
        observation,
      ]);
    }

    const teamsStart = 11;
    const teamsEnd = teamsStart + topTeams.length - 1;
    for (let rowIndex = teamsStart; rowIndex <= teamsEnd; rowIndex += 1) {
      const row = executiveSheet.getRow(rowIndex);
      const isEven = rowIndex % 2 === 0;
      row.eachCell((cell) => {
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
      });
    }

    executiveSheet.columns = [
      { width: 30 },
      { width: 14 },
      { width: 17 },
      { width: 16 },
      { width: 24 },
      { width: 18 },
    ];

    const sheet = workbook.addWorksheet('Mapa de Férias', {
      views: [{ state: 'frozen', ySplit: 3 }],
      properties: { defaultColWidth: 18 },
    });

    sheet.mergeCells('A1:K1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = `Mapa de Férias | Período ${periodLabel}`;
    titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };

    sheet.mergeCells('A2:K2');
    const metaCell = sheet.getCell('A2');
    metaCell.value = `Gerado em ${new Date().toLocaleString('pt-PT')} | Colaboradores: ${rows.length} | Pedidos aprovados no período: ${detailRows.length}`;
    metaCell.font = { name: 'Calibri', size: 10, color: { argb: 'FF38516B' } };
    metaCell.alignment = { vertical: 'middle', horizontal: 'left' };
    metaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF2FB' } };

    const headerRow = sheet.getRow(3);
    headerRow.values = [
      'Username',
      'Nome',
      'Equipa',
      'País',
      'Início Período',
      'Fim Período',
      'Dias Base (Período)',
      'Dias Extra',
      'Dias Aprovados',
      'Saldo Estimado',
      'Nº Pedidos',
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
        row.periodoInicio,
        row.periodoFim,
        row.diasBase,
        row.diasExtra,
        row.diasAprovados,
        row.saldo,
        row.pedidosAprovados,
        row.periodos,
      ]);
    }

    sheet.columns = [
      { width: 18 },
      { width: 28 },
      { width: 22 },
      { width: 10 },
      { width: 13 },
      { width: 13 },
      { width: 14 },
      { width: 11 },
      { width: 12 },
      { width: 13 },
      { width: 11 },
      { width: 46 },
    ];

    const dataStart = 4;
    const dataEnd = rows.length + 3;
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
        if (colNumber >= 7 && colNumber <= 10) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: colNumber === 12 };
        }

        if (colNumber === 10) {
          const sourceRow = rows[i - dataStart];
          const totalDays = (sourceRow?.diasBase ?? 0) + (sourceRow?.diasExtra ?? 0);
          const saldoRatio = totalDays > 0 ? (sourceRow?.saldo ?? 0) / totalDays : 0;

          if (saldoRatio < 0.15) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFECEA' } };
          } else if (saldoRatio < 0.35) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4E5' } };
          } else {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF9F0' } };
          }
        }
      });
    }

    const totalsStart = rows.length > 0 ? dataStart : 0;
    const totalsEnd = rows.length > 0 ? dataEnd : 0;

    const totalsRow = sheet.addRow([
      '',
      'Totais',
      '',
      '',
      '',
      '',
      rows.length > 0 ? { formula: `SUM(G${totalsStart}:G${totalsEnd})` } : 0,
      rows.length > 0 ? { formula: `SUM(H${totalsStart}:H${totalsEnd})` } : 0,
      rows.length > 0 ? { formula: `SUM(I${totalsStart}:I${totalsEnd})` } : 0,
      rows.length > 0 ? { formula: `SUM(J${totalsStart}:J${totalsEnd})` } : 0,
      rows.length > 0 ? { formula: `SUM(K${totalsStart}:K${totalsEnd})` } : 0,
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

    sheet.autoFilter = {
      from: { row: 3, column: 1 },
      to: { row: 3, column: 11 },
    };

    const detailSheet = workbook.addWorksheet('Detalhe Pedidos', {
      views: [{ state: 'frozen', ySplit: 2 }],
      properties: { defaultColWidth: 18 },
    });

    detailSheet.mergeCells('A1:J1');
    const detailTitle = detailSheet.getCell('A1');
    detailTitle.value = `Pedidos aprovados no período ${periodLabel}`;
    detailTitle.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    detailTitle.alignment = { vertical: 'middle', horizontal: 'left' };
    detailTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };

    const detailHeader = detailSheet.getRow(2);
    detailHeader.values = [
      'Username',
      'Nome',
      'Equipa',
      'País',
      'Início Pedido',
      'Fim Pedido',
      'Início no Período',
      'Fim no Período',
      'Dias no Período',
      'Parcial',
    ];
    detailHeader.font = { name: 'Calibri', bold: true, color: { argb: 'FFFFFFFF' } };
    detailHeader.alignment = { vertical: 'middle', horizontal: 'center' };
    detailHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E75B6' } };
    detailHeader.height = 22;

    for (const row of detailRows) {
      detailSheet.addRow([
        row.username,
        row.nome,
        row.equipa,
        row.pais,
        row.pedidoInicio,
        row.pedidoFim,
        row.recorteInicio,
        row.recorteFim,
        row.diasNoPeriodo,
        row.parcial,
      ]);
    }

    detailSheet.columns = [
      { width: 18 },
      { width: 28 },
      { width: 22 },
      { width: 10 },
      { width: 13 },
      { width: 13 },
      { width: 15 },
      { width: 15 },
      { width: 14 },
      { width: 10 },
    ];

    for (let i = 3; i <= detailRows.length + 2; i += 1) {
      const row = detailSheet.getRow(i);
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
        cell.alignment = {
          horizontal: colNumber === 9 ? 'center' : 'left',
          vertical: 'middle',
        };
      });
    }

    detailSheet.autoFilter = {
      from: { row: 2, column: 1 },
      to: { row: 2, column: 10 },
    };

    const paramsSheet = workbook.addWorksheet('Parâmetros', {
      properties: { defaultColWidth: 32 },
    });

    paramsSheet.getRow(1).values = ['Parâmetro', 'Valor'];
    paramsSheet.getRow(1).font = { name: 'Calibri', bold: true, color: { argb: 'FFFFFFFF' } };
    paramsSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E75B6' } };

    const usersLabel = teamIdFilter ? users.filter((u) => u.team?.name).map((u) => u.team?.name || '').filter(Boolean).join(', ') : 'Todas';
    paramsSheet.addRows([
      ['Período inicial', formatIsoDatePt(periodStart)],
      ['Período final', formatIsoDatePt(periodEnd)],
      ['Anos abrangidos', yearsInPeriod.join(', ')],
      ['Equipa filtrada', teamIdFilter || 'Todas'],
      ['Total de colaboradores', rows.length],
      ['Total de pedidos aprovados no período', detailRows.length],
      ['Gerado em', new Date().toLocaleString('pt-PT')],
      ['Filtros de equipa no dataset', usersLabel || 'Todas'],
    ]);

    paramsSheet.columns = [{ width: 34 }, { width: 60 }];
    for (let i = 2; i <= 8; i += 1) {
      const row = paramsSheet.getRow(i);
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD9E2F3' } },
          left: { style: 'thin', color: { argb: 'FFD9E2F3' } },
          bottom: { style: 'thin', color: { argb: 'FFD9E2F3' } },
          right: { style: 'thin', color: { argb: 'FFD9E2F3' } },
        };
      });
    }

    const periodTag = `${periodStart}_${periodEnd}`;
    const filename = `mapa-ferias-${periodTag}.xlsx`;
    const xlsxBuffer = await workbook.xlsx.writeBuffer();

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(Buffer.from(xlsxBuffer as ArrayBuffer));
  } catch (error) {
    console.error('[GET /vacations/export]', error);
    return res.status(500).json({ error: 'Falha ao gerar exportação do mapa de férias.' });
  }
});

// Phase 2B: PT Carryover Reminder Job
// POST /vacations/jobs/carryover-reminder
// Sends notifications to PT collaborators whose carried-over vacation balance expires within N days.
// Should be called by an external cron job (e.g., daily at 08:00).
// Secured by JOBS_SECRET header matching env var JOBS_SECRET.
router.post('/vacations/jobs/carryover-reminder', async (req: Request, res: Response) => {
  try {
    const secret = req.headers['x-jobs-secret'];
    if (!secret || secret !== process.env.JOBS_SECRET) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const daysAhead = typeof req.query.daysAhead === 'string' ? Math.max(1, parseInt(req.query.daysAhead, 10) || 30) : 30;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + daysAhead);

    // PT carryover rule: férias transitadas do ano anterior expiram a 30 de abril do ano corrente
    const currentYear = today.getFullYear();
    const carryoverExpiry = new Date(`${currentYear}-04-30T00:00:00`);

    // Only send reminder if expiry is within daysAhead window and hasn't passed yet
    if (today > carryoverExpiry) {
      return res.json({ skipped: true, reason: 'Carryover expiry already passed for this year.', notified: 0 });
    }

    if (carryoverExpiry > targetDate) {
      return res.json({ skipped: true, reason: `Carryover expiry is more than ${daysAhead} days away.`, notified: 0 });
    }

    // Find PT collaborators with approved carryover balance credits for previous year
    const prevYear = currentYear - 1;
    const carryoverCredits = await prisma.vacationBalanceCredit.findMany({
      where: {
        year: prevYear,
        reason: { contains: 'transitad', mode: 'insensitive' },
        user: {
          profile: { workCountry: 'PT' },
        },
      },
      select: {
        userId: true,
        days: true,
        user: {
          select: {
            profile: { select: { nomeAbreviado: true, nomeCompleto: true } },
          },
        },
      },
    });

    if (carryoverCredits.length === 0) {
      return res.json({ skipped: false, notified: 0 });
    }

    const expiryFormatted = formatIsoDatePt(dateToISO(carryoverExpiry));
    const daysRemaining = Math.round((carryoverExpiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    const notifyPromises = carryoverCredits.map(async (credit) => {
      const name = String(credit.user.profile?.nomeAbreviado ?? '').trim()
        || String(credit.user.profile?.nomeCompleto ?? '').trim()
        || 'Colaborador';
      await notifyUsers(
        prisma,
        [credit.userId],
        `Férias transitadas a expirar em ${daysRemaining} dia(s)`,
        `${name}, tens ${credit.days} dia(s) de férias transitados de ${prevYear} que expiram a ${expiryFormatted}. Certifica-te de que os utilizas antes do prazo.`,
      );
    });

    await Promise.allSettled(notifyPromises);

    return res.json({ skipped: false, notified: carryoverCredits.length, expiresAt: dateToISO(carryoverExpiry), daysRemaining });
  } catch (error) {
    console.error('[POST /vacations/jobs/carryover-reminder]', error);
    return res.status(500).json({ error: 'Erro ao enviar lembretes de carryover.' });
  }
});

export { router as vacationsRouter };
