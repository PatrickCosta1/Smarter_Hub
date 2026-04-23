CREATE INDEX IF NOT EXISTS "Training_userId_createdAt_idx" ON "Training"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "Training_assignedByUserId_createdAt_idx" ON "Training"("assignedByUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "Training_status_createdAt_idx" ON "Training"("status", "createdAt");
