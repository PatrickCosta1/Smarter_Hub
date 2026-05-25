import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { buildEmptyAdmissionPersonalData } from './admissions-public-data.service.js';

function normalizeTextField(value?: string | null) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

export function hashAdmissionToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function buildAdmissionToken() {
  return randomBytes(32).toString('hex');
}

function normalizeFrontendBaseUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'http://localhost:5173';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/$/, '');
  }

  return `https://${trimmed.replace(/\/$/, '')}`;
}

export function buildFrontendAdmissionUrl(token: string) {
  const configuredBase = String(process.env.FRONTEND_URL ?? '').split(',').map((item) => item.trim()).find(Boolean) || '';
  const frontendBase = normalizeFrontendBaseUrl(configuredBase);
  return `${frontendBase}/admissao/${encodeURIComponent(token)}`;
}

export function getAdmissionExpiryDate() {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 7);
  return expiry;
}

export async function createAdmissionInvitation(input: {
  actorUserId: string;
  fullName: string;
  personalEmail: string;
  workCountry: 'PT' | 'BR';
  brWorkState?: 'SP' | 'RS' | null;
}) {
  const normalizedFullName = normalizeTextField(input.fullName).replace(/\s+/g, ' ');
  const personalEmail = normalizeTextField(input.personalEmail).toLowerCase();
  const workCountry = input.workCountry;
  const brWorkState = workCountry === 'BR' ? (input.brWorkState ?? null) : null;

  const existingActiveAdmission = await prisma.employeeAdmission.findFirst({
    where: {
      personalEmail,
      status: { in: ['INVITED', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED_PENDING_CONTRACT'] },
    },
    select: { id: true },
  });

  if (existingActiveAdmission) {
    return { conflict: true as const };
  }

  const token = buildAdmissionToken();
  const invitationLink = buildFrontendAdmissionUrl(token);
  const admission = await prisma.employeeAdmission.create({
    data: {
      fullName: normalizedFullName,
      personalEmail,
      workCountry,
      brWorkState,
      personalData: buildEmptyAdmissionPersonalData({
        fullName: normalizedFullName,
        personalEmail,
        workCountry,
        brWorkState,
      }) as Prisma.InputJsonValue,
      submissionTokenHash: hashAdmissionToken(token),
      tokenExpiresAt: getAdmissionExpiryDate(),
      lastInvitationSentAt: new Date(),
      invitedById: input.actorUserId,
    },
    select: {
      id: true,
      fullName: true,
      personalEmail: true,
      workCountry: true,
      brWorkState: true,
      status: true,
      tokenExpiresAt: true,
    },
  });

  return {
    conflict: false as const,
    admission,
    invitationLink,
    personalEmail,
  };
}
