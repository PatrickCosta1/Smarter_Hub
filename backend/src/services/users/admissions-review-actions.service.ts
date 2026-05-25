import { sendAdmissionInviteEmail } from './admissions-email.service.js';
import {
  markAdmissionApprovedPendingContract,
  markAdmissionCorrectionRequested,
  notifyAdmissionReadyForContract,
} from './admissions-review.service.js';
import { buildAdmissionToken, buildFrontendAdmissionUrl, getAdmissionExpiryDate, hashAdmissionToken } from './initiate-admission.service.js';

export async function requestAdmissionCorrection(input: {
  admissionId: string;
  reviewerId: string;
  fullName: string;
  personalEmail: string;
  reason: string;
}) {
  const token = buildAdmissionToken();
  const invitationLink = buildFrontendAdmissionUrl(token);

  await markAdmissionCorrectionRequested({
    admissionId: input.admissionId,
    reviewerId: input.reviewerId,
    reason: input.reason,
    submissionTokenHash: hashAdmissionToken(token),
    tokenExpiresAt: getAdmissionExpiryDate(),
  });

  await sendAdmissionInviteEmail({
    personalEmail: input.personalEmail,
    fullName: input.fullName,
    invitationLink,
    reviewReason: input.reason,
  });
}

export async function approveAdmissionPersonalData(input: {
  admissionId: string;
  reviewerId: string;
  fullName: string;
}) {
  await markAdmissionApprovedPendingContract({
    admissionId: input.admissionId,
    reviewerId: input.reviewerId,
  });

  await notifyAdmissionReadyForContract({
    actorUserId: input.reviewerId,
    fullName: input.fullName,
  });
}
