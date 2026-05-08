DO $$ BEGIN
  CREATE TYPE "VacationCompanyExtraScope" AS ENUM ('ALL', 'PT', 'BR', 'BR_SP', 'BR_RS');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "VacationCompanyExtraDay"
ADD COLUMN IF NOT EXISTS "scope" "VacationCompanyExtraScope" NOT NULL DEFAULT 'PT';

UPDATE "VacationCompanyExtraDay"
SET "scope" = CASE
  WHEN "country" = 'BR' THEN 'BR'::"VacationCompanyExtraScope"
  ELSE 'PT'::"VacationCompanyExtraScope"
END
WHERE "scope" IS DISTINCT FROM CASE
  WHEN "country" = 'BR' THEN 'BR'::"VacationCompanyExtraScope"
  ELSE 'PT'::"VacationCompanyExtraScope"
END;

DROP INDEX IF EXISTS "VacationCompanyExtraDay_country_date_key";
DROP INDEX IF EXISTS "VacationCompanyExtraDay_country_date_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "VacationCompanyExtraDay_scope_date_key"
ON "VacationCompanyExtraDay"("scope", "date");

CREATE INDEX IF NOT EXISTS "VacationCompanyExtraDay_scope_date_idx"
ON "VacationCompanyExtraDay"("scope", "date");

ALTER TABLE "VacationCompanyExtraDay"
DROP COLUMN IF EXISTS "country";
