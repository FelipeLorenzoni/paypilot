# Requirements Document

## Project Description (Input)
Recurring bills for PayPilot: user-defined recurring bill definitions (e.g. rent, subscriptions) plus **idempotent monthly generation** of ledger transactions from them. The core invariant (financial-rules R3): generating the monthly transaction for a recurring bill is idempotent per (recurring bill, period) — running generation twice for the same month, including via retries or overlapping job runs, produces exactly one transaction, enforced by a database-level uniqueness guarantee (not just app-level checks). Generated transactions are written into the existing `Transaction` ledger with `source = RECURRING`. Per-user isolation (auth-jwt baseline) and money/time conventions (`docs/conventions.md`: minor units, date-only, UTC) apply. Builds on platform-foundation, auth-jwt, and manual-expenses (the ledger). The background scheduler choice (BullMQ vs cron) deferred from the foundation is decided in this spec's design.

## Introduction

This specification adds **recurring bill definitions** and the **idempotent monthly generation** of ledger transactions from them. It is the first feature to (a) write to the `Transaction` ledger from a non-manual source (`source = RECURRING`), and (b) introduce background/scheduled work — so it must uphold financial-rules **R3** (no duplicate monthly transactions) with a **database-level** uniqueness guarantee, not merely application checks.

It reuses existing primitives: the global `JwtAuthGuard` + `@CurrentUser`, owner-scoped queries + `assertOwnership`, the canonical error envelope, request-id correlation, validated config, the shared `Money` (`createMoney`) and money/date mapper, and Prisma via `PrismaService`. Requirements describe **what** must hold; the model shape, the way the generated transaction is linked to its bill and period, the scheduler (BullMQ vs cron), and how generation is triggered are decided in design.

**Out of scope (deliberately excluded):** due-date reminders/notifications (own spec), variable/usage-based amounts, proration, non-monthly frequencies (weekly/annual/custom), credit-card/installment logic, CSV/import flows, currencies other than BRL (MVP), reporting/dashboards, editing/deleting already-generated ledger transactions through this spec's bill endpoints, an admin/RBAC system, and (unless explicitly justified in design) Redis/BullMQ.

## Requirements

### Requirement 1: Create a Recurring Bill
**Objective:** As an authenticated user, I want to define a recurring monthly bill, so that its monthly charge is tracked automatically.

#### Acceptance Criteria
1. When an authenticated user submits a valid recurring bill (amount in integer minor units, ISO-4217 currency, day-of-month, description, optional category, start date, optional end date), the API shall create a bill owned by that user and return it.
2. The bill shall be associated with the authenticated user's id derived from the token, never from client input.
3. If the request body fails validation, then the API shall reject it with a 400 validation error.
4. While the request is unauthenticated, the API shall reject it with 401 before creating anything.
5. The bill shall be created active by default and record a UTC `createdAt`.

### Requirement 2: Read Recurring Bills
**Objective:** As a user, I want to list and fetch my recurring bills.

#### Acceptance Criteria
1. When an authenticated user lists or fetches recurring bills, the API shall return only bills owned by that user.
2. If a bill is owned by another user or does not exist, then the API shall respond with 404 without revealing whether it exists.
3. The list shall support pagination with a bounded maximum page size and return pagination metadata.

### Requirement 3: Update a Recurring Bill
**Objective:** As a user, I want to edit a recurring bill.

#### Acceptance Criteria
1. When an authenticated user updates a bill they own with a valid body, the API shall apply the changes and return the updated bill.
2. If the bill is owned by another user or does not exist, then the API shall respond with 404 without disclosure.
3. If the update body fails validation, then the API shall respond with a 400 validation error.
4. The update shall only allow editable fields and shall never change ownership, `id`, or audit timestamps; the owning user is immutable and token-derived.
5. Changing a bill shall not retroactively alter transactions already generated for past periods.

### Requirement 4: Delete / Deactivate a Recurring Bill
**Objective:** As a user, I want to stop a recurring bill.

#### Acceptance Criteria
1. When an authenticated user deletes (or deactivates) a bill they own, the API shall stop future generation for that bill and return a success response; the design defines whether this is a hard delete or deactivation (recommended: deactivation to preserve history) and the response shape.
2. If the bill is owned by another user or does not exist, then the API shall respond with 404 without disclosure.
3. Removing/deactivating a bill shall not delete transactions already generated for past periods.

### Requirement 5: Monthly Transaction Generation
**Objective:** As the system, I want to generate the monthly transaction for each due recurring bill, so that recurring charges appear in the ledger.

#### Acceptance Criteria
1. When generation runs for a given period (a calendar month), the system shall create one ledger `Transaction` per eligible recurring bill for that period.
2. Generated transactions shall be classified `type = EXPENSE`, `source = RECURRING`, and carry the bill's amount, currency, and description, owned by the bill's user.
3. Each generated transaction shall be linked to its originating recurring bill and the period it was generated for.
4. A generated transaction shall **snapshot** the recurring bill's values **at generation time**: amount, currency, description, category, the generated transaction date, the recurring bill id, and the generation period.
5. Changing a bill later shall affect only **future** generation and shall never retroactively change already-generated transactions.

### Requirement 6: Idempotent Generation (financial-rules R3)
**Objective:** As the system, I want generation to be idempotent per bill and period, so that no duplicate monthly transactions are ever created.

#### Acceptance Criteria
1. The system shall guarantee at most one generated transaction per (recurring bill, period), enforced by a **database-level uniqueness constraint** — not only application-level checks.
2. If an **eligible** bill is generated more than once for the same period — including retries or overlapping/concurrent runs — then the system shall still result in **exactly one** transaction for that bill and period and shall not raise an unhandled error to the caller.
3. If a bill is inactive or outside its eligibility window for the period, then generation shall result in **zero** transactions for that bill and period.
4. When a uniqueness conflict occurs during generation, the system shall treat that (bill, period) as **already generated**, skip it, and continue with the remaining bills.
5. If a transaction already exists for a (bill, period), a later generation run shall **not mutate** that existing transaction through the generation flow (ledger immutability for generated periods).
6. Idempotency under concurrent/duplicate runs shall be covered by automated tests.

### Requirement 7: Day-of-Month and Short-Month Handling
**Objective:** As the system, I want correct calendar dates so charges land on the right day even in short months.

#### Acceptance Criteria
1. The generated transaction's date shall be the bill's day-of-month within the target period.
2. If the bill's day-of-month exceeds the number of days in the target month, then the system shall clamp the date to the last day of that month.
3. The transaction date shall be a calendar date (date-only, no timezone shift), per `docs/conventions.md`.
4. The period shall be represented as a stable calendar-month value (preferably `YYYY-MM`, or an equivalent date-only representation decided in design), and shall **not** be derived from server timezone-dependent timestamps.
5. The design shall define how the period is passed to controlled/manual generation and how scheduled generation chooses its target period.

### Requirement 8: Eligibility Window (active / start / end)
**Objective:** As a user, I want only currently-active bills to generate within their window.

#### Acceptance Criteria
1. The system shall generate for a bill in a given period only while the bill is active.
2. Eligibility shall be evaluated against the **generated transaction date**: the date is first computed from the target period + day-of-month (with short-month clamping per Requirement 7), then the bill is eligible only if `startDate <= generatedTransactionDate` and, when `endDate` is set, `generatedTransactionDate <= endDate`.
3. `startDate` and `endDate` are calendar dates (date-only), not timestamps.
4. If a bill is inactive or outside its window for the target period, then no transaction shall be generated for that (bill, period).

### Requirement 9: Generation Trigger / Scheduling
**Objective:** As an operator, I want generation to run on a schedule and be triggerable, without unsafe infrastructure.

#### Acceptance Criteria
1. The system shall provide a way to run generation for a period via a scheduled/background mechanism; the concrete scheduler (BullMQ vs cron-based) is decided in design.
2. The design shall define a **controlled** generation trigger appropriate for the **current** auth model (no admin/RBAC system is introduced here). If no role system exists, the trigger may be an internal service method, a CLI/local script, or a test/local-only endpoint; it must **not** expose unsafe public generation access.
3. The design shall not introduce Redis or external job infrastructure unless explicitly justified; an in-process/local scheduler is acceptable for the MVP if documented as non-production-grade.
4. Regardless of how or how often it is triggered, generation shall remain idempotent (Requirement 6).
5. A generation run shall return or record a **summary** with at least the created count, the already-generated/skipped count, and the failed count; the summary shall not expose data across users.

### Requirement 10: Per-User Data Isolation
**Objective:** As a user, I want my recurring bills and their generated transactions isolated.

#### Acceptance Criteria
1. The system shall scope every recurring-bill operation (read/update/delete) to the authenticated user.
2. The system shall derive the owning user from the token, never from client-supplied input.
3. A generated transaction shall be owned by the bill's user; generation shall never assign a transaction to a different user.
4. Cross-user access to a recurring bill shall be denied with a 404-like response without disclosure.

### Requirement 11: Money and Date Modeling
**Objective:** As the system, I want exact money/date handling consistent with the ledger.

#### Acceptance Criteria
1. The system shall store monetary amounts as integer minor units plus an ISO-4217 currency and shall never use floating-point types for money.
2. `amountMinor` shall be a **positive safe integer (> 0)**; otherwise the API shall reject the request with a 400 validation error.
3. `currency` shall be normalized to **uppercase** and accepted as **`BRL` only** for the MVP; other/invalid codes shall be rejected with 400.
4. `dayOfMonth` shall be an integer from **1 to 31**; otherwise 400.
5. `description` shall be required, trimmed, and bounded by a maximum length (design-defined); an empty string after trimming shall be rejected with 400. Optional `category` shall be trimmed and bounded by a maximum length (design-defined).
6. `startDate` and `endDate`, when provided, shall be valid `YYYY-MM-DD` date strings; if `endDate` is provided it shall **not** be before `startDate` (else 400).
7. The system shall store day-of-month, start date, and end date as date-based values and audit timestamps as UTC.
8. In-code money shall be validated/constructed via the shared `createMoney`.

### Requirement 12: Persistence, Errors, and Test Coverage
**Objective:** As a maintainer, I want robust persistence, canonical errors, and tested behavior.

#### Acceptance Criteria
1. The system shall persist recurring bills via Prisma with a migration; the table shall reference the owning user with a foreign key and index the owner for efficient per-user queries.
2. The system shall enforce the (recurring bill, period) uniqueness for generated transactions at the database level (Requirement 6), and shall extend the ledger `source` to include `RECURRING`.
3. The API shall represent failures using the canonical error envelope (400/401/404), including the request id, and shall not leak internal/database details.
4. The system shall cover bill CRUD, eligibility, day/short-month handling, and **generation idempotency under concurrent/duplicate runs** with automated tests, including integration against a real PostgreSQL instance.

### Requirement 13: Ledger Source Protection
**Objective:** As the system, I want manual and recurring ledger rows protected by source, so that one feature cannot accidentally mutate another feature's transactions.

#### Acceptance Criteria
1. Manual expense CRUD shall only read, update, and delete transactions with `source = MANUAL`.
2. Generated recurring transactions shall use `source = RECURRING`.
3. Recurring-bill endpoints shall not edit or delete generated ledger transactions directly.
4. Automated tests shall prove that manual expense endpoints cannot read, update, or delete a `source = RECURRING` transaction.
