-- CreateTable
CREATE TABLE "VacationCompanyExtraDay" (
  "id" TEXT NOT NULL,
  "country" "WorkCountry" NOT NULL,
  "date" TEXT NOT NULL,
  "label" TEXT NOT NULL DEFAULT 'Dia dado pela empresa',
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VacationCompanyExtraDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VacationCompanyExtraDay_country_date_key" ON "VacationCompanyExtraDay"("country", "date");

-- CreateIndex
CREATE INDEX "VacationCompanyExtraDay_country_date_idx" ON "VacationCompanyExtraDay"("country", "date");

-- CreateIndex
CREATE INDEX "VacationCompanyExtraDay_createdById_idx" ON "VacationCompanyExtraDay"("createdById");

-- AddForeignKey
ALTER TABLE "VacationCompanyExtraDay"
ADD CONSTRAINT "VacationCompanyExtraDay_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
