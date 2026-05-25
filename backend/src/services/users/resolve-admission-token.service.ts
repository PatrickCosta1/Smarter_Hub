import { createHash } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';

function hashAdmissionToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function resolveAdmissionByTokenOrThrow(token: string) {
  const tokenHash = hashAdmissionToken(token);
  const admission = await prisma.employeeAdmission.findUnique({
    where: { submissionTokenHash: tokenHash },
  });

  if (!admission) {
    throw new Error('Convite não encontrado.');
  }

  if (admission.status === 'COMPLETED' || admission.status === 'CANCELLED') {
    throw new Error('Este convite já não está disponível.');
  }

  if (admission.tokenExpiresAt < new Date()) {
    throw new Error('Este convite expirou.');
  }

  return admission;
}
