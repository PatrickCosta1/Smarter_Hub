import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { notifyUsers } from '../lib/notifications.js';

const router = Router();

const vacationSchema = z
  .object({
    dataInicio: z.string().min(1, 'Data de início é obrigatória'),
    dataFim: z.string().min(1, 'Data de fim é obrigatória'),
    observacoes: z.string().default(''),
    requestType: z.enum(['VACATION', 'ABSENCE_MEDICAL', 'ABSENCE_TRAINING']).default('VACATION'),
    attachmentLink: z.string().default(''),
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
  });

function toLocalDate(dateText: string) {
  return new Date(`${dateText}T00:00:00`);
}

function dateToISO(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

function brVacationDaysByAbsences(absences: number) {
  if (absences <= 5) return 30;
  if (absences <= 14) return 24;
  if (absences <= 23) return 18;
  if (absences <= 32) return 12;
  return 0;
}

async function resolveApprovers(userId: string) {
  const requester = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      team: {
        select: {
          id: true,
          managerId: true,
          coordinatorId: true,
        },
      },
    },
  });

  if (!requester) {
    return [] as string[];
  }

  if (requester.role === 'COLABORADOR') {
    return requester.team?.managerId ? [requester.team.managerId] : [];
  }

  if (requester.role === 'MANAGER') {
    return requester.team?.coordinatorId ? [requester.team.coordinatorId] : [];
  }

  if (requester.role === 'COORDENADOR') {
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    return admins.map((item) => item.id);
  }

  if (requester.role === 'ADMIN') {
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', id: { not: requester.id } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    return admins.map((item) => item.id);
  }

  return [];
}

async function canReviewRequest(requestId: string, reviewerId: string, reviewerRole: string) {
  if (reviewerRole === 'ADMIN') {
    return true;
  }

  const request = await prisma.vacation.findUnique({
    where: { id: requestId },
    include: {
      user: {
        include: {
          team: true,
        },
      },
    },
  });

  if (!request) {
    return false;
  }

  if (reviewerRole === 'MANAGER') {
    return request.user.role === 'COLABORADOR' && request.user.team?.managerId === reviewerId;
  }

  if (reviewerRole === 'COORDENADOR') {
    return request.user.role === 'MANAGER' && request.user.team?.coordinatorId === reviewerId;
  }

  return false;
}

router.get('/vacations/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.id;

    const vacations = await prisma.vacation.findMany({
      where: { userId },
      orderBy: [{ dataInicio: 'desc' }, { createdAt: 'desc' }],
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
        .reduce((sum, item) => sum + enumerateDates(item.dataInicio, item.dataFim).length, 0);

      return res.json({
        country: 'PT',
        year: currentYear,
        rules: {
          baseDays: 22,
          extraDays: ['Aniversário', '24/12', '31/12', 'Terça-feira de Carnaval', 'São João (se aplicável)'],
          mandatoryConsecutiveDays: 10,
          carryOver: true,
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
      .filter((item) => item.requestType !== 'VACATION')
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

    const vacation = await prisma.vacation.create({
      data: {
        userId,
        dataInicio: data.dataInicio,
        dataFim: data.dataFim,
        observacoes: data.observacoes,
        requestType: data.requestType,
        attachmentLink: data.attachmentLink,
        status: 'PENDING',
      },
    });

    const approverIds = await resolveApprovers(userId);
    if (approverIds.length > 0) {
      await notifyUsers(
        prisma,
        approverIds,
        data.requestType === 'VACATION' ? 'Novo pedido de férias' : 'Novo pedido de ausência',
        `${req.authUser!.username} submeteu um pedido pendente de aprovação.`,
      );
    }

    res.status(201).json(vacation);
  } catch (error) {
    console.error('[POST /vacations]', error);
    res.status(500).json({ error: 'Falha ao registar pedido.' });
  }
});

router.get('/vacations/requests', requireAuth, async (req: Request, res: Response) => {
  const role = req.authUser!.role;
  const userId = req.authUser!.id;

  if (!['MANAGER', 'COORDENADOR', 'ADMIN'].includes(role)) {
    return res.status(403).json({ message: 'Sem permissões para consultar pedidos.' });
  }

  const where =
    role === 'ADMIN'
      ? { status: 'PENDING' as const }
      : role === 'MANAGER'
        ? {
            status: 'PENDING' as const,
            user: {
              role: 'COLABORADOR' as const,
              team: { managerId: userId },
            },
          }
        : {
            status: 'PENDING' as const,
            user: {
              role: 'MANAGER' as const,
              team: { coordinatorId: userId },
            },
          };

  const vacations = await prisma.vacation.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          team: { select: { id: true, name: true } },
          profile: { select: { workCountry: true } },
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }],
  });

  return res.json(vacations);
});

router.post('/vacations/:id/approve', requireAuth, async (req: Request, res: Response) => {
  const role = req.authUser!.role;

  if (!['MANAGER', 'COORDENADOR', 'ADMIN'].includes(role)) {
    return res.status(403).json({ message: 'Sem permissões para aprovar pedidos.' });
  }

  const id = typeof req.params.id === 'string' ? req.params.id : '';
  const allowed = await canReviewRequest(id, req.authUser!.id, role);

  if (!allowed) {
    return res.status(403).json({ message: 'Este pedido não pertence ao teu nível de aprovação.' });
  }

  const vacation = await prisma.vacation.findFirst({ where: { id, status: 'PENDING' } });

  if (!vacation) {
    return res.status(404).json({ message: 'Pedido não encontrado.' });
  }

  await prisma.vacation.update({
    where: { id },
    data: {
      status: 'APPROVED',
      reviewedById: req.authUser!.id,
      reviewedAt: new Date(),
      reviewReason: 'Pedido aprovado.',
      approvedByRole: role,
    },
  });

  await prisma.notification.create({
    data: {
      userId: vacation.userId,
      title: 'Pedido aprovado',
      message: 'O teu pedido foi aprovado.',
    },
  });

  return res.json({ success: true });
});

router.post('/vacations/:id/reject', requireAuth, async (req: Request, res: Response) => {
  const role = req.authUser!.role;

  if (!['MANAGER', 'COORDENADOR', 'ADMIN'].includes(role)) {
    return res.status(403).json({ message: 'Sem permissões para recusar pedidos.' });
  }

  const id = typeof req.params.id === 'string' ? req.params.id : '';
  const allowed = await canReviewRequest(id, req.authUser!.id, role);

  if (!allowed) {
    return res.status(403).json({ message: 'Este pedido não pertence ao teu nível de aprovação.' });
  }

  const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : 'Pedido recusado.';
  const vacation = await prisma.vacation.findFirst({ where: { id, status: 'PENDING' } });

  if (!vacation) {
    return res.status(404).json({ message: 'Pedido não encontrado.' });
  }

  await prisma.vacation.update({
    where: { id },
    data: {
      status: 'REJECTED',
      reviewedById: req.authUser!.id,
      reviewedAt: new Date(),
      reviewReason: reason,
      approvedByRole: role,
    },
  });

  await prisma.notification.create({
    data: {
      userId: vacation.userId,
      title: 'Pedido recusado',
      message: `O teu pedido foi recusado. ${reason}`,
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

    const existing = await prisma.vacation.findFirst({ where: { id, userId, status: 'PENDING' } });

    if (!existing) {
      return res.status(404).json({ error: 'Pedido não encontrado ou já processado.' });
    }

    const data = validation.data;

    const updated = await prisma.vacation.update({
      where: { id },
      data: {
        dataInicio: data.dataInicio,
        dataFim: data.dataFim,
        observacoes: data.observacoes,
        requestType: data.requestType,
        attachmentLink: data.attachmentLink,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('[PUT /vacations/:id]', error);
    res.status(500).json({ error: 'Falha ao atualizar pedido.' });
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

    await prisma.vacation.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        reviewReason: 'Cancelado pelo colaborador.',
      },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('[DELETE /vacations/:id]', error);
    res.status(500).json({ error: 'Falha ao remover pedido.' });
  }
});

export { router as vacationsRouter };
