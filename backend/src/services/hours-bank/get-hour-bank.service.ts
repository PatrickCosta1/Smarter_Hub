import { prisma } from '../../lib/prisma.js';
import { getHourBankTotalsByUserId, resolveBrClosingPolicy, resolveBrHourBankLimit, getNextClosingDateByPolicy } from '../../lib/hour-bank.js';

export async function getMyHourBankBalance(userId: string) {
  const [profile, entries] = await Promise.all([
    prisma.profile.findUnique({
      where: { userId },
      select: {
        workCountry: true,
        brWorkState: true,
        hourBankLimitHours: true,
      },
    }),
    prisma.hourBankEntry.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 120,
      select: {
        id: true,
        type: true,
        hours: true,
        reason: true,
        source: true,
        createdAt: true,
        createdBy: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    }),
  ]);

  const isBr = (profile?.workCountry ?? 'PT') === 'BR';
  const limitHours = isBr ? resolveBrHourBankLimit(profile?.hourBankLimitHours) : Math.max(profile?.hourBankLimitHours ?? 40, 0);
  const totals = await getHourBankTotalsByUserId(prisma, userId, limitHours);
  const closingPolicy = isBr ? resolveBrClosingPolicy(profile?.brWorkState ?? null) : null;

  return {
    geo: profile?.workCountry ?? 'PT',
    brWorkState: profile?.brWorkState ?? null,
    closingPolicyLabel: closingPolicy?.label ?? null,
    nextClosingDate: closingPolicy ? getNextClosingDateByPolicy(closingPolicy).toISOString().slice(0, 10) : null,
    ...totals,
    entries,
  };
}
