import { prisma } from '../../lib/prisma.js';

type WorkCountry = 'PT' | 'BR';
type AdmissionStatus = 'DRAFT' | 'INVITED' | 'SUBMITTED' | 'CHANGES_REQUESTED' | 'APPROVED_PENDING_CONTRACT' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';

export async function findActorWorkCountry(userId: string) {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { workCountry: true },
  });

  return (profile?.workCountry ?? 'PT') as WorkCountry;
}

export async function listAdmissionsForReview(input: {
  isRootAccess: boolean;
  actorWorkCountry: WorkCountry;
}) {
  return prisma.employeeAdmission.findMany({
    where: {
      status: { in: ['SUBMITTED', 'APPROVED_PENDING_CONTRACT'] },
      ...(input.isRootAccess ? {} : { workCountry: input.actorWorkCountry }),
    },
    orderBy: [{ status: 'asc' }, { submittedAt: 'desc' }, { createdAt: 'desc' }],
    include: {
      invitedBy: { select: { id: true, username: true, email: true, profile: { select: { nomeAbreviado: true, nomeCompleto: true } } } },
      reviewedBy: { select: { id: true, username: true, email: true, profile: { select: { nomeAbreviado: true, nomeCompleto: true } } } },
    },
  });
}

export async function listAdmissionsWithPagination(input: {
  isRootAccess: boolean;
  actorWorkCountry: WorkCountry;
  status?: AdmissionStatus;
  page: number;
  pageSize: number;
}) {
  const where = {
    ...(input.isRootAccess ? {} : { workCountry: input.actorWorkCountry }),
    ...(input.status ? { status: input.status } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.employeeAdmission.count({ where }),
    prisma.employeeAdmission.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      include: {
        invitedBy: { select: { id: true, username: true, profile: { select: { nomeAbreviado: true } } } },
        reviewedBy: { select: { id: true, username: true, profile: { select: { nomeAbreviado: true } } } },
        completedBy: { select: { id: true, username: true, profile: { select: { nomeAbreviado: true } } } },
      },
    }),
  ]);

  return { total, rows };
}

export async function findAdmissionDetailById(admissionId: string) {
  return prisma.employeeAdmission.findUnique({
    where: { id: admissionId },
    include: {
      invitedBy: { select: { id: true, username: true, profile: { select: { nomeAbreviado: true } } } },
      reviewedBy: { select: { id: true, username: true, profile: { select: { nomeAbreviado: true } } } },
      completedBy: { select: { id: true, username: true, profile: { select: { nomeAbreviado: true } } } },
    },
  });
}
