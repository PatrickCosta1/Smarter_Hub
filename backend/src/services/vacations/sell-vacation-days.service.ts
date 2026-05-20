import {
  findVacationSellProfile,
  sumVacationBalanceCreditsByUserYear,
  updateSoldVacationDays,
} from '../../repositories/vacations.repository.js';

type SellVacationDaysInput = {
  userId: string;
  days: number;
};

type SellVacationDaysResult =
  | {
    ok: true;
    soldVacationDays: number;
    maxSellable: number;
    entitledDays: number;
    availableEntitledDays: number;
  }
  | {
    ok: false;
    reason: 'NOT_BR_PROFILE' | 'DAYS_OVER_LIMIT';
    message: string;
  };

function brVacationDaysByAbsences(absences: number) {
  if (absences <= 5) return 30;
  if (absences <= 14) return 24;
  if (absences <= 23) return 18;
  if (absences <= 32) return 12;
  return 0;
}

export async function sellVacationDays(input: SellVacationDaysInput): Promise<SellVacationDaysResult> {
  const profile = await findVacationSellProfile(input.userId);

  if (profile?.workCountry !== 'BR') {
    return {
      ok: false,
      reason: 'NOT_BR_PROFILE',
      message: 'Venda de férias (abono) é uma funcionalidade exclusiva para colaboradores no regime BR.',
    };
  }

  const currentYear = new Date().getFullYear();
  const extraBalanceDays = await sumVacationBalanceCreditsByUserYear(input.userId, currentYear);
  const unjustifiedAbsences = profile.unjustifiedAbsences ?? 0;
  const isInternUser = profile.isIntern ?? false;
  const hireDate = profile.dataInicioContrato
    ? new Date(`${profile.dataInicioContrato}T00:00:00`)
    : new Date(`${currentYear}-01-01T00:00:00`);
  const now = new Date();
  const monthsWorked = (now.getFullYear() - hireDate.getFullYear()) * 12 + (now.getMonth() - hireDate.getMonth());
  const internProportionalDays = Math.min(30, Math.floor(monthsWorked * 2.5));
  const baseEntitledDays = isInternUser
    ? (monthsWorked < 12 ? 0 : internProportionalDays)
    : brVacationDaysByAbsences(unjustifiedAbsences);
  const entitledDays = baseEntitledDays + extraBalanceDays;
  const maxSellable = Math.min(10, Math.floor(entitledDays / 3));

  if (input.days > maxSellable) {
    return {
      ok: false,
      reason: 'DAYS_OVER_LIMIT',
      message: `Política BR: pode vender no máximo ${maxSellable} dias de férias (1/3 do total, máx. 10 dias). Tentou vender ${input.days} dias.`,
    };
  }

  await updateSoldVacationDays(input.userId, input.days);

  return {
    ok: true,
    soldVacationDays: input.days,
    maxSellable,
    entitledDays,
    availableEntitledDays: Math.max(entitledDays - input.days, 0),
  };
}
