-- Remove salary field from collaborator profile contract data.
ALTER TABLE "Profile"
DROP COLUMN IF EXISTS "remuneracao";
