-- Add optional cost center for top-level teams.
ALTER TABLE "Team"
ADD COLUMN "costCenter" TEXT;
