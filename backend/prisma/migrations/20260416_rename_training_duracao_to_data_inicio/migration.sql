-- Rename legacy training start-period column to explicit start date naming.
ALTER TABLE "Training" RENAME COLUMN "duracao" TO "dataInicio";
