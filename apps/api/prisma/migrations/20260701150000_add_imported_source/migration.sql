-- Step 1 of 2 (csv-import): add the enum value ALONE. The partial unique index
-- in the next migration references 'IMPORTED' in its predicate, and PostgreSQL
-- rejects "unsafe use of new value of enum type" when a value added in the same
-- transaction is used. `migrate deploy` commits this file before the next runs.
ALTER TYPE "TransactionSource" ADD VALUE 'IMPORTED';
