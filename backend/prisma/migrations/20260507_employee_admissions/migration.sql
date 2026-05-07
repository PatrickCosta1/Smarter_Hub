-- CreateTable
CREATE TABLE "EmployeeAdmission" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "personalEmail" TEXT NOT NULL,
    "workCountry" "WorkCountry" NOT NULL,
    "brWorkState" "BrWorkState",
    "status" TEXT NOT NULL DEFAULT 'INVITED',
    "personalData" JSONB NOT NULL DEFAULT '{}',
    "contractData" JSONB NOT NULL DEFAULT '{}',
    "companyEmail" TEXT NOT NULL DEFAULT '',
    "companyUsername" TEXT NOT NULL DEFAULT '',
    "reviewReason" TEXT NOT NULL DEFAULT '',
    "submissionTokenHash" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "lastInvitationSentAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "invitedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "completedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmployeeAdmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeAdmission_submissionTokenHash_key" ON "EmployeeAdmission"("submissionTokenHash");
CREATE INDEX "EmployeeAdmission_personalEmail_status_idx" ON "EmployeeAdmission"("personalEmail", "status");
CREATE INDEX "EmployeeAdmission_status_createdAt_idx" ON "EmployeeAdmission"("status", "createdAt");
CREATE INDEX "EmployeeAdmission_workCountry_status_idx" ON "EmployeeAdmission"("workCountry", "status");
CREATE INDEX "EmployeeAdmission_invitedById_idx" ON "EmployeeAdmission"("invitedById");
CREATE INDEX "EmployeeAdmission_reviewedById_idx" ON "EmployeeAdmission"("reviewedById");
CREATE INDEX "EmployeeAdmission_completedById_idx" ON "EmployeeAdmission"("completedById");

-- AddForeignKey
ALTER TABLE "EmployeeAdmission" ADD CONSTRAINT "EmployeeAdmission_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeAdmission" ADD CONSTRAINT "EmployeeAdmission_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmployeeAdmission" ADD CONSTRAINT "EmployeeAdmission_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
