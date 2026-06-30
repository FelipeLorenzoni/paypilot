# Implementation Plan — manual-expenses (Executor-Grade)

> Builds on platform-foundation + auth-jwt. Scope: manual expense CRUD over a generic `Transaction` ledger. **No** other ledger producers (recurring bills, cards, CSV, reminders), no categories taxonomy, no reporting, no soft-delete/status workflow, no multi-currency conversion.
> `(P)` = parallel-safe (independent files). Each task ends with `_Requirements: <ids>_`. Conventions: `apps/api/src/expenses/`, repository over `PrismaService`, reuse global guard / `@CurrentUser` / `AllExceptionsFilter` / `Money`.

---

## 1. Ledger model and migration

- [x] 1.1 Add the generic `Transaction` model + enums + migration

  **Goal**
  Persist the shared ledger spine (first model written to by manual expenses).

  **Deliverables**
  - `schema.prisma`: `enum TransactionType { EXPENSE }`, `enum TransactionSource { MANUAL }`, and `model Transaction` with `id`, `userId` (FK → `User`, `onDelete: Restrict`), `type`, `source`, `amountMinor BigInt`, `currency String @db.Char(3)`, `transactionDate DateTime @db.Date`, `description String @db.VarChar(255)`, `categoryLabel String? @db.VarChar(100)`, `createdAt`/`updatedAt` `@db.Timestamptz(6)`, `@@index([userId, transactionDate, id])` (aligned with the deterministic ordering), `@@map("transactions")`. Add the inverse relation on `User`.
  - A Prisma migration creating the enums + `transactions` table; regenerated client.

  **Implementation notes**
  - Generic field names (`transactionDate`, `categoryLabel`) — the API maps them to `expenseDate`/`category`. `categoryLabel` is free-text, not a relation. `onDelete: Restrict` (no purge via user deletion here).
  - Enums are intentionally single-value now; future specs extend them.

  **Acceptance criteria**
  - Migration applies on an empty DB; `transactions` has the FK (Restrict), unique-less owner index, and BIGINT/`date`/`timestamptz` column types.

  **Verification**
  - `pnpm db:generate` ok; migration applies against the Testcontainers/compose DB (asserted in 7.1).

  **Out of scope**
  - Any other ledger producer or business model.

  _Requirements: 7.1, 7.3, 7.4, 8.1, 8.2, 8.5, 11.1, 11.2, 12.1_

---

## 2. Money & date mapper

- [x] 2.1 (P) Mapper: bigint↔number (guarded) and date↔`YYYY-MM-DD`

  **Goal**
  Single, tested boundary between the ledger row and the API/domain shapes.

  **Deliverables**
  - A mapper module: `bigint → number` guarded by `Number.isSafeInteger` (throws if violated), `number → BigInt`; `YYYY-MM-DD → Date` (`T00:00:00.000Z`) and `Date → YYYY-MM-DD` (`toISOString().slice(0,10)`); row → `ExpenseResponse` mapping the field renames (`transactionDate→expenseDate`, `categoryLabel→category`).
  - Unit tests.

  **Implementation notes**
  - Money is built via `createMoney` (`@paypilot/shared`) — single source of safe-integer + ISO-4217 validation. Raw `bigint` must never be serialized to JSON.

  **Acceptance criteria**
  - bigint↔number round-trips; **rejects unsafe integers**; date round-trips with **no timezone shift**; response `amountMinor` is a `number`.

  **Verification**
  - `pnpm --filter @paypilot/api test` → mapper tests pass (incl. unsafe-int rejection and `2026-03-01`→`2026-03-01`).

  **Out of scope**
  - HTTP concerns.

  _Requirements: 7.1, 7.2, 7.5_

---

## 3. DTOs & validation

- [x] 3.1 (P) Create / Update / List DTOs

  **Goal**
  Validate request shape at the API boundary.

  **Deliverables**
  - `CreateExpenseDto`: `amountMinor` (`@IsInt @IsPositive @Max(Number.MAX_SAFE_INTEGER)`), `currency` (trim+uppercase transform, `@IsIn(["BRL"])` MVP), `expenseDate` (`YYYY-MM-DD` regex + valid calendar date), `description` (trim, `@IsNotEmpty`, `@MaxLength(255)`), `category?` (trim, `@MaxLength(100)`).
  - `UpdateExpenseDto = PartialType(CreateExpenseDto)` (PATCH; editable fields only). An **empty PATCH body** (no editable fields) shall be rejected with 400 (e.g. a custom "at least one field" validator or a service guard).
  - `ListExpensesQueryDto`: `page` (default 1, `@Type(() => Number) @IsInt @Min(1)`), `pageSize` (default 20, `@Type(() => Number) @IsInt @Min(1) @Max(100)`), `from?`/`to?` (`YYYY-MM-DD`). Cross-field rule: if both `from` and `to` are provided and `from > to`, reject with 400.

  **Implementation notes**
  - `type`/`source`/`id`/owner/timestamps are NOT in any DTO; the global `ValidationPipe` (`forbidNonWhitelisted`) rejects them with 400 if sent.
  - Numeric query params must be transformed (`@Type(() => Number)`) **before** validation (query strings arrive as text).

  **Acceptance criteria**
  - Invalid amount (≤0 / non-int / > `Number.MAX_SAFE_INTEGER`), non-BRL currency, bad date, empty/over-long description, `pageSize > 100`, **empty PATCH body**, or **`from > to`** → 400 `VALIDATION_ERROR`.

  **Verification**
  - Covered by integration (7.1) and DTO-level unit checks where useful.

  **Out of scope**
  - Persistence/business logic.

  _Requirements: 1.3, 1.6, 1.7, 1.8, 2.6, 4.4, 7.2, 7.3_

---

## 4. Repository (owner-scoped)

- [x] 4.1 ExpensesRepository

  **Goal**
  Owner-scoped Prisma access enforcing isolation in the query.

  **Deliverables**
  - `ExpensesRepository`: `create(userId, data)`, `findOwned(userId, id)`, `findManyWithCount(userId, { from, to, skip, take })` (returns `{ rows, total }`), `updateOwned(userId, id, data)`, `deleteOwned(userId, id)`.

  **Implementation notes**
  - Every query is scoped by `userId` (never by `id` alone). `findManyWithCount` returns rows **and** a `total` computed with the **same owner scope + inclusive date-range filter**; rows use `orderBy: [{ transactionDate: "desc" }, { id: "desc" }]` and the range `transactionDate: { gte?, lte? }` (each bound applied only when provided).
  - `updateOwned`: run inside a **Prisma transaction** — `updateMany({ where: { id, userId }, data })`; if `count === 0` → signal not-found (service throws 404); otherwise `findOwned` and **return the updated row**. Never update by `id` alone.
  - `deleteOwned`: `deleteMany({ where: { id, userId } })`; `count === 0` → not-found (404).

  **Acceptance criteria**
  - Cross-user id returns nothing (→ 404 at the service); list returns only the user's rows in deterministic order.

  **Verification**
  - Covered by integration (7.1).

  **Out of scope**
  - Mapping/validation (in service/mapper).

  _Requirements: 2.1, 2.3, 2.4, 2.5, 3.1, 3.2, 4.1, 4.2, 5.1, 5.2, 6.1, 6.2, 6.3_

---

## 5. Service

- [x] 5.1 ExpensesService (create/list/get/update/remove)

  **Goal**
  Orchestrate validation, money/date mapping, classification, and isolation.

  **Deliverables**
  - `ExpensesService` with `create/list/get/update/remove`, returning `ExpenseResponse` via the mapper.
  - Unit tests.

  **Implementation notes**
  - `create`: build `Money` via `createMoney`; set `type=EXPENSE`, `source=MANUAL` (server-side, never from client); persist via repository.
  - `get/update/remove`: use owner-scoped repository; not found/owned → `NotFoundException` (404). `update` applies only editable fields. `remove` is a hard delete.
  - **PATCH money merge:** since `UpdateExpenseDto` is partial, if only `amountMinor` or only `currency` is provided, the service shall merge the patch with the **existing persisted** amount/currency and validate the resulting value via `createMoney` before updating — never bypass `createMoney`.
  - All amounts pass the guarded bigint mapper; currency uppercased + BRL-only.

  **Acceptance criteria**
  - Sets `type`/`source`; rejects amount ≤ 0 and non-BRL; trims description/category; cross-user → 404; `update` cannot change `type`/`source`/owner/timestamps.

  **Verification**
  - `pnpm --filter @paypilot/api test` → service unit tests pass.

  **Out of scope**
  - HTTP wiring.

  _Requirements: 1.1, 1.2, 3.1, 3.3, 4.1, 4.4, 4.5, 5.1, 6.2, 7.1, 7.5, 11.1, 11.2, 11.3_

---

## 6. Controller & module

- [x] 6.1 ExpensesController + ExpensesModule

  **Goal**
  Expose `/api/v1/expenses` CRUD, protected by the global guard.

  **Deliverables**
  - `ExpensesController`: `POST /` (201), `GET /` (list), `GET /:id`, `PATCH /:id`, `DELETE /:id` (`204 No Content`); owner from `@CurrentUser`.
  - `ExpensesModule` (provides controller + service + repository), wired into `AppModule`.

  **Implementation notes**
  - Routes are protected by default (global `JwtAuthGuard`) — unauthenticated → 401. Errors via `AllExceptionsFilter` (400/401/404 canonical, requestId). Never return a raw `Transaction` row (bigint) — always the mapped `ExpenseResponse`.
  - `:id` params on `GET`/`PATCH`/`DELETE` use **`ParseUUIDPipe`** so a malformed id returns a canonical 400 `VALIDATION_ERROR` (not a Prisma/internal error).

  **Acceptance criteria**
  - Unauthenticated → 401; create → 201 `ExpenseResponse`; delete → 204; all responses use the canonical shapes.

  **Verification**
  - Covered by integration (7.1); `pnpm --filter @paypilot/api build` compiles the wiring.

  **Out of scope**
  - Non-CRUD endpoints.

  _Requirements: 1.1, 1.4, 2.1, 3.1, 4.1, 5.1, 9.1, 9.2_

---

## 7. Integration & final gate

- [x] 7.1 Expenses integration suite (Testcontainers) incl. blocking non-UTC date test

  **Goal**
  Prove CRUD, isolation, validation, listing, and the date round-trip against real PostgreSQL.

  **Deliverables**
  - Integration tests (`apps/api/test/expenses.int.spec.ts`) using Testcontainers + `migrate deploy` + the same global app setup (guard, pipe, filter, request-id), registering users via the auth flow for tokens.

  **Implementation notes**
  - The non-UTC date round-trip must be **deterministic**: set `TZ=America/Sao_Paulo` **before the test process starts** (e.g. a dedicated test script/`cross-env` or an isolated jest project/command). Do **not** rely on mutating `process.env.TZ` mid-suite (Node caches the zone; unreliable). Document the command used.

  **Acceptance criteria** (all pass; suite exits non-zero on failure)
  - Create → 201 `ExpenseResponse` (`amountMinor` is a **number**; `expenseDate` is `YYYY-MM-DD`; `type=EXPENSE`/`source=MANUAL`).
  - Validation: amount ≤ 0 → 400; non-BRL → 400; empty/over-long description → 400; `pageSize > 100` → 400.
  - Isolation: user B cannot read/update/delete user A's expense → 404 (no disclosure).
  - List: only own; deterministic order (`transactionDate desc, id desc`); inclusive date-range filter; pagination meta.
  - Delete → 204; subsequent GET → 404.
  - **Blocking date round-trip:** with the process in a non-UTC timezone (`TZ=America/Sao_Paulo`), a stored `expenseDate` reads back unchanged. If it shifts, switch to explicit string mapping before completing.

  **Verification**
  - `pnpm --filter @paypilot/api test:integration` → green (Docker required).

  **Out of scope**
  - E2E browser tests.

  _Requirements: 1.1, 1.3, 1.5, 1.6, 1.8, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 4.1, 4.2, 5.1, 5.2, 6.1, 6.3, 7.1, 7.2, 7.3, 7.4, 7.5, 10.1, 11.1, 11.2_

- [x] 7.2 README + final quality gate

  **Goal**
  Document the expenses endpoints and confirm the monorepo gate is green.

  **Deliverables**
  - README: brief `/api/v1/expenses` endpoint list + request/response shape note (`amountMinor` number, `expenseDate` `YYYY-MM-DD`, BRL MVP).

  **Acceptance criteria**
  - `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm format:check`, `pnpm test` (incl. integration), `pnpm build`, `pnpm security:audit` all pass.

  **Verification**
  - Run the full gate; record results.

  **Out of scope**
  - CI pipeline files; deployment.

  _Requirements: 10.1_
