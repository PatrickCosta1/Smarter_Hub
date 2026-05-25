import type { Prisma } from '@prisma/client';
import {
  Prisma as PrismaNamespace,
} from '@prisma/client';
import { prisma } from './prisma.js';
import type {
  PerformanceReviewSubmissionCreate,
  PerformanceReviewSubmissionUpdate,
} from './schemas/performance-review.schema.js';

type PerformanceReviewSectionType =
  | 'REFLECTION_PREVIOUS_CYCLE'
  | 'BEHAVIORAL_COMPETENCIES'
  | 'OBJECTIVES_KPIS_CURRENT_YEAR'
  | 'LEADERSHIP_REFLECTION'
  | 'NEXT_CYCLE_REFLECTION'
  | 'OBJECTIVES_KPIS_NEXT_YEAR';

type PerformanceReviewCollaboratorType = 'SELF' | 'MANAGER';

type PerformanceReviewSubmissionStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'AWAITING_RESPONSE'
  | 'REVISED'
  | 'ACCEPTED'
  | 'CLOSED';

const prismaClient: any = prisma;

export async function findOrCreatePerformanceReviewCycle(cycleIdentifier: string) {
  const existing = await prismaClient.performanceReviewCycle.findUnique({
    where: { cycleIdentifier },
  });

  if (existing) {
    return existing;
  }

  return prismaClient.performanceReviewCycle.create({
    data: {
      cycleIdentifier,
    },
  });
}

export async function getPerformanceReviewSubmission(
  userId: string,
  cycleId: string,
  sectionType: PerformanceReviewSectionType,
  collaboratorType: PerformanceReviewCollaboratorType,
) {
  return prismaClient.performanceReviewSubmission.findUnique({
    where: {
      userId_cycleId_sectionType_collaboratorType: {
        userId,
        cycleId,
        sectionType,
        collaboratorType,
      },
    },
  });
}

export async function createPerformanceReviewSubmission(
  input: PerformanceReviewSubmissionCreate & { actorUserId: string },
) {
  const { actorUserId, ...data } = input;

  const submission = await prismaClient.performanceReviewSubmission.create({
    data: {
      userId: data.userId,
      cycleId: data.cycleId,
      sectionType: data.sectionType,
      collaboratorType: data.collaboratorType,
      content: data.content as Prisma.InputJsonValue,
      lastEditedBy: actorUserId,
      lastEditedAt: new Date(),
    },
  });

  await recordSubmissionHistory({
    submissionId: submission.id,
    cycleId: submission.cycleId,
    userId: submission.userId,
    sectionType: submission.sectionType,
    collaboratorType: submission.collaboratorType,
    previousStatus: 'DRAFT' as const,
    newStatus: 'DRAFT' as const,
    changeType: 'CREATED',
    changedBy: actorUserId,
  });

  return submission;
}

export async function updatePerformanceReviewSubmission(
  submissionId: string,
  input: PerformanceReviewSubmissionUpdate & { actorUserId: string },
) {
  const { actorUserId, ...updateData } = input;

  const existing = await prismaClient.performanceReviewSubmission.findUnique({
    where: { id: submissionId },
  });

  if (!existing) {
    throw new Error('Submission not found');
  }

  const updated = await prismaClient.performanceReviewSubmission.update({
    where: { id: submissionId },
    data: {
      content: (updateData.content ?? existing.content) as Prisma.InputJsonValue,
      status: updateData.status ?? existing.status,
      lastEditedBy: actorUserId,
      lastEditedAt: new Date(),
    },
  });

  if (updateData.status && updateData.status !== existing.status) {
    await recordSubmissionHistory({
      submissionId,
      cycleId: existing.cycleId,
      userId: existing.userId,
      sectionType: existing.sectionType,
      collaboratorType: existing.collaboratorType,
      previousStatus: existing.status,
      newStatus: updateData.status,
      changeType: 'STATUS_CHANGED',
      changedBy: actorUserId,
      changedContent: {
        from: existing.content,
        to: updateData.content ?? existing.content,
      },
    });
  }

  return updated;
}

export async function submitPerformanceReviewSubmission(
  submissionId: string,
  actorUserId: string,
) {
  const existing = await prismaClient.performanceReviewSubmission.findUnique({
    where: { id: submissionId },
  });

  if (!existing) {
    throw new Error('Submission not found');
  }

  if (existing.status !== 'DRAFT' && existing.status !== 'REVISED') {
    throw new Error(`Cannot submit submission in status ${existing.status}`);
  }

  const nextStatus = existing.status === 'REVISED' ? 'REVISED' : 'SUBMITTED';

  const updated = await prismaClient.performanceReviewSubmission.update({
    where: { id: submissionId },
    data: {
      status: nextStatus,
      submittedAt: existing.submittedAt || new Date(),
      lastEditedBy: actorUserId,
      lastEditedAt: new Date(),
    },
  });

  await recordSubmissionHistory({
    submissionId,
    cycleId: existing.cycleId,
    userId: existing.userId,
    sectionType: existing.sectionType,
    collaboratorType: existing.collaboratorType,
    previousStatus: existing.status,
    newStatus: nextStatus,
    changeType: 'SUBMITTED',
    changedBy: actorUserId,
  });

  return updated;
}

export async function proposeEditsToSubmission(
  submissionId: string,
  proposedEdits: Record<string, unknown>,
  actorUserId: string,
) {
  const existing = await prismaClient.performanceReviewSubmission.findUnique({
    where: { id: submissionId },
  });

  if (!existing) {
    throw new Error('Submission not found');
  }

  if (existing.status !== 'SUBMITTED' && existing.status !== 'ACCEPTED') {
    throw new Error(`Cannot propose edits to submission in status ${existing.status}`);
  }

  const updated = await prismaClient.performanceReviewSubmission.update({
    where: { id: submissionId },
    data: {
      status: 'AWAITING_RESPONSE',
      proposedEdits: proposedEdits as Prisma.InputJsonValue,
      proposedEditsBy: actorUserId,
      proposedEditsAt: new Date(),
      lastEditedBy: actorUserId,
      lastEditedAt: new Date(),
    },
  });

  await recordSubmissionHistory({
    submissionId,
    cycleId: existing.cycleId,
    userId: existing.userId,
    sectionType: existing.sectionType,
    collaboratorType: existing.collaboratorType,
    previousStatus: existing.status,
    newStatus: 'AWAITING_RESPONSE',
    changeType: 'EDITS_PROPOSED',
    changedBy: actorUserId,
    changedContent: proposedEdits,
  });

  return updated;
}

export async function acceptProposedEdits(
  submissionId: string,
  actorUserId: string,
) {
  const existing = await prismaClient.performanceReviewSubmission.findUnique({
    where: { id: submissionId },
  });

  if (!existing) {
    throw new Error('Submission not found');
  }

  if (existing.status !== 'AWAITING_RESPONSE') {
    throw new Error(`Cannot accept edits from submission in status ${existing.status}`);
  }

  if (!existing.proposedEdits) {
    throw new Error('No proposed edits found');
  }

  const updated = await prismaClient.performanceReviewSubmission.update({
    where: { id: submissionId },
    data: {
      status: 'REVISED',
      content: existing.proposedEdits as Prisma.InputJsonValue,
      proposedEdits: PrismaNamespace.JsonNull,
      proposedEditsBy: null,
      proposedEditsAt: null,
      lastEditedBy: actorUserId,
      lastEditedAt: new Date(),
    },
  });

  await recordSubmissionHistory({
    submissionId,
    cycleId: existing.cycleId,
    userId: existing.userId,
    sectionType: existing.sectionType,
    collaboratorType: existing.collaboratorType,
    previousStatus: existing.status,
    newStatus: 'REVISED',
    changeType: 'EDITS_ACCEPTED',
    changedBy: actorUserId,
  });

  return updated;
}

export async function rejectProposedEdits(
  submissionId: string,
  actorUserId: string,
) {
  const existing = await prismaClient.performanceReviewSubmission.findUnique({
    where: { id: submissionId },
  });

  if (!existing) {
    throw new Error('Submission not found');
  }

  if (existing.status !== 'AWAITING_RESPONSE') {
    throw new Error(`Cannot reject edits from submission in status ${existing.status}`);
  }

  const updated = await prismaClient.performanceReviewSubmission.update({
    where: { id: submissionId },
    data: {
      status: 'SUBMITTED',
      proposedEdits: PrismaNamespace.JsonNull,
      proposedEditsBy: null,
      proposedEditsAt: null,
      lastEditedBy: actorUserId,
      lastEditedAt: new Date(),
    },
  });

  await recordSubmissionHistory({
    submissionId,
    cycleId: existing.cycleId,
    userId: existing.userId,
    sectionType: existing.sectionType,
    collaboratorType: existing.collaboratorType,
    previousStatus: existing.status,
    newStatus: 'SUBMITTED',
    changeType: 'EDITS_REJECTED',
    changedBy: actorUserId,
  });

  return updated;
}

export async function acceptSubmission(
  submissionId: string,
  actorUserId: string,
) {
  const existing = await prismaClient.performanceReviewSubmission.findUnique({
    where: { id: submissionId },
  });

  if (!existing) {
    throw new Error('Submission not found');
  }

  if (existing.status !== 'SUBMITTED' && existing.status !== 'REVISED') {
    throw new Error(`Cannot accept submission in status ${existing.status}`);
  }

  const updated = await prismaClient.performanceReviewSubmission.update({
    where: { id: submissionId },
    data: {
      status: 'ACCEPTED',
      acceptedAt: existing.acceptedAt || new Date(),
      lastEditedBy: actorUserId,
      lastEditedAt: new Date(),
    },
  });

  await recordSubmissionHistory({
    submissionId,
    cycleId: existing.cycleId,
    userId: existing.userId,
    sectionType: existing.sectionType,
    collaboratorType: existing.collaboratorType,
    previousStatus: existing.status,
    newStatus: 'ACCEPTED',
    changeType: 'ACCEPTED',
    changedBy: actorUserId,
  });

  return updated;
}

export async function recordSubmissionHistory(input: {
  submissionId: string;
  cycleId: string;
  userId: string;
  sectionType: PerformanceReviewSectionType;
  collaboratorType: PerformanceReviewCollaboratorType;
  previousStatus: PerformanceReviewSubmissionStatus;
  newStatus: PerformanceReviewSubmissionStatus;
  changeType: string;
  changedBy: string;
  changedContent?: Record<string, unknown>;
}) {
  return prismaClient.performanceReviewHistory.create({
    data: {
      submissionId: input.submissionId,
      cycleId: input.cycleId,
      userId: input.userId,
      sectionType: input.sectionType,
      collaboratorType: input.collaboratorType,
      previousStatus: input.previousStatus,
      newStatus: input.newStatus,
      changeType: input.changeType,
      changedContent: input.changedContent as Prisma.InputJsonValue,
      changedById: input.changedBy,
    },
  });
}

export async function getPerformanceReviewSubmissionHistory(
  userId: string,
  cycleId: string,
) {
  return prismaClient.performanceReviewHistory.findMany({
    where: {
      userId,
      cycleId,
    },
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      changedBy: {
        select: {
          id: true,
          username: true,
          profile: {
            select: {
              nomeAbreviado: true,
            },
          },
        },
      },
    },
  });
}

export async function getSubmissionsByCycle(cycleId: string) {
  return prismaClient.performanceReviewSubmission.findMany({
    where: { cycleId },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          email: true,
          profile: {
            select: {
              nomeAbreviado: true,
              nomeCompleto: true,
            },
          },
          team: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });
}

export async function getSubmissionsByUserAndCycle(userId: string, cycleId: string) {
  return prismaClient.performanceReviewSubmission.findMany({
    where: {
      userId,
      cycleId,
    },
  });
}
