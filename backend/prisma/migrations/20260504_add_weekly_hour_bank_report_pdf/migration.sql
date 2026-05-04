CREATE TABLE IF NOT EXISTS "WeeklyHourBankReport" (
  "id" TEXT NOT NULL,
  "weekLabel" TEXT NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "periodStart" TEXT NOT NULL,
  "periodEnd" TEXT NOT NULL,
  "totalUsers" INTEGER NOT NULL,
  "positiveUsers" INTEGER NOT NULL,
  "negativeUsers" INTEGER NOT NULL,
  "exceededUsers" INTEGER NOT NULL,
  "pdfFileName" TEXT NOT NULL,
  "pdfLinkPath" TEXT NOT NULL,
  "pdfPublicUrl" TEXT NOT NULL,
  "generatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WeeklyHourBankReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WeeklyHourBankReport_weekLabel_key"
ON "WeeklyHourBankReport"("weekLabel");

CREATE INDEX IF NOT EXISTS "WeeklyHourBankReport_generatedAt_idx"
ON "WeeklyHourBankReport"("generatedAt");

CREATE INDEX IF NOT EXISTS "WeeklyHourBankReport_generatedById_idx"
ON "WeeklyHourBankReport"("generatedById");

DO $$ BEGIN
  ALTER TABLE "WeeklyHourBankReport"
  ADD CONSTRAINT "WeeklyHourBankReport_generatedById_fkey"
  FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
