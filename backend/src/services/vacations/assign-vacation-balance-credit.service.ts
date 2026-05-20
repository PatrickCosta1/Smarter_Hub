import {
  createVacationBalanceCreditsWithNotifications,
  findVacationBalanceCreditTargetUsers,
} from '../../repositories/vacations.repository.js';

type AssignVacationBalanceCreditInput = {
  actorId: string;
  actorLabel: string;
  year: number;
  days: number;
  reason: string;
  targetUserIds: string[];
  validateTargetAccess?: (targetUserId: string) => Promise<boolean>;
};

type AssignVacationBalanceCreditResult =
  | {
    ok: true;
    createdCount: number;
    createdItems: unknown[];
  }
  | {
    ok: false;
    code: 'TARGET_NOT_FOUND' | 'TARGET_INACTIVE' | 'TARGET_PROTECTED' | 'TARGET_FORBIDDEN';
    message: string;
  };

export async function assignVacationBalanceCredit(
  input: AssignVacationBalanceCreditInput,
): Promise<AssignVacationBalanceCreditResult> {
  const targetUsers = await findVacationBalanceCreditTargetUsers(input.targetUserIds);

  if (targetUsers.length !== input.targetUserIds.length) {
    return {
      ok: false,
      code: 'TARGET_NOT_FOUND',
      message: 'Um ou mais colaboradores não foram encontrados.',
    };
  }

  const inactiveTarget = targetUsers.find((item) => !item.isActive);
  if (inactiveTarget) {
    return {
      ok: false,
      code: 'TARGET_INACTIVE',
      message: 'Um ou mais colaboradores estão inativos.',
    };
  }

  const protectedTarget = targetUsers.find((item) => item.isRootAccess || item.hasAccessTotal);
  if (protectedTarget) {
    return {
      ok: false,
      code: 'TARGET_PROTECTED',
      message: 'Só é permitido creditar saldo para colaboradores sem acesso total.',
    };
  }

  if (input.validateTargetAccess) {
    for (const targetUser of targetUsers) {
      const canCredit = await input.validateTargetAccess(targetUser.id);
      if (!canCredit) {
        return {
          ok: false,
          code: 'TARGET_FORBIDDEN',
          message: 'Sem permissões para creditar saldo a um dos colaboradores selecionados com as restrições atuais.',
        };
      }
    }
  }

  const created = await createVacationBalanceCreditsWithNotifications({
    actorId: input.actorId,
    actorLabel: input.actorLabel,
    year: input.year,
    days: input.days,
    reason: input.reason,
    targetUserIds: targetUsers.map((item) => item.id),
  });

  return {
    ok: true,
    createdCount: created.length,
    createdItems: created,
  };
}
