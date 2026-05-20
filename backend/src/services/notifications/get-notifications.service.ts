import { prisma } from '../../lib/prisma.js';

export async function getUserNotifications(userId: string, skip: number, take: number) {
  const [total, rows] = await Promise.all([
    prisma.notification.count({ where: { userId } }),
    prisma.notification.findMany({
      where: { userId },
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
  return prisma.notification.update({
    where: { id: notificationId, userId },
    data: { isRead: true },
  });
}

export async function deleteNotification(notificationId: string, userId: string) {
  return prisma.notification.delete({
    where: { id: notificationId, userId },
  });
}

export async function deleteAllNotifications(userId: string) {
  const result = await prisma.notification.deleteMany({
    where: { userId },
  });
  return result.count;
}
