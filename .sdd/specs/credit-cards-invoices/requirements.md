# Requirements Document

## Project Description (Input)

Credit cards and invoices for PayPilot: user-defined credit cards (with a closing day and a due day) plus the assignment of card purchases to the correct monthly invoice and the generation of predictable installment plans. The two core invariants (financial-rules):

- **R4 — Correct invoice assignment.** A credit-card purchase is assigned to an invoice based on the card's **closing day** and **due day**. A purchase on or before the closing day belongs to the current cycle's invoice; after the closing day it rolls to the next cycle. The boundary (closing-day-inclusive) and month-rollover / short-month edge cases must be defined and tested explicitly.
- **R5 — Predictable installments.** An installment purchase generates a **deterministic, reproducible** set of N installments across consecutive invoice cycles. Rounding of residual cents must be defined (e.g. on the first or last installment) and tested.

Card purchases are recorded as ledger transactions distinct from manual (`MANUAL`) and recurring (`RECURRING`) sources — a new source classification — so per-source protection (R13-style) continues to hold. Per-user isolation (auth-jwt baseline) and money/time conventions (`docs/conventions.md`: integer minor units, date-only, UTC; the current time is an injected `Clock` input, never read directly) apply. Builds on platform-foundation, auth-jwt, and the existing `Transaction` ledger (manual-expenses, recurring-bills).

## Introduction

This specification adds **credit cards** and the assignment of **card purchases** (single and installment) to the correct monthly **invoice**, upholding financial-rules **R4** (correct invoice assignment by closing/due day) and **R5** (predictable, deterministic installments). It is the third producer to write into the shared `Transaction` ledger, using `source = CARD` (distinct from `MANUAL` and `RECURRING`), and it must preserve cross-source ledger protection so no feature mutates another's rows. Purchase creation is **idempotent** and installment schedules are created **atomically**.

It reuses existing primitives: the global `JwtAuthGuard` + `@CurrentUser`, owner-scoped queries + `assertOwnership`, the canonical error envelope, request-id correlation, validated config, the shared `Money` (`createMoney`) and money/date mapper, the injected `Clock` port, and Prisma via `PrismaService`. Requirements describe **what** must hold; the data model (how cards, invoices, purchases, and installments are represented and linked), whether an invoice is a stored entity or a derived view, and the exact rounding placement are decided in design.

**Out of scope (deliberately excluded):** due-date reminders/notifications (own spec, R1/R2), CSV/import flows (own spec, R6), recurring-bill logic, interest/late-fee/minimum-payment calculation, statement reconciliation, multi-currency (BRL only for MVP), rewards/points, paying an invoice / payment settlement, **available-credit-limit enforcement** (depends on open invoices, future installments, payments, and invoice status), **editing/deleting card-generated ledger transactions** after creation, **correction / cancellation / refund / chargeback / transaction-adjustment** flows, reporting/dashboards, and an admin/RBAC system.

## Requirements

### Requirement 1: Create a Credit Card
**Objective:** As an authenticated user, I want to register a credit card with its closing and due day, so that my card purchases can be assigned to the right invoice.

#### Acceptance Criteria
1. When an authenticated user submits a valid credit card (name/label, closing day, due day, and optionally a credit limit in integer minor units), the Credit Cards Service shall create a card owned by that user and return it.
2. The card shall be associated with the authenticated user's id derived from the token, never from client input.
3. The Credit Cards Service shall require `closingDay` and `dueDay` to be integers from 1 to 31; otherwise it shall reject the request with a 400 validation error.
4. If a credit limit is provided, then `creditLimitMinor` shall be a **non-negative safe integer** in `BRL` minor units; otherwise the Credit Cards Service shall reject the request with a 400 validation error. This spec shall **not** enforce available-limit checks (available-limit depends on open invoices, future installments, payments, and invoice status — deferred to a future spec).
5. If the request body fails validation, then the Credit Cards Service shall reject it with a 400 validation error.
6. While the request is unauthenticated, the Credit Cards Service shall reject it with 401 before creating anything.
7. The card shall be created active by default and shall record a UTC `createdAt`.

### Requirement 2: Read Credit Cards
**Objective:** As a user, I want to list and fetch my credit cards.

#### Acceptance Criteria
1. When an authenticated user lists or fetches credit cards, the Credit Cards Service shall return only cards owned by that user.
2. If a card is owned by another user or does not exist, then the Credit Cards Service shall respond with 404 without revealing whether it exists.
3. The list shall support pagination with a bounded maximum page size and return pagination metadata.

### Requirement 3: Update a Credit Card
**Objective:** As a user, I want to edit a credit card.

#### Acceptance Criteria
1. When an authenticated user updates a card they own with a valid body, the Credit Cards Service shall apply the changes and return the updated card.
2. If the card is owned by another user or does not exist, then the Credit Cards Service shall respond with 404 without disclosure.
3. If the update body fails validation, then the Credit Cards Service shall respond with a 400 validation error.
4. The update shall only allow editable fields and shall never change ownership, `id`, or audit timestamps; the owning user is immutable and token-derived.
5. Changing a card's `closingDay`/`dueDay` shall affect only the assignment of **future** purchases and shall never retroactively reassign or alter transactions already generated for past purchases.

### Requirement 4: Delete / Deactivate a Credit Card
**Objective:** As a user, I want to stop using a credit card without losing its history.

#### Acceptance Criteria
1. When an authenticated user deletes a card they own, the Credit Cards Service shall deactivate it (set it inactive) rather than hard-deleting, return `204 No Content`, and prevent new purchases from being recorded against it.
2. If the card is owned by another user or does not exist, then the Credit Cards Service shall respond with 404 without disclosure.
3. Deactivating a card shall not delete or alter transactions (including pending future installments) already generated for that card.

### Requirement 5: Record a Card Purchase
**Objective:** As a user, I want to record a purchase on a credit card, so that it appears on the correct invoice.

#### Acceptance Criteria
1. When an authenticated user records a purchase (card, purchase date, amount in integer minor units, currency, description, optional category, and an installment count ≥ 1), the Credit Cards Service shall create the corresponding ledger transaction(s) owned by the user and assigned to the correct invoice cycle(s).
2. Each generated transaction shall be classified `source = CARD` (distinct from `MANUAL`/`RECURRING`), carry the card reference and the invoice cycle it belongs to, and be owned by the card's user.
3. The purchase date shall be a calendar date (date-only, no timezone shift) per `docs/conventions.md`; `amount` shall be a positive safe integer in minor units; `currency` shall be uppercase `BRL` (MVP).
4. If the referenced card is not owned by the user, does not exist, or is inactive, then the Credit Cards Service shall reject the purchase with 404 (not owned/found) or 400 (inactive) without disclosure of other users' data.
5. If `installments` is less than 1 or exceeds the maximum installment count, then the Credit Cards Service shall reject the request with a 400 `VALIDATION_ERROR`.
6. The design shall define the **maximum installment count**, its default value, and whether it is hard-coded for the MVP or a validated configuration value.
7. A generated card transaction shall **snapshot** the values used at creation time (amount per installment, currency, description, category, the card id, the assigned invoice cycle, and the installment sequence number/total) and shall not be retroactively changed by later edits to the card.
8. All transactions generated from the same purchase shall be linked to a **stable originating purchase / installment-plan identifier**, and each generated transaction shall carry enough metadata to identify the card, the invoice cycle, the installment sequence, the installment total, and the original purchase/plan. The design shall decide whether this is represented by a `CardPurchase`, an `InstallmentPlan`, or an equivalent model.

### Requirement 6: Correct Invoice Assignment (financial-rules R4)
**Objective:** As the system, I want each purchase assigned to the invoice cycle implied by the card's closing day, so that invoice composition is correct.

#### Acceptance Criteria
1. When a purchase is made on or before the card's `closingDay` in a given month, the Credit Cards Service shall assign it to the **current** cycle's invoice (closing-day-**inclusive** boundary).
2. When a purchase is made after the card's `closingDay`, the Credit Cards Service shall assign it to the **next** cycle's invoice.
3. The Credit Cards Service shall identify an invoice cycle by a stable calendar value (e.g. `YYYY-MM`) that is **not** derived from server-timezone-dependent timestamps, and shall derive the invoice's **due date** from the card's `dueDay` for that cycle.
4. If the card's `closingDay` exceeds the number of days in the target month, then the Credit Cards Service shall clamp the effective closing date to the last day of that month; the same clamping shall apply to the `dueDay` when computing the due date.
5. When assignment crosses a year boundary (a December purchase after closing rolling into January), the Credit Cards Service shall roll the cycle to the next month/year correctly.
6. The design shall define what `invoiceCycle` (`YYYY-MM`) represents — the **closing month**, the **due month**, or the **user-visible invoice month** — and shall document it with worked examples; the chosen meaning shall be consistent across assignment, invoice views, and tests.
7. The closing-day boundary, month rollover, year rollover, short-month clamping, and the documented `invoiceCycle` meaning shall each be covered by automated tests.

#### Worked Examples (to drive the design; exact `invoiceCycle` values fixed in design)
- `closingDay = 10`, `dueDay = 20`, `purchaseDate = 2026-03-10` → on the closing day (inclusive) ⇒ **current** cycle.
- `closingDay = 10`, `dueDay = 20`, `purchaseDate = 2026-03-11` → after the closing day ⇒ **next** cycle.
- `closingDay = 10`, `dueDay = 20`, `purchaseDate = 2026-12-15` → after closing in December ⇒ rolls into **January (next year)**.

### Requirement 7: Predictable Installments (financial-rules R5)
**Objective:** As the system, I want installment purchases to produce a deterministic, reproducible schedule, so that the user can trust future invoice amounts.

#### Acceptance Criteria
1. When a purchase with `N` installments is recorded, the Credit Cards Service shall generate exactly `N` installment transactions across `N` **consecutive** invoice cycles, beginning with the cycle assigned by Requirement 6 for the purchase date.
2. The sum of the `N` installment amounts shall exactly equal the original purchase total (no money created or lost to rounding).
3. The Credit Cards Service shall distribute any residual cents using a single, documented rule (e.g. the remainder is added to the first installment) so the schedule is deterministic and reproducible from the purchase inputs.
4. Each installment transaction shall record its sequence position and total (e.g. "2 of 6") and the invoice cycle it is assigned to.
5. A single-payment purchase (`installments = 1`) shall produce exactly one transaction equal to the full amount, assigned per Requirement 6.
6. A purchase with `N` installments shall be persisted **atomically**: either all `N` installment transactions are created or none are. The system shall never leave a **partial** installment schedule.
7. The design shall define the `transactionDate` used for each generated installment transaction; invoice membership shall be driven by `invoiceCycle`, **not** by server time; the chosen rule shall be date-only and tested for timezone safety.
8. The installment count, per-installment amounts, consecutive-cycle scheduling, rounding-remainder handling, and **atomic all-or-none** creation shall be covered by automated tests, including a case where the total does not divide evenly.

### Requirement 8: View a Card Invoice
**Objective:** As a user, I want to see a card's invoice for a given cycle, so that I know what I owe and when.

#### Acceptance Criteria
1. When an authenticated user requests a card's invoice for a given cycle, the Credit Cards Service shall return the transactions assigned to that (card, cycle), the invoice total, the cycle identifier, and the computed due date.
2. The Credit Cards Service shall return only invoices for cards owned by the requesting user; cross-user or unknown card access shall respond with 404 without disclosure.
3. The invoice total shall equal the exact sum of the minor-unit amounts of the transactions assigned to that (card, cycle).
4. Where a cycle has no assigned transactions, the Credit Cards Service shall return an empty invoice (zero total) for an owned card rather than an error.
5. The invoice cycle input shall be validated as `YYYY-MM`; if it is malformed, then the Credit Cards Service shall respond with 400 `VALIDATION_ERROR`. An unknown or cross-user card shall still respond with 404 without disclosure.

### Requirement 9: Ledger Source Protection and Mutation Scope
**Objective:** As the system, I want card, manual, and recurring ledger rows protected by source, so that one feature cannot accidentally mutate another feature's transactions.

#### Acceptance Criteria
1. Card purchases and installments shall use `source = CARD`, distinct from `MANUAL` and `RECURRING`.
2. Manual expense endpoints and recurring-bill endpoints shall not read, update, or delete `CARD`-sourced transactions.
3. This spec shall **not** support editing or deleting card-generated ledger transactions after creation. Credit-card endpoints may **read** `CARD`-sourced transactions (e.g. for invoice views) but shall not mutate `MANUAL` or `RECURRING` rows.
4. Correction, cancellation, refund, chargeback, and transaction-adjustment flows are **out of scope** for this spec and shall be handled by future specs.
5. Automated tests shall prove that manual and recurring endpoints cannot read, update, or delete a `CARD`-sourced transaction, and that credit-card endpoints do not mutate `MANUAL` or `RECURRING` rows.

### Requirement 10: Per-User Data Isolation
**Objective:** As a user, I want my cards, purchases, and invoices isolated from other users.

#### Acceptance Criteria
1. The system shall scope every credit-card, purchase, and invoice operation to the authenticated user.
2. The system shall derive the owning user from the token, never from client-supplied input.
3. A generated card transaction shall be owned by the card's user; the system shall never assign it to a different user.
4. Cross-user access to a card, purchase, or invoice shall be denied with a 404-like response without disclosure.

### Requirement 11: Money and Date Modeling
**Objective:** As the system, I want exact money/date handling consistent with the ledger and deterministic time.

#### Acceptance Criteria
1. The system shall store monetary amounts as integer minor units plus an ISO-4217 currency and shall never use floating-point types for money.
2. `amount` and any credit limit shall be validated as safe integers; purchase `amount` shall be a positive safe integer (> 0), otherwise rejected with 400.
3. `currency` shall be normalized to uppercase and accepted as `BRL` only for the MVP; other/invalid codes shall be rejected with 400.
4. `closingDay` and `dueDay` shall be integers from 1 to 31; purchase dates and computed due dates shall be stored as date-only values and audit timestamps as UTC.
5. All date-sensitive logic (invoice assignment, cycle and due-date computation) shall take the current time as an injected `Clock` input and shall never read the system clock directly, so behavior is deterministic and testable.
6. In-code money shall be validated/constructed via the shared `createMoney`.

### Requirement 12: Persistence, Errors, and Test Coverage
**Objective:** As a maintainer, I want robust persistence, canonical errors, and tested financial behavior.

#### Acceptance Criteria
1. The system shall persist credit cards (and any invoice/installment structures) via Prisma with a migration; tables shall reference the owning user with a foreign key and index the owner for efficient per-user queries.
2. The system shall extend the ledger `source` classification to include `CARD`.
3. The API shall represent failures using the canonical error envelope (400/401/404/409), including the request id, and shall not leak internal/database details.
4. The system shall cover card CRUD, invoice assignment (R4 boundary/rollover/short-month), installments (R5 count/schedule/rounding/atomicity), idempotent purchase creation, source protection, and per-user isolation with automated tests, including integration against a real PostgreSQL instance.

### Requirement 13: Idempotent Purchase Creation
**Objective:** As a user (or a retrying client), I want recording a card purchase to be idempotent, so that retries never duplicate purchase or installment transactions.

#### Acceptance Criteria
1. Recording a card purchase shall be idempotent, using a client-provided idempotency key or an equivalent purchase identity defined in design.
2. Retrying the same purchase-creation request shall not create duplicate purchase or installment transactions.
3. Idempotency shall be enforced by a **database-level uniqueness guarantee**, not only application-level checks.
4. If a duplicate request is detected, then the Credit Cards Service shall return the existing purchase/installment result or a safe already-created response (no partial or duplicate side effects).
5. Idempotent purchase creation (including retried/duplicate requests) shall be covered by integration tests.
