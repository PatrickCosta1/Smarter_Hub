import { prisma } from '../../lib/prisma.js';

export async function findHourBankLimitTarget(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      isActive: true,
      hasAccessTotal: true,
      profile: {
        select: { workCountry: true },
      },
    },
  });
}

export async function updateHourBankLimit(userId: string, limitHours: number) {
  await prisma.profile.update({
    where: { userId },
    data: {
      hourBankLimitHours: limitHours,
    },
  });

  return { success: true, userId, limitHours };
}
