import { prisma } from '../../lib/prisma.js';

const authTeamSelect = {
  id: true,
  name: true,
  costCenter: true,
  color: true,
};

function mapAuthTeam(team: any) {
  if (!team) return null;
  return team;
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
      profile: true,
    },
  });

  return user ? {
    ...user,
    team: mapAuthTeam(user.team),
    profile: user.profile || {
      nomeCompleto: '',
      nomeAbreviado: '',
      cargo: '',
      categoriaProfissional: '',
      // ...podes adicionar outros campos default se necessário
    },
  } : null;
}
