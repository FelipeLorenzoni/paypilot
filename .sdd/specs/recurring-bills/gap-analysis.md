# Gap Analysis — recurring-bills

## Current State (existing assets)

| Asset | Location | Reuse |
|-------|----------|-------|
| `Transaction` ledger (+ `type`/`source` enums) | `apps/api/prisma/schema.prisma` | Generated rows are `Transaction` (`source = RECURRING`) |
| money/date mapper (`createMoney`, bigint guard, `YYYY-MM-DD`) | `apps/api/src/expenses/expense.mapper.ts` | Money/date for bills + generated rows (extract to shared if needed) |
| `ExpensesRepository` pattern (owner-scoped) | `apps/api/src/expenses/expenses.repository.ts` | Template for `RecurringBillsRepository` |
| Global `JwtAuthGuard`, `@CurrentUser`, `assertOwnership` | `apps/api/src/auth/*`, `common/ownership.ts` | Auth + isolation, 404-like |
| `AllExceptionsFilter` + `ErrorCode` | `apps/api/src/common/` | Canonical 400/401/404/409 |
| DTO + `ParseUUIDPipe` + ValidationPipe pattern | `apps/api/src/expenses/dto/*`, controller | Bill DTOs / params |
| Testcontainers integration harness (serial, TZ) | `apps/api/test/*.int.spec.ts` | Generation + idempotency tests |

**Notable absences:** `TransactionSource` has **only `MANUAL`**; there is **no scheduler/queue** dependency; the compose stack is **Postgres-only (no Redis)**.

## Requirement → Asset Map (gaps tagged)

| Requirement | Existing | Gap |
|-------------|----------|-----|
| R1–R4 bill CRUD | expenses CRUD pattern | **Missing:** `RecurringBill` model + module/controller/service/repo + DTOs |
| R5 generation | `Transaction` ledger | **Missing:** generation service; **Decision:** how the generated row links to (bill, period) + snapshot |
| R6 idempotency (R3) | — | **Unknown/Decision:** DB-level uniqueness shape; concurrency handling (catch unique violation) |
| R7 period/day | mapper (date-only) | **Decision:** period representation (`YYYY-MM`) + clamp helper |
| R8 eligibility | — | **Constraint:** evaluate against generated date (start/end window) |
| R9 trigger/schedule | — | **Missing/Decision:** scheduler (no Redis) + controlled trigger (no admin) |
| R10 isolation | guard/`@CurrentUser`/scoped queries | **Constraint:** owner-scope all bill queries; generated tx owned by bill's user |
| R11 money/date | `createMoney`, mapper | **Constraint:** field validation (dayOfMonth 1–31, BRL, lengths, start/end) |
| R12 persistence/errors/tests | Prisma, filter, Testcontainers | **Missing:** migration + extend `source` enum + tests |
| R13 source protection | expenses repo (NOT source-scoped) | **Required change:** scope `ExpensesRepository` queries to `source = MANUAL` |

## Key Research / Decisions for Design

1. **Idempotency storage (R6 — main risk).** Two viable shapes for the DB-level (bill, period) uniqueness:
   - **(A, recommended)** Add nullable `recurringBillId` (FK → RecurringBill) + `periodKey` (e.g. `CHAR(7)` `"YYYY-MM"`) to `Transaction`, with a **partial unique index** `(recurringBillId, periodKey) WHERE recurringBillId IS NOT NULL`. The ledger row *is* the snapshot + link; one statement, race-safe via the index.
   - **(B)** A separate `RecurringBillGeneration` table `(recurringBillId, periodKey)` unique + `transactionId`. Cleaner separation; an extra table/write.
   Recommend (A). Either way, generation catches the unique violation (`P2002`) and treats it as "already generated".
2. **Extend `TransactionSource` enum** with `RECURRING` (migration).
3. **Source protection (R13) — required change to manual-expenses.** `ExpensesRepository` currently scopes only by `{ id, userId }`; add `source: "MANUAL"` to **all** its where-clauses (find/findMany/update/delete) so manual endpoints never read/mutate `RECURRING` rows. Manual-expenses tests must stay green.
3. **Scheduler — `@nestjs/schedule` (cron, in-process).** No Redis in the stack and BullMQ is out of scope unless justified; `@nestjs/schedule` runs a cron in-process (non-production-grade: a multi-instance deploy would double-fire, but the DB uniqueness from R6 makes that safe). BullMQ/Redis explicitly rejected for the MVP.
4. **Controlled trigger (no admin/RBAC).** The cron calls an internal `generateForPeriod(period)` service method; expose generation for tests/ops via that internal method + a CLI/local script (or a local/test-only route). No unsafe public endpoint.
5. **Period + clamp.** `periodKey = "YYYY-MM"`; generated date = `min(dayOfMonth, daysInMonth(period))` mapped via the existing date-only helper. Eligibility compares the **generated date** against `startDate`/`endDate`.
6. **Concurrency test.** Run two `generateForPeriod` calls concurrently (`Promise.all`) and assert exactly one row per (bill, period); assert the existing row is not mutated on rerun.

## Implementation Approach Options
- **Option A — Extend expenses module:** ❌ distinct domain + scheduling; would bloat expenses.
- **Option B — New `RecurringBillsModule` (recommended):** bill CRUD (mirror expenses) + a `GenerationService` + cron; plus the small `ExpensesRepository` source-scoping change. Clean, testable.
- **Option C — Hybrid (shared ledger-writer service):** factor a shared "ledger writer" used by both manual + recurring. ✅ DRY if more producers loom (cards/CSV do); ❌ more upfront abstraction. Reasonable to consider given the roadmap.

## Effort & Risk
- **Effort: M–L.** Bill CRUD is routine (reuse); the generation engine + idempotency + scheduler + the manual-expenses source-scoping change add weight.
- **Risk: Medium.** Concentrated in (a) idempotency under concurrency, (b) scheduler choice/operability, and (c) safely modifying `ExpensesRepository` without breaking manual-expenses. All are design-time decisions, not tooling unknowns.

## Recommendations for Design
- **Option B**, idempotency storage **(A)** (nullable `recurringBillId` + `periodKey` + partial unique index), `@nestjs/schedule` cron, internal trigger.
- Make `ExpensesRepository` source-scoped (`MANUAL`) as part of this spec and keep manual-expenses tests green (add a test that manual CRUD can't touch a RECURRING row).
- Consider extracting a small shared money/date + ledger-writer helper to avoid duplicating the mapper across `expenses` and `recurring-bills`.
- Carry research items 1–6 into the design.
