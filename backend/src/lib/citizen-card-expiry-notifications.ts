import type { Notification, PrismaClient } from '@prisma/client';

export const CITIZEN_CARD_EXPIRY_NOTIFICATION_TITLE = 'Validade do cartão de cidadão a expirar';
const CITIZEN_CARD_EXPIRY_WINDOW_DAYS = 30;

function parseIsoDateStrict(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [yearRaw, monthRaw, dayRaw] = value.split('-');
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

function startOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function diffDaysUtc(targetDate: Date, baseDate: Date) {
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.floor((targetDate.getTime() - baseDate.getTime()) / dayMs);
}

function hasNonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

function payloadHasCitizenCardRenewal(payload: Record<string, unknown>) {
  return hasNonEmptyString(payload.validadeCartaoCidadao) && hasNonEmptyString(payload.comprovativoCartaoCidadao);
}

function buildExpiryMessage(validadeCartaoCidadao: string, daysUntilExpiry: number) {
  const prefix = daysUntilExpiry < 0
    ? `A validade do teu cartão de cidadão expirou há ${Math.abs(daysUntilExpiry)} dia(s).`
    : daysUntilExpiry === 0
      ? 'A validade do teu cartão de cidadão expira hoje.'
      : `A validade do teu cartão de cidadão expira em ${daysUntilExpiry} dia(s).`;

  return `${prefix} Atualiza a validade e anexa um novo comprovativo do cartão de cidadão para regularizar a ficha. (Validade atual: ${validadeCartaoCidadao})`;
}

export function isCitizenCardExpiryNotification(notification: Pick<Notification, 'title'>) {
  return notification.title === CITIZEN_CARD_EXPIRY_NOTIFICATION_TITLE;
}

export async function runCitizenCardExpiryNotificationSweep(prisma: PrismaClient) {
  const today = startOfTodayUtc();

  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      profile: { isNot: null },
    },
    select: {
      id: true,
      profile: {
        select: {
          validadeCartaoCidadao: true,
        },
      },
    },
  });

  const candidates = users
    .map((user) => {
      const validadeRaw = user.profile?.validadeCartaoCidadao?.trim() ?? '';
      const validadeDate = parseIsoDateStrict(validadeRaw);
      if (!validadeDate) {
        return null;
      }
      const daysUntilExpiry = diffDaysUtc(validadeDate, today);
      if (daysUntilExpiry > CITIZEN_CARD_EXPIRY_WINDOW_DAYS) {
        return null;
      }
      return {
        userId: user.id,
        validadeCartaoCidadao: validadeRaw,
        daysUntilExpiry,
      };
    })
    .filter(Boolean) as Array<{ userId: string; validadeCartaoCidadao: string; daysUntilExpiry: number }>;

  if (candidates.length === 0) {
    return { scannedUsers: users.length, eligibleUsers: 0, createdNotifications: 0 };
  }

  const activeNotifications = await prisma.notification.findMany({
    where: {
      userId: { in: candidates.map((candidate) => candidate.userId) },
      isRead: false,
      title: CITIZEN_CARD_EXPIRY_NOTIFICATION_TITLE,
    },
    select: { userId: true },
  });

  const usersWithActiveNotification = new Set(activeNotifications.map((notification) => notification.userId));

  const toCreate = candidates.filter((candidate) => !usersWithActiveNotification.has(candidate.userId));

  if (toCreate.length > 0) {
    await prisma.notification.createMany({
      data: toCreate.map((item) => ({
        userId: item.userId,
        title: CITIZEN_CARD_EXPIRY_NOTIFICATION_TITLE,
        message: buildExpiryMessage(item.validadeCartaoCidadao, item.daysUntilExpiry),
      })),
    });
  }

  return {
    scannedUsers: users.length,
    eligibleUsers: candidates.length,
    createdNotifications: toCreate.length,
  };
}

export async function markCitizenCardExpiryNotificationsAsRead(prisma: PrismaClient, userId: string) {
  const result = await prisma.notification.updateMany({
    where: {
      userId,
      title: CITIZEN_CARD_EXPIRY_NOTIFICATION_TITLE,
      isRead: false,
    },
    data: { isRead: true },
  });

  return result.count;
}

export async function canReadCitizenCardExpiryNotification(prisma: PrismaClient, notification: Pick<Notification, 'id' | 'userId' | 'title' | 'createdAt'>) {
  if (!isCitizenCardExpiryNotification(notification)) {
    return true;
  }

  const profile = await prisma.profile.findUnique({
    where: { userId: notification.userId },
    select: {
      updatedAt: true,
      validadeCartaoCidadao: true,
      comprovativoCartaoCidadao: true,
    },
  });

  if (profile
    && profile.updatedAt > notification.createdAt
    && hasNonEmptyString(profile.validadeCartaoCidadao)
    && hasNonEmptyString(profile.comprovativoCartaoCidadao)) {
    return true;
  }

  const profileChangeRequests = await prisma.profileChangeRequest.findMany({
    where: {
      userId: notification.userId,
      createdAt: { gt: notification.createdAt },
    },
    select: {
      requestedData: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  return profileChangeRequests.some((request) => {
    const payload = (request.requestedData ?? {}) as Record<string, unknown>;
    return payloadHasCitizenCardRenewal(payload);
  });
}

export function shouldAutoResolveCitizenCardExpiryNotification(payload: Record<string, unknown>) {
  return payloadHasCitizenCardRenewal(payload);
}
