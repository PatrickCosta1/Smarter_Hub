-- Replace profile first/last name structure with full name + short name.
ALTER TABLE "Profile" ADD COLUMN "nomeCompleto" TEXT NOT NULL DEFAULT '';

UPDATE "Profile"
SET "nomeCompleto" = TRIM(
  CONCAT(
    COALESCE("primeiroNome", ''),
    CASE WHEN COALESCE("primeiroNome", '') <> '' AND COALESCE("apelido", '') <> '' THEN ' ' ELSE '' END,
    COALESCE("apelido", '')
  )
)
WHERE COALESCE("nomeCompleto", '') = '';

UPDATE "Profile"
SET "nomeCompleto" = COALESCE("nomeAbreviado", '')
WHERE COALESCE("nomeCompleto", '') = '';

ALTER TABLE "Profile" DROP COLUMN "primeiroNome";
ALTER TABLE "Profile" DROP COLUMN "apelido";
