# Requirements Document

## Project Description (Input)
Manual expenses for PayPilot: the core transaction/ledger model plus CRUD for manually-entered expenses. This is the data spine that later features (recurring bills, credit-card invoices, CSV import, reminders) write into. Every expense belongs to the authenticated user and is strictly isolated per user (reusing the auth-jwt baseline: JWT guard, `@CurrentUser`, `assertOwnership`, `UsersRepository`). Money is stored as integer minor units + ISO-4217 currency (never floating point); the expense date is a calendar date; audit timestamps are UTC — per `docs/conventions.md`. Builds on platform-foundation (NestJS, validated config, canonical errors, Prisma 7) and auth-jwt.

## Introduction

This specification adds manually-entered expenses and establishes the **shared transaction ledger** that subsequent financial features extend or write into. It is the first feature to persist user-owned financial records, so it must rigorously apply two cross-cutting invariants from steering: **per-user data isolation** (`security.md`, auth-jwt) and **exact money/time modeling** (`financial-rules.md`, `docs/conventions.md`).

It reuses existing primitives: the global `JwtAuthGuard`, `@CurrentUser`, the `assertOwnership` 404-like helper, the canonical error envelope, request-id correlation, validated config, the shared `Money` value object, and Prisma access via `PrismaService`. Requirements describe **what** must hold; concrete routes, the model name (e.g. a generic `Transaction` with a `MANUAL` source vs. an `Expense` model), DTO shapes, and pagination style are decided in the design phase.

**Out of scope (deliberately excluded):** recurring bills, credit cards/invoices, installments, CSV import, reminders, categories management/taxonomy beyond an optional free-text label, reporting/aggregation/dashboards, multi-currency conversion, and soft-delete/audit history.

## Requirements

### Requirement 1: Create a Manual Expense
**Objective:** As an authenticated user, I want to record a manual expense, so that my spending is tracked.

#### Acceptance Criteria
1. When an authenticated user submits a valid expense (amount in integer minor units, ISO-4217 currency, expense date, description, optional free-text category), the API shall create an expense owned by that user and return the created record.
2. The created expense shall be associated with the authenticated user's id derived from the token, never from client-supplied input.
3. If the request body fails validation, then the API shall reject it with a 400 validation error.
4. While the request is unauthenticated, the API shall reject it with 401 before creating anything.
5. The created expense shall record a UTC `createdAt` audit timestamp.
6. The `description` shall be required, trimmed, and bounded to a maximum length (design-defined; suggested 1–255 chars); an empty string after trimming shall be rejected with 400.
7. The optional `category` shall be trimmed and bounded to a maximum length (design-defined; suggested max 100 chars).
8. The client shall not set `type`, `source`, status, or audit fields; these are server-controlled (see Requirements 11 and 12).

### Requirement 2: List Own Expenses
**Objective:** As a user, I want to list my expenses, so that I can review my spending.

#### Acceptance Criteria
1. When an authenticated user lists expenses, the API shall return only expenses owned by that user.
2. The API shall support pagination and return pagination metadata.
3. The API shall order expenses by expense date, most recent first, by default.
4. The list shall never include another user's expenses.
5. The API shall support filtering by an `expenseDate` range; the query-parameter names and inclusivity rules are defined in design. (Optional `currency`/`category` filters may be decided in design.)
6. The API shall enforce a maximum page size to avoid unbounded queries; design defines the default and maximum (suggested default 20, max 100).

### Requirement 3: Retrieve a Single Expense
**Objective:** As a user, I want to fetch one of my expenses by id.

#### Acceptance Criteria
1. When an authenticated user requests an expense they own, the API shall return it.
2. If the expense is owned by another user or does not exist, then the API shall respond with 404 without revealing whether the record exists.
3. The owner shall be derived from the token and enforced via the shared authorization primitive (`assertOwnership`).

### Requirement 4: Update an Expense
**Objective:** As a user, I want to edit one of my expenses.

#### Acceptance Criteria
1. When an authenticated user updates an expense they own with a valid body, the API shall apply the changes and return the updated expense.
2. If the expense is owned by another user or does not exist, then the API shall respond with 404 without revealing whether the record exists.
3. If the update body fails validation, then the API shall respond with a 400 validation error.
4. The update shall only allow editable expense fields — `amountMinor`, `currency`, `expenseDate`, `description`, `category` — and shall never change `id`, `ownerUserId`, `type`, `source`, `createdAt`, `updatedAt`, or any audit field. The owning user is immutable and token-derived.
5. The expense's `updatedAt` audit timestamp shall be refreshed (UTC).
6. The design shall define whether updates are full replacement or partial; partial update (`PATCH`) over the editable fields is recommended.

### Requirement 5: Delete an Expense
**Objective:** As a user, I want to delete one of my expenses.

#### Acceptance Criteria
1. When an authenticated user deletes an expense they own, the API shall **hard-delete** it and return a success response; the design defines the response shape, preferably `204 No Content`.
2. If the expense is owned by another user or does not exist, then the API shall respond with 404 without revealing whether the record exists.
3. This spec shall not introduce soft-delete, `deletedAt`, restore, or audit-history behavior.

### Requirement 6: Per-User Data Isolation
**Objective:** As a user, I want my expenses isolated so no other user can read or modify them.

#### Acceptance Criteria
1. The system shall scope every expense operation (list/read/update/delete) to the authenticated user.
2. The system shall derive the owning user from the token, never from client-supplied input.
3. If a user attempts to access another user's expense, then the system shall deny it with a 404-like response without revealing existence.
4. Per-user isolation shall be covered by automated tests.

### Requirement 7: Money and Date Modeling
**Objective:** As the system, I want exact money and date handling so financial data stays correct.

#### Acceptance Criteria
1. The system shall store monetary amounts as integer minor units plus an ISO-4217 currency, and shall never use floating-point types for money.
2. `amountMinor` shall be a **positive safe integer (> 0)**; negative or zero amounts shall be rejected with a 400 `VALIDATION_ERROR`. (The `type = EXPENSE` classification — Requirement 11 — denotes that the record is an expense; the amount itself stays positive.)
3. Currency codes shall be normalized to **uppercase** before persistence and in responses; an invalid/unsupported currency shall be rejected with 400. The design shall decide whether the MVP accepts all valid ISO-4217 codes or only `BRL` (recommended: accept only `BRL` for the MVP while keeping `currency` for future multi-currency).
4. The system shall store the expense date as a calendar date (date-only, no time or timezone).
5. The API shall accept and return `expenseDate` as an ISO `YYYY-MM-DD` string; the design shall define how `YYYY-MM-DD` maps to the date-only DB column **without timezone shifts**. Audit timestamps (`createdAt`/`updatedAt`) remain UTC instants and are not exposed as the expense date.
6. The system shall store audit timestamps (`createdAt`/`updatedAt`) as UTC.
7. The in-code amount representation shall follow the shared `Money` conventions (`docs/conventions.md`).

### Requirement 8: Persistence and Ledger Foundation
**Objective:** As a maintainer, I want expenses persisted in a reusable transaction ledger.

#### Acceptance Criteria
1. The system shall persist expenses via Prisma with a migration that creates the ledger table.
2. The table shall reference the owning user with a foreign key and index the owner for efficient per-user queries.
3. The design shall decide whether the persistence model is named `Transaction`, `LedgerEntry`, or `Expense`. The chosen model must preserve the ability for future features (recurring bills, credit-card invoice items, CSV imports, reminders) to write into the **same ledger spine** without duplicating financial records. (Preferred direction: a generic `Transaction`/ledger model internally, exposed via `/expenses` endpoints.)
4. The API exposed by **this** spec is manual expense CRUD only — no other ledger producers are added here.
5. The behavior when a user is removed (cascade vs. restrict) shall be defined in design.

### Requirement 9: Error Handling
**Objective:** As an API consumer, I want consistent, safe errors.

#### Acceptance Criteria
1. The API shall represent failures using the canonical error envelope — 400 `VALIDATION_ERROR`, 401 `UNAUTHORIZED`, 404 `NOT_FOUND` — including the request id.
2. The API shall not leak internal or database details to the client.

### Requirement 10: Test Coverage
**Objective:** As a maintainer, I want the CRUD and isolation behavior verified.

#### Acceptance Criteria
1. The system shall cover create/read/update/delete and per-user isolation with automated tests, including integration against a real PostgreSQL instance.

### Requirement 11: Transaction Classification
**Objective:** As the system, I want ledger records classified, so the shared spine stays extensible while this spec stays limited to manual expenses.

#### Acceptance Criteria
1. Records created by this spec shall be classified with `type = EXPENSE`.
2. Records created by this spec shall have `source = MANUAL`.
3. The client shall not be allowed to override `type` or `source`; both are set server-side.

### Requirement 12: Status Scope
**Objective:** As a designer, I want a deliberate scope decision on transaction status.

#### Acceptance Criteria
1. This spec shall not introduce a transaction status field or workflow.
2. Manual expenses are considered effective once created (already-registered spending).
3. Status fields/workflows are deferred to future specs if needed; the ledger model may add them later without affecting this spec's API.

## Design Carry-Forward (decisions for the design phase)

The following must be resolved in `/sdd:spec-design` (see also `gap-analysis.md`):
- BigInt DB storage vs `Money.amountMinor: number` mapping (tested boundary conversion).
- Persistence model name (`Transaction`/`LedgerEntry`/`Expense`) and ledger extensibility.
- Ownership enforcement style — prefer user-scoped queries (`WHERE id = ? AND userId = ?`).
- Date-only column mapping and the `YYYY-MM-DD` API string mapping (no timezone shift).
- Pagination style (offset vs cursor), default/max page size, and indexing strategy.
- User foreign-key `onDelete` behavior (cascade vs restrict).
- Currency policy (BRL-only vs all ISO-4217) and `type`/`source`/status enums.
