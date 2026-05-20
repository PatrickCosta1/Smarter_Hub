import { prisma } from '../../lib/prisma.js';

export async function getUserVacations(userId: string, skip: number, take: number) {
  const [total, rows] = await Promise.all([
    prisma.vacation.count({ where: { userId } }),
    prisma.vacation.findMany({
      where: { userId },
      include: {
        contextTeam: { select: { id: true, name: true } },
        approvals: {
          select: {
            id: true,
            approverId: true,
            approvalLevel: true,
            status: true,
            decidedAt: true,
            reason: true,
          },
          orderBy: [{ approvalLevel: 'asc' }, { createdAt: 'asc' }],
        },
      },
      orderBy: [{ createdAt: 'desc' }],
      skip,
      take,
    }),
  ]);

  return {
    total,
    rows,
  };
}

export async function getVacationOverview(userId: string) {
  const [totalVacations, approvedVacations, pendingVacations] = await Promise.all([
    prisma.vacation.count({ where: { userId } }),
    prisma.vacation.count({ where: { userId, status: 'APPROVED' } }),
    prisma.vacation.count({ where: { userId, status: 'PENDING' } }),
  ]);

  return {
    total: totalVacations,
    approved: approvedVacations,
    pending: pendingVacations,
  };
}
