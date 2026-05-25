import { createHash } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { canAccessUserByPermission, hasPermission } from '../../lib/permission-engine.js';
import { normalizeStoredFilePath } from './file-storage.service.js';

const PROFILE_FILE_FIELDS = [
  'photoUrl',
  'certificadoHabilitacoesUrl',
  'cartaConducaoUrl',
  'comprovativoMoradaFiscal',
  'comprovativoCartaoCidadao',
  'comprovativoIban',
  'comprovativoCartaoContinente',
  'criminalRecordUrl',
] as const;

const ADMISSION_FILE_FIELDS = [
  'comprovativoMoradaFiscal',
  'comprovativoCartaoCidadao',
  'comprovativoIban',
  'declaracaoIrs',
  'comprovativoCartaoContinente',
] as const;

export async function canAccessAdmissionFileWithToken(admissionToken: string, relativePath: string) {
  const tokenHash = createHash('sha256').update(admissionToken).digest('hex');
  const admission = await prisma.employeeAdmission.findUnique({
    where: { submissionTokenHash: tokenHash },
    select: { tokenExpiresAt: true, personalData: true },
  });

  if (!admission || admission.tokenExpiresAt < new Date()) {
    return false;
  }

  const personalData = (admission.personalData && typeof admission.personalData === 'object')
    ? admission.personalData as Record<string, unknown>
    : {};

  for (const field of ADMISSION_FILE_FIELDS) {
    const value = personalData[field];
    if (typeof value !== 'string') {
      continue;
    }

    if (normalizeStoredFilePath(value) === relativePath) {
      return true;
    }
  }

  return false;
}

export async function canAccessProfileFileByScope(actorUserId: string, relativePath: string) {
  const candidates = Array.from(new Set([
    relativePath,
    `/uploads/${relativePath}`,
    `uploads/${relativePath}`,
    relativePath.split('/').pop() ?? relativePath,
  ]));

  const profile = await prisma.profile.findFirst({
    where: {
      OR: PROFILE_FILE_FIELDS.map((field) => ({
        [field]: { in: candidates },
      })) as Array<Record<string, unknown>>,
    },
    select: { userId: true },
  });

  if (!profile) {
    return false;
  }

  if (profile.userId === actorUserId) {
    return true;
  }

  return canAccessUserByPermission(actorUserId, 'view_user_list', profile.userId);
}

export async function canAccessHourBankFile(actorUserId: string, isRootAccess: boolean) {
  if (isRootAccess) {
    return true;
  }

  const [canView, canManage] = await Promise.all([
    hasPermission(actorUserId, 'view_hours_bank'),
    hasPermission(actorUserId, 'manage_hours_bank'),
  ]);

  return canView || canManage;
}

export async function canUploadAdmissionFile(token: string) {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const admission = await prisma.employeeAdmission.findUnique({
    where: { submissionTokenHash: tokenHash },
    select: { id: true, status: true, tokenExpiresAt: true },
  });

  if (!admission) {
    return false;
  }

  if (admission.tokenExpiresAt < new Date()) {
    return false;
  }

  return ['INVITED', 'CHANGES_REQUESTED', 'SUBMITTED'].includes(admission.status);
}
