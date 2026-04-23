CREATE UNIQUE INDEX IF NOT EXISTS "ProfileChangeRequest_userId_pending_unique"
ON "ProfileChangeRequest" ("userId")
WHERE "status" = 'PENDING';
