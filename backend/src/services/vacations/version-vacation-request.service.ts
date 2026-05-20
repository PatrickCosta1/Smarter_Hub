import { Prisma } from '@prisma/client';
import { createVacationVersionTransaction } from '../../repositories/vacations.repository.js';

type ApprovalGroup = {
  level: number;
  approverIds: string[];
};

type VersionVacationRequestInput = {
  existingVacationId: string;
  rootId: string;
  maxVersionNumber: number;
  userId: string;
  contextTeamId: string | null;
  approvalGroups: ApprovalGroup[];
  data: {
    dataInicio: string;
    dataFim: string;
    observacoes: string;
    requestType: 'VACATION' | 'ABSENCE_MEDICAL' | 'ABSENCE_TRAINING';
    partialDay: 'FULL' | 'AM' | 'PM';
    attachmentLink: string;
  };
  beforePersist?: (tx: Prisma.TransactionClient) => Promise<void>;
};

export async function versionVacationRequest(input: VersionVacationRequestInput) {
  return createVacationVersionTransaction({
    existingVacationId: input.existingVacationId,
    rootId: input.rootId,
    nextVersionNumber: input.maxVersionNumber + 1,
    userId: input.userId,
    contextTeamId: input.contextTeamId,
    approvalGroups: input.approvalGroups,
    data: input.data,
    beforeCreate: input.beforePersist,
  });
}
