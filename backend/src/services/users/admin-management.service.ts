import { prisma } from '../../lib/prisma.js';

export async function deleteTeamById(teamId: string) {
  const existing = await prisma.team.findUnique({
    where: { id: teamId },
    select: { managerId: true },
  });

  await prisma.$transaction([
    prisma.teamMembership.deleteMany({ where: { teamId } }),
    prisma.user.updateMany({ where: { teamId }, data: { teamId: null } }),
    prisma.team.update({ where: { id: teamId }, data: { managerId: null, coordinatorId: null, parentTeamId: null } }),
    prisma.team.delete({ where: { id: teamId } }),
  ]);

  return {
    previousLeaderId: existing?.managerId ?? null,
  };
}

export async function deleteUserById(userId: string) {
  return prisma.user.delete({ where: { id: userId } });
}
