import type { PrismaClient } from '@prisma/client';
import type { Role } from '@prisma/client';

export async function notifyUsersByRole(
  prisma: PrismaClient,
  roles: Role[],
  title: string,
  message: string,
) {
  const recipients = await prisma.user.findMany({
    where: { role: { in: roles } },
    select: { id: true },
  });

  if (recipients.length === 0) {
    return;
  }

  await prisma.notification.createMany({
    data: recipients.map((recipient) => ({
      userId: recipient.id,
      title,
      message,
    })),
  });
}

export async function notifyUsers(
  prisma: PrismaClient,
  userIds: string[],
  title: string,
  message: string,
) {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));

  if (uniqueIds.length === 0) {
    return;
  }

  await prisma.notification.createMany({
    data: uniqueIds.map((userId) => ({
      userId,
      title,
      message,
    })),
  });
}
