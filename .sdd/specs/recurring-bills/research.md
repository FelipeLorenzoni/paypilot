# Research & Design Decisions — recurring-bills

## Summary
- **Scope**: Extension (brownfield) — new `RecurringBillsModule` + generation engine + in-process cron, plus a small source-scoping change to manual-expenses. See `gap-analysis.md`.

## Design Decisions

### Decision: Idempotency storage — Option A1 (nullable fields + `@@unique`)
- **Compared:**
  - **A1 (chosen):** add `recurringBillId String? @db.Uuid` + `periodKey String? @db.Char(7)` to `Transaction` with `@@unique([recurringBillId, periodKey])`. PostgreSQL treats `NULL`s as distinct, so manual rows (both null) never conflict, while recurring rows are unique per `(recurringBillId, periodKey)`. Native Prisma support, one write, race-safe.
  - **A2 (partial unique index):** `CREATE UNIQUE INDEX ... WHERE recurring_bill_id IS NOT NULL`. Equivalent guarantee but Prisma can't express the `WHERE` in the schema — needs custom SQL. Unnecessary given A1 works.
  - **B (separate `RecurringBillGeneration` table):** cleaner separation but an extra table + write per generation.
- **Selected A1**: simplest DB-level guarantee that satisfies R3 and keeps the generated row as the snapshot.

### Decision: Valid source/link states — DB CHECK constraint (custom SQL)
- Prevent invalid states: `RECURRING` must have both `recurringBillId` + `periodKey`; non-`RECURRING` (i.e. `MANUAL`) must have both NULL. Prisma can't model CHECK constraints in the schema, so add it via **custom SQL appended to the migration**:
  ```sql
  ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_link_chk" CHECK (
    (source = 'RECURRING' AND "recurringBillId" IS NOT NULL AND "periodKey" IS NOT NULL)
    OR
    (source <> 'RECURRING' AND "recurringBillId" IS NULL AND "periodKey" IS NULL)
  );
  ```
- DB-level is preferred; app-level + tests is the fallback only if the custom SQL proves problematic (documented).

### Decision: Source protection — scope ExpensesRepository to `MANUAL`
- `ExpensesRepository` currently scopes only `{ id, userId }`. Add `source: "MANUAL"` to **all** its where-clauses (findOwned/findMany/updateOwned/deleteOwned) so manual endpoints can't read/mutate `RECURRING` rows. Regression tests prove it.

### Decision: Scheduler — `@nestjs/schedule` (in-process cron)
- No Redis in the stack; BullMQ out of scope. `@nestjs/schedule` runs a cron in-process. **Non-production-grade**: a multi-instance deploy may double-fire; that is **safe only because DB-level idempotency (A1) is the source of truth** — no in-memory lock is relied on for correctness. BullMQ/Redis revisitable in a future ops spec.

### Decision: Controlled trigger (no admin/RBAC)
- The cron calls an internal `GenerationService.generateForPeriod(period)`. Operability/testing via that internal method + an optional local **CLI script** (`YYYY-MM` arg). **No public HTTP trigger.** Any test/local-only route must not be registered in the production app module.

### Decision: Period + clamp + eligibility
- `periodKey = "YYYY-MM"`. Generated date = `min(dayOfMonth, daysInMonth(period))` via the date-only helper (UTC midnight, no tz shift). Eligibility compares the **generated date** to `startDate`/`endDate`.

### Decision: Generation flow + concurrency
- For each eligible bill: attempt to insert the snapshot row; a `P2002` unique violation → treat as **already generated** (skip, count), never mutate the existing row. Concurrent runs (`Promise.all`) → exactly one row. Returns a per-run summary `{ created, skipped, failed }` (no cross-user data).

## Risks & Mitigations
- **Concurrency duplicates** → A1 unique + `P2002` catch (tested with `Promise.all`).
- **Invalid ledger states** → DB CHECK constraint.
- **Breaking manual-expenses** → source-scope + regression tests kept green.
- **Multi-instance cron double-fire** → safe via DB idempotency; documented as non-prod-grade.

## References
- `gap-analysis.md`; `docs/conventions.md`; manual-expenses ledger (`Transaction`, mapper).
