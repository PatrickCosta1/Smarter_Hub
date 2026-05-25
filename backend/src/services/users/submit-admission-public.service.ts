import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { notifyUsers } from '../../lib/notifications.js';

async function resolveAdmissionReviewersByCountry(workCountry: 'PT' | 'BR') {
  const reviewers = await prisma.user.findMany({
    where: {
      isActive: true,
      AND: [
        {
          OR: [
            { isRootAccess: true },
            {
              permissionAssignments: {
                some: {
                  isEnabled: true,
                  permission: { code: 'approve_profile_change' },
                },
              },
            },
          ],
        },
        {
          OR: [
            { isRootAccess: true },
            { profile: { is: { workCountry } } },
          ],
        },
      ],
    },
    select: { id: true },
  });

  return Array.from(new Set(reviewers.map((item) => item.id)));
}

type SubmitAdmissionPublicInput = {
  admissionId: string;
  fullName: string;
  personalEmail: string;
  workCountry: 'PT' | 'BR';
  brWorkState?: 'SP' | 'RS' | null;
  normalizedPersonalData: Record<string, unknown>;
};

export async function submitAdmissionPublicForm(input: SubmitAdmissionPublicInput) {
  await prisma.employeeAdmission.update({
    where: { id: input.admissionId },
    data: {
      personalData: input.normalizedPersonalData as Prisma.InputJsonValue,
      status: 'SUBMITTED',
      reviewReason: '',
      submittedAt: new Date(),
      reviewedAt: null,
      reviewedById: null,
    },
  });

  const reviewerIds = await resolveAdmissionReviewersByCountry(input.workCountry);
  await notifyUsers(prisma, reviewerIds, 'Novo pedido de admissão', [
    `${input.fullName} submeteu a ficha de admissão e está pronto para revisão.`,
    `País: ${input.workCountry === 'BR' ? 'Brasil' : 'Portugal'}${input.brWorkState ? ` (${input.brWorkState})` : ''}`,
    `Email pessoal: ${input.personalEmail}`,
    'ação: Abrir admissões|/admissoes',
  ].join('\n'));
}
