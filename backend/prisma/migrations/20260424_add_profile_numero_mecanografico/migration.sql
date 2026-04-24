-- Add mecanographic number to collaborator contract details.
ALTER TABLE "Profile"
ADD COLUMN "numeroMecanografico" TEXT NOT NULL DEFAULT '';
