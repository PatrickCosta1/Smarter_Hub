import { prisma } from '../../lib/prisma.js';

const authTeamSelect = {
  id: true,
  name: true,
  description: true,
  isActive: true,
  isHidden: true,
};

function mapAuthTeam(team: any, isFullAccess: boolean) {
  if (!team) return null;
  return {
    ...team,
    description: isFullAccess ? team.description : null,
    isHidden: isFullAccess ? team.isHidden : null,
  };
}

export async function getCurrentUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      isActive: true,
      isRootAccess: true,
      hasAccessTotal: true,
      team: {
        select: authTeamSelect,
      },
    },
  });

  return user ? {
    ...user,
    team: mapAuthTeam(user.team, Boolean(user.isRootAccess || user.hasAccessTotal)),
  } : null;
}
