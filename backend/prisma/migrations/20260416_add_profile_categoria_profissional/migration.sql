-- Add professional category to collaborator contract details.
ALTER TABLE "Profile"
ADD COLUMN "categoriaProfissional" TEXT NOT NULL DEFAULT '';
