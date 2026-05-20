import { prisma } from '../../lib/prisma.js';

export async function getUserHourBankBalance(userId: string) {
  const [entries, credits] = await Promise.all([
    prisma.hourBankEntry.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.vacationBalanceCredit.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const totalHours = entries.reduce((sum, entry) => {
    return sum + (entry.type === 'CREDIT' ? entry.hours : -entry.hours);
  }, 0);

  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { hourBankLimitHours: true },
  });

  return {
    balance: totalHours,
    limitHours: profile?.hourBankLimitHours || 40,
    entries,
    credits,
  };
}
