import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const [permissionGrantCount, notificationCount] = await Promise.all([
    prisma.permissionGrant.count(),
    prisma.notification.count(),
  ]);

  console.log('PermissionGrant:', permissionGrantCount);
  console.log('Notification:', notificationCount);
}

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
