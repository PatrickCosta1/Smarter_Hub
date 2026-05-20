import { prisma } from '../../lib/prisma.js';
import { z } from 'zod';
import type { WorkCountry } from '@prisma/client';

const createUserSchema = z.object({
  username: z.string().min(3),
  email: z.string().email(),
  nomeCompleto: z.string().min(2),
  role: z.enum(['COLABORADOR', 'MANAGER', 'COORDENADOR', 'ADMIN', 'CONVIDADO']).optional(),
  workCountry: z.enum(['PT', 'BR']).optional(),
});

export async function createUser(data: z.infer<typeof createUserSchema>) {
  const parsedData = createUserSchema.parse(data);

  const user = await prisma.user.create({
    data: {
      username: parsedData.username,
      email: parsedData.email,
      passwordHash: '',
      role: parsedData.role ?? 'COLABORADOR',
      profile: {
        create: {
          nomeCompleto: parsedData.nomeCompleto,
          workCountry: (parsedData.workCountry ?? 'PT') as WorkCountry,
        },
      },
    },
    include: { profile: true },
  });

  return user;
}

export async function updateUserProfile(userId: string, data: any) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });

  if (!user) {
    throw new Error('User not found');
  }

  // Update profile if exists, else create
  if (user.profile) {
    await prisma.profile.update({
      where: { userId },
      data,
    });
  } else {
    await prisma.profile.create({
      data: {
        userId,
        ...data,
      },
    });
  }

  return user;
}