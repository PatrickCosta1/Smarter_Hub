import { cancelPendingVacation, findPendingVacationByIdAndUser } from '../../repositories/vacations.repository.js';

type CancelVacationInput = {
  vacationId: string;
  userId: string;
};

export async function cancelVacationForOwner(input: CancelVacationInput) {
  const existing = await findPendingVacationByIdAndUser(input.vacationId, input.userId);

  if (!existing) {
    return { cancelled: false as const };
  }

  await cancelPendingVacation(input.vacationId);
  return { cancelled: true as const };
}
