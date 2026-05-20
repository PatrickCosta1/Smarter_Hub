import { prisma } from '../../lib/prisma.js';

export async function findUserById(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
  });
}

export async function createUser(data: {
  username: string;
  email: string;
  passwordHash?: string;
  role?: string;
  teamId?: string;
}) {
  return prisma.user.create({
    data: {
      username: data.username,
      email: data.email,
      passwordHash: data.passwordHash || '',
      ...(data.role && { role: data.role as any }),
      ...(data.teamId && { teamId: data.teamId }),
    },
  });
}