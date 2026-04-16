-- Add profile fields for nationality, identity card validity, and GitHub user.
ALTER TABLE "Profile"
ADD COLUMN "nacionalidade" TEXT NOT NULL DEFAULT '',
ADD COLUMN "githubUser" TEXT NOT NULL DEFAULT '',
ADD COLUMN "validadeCartaoCidadao" TEXT NOT NULL DEFAULT '';
