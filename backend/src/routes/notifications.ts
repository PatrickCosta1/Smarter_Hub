import { Router } from "express";

import { prisma } from "../lib/prisma.js";
import { getUserNotifications, markNotificationAsRead, deleteNotification, deleteAllNotifications } from "../services/notifications/get-notifications.service.js";
import { requireAuth } from "../middleware/auth.js";
import {
  CITIZEN_CARD_EXPIRY_NOTIFICATION_TITLE,
  canReadCitizenCardExpiryNotification,
  isCitizenCardExpiryNotification,
} from "../lib/citizen-card-expiry-notifications.js";

const router = Router();

function hasNonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

function payloadHasCitizenCardRenewal(payload: Record<string, unknown>) {
  return hasNonEmptyString(payload.validadeCartaoCidadao) && hasNonEmptyString(payload.comprovativoCartaoCidadao);
}

function parsePagination(query: Record<string, unknown>) {
  const hasPagination = typeof query.page === 'string' || typeof query.pageSize === 'string';
  if (!hasPagination) {
    return null;
  }

  const pageRaw = Number(typeof query.page === 'string' ? query.page : '1');
  const pageSizeRaw = Number(typeof query.pageSize === 'string' ? query.pageSize : '20');
  const page = Number.isFinite(pageRaw) ? Math.max(1, pageRaw) : 1;
  const pageSize = Number.isFinite(pageSizeRaw) ? Math.min(100, Math.max(1, pageSizeRaw)) : 20;

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
}

function requirePagination(query: Record<string, unknown>) {
  const pagination = parsePagination(query);

  if (!pagination) {
    return { error: 'Parâmetros de paginação são obrigatórios (page e pageSize).' };
  }

  return { pagination };
}

router.get("/notifications/me", requireAuth, async (req, res) => {
  try {
    const userId = req.authUser!.id;
    const paginationResult = requirePagination(req.query as Record<string, unknown>);
    if ('error' in paginationResult) {
      return res.status(400).json({ error: paginationResult.error });
    }

    const { pagination } = paginationResult;
    const data = await getUserNotifications(userId, pagination.skip, pagination.take);

    return res.json({ ...data, page: pagination.page, pageSize: pagination.pageSize });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao obter notificações.' });
  }
});

router.patch("/notifications/:id/read", requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const userId = req.authUser!.id;

  const notification = await prisma.notification.findFirst({
    where: { id, userId },
    select: { id: true, userId: true, title: true, createdAt: true, isRead: true },
  });

  if (!notification) {
    return res.status(404).json({ message: 'Notificação não encontrada.' });
  }

  if (notification.isRead) {
    return res.json({ updated: 0 });
  }

  const canRead = await canReadCitizenCardExpiryNotification(prisma, notification);
  if (!canRead) {
    return res.status(409).json({
      message: 'Esta notificação só pode ser marcada como lida após atualizares a validade e anexares um novo comprovativo do cartão de cidadão.',
    });
  }

  const result = await prisma.notification.updateMany({
    where: { id, userId, isRead: false },
    data: { isRead: true },
  });

  return res.json({ updated: result.count });
});

router.patch("/notifications/read-all", requireAuth, async (req, res) => {
  const userId = req.authUser!.id;

  const batchSizeRaw = Number(typeof req.query.batchSize === 'string' ? req.query.batchSize : '200');
  const batchSize = Number.isFinite(batchSizeRaw) ? Math.min(500, Math.max(50, batchSizeRaw)) : 200;

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
      const oldestNotificationDate = citizenCardNotifications.reduce((oldest, item) => (item.createdAt < oldest ? item.createdAt : oldest), citizenCardNotifications[0]!.createdAt);

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

  return res.json({ updated, skipped });
});

router.delete('/notifications/cleanup', requireAuth, async (req, res) => {
  if (req.authUser!.role !== 'ADMIN' && !req.authUser!.isRootAccess) {
    return res.status(403).json({ message: 'Sem permissões para executar limpeza de notificações.' });
  }

  const olderThanDaysRaw = Number(typeof req.query.olderThanDays === 'string' ? req.query.olderThanDays : '90');
  const olderThanDays = Number.isFinite(olderThanDaysRaw) ? Math.min(730, Math.max(7, olderThanDaysRaw)) : 90;

  const threshold = new Date();
  threshold.setDate(threshold.getDate() - olderThanDays);

  const result = await prisma.notification.deleteMany({
    where: {
      isRead: true,
      createdAt: { lt: threshold },
    },
  });

  return res.json({ deleted: result.count, olderThanDays, threshold: threshold.toISOString() });
});

router.delete('/notifications/:id', requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id);
    const userId = req.authUser!.id;

    await deleteNotification(id, userId);
    return res.json({ deleted: 1 });
  } catch (error) {
    return res.status(404).json({ message: 'Notificação não encontrada.' });
  }
});

router.delete('/notifications', requireAuth, async (req, res) => {
  try {
    const userId = req.authUser!.id;
    const deleted = await deleteAllNotifications(userId);
    return res.json({ deleted });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao eliminar notificações.' });
  }
});

export { router as notificationsRouter };
