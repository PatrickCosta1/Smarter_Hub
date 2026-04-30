DO $$ BEGIN
  CREATE TYPE "HourBankEntryType" AS ENUM ('CREDIT', 'DEBIT');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "Profile"
ADD COLUMN IF NOT EXISTS "hourBankLimitHours" DOUBLE PRECISION NOT NULL DEFAULT 40;

CREATE TABLE IF NOT EXISTS "HourBankEntry" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "HourBankEntryType" NOT NULL,
  "hours" DOUBLE PRECISION NOT NULL,
  "reason" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HourBankEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "HourBankEntry_userId_createdAt_idx"
ON "HourBankEntry"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "HourBankEntry_createdById_idx"
ON "HourBankEntry"("createdById");

CREATE INDEX IF NOT EXISTS "HourBankEntry_type_createdAt_idx"
ON "HourBankEntry"("type", "createdAt");

DO $$ BEGIN
  ALTER TABLE "HourBankEntry"
  ADD CONSTRAINT "HourBankEntry_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "HourBankEntry"
  ADD CONSTRAINT "HourBankEntry_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
