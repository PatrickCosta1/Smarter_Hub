import { prisma } from '../lib/prisma.js';

export type WellbeingSettingRecord = {
  textValue: string | null;
};

export async function findWellbeingSetting() {
  return prisma.systemSetting.findUnique({
    where: { key: 'wellbeing_page_content_v1' },
    select: { textValue: true },
  });
}

export async function upsertWellbeingSetting(textValue: string) {
  return prisma.systemSetting.upsert({
    where: { key: 'wellbeing_page_content_v1' },
    update: { textValue, boolValue: null },
    create: { key: 'wellbeing_page_content_v1', textValue, boolValue: null },
  });
}

export type WellbeingUserProfile = {
  id: string;
  username: string | null;
  email: string | null;
  profile: {
    nomeCompleto: string | null;
    nomeAbreviado: string | null;
    workCountry: string | null;
  } | null;
};

export async function findUserWithProfile(userId: string): Promise<WellbeingUserProfile | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      profile: {
        select: {
          nomeCompleto: true,
          nomeAbreviado: true,
          workCountry: true,
        },
      },
    },
  });
}

export type WellbeingRecipient = {
  id: string;
  username: string | null;
  email: string | null;
};

export async function findTPeopleRecipients(excludeUserId: string): Promise<WellbeingRecipient[]> {
  const candidates = await prisma.user.findMany({
    where: {
      isActive: true,
      id: { not: excludeUserId },
      username: { equals: 't.people', mode: 'insensitive' },
    },
    select: {
      id: true,
      username: true,
      email: true,
    },
  });

  return candidates.filter((candidate) => !!candidate.email) as WellbeingRecipient[];
}
