import { Router } from "express";

import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

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

  const notification = await prisma.notification.updateMany({
    where: { id, userId },
    data: { isRead: true }
  });

  return res.json({ updated: notification.count });
});

router.patch("/notifications/read-all", requireAuth, async (req, res) => {
  const userId = req.authUser!.id;

  const result = await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true }
  });

  return res.json({ updated: result.count });
});

router.delete('/notifications/:id', requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const userId = req.authUser!.id;

  const result = await prisma.notification.deleteMany({
    where: { id, userId },
  });

  return res.json({ deleted: result.count });
});

export { router as notificationsRouter };
