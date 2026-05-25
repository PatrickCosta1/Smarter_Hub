import { prisma } from '../../lib/prisma.js';
import {
  getOccupationalHealthAlertsEnabled,
  setOccupationalHealthAlertsEnabled,
} from '../../lib/occupational-health-alerts.js';

export async function getOccupationalHealthAlertSettings() {
  return getOccupationalHealthAlertsEnabled(prisma);
}

export async function updateOccupationalHealthAlertSettings(enabled: boolean) {
  return setOccupationalHealthAlertsEnabled(prisma, enabled);
}
