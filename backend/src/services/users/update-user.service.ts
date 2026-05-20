import { prisma } from '../../lib/prisma.js';

export async function updateUserAdminData(userId: string, data: {
  role?: string;
  teamId?: string | null;
  nomeCompleto?: string;
  workCountry?: string;
  brWorkState?: string | null;
}) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });

  if (!user) {
    throw new Error('User not found');
  }

  // Update user base fields
  const updateData: any = {};
  if (data.role !== undefined) updateData.role = data.role;
  if (data.teamId !== undefined) updateData.teamId = data.teamId;

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: updateData,
    include: { profile: true, team: true },
  });

  // Update profile fields
  if (user.profile) {
    const profileData: any = {};
    if (data.nomeCompleto !== undefined) profileData.nomeCompleto = data.nomeCompleto;
    if (data.workCountry !== undefined) profileData.workCountry = data.workCountry;
    if (data.brWorkState !== undefined) profileData.brWorkState = data.brWorkState;

    if (Object.keys(profileData).length > 0) {
      await prisma.profile.update({
        where: { userId },
        data: profileData,
      });
    }
  }

  // Return updated user with fresh profile
  return prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true, team: true },
  });
}
