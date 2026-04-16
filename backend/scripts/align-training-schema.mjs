import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const columns = await prisma.$queryRaw`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'Training'
    ORDER BY column_name
  `;

  const columnNames = new Set(columns.map((row) => row.column_name));

  if (columnNames.has('duracao') && !columnNames.has('dataInicio')) {
    await prisma.$executeRawUnsafe('ALTER TABLE "Training" RENAME COLUMN "duracao" TO "dataInicio";');
    console.log('Renamed Training.duracao to Training.dataInicio');
  } else {
    console.log('Training column rename not needed');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
