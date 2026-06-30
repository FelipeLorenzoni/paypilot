# Implementation Plan — recurring-bills (Executor-Grade)

> Builds on platform-foundation + auth-jwt + manual-expenses. Scope: recurring bill CRUD + **idempotent monthly generation** into the existing `Transaction` ledger (`source = RECURRING`). **Out of scope:** reminders/notifications, variable/usage amounts, proration, non-monthly frequencies, cards/installments, CSV import, non-BRL currency, dashboards, editing/deleting generated rows via bill endpoints, admin/RBAC, **Redis/BullMQ/external job infrastructure**.
> `(P)` = parallel-safe (independent files). Each task ends with `_Requirements: <ids>_`. Conventions: `apps/api/src/recurring-bills/`, repository over `PrismaService`, reuse global guard / `@CurrentUser` / `AllExceptionsFilter` / `Money` / `Clock`. DB-level idempotency is the source of truth — no in-memory lock.

---

## 1. Source protection (manual-expenses hardening) — EARLY

- [ ] 1.1 Scope `ExpensesRepository` to `source = MANUAL` + regression tests

  **Goal**
  Prevent manual expense operations from ever touching a `RECURRING` ledger row, before recurring rows exist (R13).

  **Deliverables**
  - `apps/api/src/expenses/expenses.repository.ts`: add `source: "MANUAL"` to the where-clause of **every** operation — `findOwned`, `findManyWithCount` (both `findMany` and the `count`), `updateOwned` (`updateMany` where + the post-update `findFirst`), `deleteOwned`.
  - Regression integration coverage (added in 9.x, but the repository change ships here) asserting manual endpoints cannot list/read/update/delete a `source = RECURRING` row.

  **Implementation notes**
  - The enum value `RECURRING` does not exist yet at this step; scoping to the literal `"MANUAL"` is forward-safe (Prisma typed against current enum). The regression test that needs a `RECURRING` row depends on task 3.x (enum) and 6.x (generation) — wire the assertion there, but keep the repository edit here so the guarantee predates any recurring write.
  - Do not change `ExpensesService`/controller behavior; manual-expenses existing tests must stay green.

  **Acceptance criteria**
  - All four operations filter by `source: "MANUAL"`; existing manual-expenses suite passes unchanged.

  **Verification**
  - `pnpm --filter @paypilot/api test` (unit) green; full proof in 9.2.

  **Out of scope**
  - Recurring model/generation.

  _Requirements: 13.1, 13.2, 13.4_

---

## 2. Dependency: scheduler

- [ ] 2.1 (P) Add `@nestjs/schedule` as an exact dependency

  **Goal**
  Bring in the in-process cron primitive (no external job infra).

  **Deliverables**
  - `apps/api/package.json`: `@nestjs/schedule` pinned to an **exact** version (no `^`/`~`, per the repo `savePrefix ""` policy); lockfile updated.

  **Implementation notes**
  - **Do not** add Redis, BullMQ, or any external queue. `@nestjs/schedule` runs in-process; correctness under multi-instance double-fire relies on DB-level idempotency (task 6).
  - Respect the supply-chain policy (`minimumReleaseAge`, `allowBuilds`); no new build-script approvals expected for this package.

  **Acceptance criteria**
  - `pnpm install --frozen-lockfile` reproduces; version is exact; `pnpm security:audit` stays green.

  **Verification**
  - `pnpm install` + `pnpm --filter @paypilot/api build` compile.

  **Out of scope**
  - Wiring the scheduler module (task 7).

  _Requirements: 9.1, 9.3_

---

## 3. Schema, idempotency link, and migration

- [ ] 3.1 `RecurringBill` model + `Transaction` recurring link + `RECURRING` enum + CHECK

  **Goal**
  Persist bills and give the ledger a DB-level idempotency guarantee + valid-state constraint.

  **Deliverables**
  - `schema.prisma`:
    - `model RecurringBill { id @db.Uuid, userId @db.Uuid (FK → User, onDelete: Restrict), amountMinor BigInt, currency String @db.Char(3), dayOfMonth Int @db.SmallInt, description String @db.VarChar(255), categoryLabel String? @db.VarChar(100), startDate DateTime @db.Date, endDate DateTime? @db.Date, isActive Boolean @default(true), createdAt/updatedAt @db.Timestamptz(6), transactions Transaction[], @@index([userId]), @@map("recurring_bills") }`; inverse relation on `User`.
    - `enum TransactionSource` += `RECURRING`.
    - `model Transaction` += `recurringBillId String? @db.Uuid` (FK → `RecurringBill`, `onDelete: Restrict`), `periodKey String? @db.Char(7)`, `@@unique([recurringBillId, periodKey])`.
  - Migration via `prisma migrate dev --create-only`, then **hand-append** the CHECK constraint SQL:
    ```sql
    ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_link_chk" CHECK (
      (source = 'RECURRING' AND "recurringBillId" IS NOT NULL AND "periodKey" IS NOT NULL)
      OR (source <> 'RECURRING' AND "recurringBillId" IS NULL AND "periodKey" IS NULL)
    );
    ```
  - Regenerated client.

  **Implementation notes**
  - `@@unique([recurringBillId, periodKey])` relies on Postgres treating NULLs as **distinct**, so `MANUAL` rows (both null) never collide while recurring rows are unique per (bill, period). This is the R6/R3 source of truth.
  - The generated `Transaction` row **is** the snapshot; no separate generation table.

  **Acceptance criteria**
  - Migration applies on an empty DB; unique index, FK (Restrict), and the named CHECK constraint exist; client typechecks with `RECURRING`.

  **Verification**
  - `pnpm db:generate` ok; migration applies against Testcontainers (asserted in 9.x).

  **Out of scope**
  - Service/generation logic.

  _Requirements: 5.3, 5.4, 6.1, 11.7, 12.1, 12.2, 13.2_

---

## 4. DTOs & validation

- [ ] 4.1 (P) Create / Update / List DTOs for recurring bills

  **Goal**
  Validate bill request shape at the API boundary.

  **Deliverables**
  - `CreateRecurringBillDto`: `amountMinor` (`@IsInt @IsPositive @Max(Number.MAX_SAFE_INTEGER)`), `currency` (trim+uppercase transform, `@IsIn(["BRL"])`), `dayOfMonth` (`@IsInt @Min(1) @Max(31)`), `description` (trim, `@IsNotEmpty`, `@MaxLength(255)`), `category?` (trim, `@MaxLength(100)`), `startDate` (`YYYY-MM-DD` regex + valid calendar date), `endDate?` (`YYYY-MM-DD`). Cross-field: when `endDate` is present, `endDate >= startDate` else 400.
  - `UpdateRecurringBillDto = PartialType(CreateRecurringBillDto)` (editable fields only; empty body → 400 via guard/validator). Never accepts `id`/owner/`isActive`/timestamps.
  - `ListRecurringBillsQueryDto`: `page` (default 1, `@Type(() => Number) @IsInt @Min(1)`), `pageSize` (default 20, `@Type(() => Number) @IsInt @Min(1) @Max(100)`), `active?` (`@Type(() => Boolean)`/transform) optional filter.

  **Implementation notes**
  - `source`/owner/`id`/`isActive`/timestamps are NOT in any DTO; `ValidationPipe` (`forbidNonWhitelisted`) rejects unknown fields with 400. Numeric/boolean query params transformed before validation.

  **Acceptance criteria**
  - Invalid amount, non-BRL, `dayOfMonth` outside 1–31, empty/over-long description, `endDate < startDate`, `pageSize > 100`, empty PATCH body → 400 `VALIDATION_ERROR`.

  **Verification**
  - Covered by integration (9.1) + DTO unit checks where useful.

  **Out of scope**
  - Persistence/business logic.

  _Requirements: 1.3, 11.2, 11.3, 11.4, 11.5, 11.6_

---

## 5. Mapper, period, clamp & eligibility helpers

- [ ] 5.1 (P) RecurringBill mapper (reuse money/date boundary)

  **Goal**
  Single tested boundary between a `recurring_bills` row and the API/domain shape.

  **Deliverables**
  - Mapper: guarded `bigint↔number` (reuse/extract the existing expenses mapper helpers via `@paypilot/shared` or a shared module), date `YYYY-MM-DD↔Date` (UTC midnight, no tz shift), row → `RecurringBillResponse` (renames `categoryLabel→category`). Unit tests.

  **Implementation notes**
  - Money built via `createMoney`. Raw `bigint` never serialized. If duplication with the expenses mapper is meaningful, extract the shared bigint/date helpers rather than copy.

  **Acceptance criteria**
  - bigint↔number round-trips and rejects unsafe ints; date round-trips with no tz shift.

  **Verification**
  - `pnpm --filter @paypilot/api test`.

  **Out of scope**
  - HTTP.

  _Requirements: 11.1, 11.8_

- [ ] 5.2 (P) Period derivation, day-clamp, and eligibility helpers (timezone-safe)

  **Goal**
  Deterministic, timezone-independent period/date math for generation.

  **Deliverables**
  - `deriveCurrentPeriod(clock: Clock): string` → `"YYYY-MM"` computed from `clock.now()` using **UTC** year/month (`getUTCFullYear`/`getUTCMonth`). Documented strategy: **UTC calendar month** (not server-local), justified in a code comment; the cron passes this into generation.
  - `clampDay(dayOfMonth: number, period: string): string` → `"YYYY-MM-DD"` = `min(dayOfMonth, daysInMonth(period))`, built date-only at UTC midnight (no tz shift).
  - `isEligible(bill, generatedDate): boolean` → `startDate <= generatedDate && (endDate == null || generatedDate <= endDate)`, all compared as date-only.
  - Unit tests including **month-boundary** behavior.

  **Implementation notes**
  - Depend on the `Clock` port (`CLOCK` token), never `Date.now()` directly. Use `FixedClock` in tests.
  - Period must NOT be derived from server-timezone-dependent timestamps (R7.4) — UTC is explicit and stable.

  **Acceptance criteria**
  - With `FixedClock` at `2026-01-31T23:30:00Z`, period = `"2026-01"`; with `2026-02-01T00:30:00Z`, period = `"2026-02"` (UTC boundary, independent of `process.env.TZ`).
  - `clampDay(31, "2026-02")` = `"2026-02-28"`; `clampDay(31, "2024-02")` = `"2024-02-29"`; `clampDay(31, "2026-04")` = `"2026-04-30"`; `clampDay(15, "2026-03")` = `"2026-03-15"`.
  - Eligibility boundaries inclusive on both `startDate` and `endDate`.

  **Verification**
  - `pnpm --filter @paypilot/api test` (run a case under `TZ=America/Sao_Paulo` to prove tz-independence).

  **Out of scope**
  - Persistence; cron wiring.

  _Requirements: 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3, 8.4_

---

## 6. Repository, service, and generation

- [ ] 6.1 RecurringBillsRepository (owner-scoped)

  **Goal**
  Owner-scoped Prisma access enforcing isolation in the query.

  **Deliverables**
  - `RecurringBillsRepository`: `create(userId, data)`, `findOwned(userId, id)`, `findManyWithCount(userId, { active?, skip, take })` → `{ rows, total }`, `updateOwned(userId, id, data)` (Prisma `$transaction`: `updateMany({ where: { id, userId } })`; `count === 0` → not-found; else `findOwned`), `deactivateOwned(userId, id)` (`updateMany({ where: { id, userId }, data: { isActive: false } })`; `count === 0` → not-found), `findActiveForGeneration()` (all `isActive: true` across users, for generation only).

  **Implementation notes**
  - Every owner-scoped query filters by `userId` (never `id` alone), `orderBy: [{ createdAt: "desc" }, { id: "desc" }]` for lists; `active` filter applied only when provided.
  - `findActiveForGeneration` is **not** owner-scoped (system generation across all users) and is only callable by `GenerationService`.

  **Acceptance criteria**
  - Cross-user id returns nothing (→ 404 at service); list returns only the user's rows, deterministic order.

  **Verification**
  - Covered by integration (9.1).

  **Out of scope**
  - Mapping/validation.

  _Requirements: 2.1, 2.3, 3.1, 3.2, 4.1, 4.2, 10.1, 10.2_

- [ ] 6.2 RecurringBillsService (CRUD + deactivate-on-delete)

  **Goal**
  Orchestrate validation, money/date mapping, ownership, and the deactivate semantics.

  **Deliverables**
  - `RecurringBillsService` with `create/list/get/update/deactivate`, returning `RecurringBillResponse` via the mapper. Unit tests.

  **Implementation notes**
  - `create`: build `Money` via `createMoney`; persist `isActive=true` default; owner from token.
  - `get/update/deactivate`: owner-scoped; not found/owned → `NotFoundException` (404, no disclosure). `update` applies only editable fields, never owner/`id`/`isActive`/timestamps, and never retroactively alters past generated transactions (it only mutates the bill row).
  - **`deactivate`** sets `isActive=false` (no hard delete); already-generated transactions are untouched. Returns void (controller → 204).
  - PATCH money merge: if only `amountMinor` or only `currency` provided, merge with existing persisted values and re-validate via `createMoney`.

  **Acceptance criteria**
  - Rejects amount ≤ 0 / non-BRL / `dayOfMonth` out of range; cross-user → 404; deactivate flips `isActive` and stops future generation without deleting history.

  **Verification**
  - `pnpm --filter @paypilot/api test` (service unit).

  **Out of scope**
  - HTTP wiring; generation.

  _Requirements: 1.1, 1.2, 1.5, 3.1, 3.3, 3.4, 3.5, 4.1, 4.3, 10.2, 11.1, 11.2, 11.3, 11.8_

- [ ] 6.3 GenerationService (`generateForPeriod`, idempotent)

  **Goal**
  Idempotently generate one snapshot transaction per eligible (bill, period), concurrency-safe.

  **Deliverables**
  - `GenerationService.generateForPeriod(period: string): Promise<GenerationSummary>` where `GenerationSummary = { period, created, skipped, failed }`.
  - Unit tests for classification/snapshot/summary.

  **Implementation notes**
  - Load active bills via `findActiveForGeneration`. For each: `date = clampDay(bill.dayOfMonth, period)`; if `!isEligible` → contributes 0. Else insert a `Transaction` with `type=EXPENSE`, `source=RECURRING`, `recurringBillId=bill.id`, `periodKey=period`, snapshotting `amountMinor`/`currency`/`description`/`categoryLabel` and `transactionDate=date`, owner = `bill.userId`.
  - Catch Prisma `P2002` (unique violation on `(recurringBillId, periodKey)`) → treat as **already generated**: `skipped++`, **never mutate** the existing row, continue. Other per-bill errors → `failed++`, logged with run correlation, never aborting the run, never leaking cross-user data.
  - Summary counts only; no per-user payload. Generated tx always owned by the bill's user (R10.3).

  **Acceptance criteria**
  - One eligible bill → 1 created; rerun same period → `skipped=1`, still exactly one row, existing row unchanged; inactive/out-of-window → 0.

  **Verification**
  - `pnpm --filter @paypilot/api test`; concurrency proof in 9.1.

  **Out of scope**
  - Scheduler/trigger wiring.

  _Requirements: 5.1, 5.2, 5.3, 5.5, 6.2, 6.3, 6.4, 6.5, 9.5, 10.3, 13.2, 13.3_

---

## 7. Scheduler, trigger, controller & module

- [ ] 7.1 GenerationScheduler (cron) + local CLI trigger

  **Goal**
  Run generation on a schedule for the timezone-safe current period, and allow controlled manual runs — no public HTTP.

  **Deliverables**
  - `GenerationScheduler` using `@nestjs/schedule` `@Cron(...)`: calls `generateForPeriod(deriveCurrentPeriod(clock))`; logs the returned summary.
  - A **local CLI script** (e.g. `apps/api/src/recurring-bills/generate.cli.ts` run via a package script) accepting a `YYYY-MM` arg → calls `generateForPeriod`. No public HTTP trigger; any test/local route must NOT be registered in the production `AppModule`.

  **Implementation notes**
  - Document the cron as **non-production-grade**: multi-instance double-fire is safe only because of DB idempotency (task 3/6), no in-memory lock relied on. No Redis/BullMQ.
  - Period comes from `deriveCurrentPeriod(clock)` (UTC month) — never server-local time.

  **Acceptance criteria**
  - Scheduler resolves period via the `Clock` (UTC) and invokes generation; CLI runs a given period; no public generation endpoint exists.

  **Verification**
  - `pnpm --filter @paypilot/api build`; CLI smoke run against the local/compose DB.

  **Out of scope**
  - Distributed locking / queue infra.

  _Requirements: 9.1, 9.2, 9.3, 9.4, 7.5_

- [ ] 7.2 RecurringBillsController + RecurringBillsModule

  **Goal**
  Expose `/api/v1/recurring-bills` CRUD, protected by the global guard; wire the module.

  **Deliverables**
  - `RecurringBillsController`: `POST /` (201), `GET /` (list + pagination meta), `GET /:id` (`ParseUUIDPipe`), `PATCH /:id`, `DELETE /:id` → **deactivate, `204 No Content`**; owner from `@CurrentUser`.
  - `RecurringBillsModule` providing controller + service + repository + `GenerationService` + `GenerationScheduler`, importing `ScheduleModule.forRoot()` and the `Clock` provider; wired into `AppModule`. No generation HTTP route.

  **Implementation notes**
  - Routes protected by default (global `JwtAuthGuard`) → 401 unauthenticated. Errors via `AllExceptionsFilter`. Never return a raw row (bigint) — always `RecurringBillResponse`. `DELETE` performs deactivation (never deletes generated transactions).

  **Acceptance criteria**
  - Unauthenticated → 401; create → 201 `RecurringBillResponse`; `DELETE /:id` → 204 and flips `isActive`; malformed `:id` → 400.

  **Verification**
  - Covered by integration (9.1); `pnpm --filter @paypilot/api build`.

  **Out of scope**
  - Non-CRUD/generation endpoints.

  _Requirements: 1.1, 1.4, 2.1, 2.2, 2.3, 3.1, 4.1, 4.2, 4.3, 9.2, 10.1, 10.4_

---

## 8. (reserved)

---

## 9. Integration & final gate

- [ ] 9.1 Recurring-bills + generation integration suite (Testcontainers)

  **Goal**
  Prove CRUD, isolation, idempotency under concurrency, eligibility/clamp, and deactivate semantics against real PostgreSQL.

  **Deliverables**
  - `apps/api/test/recurring-bills.int.spec.ts` using Testcontainers + `migrate deploy` + the global app setup (guard/pipe/filter/request-id), registering users via the auth flow for tokens. Generation invoked via the internal `GenerationService`/CLI path (not HTTP).

  **Acceptance criteria** (all pass; suite exits non-zero on failure)
  - **Bill CRUD**: create → 201 `RecurringBillResponse` (`amountMinor` number, dates `YYYY-MM-DD`); validation 400s (amount, BRL, `dayOfMonth`, `endDate<startDate`, empty PATCH); list paginated, own-only, deterministic order.
  - **Isolation**: user B cannot read/update/deactivate user A's bill → 404.
  - **Delete = deactivate**: `DELETE /:id` → 204, bill `isActive=false`; a transaction already generated for a past period **still exists** afterward.
  - **Idempotency / R3**: generate same (bill, period) twice → exactly one row, `skipped=1` on rerun; **concurrent** `Promise.all([generateForPeriod(p), generateForPeriod(p)])` → exactly one row; rerun does **not mutate** the existing transaction (compare snapshot fields + `createdAt`).
  - **Eligibility**: inactive bill and out-of-window bill → 0 generated; boundary `startDate`/`endDate` inclusive.
  - **Clamp**: `dayOfMonth=31` generates `…-02-28`/`…-02-29`/`…-04-30` correctly for the right months.
  - **Snapshot/classification**: generated row is `type=EXPENSE`, `source=RECURRING`, carries bill amount/currency/description/category, owned by the bill's user; changing the bill afterward does not alter the past row.

  **Verification**
  - `pnpm --filter @paypilot/api test:integration` (Docker required).

  **Out of scope**
  - Source-protection + CHECK assertions (9.2).

  _Requirements: 2.2, 3.5, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 7.2, 8.1, 8.2, 8.4, 9.4, 9.5, 10.1, 10.3, 10.4, 12.4_

- [ ] 9.2 Source-protection + CHECK-constraint integration assertions

  **Goal**
  Prove ledger source protection (R13) and reject invalid link states at the DB.

  **Deliverables**
  - Tests (in the recurring-bills suite or a shared ledger suite) exercising both manual and recurring rows.

  **Acceptance criteria**
  - **Source protection**: after generating a `RECURRING` row for user A, user A's **manual** expense endpoints cannot **list** it (absent from `GET /api/v1/expenses`), nor **read/update/delete** it by id → 404. Existing manual-expenses suite stays green.
  - **CHECK constraint — both invalid states rejected** via raw insert/update:
    1. `source = 'RECURRING'` with `recurringBillId`/`periodKey` NULL → DB error (constraint violation).
    2. `source = 'MANUAL'` with `recurringBillId`/`periodKey` populated → DB error.
  - Valid states accepted: `MANUAL` with both NULL; `RECURRING` with both set.

  **Verification**
  - `pnpm --filter @paypilot/api test:integration`.

  **Out of scope**
  - App-level fallback (only if CHECK proves unworkable, documented).

  _Requirements: 6.1, 12.2, 13.1, 13.2, 13.3, 13.4_

- [ ] 9.3 README + final quality gate

  **Goal**
  Document the recurring-bills endpoints + generation, and confirm the monorepo gate is green.

  **Deliverables**
  - README: `/api/v1/recurring-bills` endpoint list (incl. `DELETE` = deactivate → 204), generation overview (cron derives UTC current period; idempotent per bill/period; CLI for manual runs; non-production-grade scheduler; no Redis).

  **Acceptance criteria**
  - `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm format:check`, `pnpm test` (incl. integration), `pnpm build`, `pnpm security:audit` all pass.

  **Verification**
  - Run the full gate; record results.

  **Out of scope**
  - CI pipeline files; deployment.

  _Requirements: 9.3, 12.3_
