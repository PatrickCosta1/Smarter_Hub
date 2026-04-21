import { Router } from "express";

import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import {
  canReadCitizenCardExpiryNotification,
  isCitizenCardExpiryNotification,
} from "../lib/citizen-card-expiry-notifications.js";

const router = Router();

router.get("/notifications/me", requireAuth, async (req, res) => {
  const userId = req.authUser!.id;

  const notifications = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" }
  });

  return res.json(notifications);
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

  const unreadNotifications = await prisma.notification.findMany({
    where: { userId, isRead: false },
    select: { id: true, userId: true, title: true, createdAt: true },
  });

  if (unreadNotifications.length === 0) {
    return res.json({ updated: 0, skipped: 0 });
  }

  const idsToUpdate: string[] = [];
  let skipped = 0;

  for (const notification of unreadNotifications) {
    const canRead = await canReadCitizenCardExpiryNotification(prisma, notification);
    if (!canRead && isCitizenCardExpiryNotification(notification)) {
      skipped += 1;
      continue;
    }
    idsToUpdate.push(notification.id);
  }

  if (idsToUpdate.length === 0) {
    return res.json({ updated: 0, skipped });
  }

  const result = await prisma.notification.updateMany({
    where: { userId, isRead: false, id: { in: idsToUpdate } },
    data: { isRead: true },
  });

  return res.json({ updated: result.count, skipped });
});

router.delete('/notifications/:id', requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const userId = req.authUser!.id;

  const result = await prisma.notification.deleteMany({
    where: { id, userId },
  });

  return res.json({ deleted: result.count });
});

router.delete('/notifications', requireAuth, async (req, res) => {
  const userId = req.authUser!.id;

  const result = await prisma.notification.deleteMany({
    where: { userId },
  });

  return res.json({ deleted: result.count });
});

export { router as notificationsRouter };
