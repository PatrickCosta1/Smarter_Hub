import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

const APPROVAL_PENDING = 'PENDING';
const APPROVAL_WAITING = 'WAITING';
const APPROVAL_SKIPPED = 'SKIPPED';

export async function findPendingVacationByIdAndUser(vacationId: string, userId: string) {
  return prisma.vacation.findFirst({
    where: {
      id: vacationId,
      userId,
      status: 'PENDING',
    },
  });
}

export async function cancelPendingVacation(vacationId: string) {
  return prisma.$transaction([
    prisma.vacation.update({
      where: { id: vacationId },
      data: {
        status: 'CANCELLED',
        reviewReason: 'Cancelado pelo colaborador.',
      },
    }),
    prisma.vacationApproval.updateMany({
      where: {
        vacationId,
        status: { in: [APPROVAL_PENDING, APPROVAL_WAITING] },
      },
      data: {
        status: APPROVAL_SKIPPED,
        decidedAt: new Date(),
        reason: 'Cancelado pelo colaborador.',
      },
    }),
  ]);
}

export async function findVacationSellProfile(userId: string) {
  return prisma.profile.findUnique({
    where: { userId },
    select: {
      workCountry: true,
      unjustifiedAbsences: true,
      isIntern: true,
      dataInicioContrato: true,
    },
  });
}

export async function sumVacationBalanceCreditsByUserYear(userId: string, year: number) {
  const result = await prisma.vacationBalanceCredit.aggregate({
    where: { userId, year },
    _sum: { days: true },
  });

  return result._sum.days ?? 0;
}

export type VacationBalanceCreditTargetUser = {
  id: string;
  isActive: boolean;
  isRootAccess: boolean;
  hasAccessTotal: boolean;
};

export async function findVacationBalanceCreditTargetUsers(userIds: string[]): Promise<VacationBalanceCreditTargetUser[]> {
  if (userIds.length === 0) {
    return [];
  }

  return prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      isActive: true,
      isRootAccess: true,
      hasAccessTotal: true,
    },
  });
}

type CreateVacationBalanceCreditsInput = {
  actorId: string;
  actorLabel: string;
  year: number;
  days: number;
  reason: string;
  targetUserIds: string[];
};

export async function createVacationBalanceCreditsWithNotifications(input: CreateVacationBalanceCreditsInput) {
  return prisma.$transaction(async (tx) => {
    const credits = [];

    for (const targetUserId of input.targetUserIds) {
      const credit = await tx.vacationBalanceCredit.create({
        data: {
          userId: targetUserId,
          year: input.year,
          days: input.days,
          reason: input.reason,
          createdById: input.actorId,
        },
      });

      credits.push(credit);

      await tx.notification.create({
        data: {
          userId: targetUserId,
          title: 'Saldo de férias creditado',
          message: `Foram creditados ${input.days} dia(s) ao teu saldo de férias de ${input.year} por ${input.actorLabel}. Motivo: ${input.reason}`,
        },
      });
    }

    return credits;
  });
}

export async function updateSoldVacationDays(userId: string, soldVacationDays: number) {
  return prisma.profile.update({
    where: { userId },
    data: {
      soldVacationDays,
    },
  });
}

export async function findVersionableVacationByIdAndUser(vacationId: string, userId: string) {
  return prisma.vacation.findFirst({
    where: {
      id: vacationId,
      userId,
      status: { in: ['PENDING', 'APPROVED'] },
    },
  });
}

export async function findVacationVersionProfile(userId: string) {
  return prisma.profile.findUnique({
    where: { userId },
    select: { workCountry: true, brWorkState: true, dataInicioContrato: true, isIntern: true },
  });
}

export async function findMaxVacationVersionNumber(rootId: string) {
  const maxVersion = await prisma.vacation.findFirst({
    where: {
      OR: [{ id: rootId }, { versionOfId: rootId }],
    },
    orderBy: { versionNumber: 'desc' },
    select: { versionNumber: true },
  });

  return maxVersion?.versionNumber ?? 1;
}

export async function findVacationRequesterProfile(userId: string) {
  return prisma.profile.findUnique({
    where: { userId },
    select: { nomeAbreviado: true, nomeCompleto: true },
  });
}

export async function findTeamNameById(teamId: string) {
  return prisma.team.findUnique({ where: { id: teamId }, select: { name: true } });
}

type VacationApprovalGroup = {
  level: number;
  approverIds: string[];
};

type CreateVacationVersionTransactionInput = {
  existingVacationId: string;
  rootId: string;
  nextVersionNumber: number;
  userId: string;
  contextTeamId: string | null;
  approvalGroups: VacationApprovalGroup[];
  data: {
    dataInicio: string;
    dataFim: string;
    observacoes: string;
    requestType: 'VACATION' | 'ABSENCE_MEDICAL' | 'ABSENCE_TRAINING';
    partialDay: 'FULL' | 'AM' | 'PM';
    attachmentLink: string;
  };
  beforeCreate?: (tx: Prisma.TransactionClient) => Promise<void>;
};

export async function createVacationVersionTransaction(input: CreateVacationVersionTransactionInput) {
  return prisma.$transaction(async (tx) => {
    if (input.beforeCreate) {
      await input.beforeCreate(tx);
    }

    await tx.vacation.update({
      where: { id: input.existingVacationId },
      data: {
        status: 'CANCELLED',
        reviewReason: 'Pedido substituído por nova versão.',
      },
    });

    await tx.vacationApproval.updateMany({
      where: {
        vacationId: input.existingVacationId,
        status: { in: [APPROVAL_PENDING, APPROVAL_WAITING] },
      },
      data: {
        status: APPROVAL_SKIPPED,
        decidedAt: new Date(),
        reason: 'Versão substituída.',
      },
    });

    const nextVersion = await tx.vacation.create({
      data: {
        userId: input.userId,
        contextTeamId: input.contextTeamId,
        versionOfId: input.rootId,
        versionNumber: input.nextVersionNumber,
        dataInicio: input.data.dataInicio,
        dataFim: input.data.dataFim,
        observacoes: input.data.observacoes,
        requestType: input.data.requestType,
        partialDay: input.data.partialDay,
        attachmentLink: input.data.attachmentLink,
        status: 'PENDING',
      },
    });

    for (const group of input.approvalGroups) {
      for (const approverId of group.approverIds) {
        await tx.vacationApproval.create({
          data: {
            vacationId: nextVersion.id,
            approverId,
            approvalLevel: group.level,
            status: group.level === input.approvalGroups[0].level ? APPROVAL_PENDING : APPROVAL_WAITING,
          },
        });
      }
    }

    return nextVersion;
  });
}
