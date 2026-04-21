CREATE TABLE "VacationBalanceCredit" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "days" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VacationBalanceCredit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VacationBalanceCredit_userId_year_idx" ON "VacationBalanceCredit"("userId", "year");
CREATE INDEX "VacationBalanceCredit_createdById_idx" ON "VacationBalanceCredit"("createdById");

ALTER TABLE "VacationBalanceCredit"
ADD CONSTRAINT "VacationBalanceCredit_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VacationBalanceCredit"
ADD CONSTRAINT "VacationBalanceCredit_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
