import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

type VacationApprovalGroup = {
  level: number;
  approverIds: string[];
};

type VacationRequestPayload = {
  dataInicio: string;
  dataFim: string;
  observacoes: string;
  requestType: 'VACATION' | 'ABSENCE_MEDICAL' | 'ABSENCE_TRAINING';
  partialDay: 'FULL' | 'AM' | 'PM';
  attachmentLink: string;
};

type CreateVacationRequestInput = {
  actorUserId: string;
  targetUserId: string;
  contextTeamId: string | null;
  directApproveByAccessTotal: boolean;
  approvalGroups: VacationApprovalGroup[];
  data: VacationRequestPayload;
  beforeCreate?: (tx: Prisma.TransactionClient) => Promise<string[]>;
};

export async function findVacationTargetUserById(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      isActive: true,
      hasAccessTotal: true,
    },
  });
}

export async function findVacationCreateProfile(userId: string) {
  return prisma.profile.findUnique({
    where: { userId },
    select: {
      workCountry: true,
      brWorkState: true,
      nomeCompleto: true,
      nomeAbreviado: true,
      dataInicioContrato: true,
      isIntern: true,
    },
  });
}

export async function createVacationRequestTransaction(input: CreateVacationRequestInput) {
  let policyWarnings: string[] = [];

  const vacation = await prisma.$transaction(async (tx) => {
    if (input.beforeCreate) {
      policyWarnings = await input.beforeCreate(tx);
    }

    const created = await tx.vacation.create({
      data: {
        userId: input.targetUserId,
        contextTeamId: input.contextTeamId,
        dataInicio: input.data.dataInicio,
        dataFim: input.data.dataFim,
        observacoes: input.data.observacoes,
        requestType: input.data.requestType,
        partialDay: input.data.partialDay,
        attachmentLink: input.data.attachmentLink,
        status: input.directApproveByAccessTotal ? 'APPROVED' : 'PENDING',
        reviewedById: input.directApproveByAccessTotal ? input.actorUserId : null,
        reviewedAt: input.directApproveByAccessTotal ? new Date() : null,
        ...(input.directApproveByAccessTotal
          ? {
              reviewReason: 'Registo direto por utilizador com acesso total.',
              approvedByRole: 'ACCESS_TOTAL',
            }
          : {}),
        versionNumber: 1,
      },
    });

    if (!input.directApproveByAccessTotal) {
      for (const group of input.approvalGroups) {
        for (const approverId of group.approverIds) {
          await tx.vacationApproval.create({
            data: {
              vacationId: created.id,
              approverId,
              approvalLevel: group.level,
              status: group.level === input.approvalGroups[0].level ? 'PENDING' : 'WAITING',
            },
          });
        }
      }
    }

    return created;
  });

  return { vacation, policyWarnings };
}
