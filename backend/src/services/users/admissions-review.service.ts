import { prisma } from '../../lib/prisma.js';
import { notifyUsers } from '../../lib/notifications.js';

export async function findAdmissionById(admissionId: string) {
  return prisma.employeeAdmission.findUnique({ where: { id: admissionId } });
}

export async function markAdmissionCorrectionRequested(input: {
  admissionId: string;
  reviewerId: string;
  reason: string;
  submissionTokenHash: string;
  tokenExpiresAt: Date;
}) {
  return prisma.employeeAdmission.update({
    where: { id: input.admissionId },
    data: {
      status: 'CHANGES_REQUESTED',
      reviewReason: input.reason,
      reviewedAt: new Date(),
      reviewedById: input.reviewerId,
      submissionTokenHash: input.submissionTokenHash,
      tokenExpiresAt: input.tokenExpiresAt,
      lastInvitationSentAt: new Date(),
    },
  });
}

export async function markAdmissionApprovedPendingContract(input: {
  admissionId: string;
  reviewerId: string;
}) {
  return prisma.employeeAdmission.update({
    where: { id: input.admissionId },
    data: {
      status: 'APPROVED_PENDING_CONTRACT',
      reviewReason: '',
      reviewedAt: new Date(),
      reviewedById: input.reviewerId,
    },
  });
}

export async function notifyAdmissionReadyForContract(input: {
  actorUserId: string;
  fullName: string;
}) {
  return notifyUsers(prisma, [input.actorUserId], 'Admissão pronta para contrato', [
    `Os dados pessoais de ${input.fullName} foram aprovados.`,
    'Passo seguinte: preencher dados contratuais e criar o utilizador.',
    'ação: Abrir admissões|/admissoes',
  ].join('\n'));
}
