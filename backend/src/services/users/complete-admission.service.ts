import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { sendTransactionalEmail } from '../../lib/email.js';

type ContractPayload = {
  companyEmail: string;
  companyUsername: string;
  cargo: string;
  categoriaProfissional: string;
  numeroMecanografico: string;
  funcao: string;
  dataInicioContrato: string;
  dataFimContrato: string;
  tipoContrato: string;
  regimeHorario: string;
};

export async function markAdmissionCompleted(input: {
  admissionId: string;
  reviewerId: string;
  contract: ContractPayload;
}) {
  return prisma.employeeAdmission.update({
    where: { id: input.admissionId },
    data: {
      status: 'COMPLETED',
      companyEmail: input.contract.companyEmail.trim().toLowerCase(),
      companyUsername: input.contract.companyUsername.trim().toLowerCase(),
      contractData: input.contract as unknown as Prisma.InputJsonValue,
      completedAt: new Date(),
      completedById: input.reviewerId,
    },
  });
}

export async function sendAdmissionCompletedEmail(input: {
  personalEmail: string;
  fullName: string;
  companyUsername: string;
  companyEmail: string;
}) {
  return sendTransactionalEmail({
    to: input.personalEmail,
    subject: 'Smarter Hub · admissão concluída',
    text: [
      `Olá ${input.fullName},`,
      '',
      'O teu processo de admissão foi concluído com sucesso.',
      `Username criado: ${input.companyUsername.trim().toLowerCase()}`,
      `Email da empresa: ${input.companyEmail.trim().toLowerCase()}`,
      '',
      'A autenticação no Smarter Hub segue a política definida pela empresa (Microsoft SSO ou credenciais geridas por RH).',
    ].join('\n'),
  });
}
