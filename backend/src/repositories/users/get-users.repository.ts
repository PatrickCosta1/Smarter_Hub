import { prisma } from '../../lib/prisma.js';

export async function findUserByIdWithProfile(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      profile: true,
      team: true,
      teamMemberships: {
        include: { team: true },
      },
      managedTeams: true,
    },
  });
}

export async function findUserById(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
  });
}

export async function findCollaboratorsList(filters: {
  skip: number;
  limit: number;
  search?: string;
  role?: string;
  teamId?: string;
  workCountry?: string;
}) {
  const whereClause: any = {
    isActive: true,
  };

  if (filters.search) {
    whereClause.OR = [
      { username: { contains: filters.search, mode: 'insensitive' } },
      { email: { contains: filters.search, mode: 'insensitive' } },
      { profile: { nomeCompleto: { contains: filters.search, mode: 'insensitive' } } },
    ];
  }

  if (filters.role) {
    whereClause.role = filters.role;
  }

  if (filters.teamId) {
    whereClause.teamId = filters.teamId;
  }

  if (filters.workCountry) {
    whereClause.profile = {
      ...whereClause.profile,
      workCountry: filters.workCountry,
    };
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where: whereClause,
      skip: filters.skip,
      take: filters.limit,
      include: {
        profile: true,
        team: true,
        teamMemberships: { include: { team: true } },
        managedTeams: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.count({ where: whereClause }),
  ]);

  return { users, total };
}
