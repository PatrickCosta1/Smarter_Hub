import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const [permissionGrantResult, notificationResult] = await prisma.$transaction([
    prisma.permissionGrant.deleteMany({}),
    prisma.notification.deleteMany({}),
  ]);

  console.log('Deleted permission grants:', permissionGrantResult.count);
  console.log('Deleted notifications:', notificationResult.count);
}

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
