import { hasPermission } from '../../lib/permission-engine.js';
import { findActorWorkCountry } from './admissions-query.service.js';

type AdmissionCountry = 'PT' | 'BR';

export async function canUserReviewAdmissions(actor: { id: string; isRootAccess: boolean }) {
  if (actor.isRootAccess) {
    return true;
  }

  return hasPermission(actor.id, 'approve_profile_change');
}

export async function canUserReviewAdmissionCountry(actor: { id: string; isRootAccess: boolean }, admissionCountry: AdmissionCountry) {
  if (actor.isRootAccess) {
    return true;
  }

  const actorWorkCountry = await findActorWorkCountry(actor.id);
  return actorWorkCountry === admissionCountry;
}
