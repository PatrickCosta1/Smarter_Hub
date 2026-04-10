import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import {
  buildUserWhereFromScope,
  canAccessUserByPermission,
  getPermissionScope,
  hasPermission,
  isAccessTotal,
} from '../lib/permission-engine.js';
import { requireAuth } from '../middleware/auth.js';
import { notifyUsersByPermission } from '../lib/notifications.js';

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

async function enforceVacationBusinessDays(params: {
  requestType: 'VACATION' | 'ABSENCE_MEDICAL' | 'ABSENCE_TRAINING';
  dataInicio: string;
  dataFim: string;
  country: 'PT' | 'BR';
}) {
  if (params.requestType !== 'VACATION') {
    return;
  }

  const requestedDays = enumerateDates(params.dataInicio, params.dataFim);
  if (requestedDays.some(isWeekendIso)) {
    throw new Error('Pedidos de férias só podem incluir dias úteis. Para fim de semana/feriado, usa um pedido de ausência.');
  }

  const startYear = toLocalDate(params.dataInicio).getFullYear();
  const endYear = toLocalDate(params.dataFim).getFullYear();
  const years = new Set<number>([startYear, endYear]);
  const holidaysByIso = new Set<string>();

  for (const year of years) {
    const holidays = await fetchHolidays(params.country, year);
    for (const holiday of holidays) {
      holidaysByIso.add(holiday.date);
    }
  }

  if (requestedDays.some((day) => holidaysByIso.has(day))) {
    throw new Error('Pedidos de férias só podem incluir dias úteis. Para fim de semana/feriado, usa um pedido de ausência.');
  }
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
    return;
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
    const hasMandatoryConsecutiveBlock = currentYearPeriods.some((period) => vacationDaysForMetrics(period) >= 10);
    const requestedDays = vacationDaysForMetrics(requestedPeriod);

    if (!hasMandatoryConsecutiveBlock && requestedDays < 10) {
      throw new Error('Política PT: deve existir pelo menos um período de férias com 10 dias úteis consecutivos no ano.');
    }

    return;
  }

  if (params.partialDay !== 'FULL') {
    throw new Error('Política BR: pedidos de férias fracionados em meio-dia não são permitidos.');
  }

  const allPeriods = [...currentYearPeriods, requestedPeriod];
  if (allPeriods.length > 3) {
    throw new Error('Política BR: férias só podem ser divididas em, no máximo, 3 períodos por ano.');
  }

  const periodLengths = allPeriods.map((period) => vacationDaysForMetrics(period));
  if (periodLengths.some((days) => days < 5)) {
    throw new Error('Política BR: cada período de férias deve ter, no mínimo, 5 dias corridos.');
  }

  if (allPeriods.length >= 3 && !periodLengths.some((days) => days >= 14)) {
    throw new Error('Política BR: quando as férias são divididas em 3 períodos, pelo menos um deve ter 14 dias ou mais.');
  }
}

function hasDateOverlap(startA: string, endA: string, startB: string, endB: string) {
  return !(endA < startB || endB < startA);
}

function vacationDaysForMetrics(record: { requestType: string; dataInicio: string; dataFim: string; partialDay?: 'FULL' | 'AM' | 'PM' }) {
  if (record.requestType !== 'VACATION') {
    return enumerateDates(record.dataInicio, record.dataFim).length;
  }

  if (record.partialDay && record.partialDay !== 'FULL') {
    return 0.5;
  }

  return enumerateDates(record.dataInicio, record.dataFim).length;
}

function vacationDailyWeight(record: { dataInicio: string; partialDay?: 'FULL' | 'AM' | 'PM' }, iso: string) {
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

async function resolveApprovalGroups(userId: string, contextTeamId: string | null) {
  const requester = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
    },
  });

  if (!requester) {
    return [] as Array<{ level: number; approverIds: string[] }>;
  }

  type TeamHierarchyNode = { id: string; managerId: string | null; coordinatorId: string | null; parentTeamId: string | null };

  const hierarchy: TeamHierarchyNode[] = [];
  const visited = new Set<string>();
  let cursorTeamId: string | null = contextTeamId;

  while (cursorTeamId && !visited.has(cursorTeamId)) {
    visited.add(cursorTeamId);
    const team: TeamHierarchyNode | null = await prisma.team.findUnique({
      where: { id: cursorTeamId },
      select: {
        id: true,
        managerId: true,
        coordinatorId: true,
        parentTeamId: true,
      },
    });

    if (!team) {
      break;
    }

    hierarchy.push(team);
    cursorTeamId = team.parentTeamId;
  }

  if (hierarchy.length === 0) {
    return [] as Array<{ level: number; approverIds: string[] }>;
  }

  const groups: Array<{ level: number; approverIds: string[] }> = [];
  const seenApprovers = new Set<string>();

  function pushLevel(candidates: Array<string | null | undefined>) {
    const approverIds = candidates
      .filter((id): id is string => Boolean(id && id !== userId && !seenApprovers.has(id)));

    if (approverIds.length === 0) {
      return;
    }

    for (const id of approverIds) {
      seenApprovers.add(id);
    }

    groups.push({
      level: groups.length + 1,
      approverIds,
    });
  }

  for (const team of hierarchy) {
    const membershipApprovers = await prisma.teamMembership.findMany({
      where: {
        teamId: team.id,
        isActive: true,
        isApprover: true,
        approvalLevel: { not: null },
      },
      select: {
        userId: true,
        approvalLevel: true,
      },
    });

    const localLevels = new Map<number, string[]>();
    for (const item of membershipApprovers) {
      if (!item.approvalLevel) {
        continue;
      }

      if (!localLevels.has(item.approvalLevel)) {
        localLevels.set(item.approvalLevel, []);
      }

      localLevels.get(item.approvalLevel)!.push(item.userId);
    }

    const sortedLocalLevels = Array.from(localLevels.keys()).sort((a, b) => a - b);
    if (sortedLocalLevels.length > 0) {
      for (const localLevel of sortedLocalLevels) {
        pushLevel(localLevels.get(localLevel) ?? []);
      }
    } else {
      pushLevel([team.managerId, team.coordinatorId]);
    }
  }

  if (groups.length === 0) {
    const globalApprovers = await prisma.user.findMany({
      where: {
        id: { not: userId },
        OR: [
          { isRootAccess: true },
          {
            permissionAssignments: {
              some: {
                isEnabled: true,
                permission: {
                  code: 'approve_vacation',
                },
              },
            },
          },
        ],
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    if (globalApprovers.length > 0) {
      pushLevel(globalApprovers.map((item) => item.id));
    }
  }

  return groups;
}

async function enforceOneThirdCapacity(
  db: Pick<Prisma.TransactionClient, 'teamMembership' | 'user' | 'vacation'>,
  contextTeamId: string,
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
      status: 'APPROVED',
      ...(excludeVacationId ? { id: { not: excludeVacationId } } : {}),
    },
    select: {
      dataInicio: true,
      dataFim: true,
      partialDay: true,
    },
  });

  const targetDates = enumerateDates(dataInicio, dataFim);

  for (const iso of targetDates) {
    let usedCapacity = 0;
    for (const item of overlapping) {
      if (hasDateOverlap(iso, iso, item.dataInicio, item.dataFim)) {
        usedCapacity += vacationDailyWeight(item, iso);
      }
    }

    const requestedCapacity = vacationDailyWeight({ dataInicio, partialDay }, iso);

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

router.get('/vacations/overview', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.id;

    const [profile, vacations] = await Promise.all([
      prisma.profile.findUnique({ where: { userId } }),
      prisma.vacation.findMany({ where: { userId } }),
    ]);

    const country = profile?.workCountry ?? 'PT';
    const currentYear = new Date().getFullYear();

    if (country === 'PT') {
      const approvedVacationDays = vacations
        .filter((item) => item.status === 'APPROVED' && item.requestType === 'VACATION')
        .reduce((sum, item) => sum + vacationDaysForMetrics(item), 0);

      return res.json({
        country: 'PT',
        year: currentYear,
        rules: {
          baseDays: 22,
          extraDays: ['Aniversário', '24/12', '31/12', 'Terça-feira de Carnaval', 'São João (se aplicável)'],
          mandatoryConsecutiveDays: 10,
          carryOver: true,
          maxTeamShare: '1/3',
        },
        approvedVacationDays,
      });
    }

    const hireDate = profile?.dataInicioContrato ? new Date(`${profile.dataInicioContrato}T00:00:00`) : new Date(`${currentYear}-01-01T00:00:00`);
    const now = new Date();
    const monthsWorked = (now.getFullYear() - hireDate.getFullYear()) * 12 + (now.getMonth() - hireDate.getMonth());
    const acquisitionComplete = monthsWorked >= 12;
    const unjustifiedAbsences = profile?.unjustifiedAbsences ?? 0;
    const entitledDays = brVacationDaysByAbsences(unjustifiedAbsences);

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

    const extras = [
      `${year}-12-24`,
      `${year}-12-31`,
      dateToISO(carnivalTuesday(year)),
    ];

    if ((profile?.localidade ?? '').toLowerCase().includes('porto')) {
      extras.push(`${year}-06-24`);
    }

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
      select: { workCountry: true, primeiroNome: true, apelido: true, nomeAbreviado: true },
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

    const vacation = await prisma.$transaction(async (tx) => {
      await validateVacationCountryPolicy({
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
        await enforceOneThirdCapacity(tx, contextTeamId, data.dataInicio, data.dataFim, data.partialDay);
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
        || `${String(profile?.primeiroNome ?? '').trim()} ${String(profile?.apelido ?? '').trim()}`.trim()
        || 'Colaborador';
      const requestLabel = data.requestType === 'VACATION' ? 'férias' : 'ausência';
      await notifyUsersByPermission(
        prisma,
        ['approve_vacation'],
        data.requestType === 'VACATION' ? 'Novo pedido de férias' : 'Novo pedido de ausência',
        `${requesterName} efetuou um pedido de ${requestLabel}, de ${formatIsoDatePt(data.dataInicio)} até ${formatIsoDatePt(data.dataFim)}.`,
        { excludeUserIds: [userId] },
      );
    }

    res.status(201).json(vacation);
  } catch (error) {
    console.error('[POST /vacations]', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Falha ao registar pedido.' });
  }
});

router.get('/vacations/requests', requireAuth, async (req: Request, res: Response) => {
  const userId = req.authUser!.id;
  const [canApproveVacation, canRejectVacation, canViewAllVacations, isFullAccess, viewAllScope] = await Promise.all([
    hasPermission(userId, 'approve_vacation'),
    hasPermission(userId, 'reject_vacation'),
    hasPermission(userId, 'view_all_vacations'),
    isAccessTotal(userId),
    getPermissionScope(userId, 'view_all_vacations'),
  ]);

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
          profile: { select: { workCountry: true, nomeAbreviado: true, primeiroNome: true, apelido: true } },
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

  await prisma.notification.create({
    data: {
      userId: vacation.userId,
      title: vacation.requestType === 'VACATION' ? 'Pedido de férias aprovado' : 'Pedido de ausência aprovado',
      message: vacation.requestType === 'VACATION'
        ? 'Pedido aprovado.'
        : 'Pedido aprovado.',
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

  await prisma.$transaction([
    prisma.vacation.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewedById: req.authUser!.id,
        reviewedAt: new Date(),
        reviewReason: reason,
      },
    }),
    prisma.vacationApproval.updateMany({
      where: {
        vacationId: id,
        status: { in: [APPROVAL_PENDING, APPROVAL_WAITING] },
      },
      data: {
        status: APPROVAL_REJECTED,
        decidedAt: new Date(),
        reason,
      },
    }),
  ]);

  await prisma.notification.create({
    data: {
      userId: vacation.userId,
      title: vacation.requestType === 'VACATION' ? 'Pedido de férias recusado' : 'Pedido de ausência recusado',
      message: `Pedido recusado. ${reason}`,
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

    const created = await prisma.$transaction(async (tx) => {
      await validateVacationCountryPolicy({
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
        await enforceOneThirdCapacity(tx, contextTeamId, data.dataInicio, data.dataFim, data.partialDay, id);
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

    res.json(created);
  } catch (error) {
    console.error('[PUT /vacations/:id]', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Falha ao atualizar pedido.' });
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

export { router as vacationsRouter };
