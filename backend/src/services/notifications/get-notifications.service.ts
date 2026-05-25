import { prisma } from '../../lib/prisma.js';
import {
  CITIZEN_CARD_EXPIRY_NOTIFICATION_TITLE,
  isCitizenCardExpiryNotification,
} from '../../lib/citizen-card-expiry-notifications.js';
import { OCCUPATIONAL_HEALTH_ALERT_TITLE } from '../../lib/occupational-health-alerts.js';

const SHARED_MANAGEMENT_USERNAMES = ['t.people'];

export async function getUserNotifications(userId: string, skip: number, take: number) {
  const userDelegate = (prisma as unknown as {
    user?: {
      findUnique?: (args: { where: { id: string }; select: { username: boolean } }) => Promise<{ username: string } | null>;
    };
  }).user;

  const user = userDelegate?.findUnique
    ? await userDelegate.findUnique({
      where: { id: userId },
      select: { username: true },
    })
    : null;

  const isSharedManagementUser = user
    ? SHARED_MANAGEMENT_USERNAMES.includes(user.username.toLowerCase())
    : false;

  const whereClause = isSharedManagementUser
    ? {
        userId,
        NOT: {
          title: OCCUPATIONAL_HEALTH_ALERT_TITLE,
        },
      }
    : { userId };

  const [total, rows] = await Promise.all([
    prisma.notification.count({ where: whereClause }),
    prisma.notification.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);

  return {
    total,
    rows,
  };
}

export async function markNotificationAsRead(notificationId: string, userId: string) {
  const result = await prisma.notification.updateMany({
    where: { id: notificationId, userId, isRead: false },
    data: { isRead: true },
  });
  return result.count;
}

export async function deleteNotification(notificationId: string, userId: string) {
  const result = await prisma.notification.deleteMany({
    where: { id: notificationId, userId },
  });

  return result.count;
}

export async function deleteAllNotifications(userId: string) {
  const result = await prisma.notification.deleteMany({
    where: { userId },
  });
  return result.count;
}

function hasNonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

function payloadHasCitizenCardRenewal(payload: Record<string, unknown>) {
  return hasNonEmptyString(payload.validadeCartaoCidadao) && hasNonEmptyString(payload.comprovativoCartaoCidadao);
}

export async function getNotificationForUser(notificationId: string, userId: string) {
  return prisma.notification.findFirst({
    where: { id: notificationId, userId },
    select: { id: true, userId: true, title: true, createdAt: true, isRead: true },
  });
}

export async function markAllNotificationsAsRead(userId: string, batchSize: number) {
  let cursorId: string | undefined;
  let updated = 0;
  let skipped = 0;

  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: {
      updatedAt: true,
      validadeCartaoCidadao: true,
      comprovativoCartaoCidadao: true,
    },
  });

  while (true) {
    const unreadBatch = await prisma.notification.findMany({
      where: { userId, isRead: false },
      select: { id: true, userId: true, title: true, createdAt: true },
      orderBy: { id: 'asc' },
      ...(cursorId
        ? {
            cursor: { id: cursorId },
            skip: 1,
          }
        : {}),
      take: batchSize,
    });

    if (unreadBatch.length === 0) {
      break;
    }

    const idsToUpdate: string[] = [];
    const citizenCardNotifications = unreadBatch.filter((notification) => notification.title === CITIZEN_CARD_EXPIRY_NOTIFICATION_TITLE);

    let renewalRequestDates: Date[] = [];
    if (citizenCardNotifications.length > 0) {
      const oldestNotificationDate = citizenCardNotifications.reduce(
        (oldest, item) => (item.createdAt < oldest ? item.createdAt : oldest),
        citizenCardNotifications[0]!.createdAt,
      );

      const renewalRequests = await prisma.profileChangeRequest.findMany({
        where: {
          userId,
          createdAt: { gt: oldestNotificationDate },
        },
        select: {
          createdAt: true,
          requestedData: true,
        },
      });

      renewalRequestDates = renewalRequests
        .filter((request) => payloadHasCitizenCardRenewal((request.requestedData ?? {}) as Record<string, unknown>))
        .map((request) => request.createdAt);
    }

    for (const notification of unreadBatch) {
      if (isCitizenCardExpiryNotification(notification)) {
        const profileAllowsRead = Boolean(
          profile
          && profile.updatedAt > notification.createdAt
          && hasNonEmptyString(profile.validadeCartaoCidadao)
          && hasNonEmptyString(profile.comprovativoCartaoCidadao),
        );

        if (!profileAllowsRead) {
          const hasRenewalRequestAfterNotification = renewalRequestDates.some((requestDate) => requestDate > notification.createdAt);
          if (!hasRenewalRequestAfterNotification) {
            skipped += 1;
            continue;
          }
        }
      }

      idsToUpdate.push(notification.id);
    }

    if (idsToUpdate.length > 0) {
      const result = await prisma.notification.updateMany({
        where: { userId, isRead: false, id: { in: idsToUpdate } },
        data: { isRead: true },
      });
      updated += result.count;
    }

    if (unreadBatch.length < batchSize) {
      break;
    }

    cursorId = unreadBatch[unreadBatch.length - 1]!.id;
  }

  return { updated, skipped };
}

export async function cleanupReadNotifications(olderThanDays: number) {
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - olderThanDays);

  const result = await prisma.notification.deleteMany({
    where: {
      isRead: true,
      createdAt: { lt: threshold },
    },
  });

  return {
    deleted: result.count,
    threshold: threshold.toISOString(),
  };
}
