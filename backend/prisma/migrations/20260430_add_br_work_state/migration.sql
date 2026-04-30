DO $$ BEGIN
  CREATE TYPE "BrWorkState" AS ENUM ('SP', 'RS');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "Profile"
ADD COLUMN IF NOT EXISTS "brWorkState" "BrWorkState";

CREATE INDEX IF NOT EXISTS "Profile_workCountry_brWorkState_idx"
ON "Profile"("workCountry", "brWorkState");

-- Regra base do banco de horas BR: limite acumulado de 100h.
UPDATE "Profile"
SET "hourBankLimitHours" = 100
WHERE "workCountry" = 'BR' AND "hourBankLimitHours" < 100;
