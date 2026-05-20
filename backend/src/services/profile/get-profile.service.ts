import { prisma } from '../../lib/prisma.js';

export async function getUserProfile(userId: string) {
  const profile = await prisma.profile.findUnique({
    where: { userId },
  });

  if (!profile) {
    throw new Error('Profile not found');
  }

  return profile;
}
