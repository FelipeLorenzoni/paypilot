-- bill-payments: the payment date chosen by the user, distinct from the
-- instant the marker was recorded ("paidAt"). Date-only, like every other
-- business date in the ledger.

-- 1. Add the column as nullable so existing markers do not block it.
ALTER TABLE "payment_markers" ADD COLUMN "paidOn" DATE;

-- 2. Back-fill markers written by due-date-reminders with the UTC calendar
--    date of their recording instant (the only date they ever had).
UPDATE "payment_markers" SET "paidOn" = ("paidAt" AT TIME ZONE 'UTC')::date;

-- 3. Every marker now has a payment date.
ALTER TABLE "payment_markers" ALTER COLUMN "paidOn" SET NOT NULL;
