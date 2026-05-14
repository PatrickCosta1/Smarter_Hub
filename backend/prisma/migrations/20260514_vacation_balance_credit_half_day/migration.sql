-- Permite crédito de férias com meio dia (0.5)
ALTER TABLE "VacationBalanceCredit"
ALTER COLUMN "days" TYPE DOUBLE PRECISION
USING "days"::double precision;
