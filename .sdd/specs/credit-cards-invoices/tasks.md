# Implementation Plan — credit-cards-invoices (Executor-Grade)

> Builds on platform-foundation + auth-jwt + manual-expenses + recurring-bills. Scope: credit cards, idempotent+atomic card purchases (single/installment) into the shared `Transaction` ledger (`source = CARD`), invoice assignment (R4), predictable installments (R5), and a derived per-cycle invoice view. **Out of scope:** editing/deleting card transactions after creation, refund/chargeback/adjustment, paying an invoice, available-limit enforcement, interest/fees, reminders, CSV, multi-currency, stored Invoice entity, admin/RBAC.
> `(P)` = parallel-safe (independent files). Each task ends with `_Requirements: <ids>_`. Conventions: `apps/api/src/cards/`, pure domain with no framework imports, repository over `PrismaService`, reuse global guard / `@CurrentUser` / `AllExceptionsFilter` / `Money` / date-only mapper. DB-level uniqueness + a single `$transaction` are the source of truth for idempotency/atomicity.

---

## 1. Schema, CARD source, link columns, and CHECK rewrite

- [x] 1.1 `CreditCard` + `CardPurchase` models, `CARD` enum, `Transaction` card columns, source-aware CHECK

  **Goal**
  Persist cards and purchase plans, extend the ledger with card links, and give idempotency + valid link states a DB-level guarantee.

  **Deliverables**
  - `schema.prisma`:
    - `model CreditCard` (`id @db.Uuid`, `userId` FK → User `onDelete: Restrict`, `label VarChar(100)`, `closingDay`/`dueDay @db.SmallInt`, `creditLimitMinor BigInt?`, `isActive @default(true)`, `createdAt`/`updatedAt @db.Timestamptz(6)`, `@@index([userId])`, `@@map("credit_cards")`).
    - `model CardPurchase` (`id`, `userId` FK, `creditCardId` FK → CreditCard `onDelete: Restrict`, `idempotencyKey VarChar(200)`, `requestHash @db.Char(64)`, `purchaseDate @db.Date`, `amountMinor BigInt`, `currency @db.Char(3)`, `description VarChar(255)`, `categoryLabel VarChar(100)?`, `installments @db.SmallInt`, `startCycle @db.Char(7)`, timestamps, `@@unique([userId, idempotencyKey])`, `@@index([creditCardId])`, `@@map("card_purchases")`).
    - `enum TransactionSource` += `CARD`.
    - `Transaction` += `creditCardId @db.Uuid?` (FK, Restrict), `cardPurchaseId @db.Uuid?` (FK, Restrict), `invoiceCycle @db.Char(7)?`, `installmentSeq @db.SmallInt?`, `installmentTotal @db.SmallInt?`, `@@index([creditCardId, invoiceCycle])`. Inverse relations on `User`/`CreditCard`/`CardPurchase`.
  - Migration via `prisma migrate diff` → hand-edit → `migrate deploy`: **drop** `transactions_recurring_link_chk`, **add** `transactions_source_link_chk` — a source-aware CHECK where each of MANUAL / RECURRING / CARD sets exactly its own link columns and nulls the others; the CARD branch also asserts `installmentSeq >= 1 AND installmentTotal >= 1 AND installmentSeq <= installmentTotal`. Regenerated client.

  **Implementation notes**
  - Postgres NULLs-distinct is not relied on here (idempotency uniqueness is `(userId, idempotencyKey)`, both non-null). The composite CHECK is the valid-state guard across three sources; existing MANUAL/RECURRING rows satisfy the new constraint (card columns default NULL), so the swap is backward-compatible.
  - `type` stays `EXPENSE` (no new `TransactionType`).

  **Acceptance criteria**
  - Migration applies on a DB already holding MANUAL/RECURRING rows; the new named CHECK + FKs + indexes exist; client typechecks with `CARD`.

  **Verification**
  - `pnpm db:generate` ok; migration applies against Testcontainers (asserted in 8.x).

  **Out of scope**
  - Service/domain logic.

  _Requirements: 5.2, 9.1, 11.1, 11.4, 12.1, 12.2, 13.3_

---

## 2. DTOs, validation, and mappers

- [x] 2.1 (P) Credit-card + purchase + invoice-cycle DTOs

  **Goal**
  Validate request shape at the API boundary.

  **Deliverables**
  - `CreateCreditCardDto`: `label` (trim, `@IsNotEmpty`, `@MaxLength(100)`), `closingDay`/`dueDay` (`@IsInt @Min(1) @Max(31)`), `creditLimitMinor?` (`@IsInt @Min(0) @Max(Number.MAX_SAFE_INTEGER)`).
  - `UpdateCreditCardDto = PartialType(CreateCreditCardDto)` (editable fields only; empty body → 400; never `id`/owner/`isActive`/timestamps).
  - `ListCreditCardsQueryDto`: `page`/`pageSize` (`@Type(Number)`, `@Min(1)`, `pageSize @Max(100)`), `active?` using the **explicit boolean parser** (`"true"`→true, `"false"`→false, undefined→no filter, any other → 400) reused from the recurring-bills pattern.
  - `CreatePurchaseDto`: `idempotencyKey` (trim, `@IsNotEmpty`, `@MaxLength(200)`), `purchaseDate` (`IsIsoCalendarDate`), `amountMinor` (`@IsInt @IsPositive @Max(Number.MAX_SAFE_INTEGER)`), `currency` (trim+uppercase, `@IsIn(["BRL"])`), `description` (trim, `@IsNotEmpty`, `@MaxLength(255)`), `category?` (trim, `@MaxLength(100)`), `installments` (`@IsInt @Min(1) @Max(MAX_INSTALLMENTS)`).
  - Invoice-cycle path param validation: a pipe/validator enforcing `^\d{4}-(0[1-9]|1[0-2])$` → else 400.
  - `MAX_INSTALLMENTS = 24` constant (documented, hard-coded for MVP).

  **Implementation notes**
  - `source`/owner/`id`/link columns/timestamps are NOT in any DTO; `ValidationPipe` (`forbidNonWhitelisted`) rejects unknown fields. Numeric/boolean query params transformed before validation.

  **Acceptance criteria**
  - Invalid label/day/limit, non-BRL, non-positive amount, `installments` outside 1..24, empty PATCH, malformed cycle, bad `active` value → 400 `VALIDATION_ERROR`.

  **Verification**
  - Covered by integration (8.1) + DTO-level unit checks where useful.

  **Out of scope**
  - Persistence/business logic.

  _Requirements: 1.3, 1.4, 5.3, 5.5, 5.6, 8.5, 11.2, 11.3, 11.4_

- [x] 2.2 (P) Card response mappers

  **Goal**
  Single tested boundary between rows and API shapes.

  **Deliverables**
  - `CreditCardResponse` mapper (guarded `bigint→number` for `creditLimitMinor`, date/label passthrough, `categoryLabel→` n/a) reusing `common/ledger-money-date`.
  - `CardTransactionResponse` mapper for a generated ledger row: `amountMinor` (number), `invoiceCycle`, `dueDate` (`YYYY-MM-DD`), `installmentSeq`, `installmentTotal`, `description`, `category`. Unit tests.

  **Implementation notes**
  - Raw `bigint` never serialized; money via the shared guarded helper. Dates via the date-only helper (no tz shift).
  - **`dueDate` is derived directly from the row's `transactionDate`** (the design stores a CARD `transactionDate` = the invoice cycle due date). The mapper does **not** recompute `dueDate` from closing/due-day context — it has no card context and must not re-run assignment. (`InvoicesService`, which does hold the card, computes the invoice's due date independently.)

  **Acceptance criteria**
  - bigint↔number round-trips and rejects unsafe ints; dates round-trip with no tz shift.

  **Verification**
  - `pnpm --filter @paypilot/api test`.

  **Out of scope**
  - HTTP.

  _Requirements: 11.1, 11.6_

---

## 3. Pure domain: invoice assignment & installments

- [x] 3.1 (P) Invoice-assignment domain (R4)

  **Goal**
  Deterministic, timezone-independent invoice-cycle + due-date computation.

  **Deliverables**
  - `assignCycle(purchaseDate: "YYYY-MM-DD", closingDay: number): "YYYY-MM"` — effective closing = `min(closingDay, daysInMonth(month))`; `purchaseDay <= effectiveClosing` → purchase month, else next month (rolling the year at December). `invoiceCycle` = the **closing month**.
  - `dueDate(cycle: "YYYY-MM", closingDay: number, dueDay: number): "YYYY-MM-DD"` — if `dueDay > closingDay` due is in the cycle month, else it rolls to the following month; day clamped to that month's length.
  - Unit tests.

  **Implementation notes**
  - **Pure over explicit inputs** — no framework imports, **no system clock read** (R11.5 by construction). Date-only string math (no tz).

  **Acceptance criteria**
  - Worked examples (`closingDay=10, dueDay=20`): `2026-03-10` (inclusive) → `2026-03`; `2026-03-11` → `2026-04`; `2026-12-15` → `2027-01`. Short-month clamp (`closingDay=31` in Feb). `dueDay <= closingDay` rolls the due date to the next month; day clamped.

  **Verification**
  - `pnpm --filter @paypilot/api test` (run a case under `TZ=America/Sao_Paulo` to prove tz-independence).

  **Out of scope**
  - Persistence; installment amounts.

  _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 11.5_

- [x] 3.2 (P) Installments domain (R5)

  **Goal**
  Deterministic, sum-preserving installment split + consecutive cycle schedule.

  **Deliverables**
  - `splitInstallments(totalMinor: number, n: number): number[]` — `base = floor(total/n)`; residual `total - base*n` added to installment **1**; length `n`; sums exactly to `total`.
  - `installmentCycles(startCycle: "YYYY-MM", n: number): "YYYY-MM"[]` — `startCycle` then `n-1` consecutive months (year rolls).
  - Unit tests.

  **Implementation notes**
  - Pure; integer math only (no floats). Each per-installment amount is later validated via `createMoney` in the service.

  **Acceptance criteria**
  - Sum equals total; remainder on first; `n=1` → `[total]`; non-even division (e.g. `10000/3 → [3334,3333,3333]`); cycles consecutive incl. Dec→Jan roll.

  **Verification**
  - `pnpm --filter @paypilot/api test`.

  **Out of scope**
  - Assignment; persistence.

  _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

---

## 4. Repository & card CRUD service

- [x] 4.1 CreditCardsRepository (owner-scoped)

  **Goal**
  Owner-scoped Prisma access enforcing isolation in the query.

  **Deliverables**
  - `create(userId, data)`, `findOwned(userId, id)`, `findManyWithCount(userId, { active?, skip, take })` → `{ rows, total }`, `updateOwned(userId, id, data)` (Prisma `$transaction`: `updateMany` where `{id,userId}`; count 0 → not-found; else `findOwned`), `deactivateOwned(userId, id)` (`updateMany` set `isActive:false`; count 0 → not-found).

  **Implementation notes**
  - Every owner-scoped query filters by `userId` (never `id` alone); list `orderBy: [{ createdAt: "desc" }, { id: "desc" }]`; `active` filter applied only when provided.

  **Acceptance criteria**
  - Cross-user id returns nothing (→ 404 at service); list returns only the user's rows, deterministic order.

  **Verification**
  - Covered by integration (8.1).

  **Out of scope**
  - Mapping/validation; purchases.

  _Requirements: 2.1, 2.3, 3.1, 4.1, 10.1, 10.2_

- [x] 4.2 CreditCardsService (CRUD + deactivate-on-delete)

  **Goal**
  Orchestrate validation, money mapping, ownership, and deactivate semantics.

  **Deliverables**
  - `create/list/get/update/deactivate` returning `CreditCardResponse`. Unit tests.

  **Implementation notes**
  - `create`: validate `creditLimitMinor` (non-negative safe int) via the guarded mapper; `isActive=true` default; owner from token.
  - `get/update/deactivate`: owner-scoped; not found/owned → `NotFoundException` (404, no disclosure). `update` applies only editable fields, never owner/`id`/`isActive`/timestamps, and never retroactively reassigns already-generated transactions (it only mutates the card row).
  - `deactivate` sets `isActive=false` (no hard delete); generated transactions untouched; returns void (controller → 204).

  **Acceptance criteria**
  - Rejects `closingDay`/`dueDay` out of 1..31 and negative limit; cross-user → 404; deactivate flips `isActive` without deleting history; day changes affect only future assignment.

  **Verification**
  - `pnpm --filter @paypilot/api test` (service unit).

  **Out of scope**
  - HTTP wiring; purchases/invoices.

  _Requirements: 1.1, 1.2, 1.6, 1.7, 2.1, 2.2, 3.1, 3.4, 3.5, 4.1, 4.2, 4.3, 10.2, 11.6_

---

## 5. Purchase recording (idempotent + atomic)

- [x] 5.1 CardLedgerWriter (atomic plan + N CARD rows)

  **Goal**
  Persist a purchase plan and all its installment ledger rows atomically.

  **Deliverables**
  - A writer that, inside a **single `prisma.$transaction`**, inserts the `CardPurchase` (with `idempotencyKey` + `requestHash`) then the `N` `Transaction` rows (`source=CARD`, `cardPurchaseId`, `creditCardId`, `invoiceCycle`, `installmentSeq`, `installmentTotal`, `transactionDate = dueDate(cycle)`, snapshot amount/currency/description/category, owner = card user).
  - Unit tests (mocked prisma) asserting all-or-none and field mapping.

  **Implementation notes**
  - All-or-none: any failure rolls back the whole `$transaction` — a partial schedule is impossible. Each installment `transactionDate` is the **cycle due date** (date-only, no tz shift); invoice membership is driven by `invoiceCycle`, not the date.

  **Acceptance criteria**
  - On success, 1 plan + N rows with correct seq/total/cycle/date; on a forced mid-write failure, 0 rows persisted.
  - The forced-failure test triggers the error **inside the transaction in a test-safe way** (e.g. injecting a stub/spy that throws mid-write at the writer/service boundary, or a deliberately invalid row that the DB rejects) — **no** production-only test hooks, public test routes, or runtime flags.

  **Verification**
  - `pnpm --filter @paypilot/api test`; end-to-end atomicity in 8.1.

  **Out of scope**
  - Assignment/split (done in the service); HTTP.

  _Requirements: 5.1, 5.2, 5.7, 7.6, 7.7, 10.3_

- [x] 5.2 PurchasesService (assign, split, idempotent creation + reconciliation)

  **Goal**
  Record a purchase idempotently, producing the correct invoice-assigned installment schedule.

  **Deliverables**
  - `create(userId, cardId, input)` → `PurchaseResult`. Unit tests.

  **Implementation notes**
  - Load the owned card (404 if not owned/missing; **400** if inactive). Compute `startCycle = assignCycle(purchaseDate, closingDay)`, per-installment amounts via `splitInstallments` (each validated via `createMoney`), and cycles via `installmentCycles`. Compute `requestHash` = sha-256 of the **normalized full payload** (`creditCardId`, `purchaseDate`, `amountMinor`, `currency`, `description`, `category`, `installments`; currency-upper, description-trimmed, category-trimmed-or-null, date `YYYY-MM-DD`, integer amount/installments). Delegate the atomic write to the ledger writer.
  - **Idempotent reconciliation** on `P2002` (unique `idempotencyKey`): fresh read of the existing `CardPurchase`; same user + same `creditCardId` + same `requestHash` → return the existing result (no new rows); divergent normalized payload or different card under the same key → **409 `CONFLICT`** (`IDEMPOTENCY_KEY_REUSED`).

  **Acceptance criteria**
  - Single-payment → 1 row = full amount; N installments → N rows across consecutive cycles summing to the total; inactive card → 400; retry with same key+payload → existing result; same key + divergent payload/card → 409.

  **Verification**
  - `pnpm --filter @paypilot/api test`; concurrency + 409 proven in 8.1.

  **Out of scope**
  - HTTP wiring; invoice view.

  _Requirements: 5.1, 5.3, 5.4, 5.5, 7.1, 7.2, 7.3, 10.3, 11.2, 11.3, 11.6, 13.1, 13.2, 13.3, 13.4_

---

## 6. Invoice view (derived)

- [x] 6.1 InvoicesService (derived per-cycle invoice)

  **Goal**
  Compute a card's invoice for a cycle from the ledger, without a stored entity.

  **Deliverables**
  - `getInvoice(userId, cardId, cycle)` → `{ cardId, cycle, dueDate, totalMinor, transactions }`. Unit tests.

  **Implementation notes**
  - Validate `cycle` as `YYYY-MM` (else 400). Load the owned card (404 else) — **does not** filter `isActive`, so a deactivated card still returns its invoices (history preserved). Query `source=CARD AND creditCardId AND invoiceCycle` (owner-scoped), sum `amountMinor` exactly, compute `dueDate` from the card, order `installmentSeq, id`. Empty cycle → zero-total invoice (not an error).

  **Acceptance criteria**
  - Total = exact sum; due date computed; empty cycle → zero total; malformed cycle → 400; cross-user/unknown card → 404; deactivated card still returns invoices.

  **Verification**
  - `pnpm --filter @paypilot/api test`; end-to-end in 8.1.

  **Out of scope**
  - Payment/status; pagination (MVP).

  _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 10.1, 10.4_

---

## 7. Controllers & module wiring

- [x] 7.1 Controllers + CardsModule

  **Goal**
  Expose the card, purchase, and invoice endpoints, protected by the global guard; wire the module.

  **Deliverables**
  - `CreditCardsController`: `POST /api/v1/credit-cards` (201), `GET /` (list + meta), `GET /:id` (`ParseUUIDPipe`), `PATCH /:id`, `DELETE /:id` → **deactivate, 204**.
  - `PurchasesController`: `POST /api/v1/credit-cards/:cardId/purchases` (201; duplicate idempotent retry → existing result; divergent-key → 409).
  - `InvoicesController`: `GET /api/v1/credit-cards/:cardId/invoices/:cycle` (cycle validated `YYYY-MM`).
  - `CardsModule` providing controllers + `CreditCardsService`/`Repository` + `PurchasesService` + `CardLedgerWriter` + `InvoicesService`, wired into `AppModule`. Owner from `@CurrentUser`.

  **Implementation notes**
  - Routes protected by default (global `JwtAuthGuard`) → 401 unauthenticated. Errors via `AllExceptionsFilter` (400/401/404/409 canonical, requestId). Never return a raw row (bigint) — always mapped responses. No card-transaction edit/delete endpoints (out of scope).

  **Acceptance criteria**
  - Unauthenticated → 401; create card → 201; malformed `:id`/`:cardId` → 400; create purchase → 201 with schedule; `DELETE` card → 204 + `isActive=false`; invoice → 200.

  **Verification**
  - Covered by integration (8.1); `pnpm --filter @paypilot/api build`.

  **Out of scope**
  - Non-CRUD/transaction-mutation endpoints.

  _Requirements: 1.1, 1.5, 2.1, 2.2, 3.1, 4.1, 5.1, 8.1, 9.3, 10.1, 10.4, 13.4_

---

## 8. Integration & final gate

- [x] 8.1 Cards + purchases + invoices integration suite (Testcontainers)

  **Goal**
  Prove card CRUD, isolation, R4 assignment, R5 installments, idempotency, atomicity, and invoice views against real PostgreSQL.

  **Deliverables**
  - `apps/api/test/credit-cards.int.spec.ts` using Testcontainers + `migrate deploy` + the global app setup (guard/pipe/filter/request-id), registering users via the auth flow for tokens. Purchases invoked over HTTP.

  **Acceptance criteria** (all pass; suite exits non-zero on failure)
  - **Card CRUD**: create → 201 `CreditCardResponse`; validation 400s (day range, negative limit, empty PATCH, bad `active`); list paginated, own-only, deterministic; **isolation** cross-user → 404.
  - **DELETE = deactivate**: 204, `isActive=false`; previously generated card transactions still exist.
  - **Purchase / R4+R5**: single → 1 `CARD` row on the right cycle/date; N installments → N rows across consecutive cycles, correct seq/total, sum = total, snapshot fields, owner = card user; the 3 worked assignment examples; `installments > 24`/`< 1` → 400; inactive card → 400.
  - **Idempotency / R13**: same `idempotencyKey` + same payload twice → one plan + N rows, second returns existing; concurrent `Promise.all` → exactly one plan; same key + divergent payload or different card → **409**.
  - **Atomicity / R7**: a forced failure mid-write leaves **0** rows (no `CardPurchase`, no `Transaction`). The failure is induced in a **test-safe way** (stub/spy throwing inside the transaction, or a DB-rejected row) — **never** via production-only hooks, public test routes, or runtime flags.
  - **Invoice view / R8**: total = exact sum; due date computed; empty cycle → zero total; malformed cycle → 400; cross-user/unknown card → 404; deactivated card still returns invoices.
  - **tz safety**: installment `transactionDate` round-trips unchanged under `TZ=America/Sao_Paulo`.

  **Verification**
  - `pnpm --filter @paypilot/api test:integration` (Docker required).

  **Out of scope**
  - Source-protection + CHECK assertions (8.2).

  _Requirements: 1.1, 1.3, 2.1, 2.2, 3.1, 4.1, 4.2, 4.3, 5.1, 5.3, 5.4, 5.5, 5.7, 6.1, 6.2, 6.5, 6.7, 7.1, 7.2, 7.5, 7.6, 7.7, 8.1, 8.3, 8.4, 8.5, 10.1, 10.3, 10.4, 11.5, 12.4, 13.1, 13.2, 13.4_

- [x] 8.2 Source-protection + CHECK-constraint integration assertions

  **Goal**
  Prove three-source ledger protection (R9) and reject invalid link states at the DB.

  **Deliverables**
  - Tests exercising manual/recurring vs CARD rows and raw invalid inserts.

  **Acceptance criteria**
  - **Source protection**: after a purchase generates `CARD` rows for user A, A's **manual** expense endpoints cannot list/read/update/delete them (404 / absent from list); credit-card endpoints never mutate `MANUAL`/`RECURRING` rows; existing manual + recurring suites stay green.
  - **CHECK** rejects each invalid link state via raw insert: MANUAL/RECURRING/CARD with wrong columns set, **and** a `CARD` row violating installment invariants (`installmentSeq < 1`, `installmentTotal < 1`, or `installmentSeq > installmentTotal`). Valid states accepted.

  **Verification**
  - `pnpm --filter @paypilot/api test:integration`.

  **Out of scope**
  - App-level fallback.

  _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 12.2_

- [x] 8.3 README + final quality gate

  **Goal**
  Document the credit-card endpoints and confirm the monorepo gate is green.

  **Deliverables**
  - README: `/api/v1/credit-cards` CRUD (DELETE = deactivate → 204), purchase endpoint (idempotencyKey, installments ≤ 24, 409 on key reuse), invoice view (cycle = closing month `YYYY-MM`, derived total + due date); note `source = CARD` and no card-transaction edit/delete in this spec.

  **Acceptance criteria**
  - `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm format:check`, `pnpm test` (incl. integration), `pnpm build`, `pnpm security:audit` all pass.

  **Verification**
  - Run the full gate; record results.

  **Out of scope**
  - CI pipeline files; deployment.

  _Requirements: 12.3_
