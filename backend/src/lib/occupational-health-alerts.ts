import type { PrismaClient, WorkCountry } from '@prisma/client';

export const OCCUPATIONAL_HEALTH_ALERT_TITLE = 'Lembrete: consulta de medicina do trabalho';
export const OCCUPATIONAL_HEALTH_ALERT_SETTING_KEY = 'occupational_health_alerts_enabled';

function startOfUtcDay(input = new Date()) {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
}

function addMonths(input: Date, months: number) {
  const date = new Date(input.getTime());
  date.setUTCMonth(date.getUTCMonth() + months);
  return date;
}

function parseIsoDateStrict(value: string) {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }

  const [yearRaw, monthRaw, dayRaw] = normalized.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    return null;
  }

  return date;
}

function calculateAgeYears(birthDateIso: string, todayUtc: Date) {
  const birth = parseIsoDateStrict(birthDateIso);
  if (!birth) {
    return null;
  }

  let age = todayUtc.getUTCFullYear() - birth.getUTCFullYear();
  const hasNotHadBirthdayThisYear =
    todayUtc.getUTCMonth() < birth.getUTCMonth()
    || (todayUtc.getUTCMonth() === birth.getUTCMonth() && todayUtc.getUTCDate() < birth.getUTCDate());

  if (hasNotHadBirthdayThisYear) {
    age -= 1;
  }

  return age;
}

function resolveIntervalMonths(country: WorkCountry, ageYears: number | null) {
  if (country === 'BR') {
    return 6;
  }

  if (country === 'PT' && typeof ageYears === 'number' && ageYears >= 50) {
    return 12;
  }

  return 24;
}

function buildAlertMessage(name: string, country: WorkCountry, intervalMonths: number, ageYears: number | null) {
  const countryLabel = country === 'BR' ? 'Brasil' : 'Portugal';
  const periodicityLabel = intervalMonths === 6
    ? 'de 6 em 6 meses'
    : intervalMonths === 12
      ? 'anual'
      : 'de 2 em 2 anos';

  const ageHint = country === 'PT' && typeof ageYears === 'number' && ageYears >= 50
    ? ' (regra PT 50+)'
    : '';

  return [
    `Olá ${name},`,
    '',
    `Em breve receberás informações para a tua consulta de medicina do trabalho (${countryLabel}).`,
    `Periodicidade aplicada: ${periodicityLabel}${ageHint}.`,
    'Em caso de dúvidas, fala com o RH.',
  ].join('\n');
}

export async function getOccupationalHealthAlertsEnabled(prisma: PrismaClient) {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: OCCUPATIONAL_HEALTH_ALERT_SETTING_KEY },
    select: { boolValue: true },
  });

  return setting?.boolValue ?? true;
}

export async function setOccupationalHealthAlertsEnabled(prisma: PrismaClient, enabled: boolean) {
  const setting = await prisma.systemSetting.upsert({
    where: { key: OCCUPATIONAL_HEALTH_ALERT_SETTING_KEY },
    update: { boolValue: enabled, textValue: null },
    create: { key: OCCUPATIONAL_HEALTH_ALERT_SETTING_KEY, boolValue: enabled, textValue: null },
    select: { boolValue: true },
  });

  return setting.boolValue ?? enabled;
}

export async function runOccupationalHealthAlertSweep(prisma: PrismaClient) {
  const enabled = await getOccupationalHealthAlertsEnabled(prisma);
  if (!enabled) {
    return { skipped: true, reason: 'disabled', scannedUsers: 0, createdNotifications: 0 };
  }

  const today = startOfUtcDay();

  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { not: 'CONVIDADO' },
      profile: { isNot: null },
    },
    select: {
      id: true,
      username: true,
      profile: {
        select: {
          nomeAbreviado: true,
          nomeCompleto: true,
          dataNascimento: true,
          workCountry: true,
        },
      },
    },
  });

  if (users.length === 0) {
    return { skipped: false, reason: null, scannedUsers: 0, createdNotifications: 0 };
  }

  const userIds = users.map((item) => item.id);
  const previousNotifications = await prisma.notification.findMany({
    where: {
      userId: { in: userIds },
      title: OCCUPATIONAL_HEALTH_ALERT_TITLE,
    },
    orderBy: { createdAt: 'desc' },
    select: {
      userId: true,
      createdAt: true,
    },
  });

  const latestNotificationByUser = new Map<string, Date>();
  for (const row of previousNotifications) {
    if (!latestNotificationByUser.has(row.userId)) {
      latestNotificationByUser.set(row.userId, row.createdAt);
    }
  }

  const toCreate = users.flatMap((user) => {
    const profile = user.profile;
    if (!profile) {
      return [];
    }

    const ageYears = calculateAgeYears(profile.dataNascimento || '', today);
    const intervalMonths = resolveIntervalMonths(profile.workCountry, ageYears);
    const lastNotificationAt = latestNotificationByUser.get(user.id);

    if (lastNotificationAt) {
      const nextDueDate = addMonths(startOfUtcDay(lastNotificationAt), intervalMonths);
      if (today < nextDueDate) {
        return [];
      }
    }

    const displayName = profile.nomeAbreviado?.trim() || profile.nomeCompleto?.trim() || user.username;

    return [{
      userId: user.id,
      title: OCCUPATIONAL_HEALTH_ALERT_TITLE,
      message: buildAlertMessage(displayName, profile.workCountry, intervalMonths, ageYears),
    }];
  });

  if (toCreate.length > 0) {
    await prisma.notification.createMany({ data: toCreate });
  }

  return {
    skipped: false,
    reason: null,
    scannedUsers: users.length,
    createdNotifications: toCreate.length,
  };
}
