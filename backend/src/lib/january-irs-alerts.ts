import type { PrismaClient } from '@prisma/client';

export const JANUARY_IRS_ALERT_TITLE = 'Verificação de início de ano: agregado familiar e Mod. 99';

const JANUARY_IRS_ALERT_MESSAGE =
  'É início de ano - confirma se existem alterações ao teu agregado familiar, ' +
  'morada ou situação fiscal. Se existirem alterações, submete a Declaração de ' +
  'Remunerações Mod. 99 o mais breve possível. Acede à tua ficha (separador Fiscal) ' +
  'para carregar o documento.';

function buildAlertTitle(year: number) {
  return `${JANUARY_IRS_ALERT_TITLE} (${year})`;
}

/**
 * Runs once per calendar year, during January only.
 * Sends a notification to all active collaborators asking them to confirm
 * family unit / address changes and to submit Mod. 99 if applicable.
 *
 * Idempotent: will not re-send if a notification with the same year-scoped title
 * already exists for a user, regardless of read state.
 */
export async function runJanuaryIrsAlertSweep(prisma: PrismaClient) {
  const now = new Date();
  const currentMonth = now.getUTCMonth(); // 0 = January
  const currentYear = now.getUTCFullYear();

  // Only fire in January
  if (currentMonth !== 0) {
    return { skipped: true, reason: 'not-january', scannedUsers: 0, createdNotifications: 0 };
  }

  const titleForYear = buildAlertTitle(currentYear);

  const activeUsers = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { not: 'CONVIDADO' },
    },
    select: { id: true },
  });

  if (activeUsers.length === 0) {
    return { skipped: false, reason: null, scannedUsers: 0, createdNotifications: 0 };
  }

  const userIds = activeUsers.map((u) => u.id);

  // Find users who already received the alert for this specific year
  const existingAlerts = await prisma.notification.findMany({
    where: {
      userId: { in: userIds },
      title: titleForYear,
    },
    select: { userId: true },
  });

  const alreadyAlerted = new Set(existingAlerts.map((n) => n.userId));
  const toCreate = userIds.filter((id) => !alreadyAlerted.has(id));

  if (toCreate.length === 0) {
    return { skipped: false, reason: null, scannedUsers: activeUsers.length, createdNotifications: 0 };
  }

  await prisma.notification.createMany({
    data: toCreate.map((userId) => ({
      userId,
      title: titleForYear,
      message: JANUARY_IRS_ALERT_MESSAGE,
    })),
  });

  return {
    skipped: false,
    reason: null,
    scannedUsers: activeUsers.length,
    createdNotifications: toCreate.length,
  };
}
