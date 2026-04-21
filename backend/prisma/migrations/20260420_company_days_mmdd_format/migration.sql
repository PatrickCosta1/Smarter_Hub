-- Convert VacationCompanyExtraDay.date from YYYY-MM-DD to MM-DD format.
-- Days are now year-agnostic and repeat automatically each year.
UPDATE "VacationCompanyExtraDay"
SET "date" = SUBSTRING("date" FROM 6 FOR 5)
WHERE LENGTH("date") = 10 AND "date" ~ '^\d{4}-\d{2}-\d{2}$';

-- Remove any duplicate MM-DD rows that might have been created per year for the same country
-- (keep the most recently created one for each country+date pair).
DELETE FROM "VacationCompanyExtraDay" a
USING "VacationCompanyExtraDay" b
WHERE a."country" = b."country"
  AND a."date" = b."date"
  AND a."createdAt" < b."createdAt";
