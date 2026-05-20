import { prisma } from '../../lib/prisma.js';

export async function getUserTrainings(userId: string, skip: number, take: number) {
  const [total, rows] = await Promise.all([
    prisma.training.count({ where: { userId } }),
    prisma.training.findMany({
      where: { userId },
      include: {
        assignedBy: {
          select: {
            id: true,
            username: true,
          },
        },
        user: {
          select: {
            id: true,
            username: true,
            profile: {
              select: {
                nomeAbreviado: true,
              },
            },
          },
        },
      },
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

export async function deleteTraining(trainingId: string, userId: string) {
  const training = await prisma.training.findUnique({
    where: { id: trainingId },
    select: { userId: true },
  });

  if (!training) {
    throw new Error('Training not found');
  }

  if (training.userId !== userId) {
    throw new Error('Unauthorized');
  }

  return prisma.training.delete({
    where: { id: trainingId },
  });
}
