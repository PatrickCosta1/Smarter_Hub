import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const username = 'ana';
  const email = 'ana@tlantic.local';
  const passwordHash = await bcrypt.hash('1111', 10);

  const existing = await prisma.user.findUnique({ where: { username } });

  if (existing) {
    await prisma.user.update({
      where: { username },
      data: {
        email,
        passwordHash,
        role: 'RH',
      },
    });

    const profile = await prisma.profile.findUnique({ where: { userId: existing.id } });
    if (!profile) {
      await prisma.profile.create({ data: { userId: existing.id } });
    }

    console.log('USER_UPDATED');
  } else {
    await prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
        role: 'RH',
        profile: { create: {} },
      },
    });

    console.log('USER_CREATED');
  }

  const user = await prisma.user.findUnique({
    where: { username },
    include: { profile: true },
  });

  console.log(
    JSON.stringify({
      id: user?.id,
      username: user?.username,
      email: user?.email,
      role: user?.role,
      hasProfile: Boolean(user?.profile),
    }),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
