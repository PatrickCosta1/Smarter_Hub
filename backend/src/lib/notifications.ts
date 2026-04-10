import type { PrismaClient } from '@prisma/client';

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

export async function notifyUsersByPermission(
  prisma: PrismaClient,
  permissionCodes: string[],
  title: string,
  message: string,
) {
  const codes = Array.from(new Set(permissionCodes.map((code) => code.trim()).filter(Boolean)));
  if (codes.length === 0) {
    return;
  }

  const recipients = await prisma.user.findMany({
    where: {
      OR: [
        { isRootAccess: true },
        {
          permissionAssignments: {
            some: {
              isEnabled: true,
              permission: {
                code: { in: codes },
              },
            },
          },
        },
      ],
    },
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
