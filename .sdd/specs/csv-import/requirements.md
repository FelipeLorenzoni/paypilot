# Requirements Document

## Project Description (Input)

CSV import for PayPilot: bulk-import transactions from bank/card statement CSV files into the shared `Transaction` ledger, with **duplicate protection** (financial-rules R6). The core invariant: an imported row that matches an existing transaction — or another row within the same import — on **date, amount, and description** is flagged/skipped rather than silently inserted. The design must define exactly how the dedup key is normalized (trimming, casing, date granularity) and whether dedup is enforced app-level, DB-level, or both.

Imported transactions are recorded with an import provenance / source classification distinct from `MANUAL`, `RECURRING`, and `CARD` (exact enum value decided in design), so per-source ledger protection (R13-style) continues to hold. Per-user isolation (auth-jwt baseline) and money/time conventions (`docs/conventions.md`: integer minor units, date-only, UTC; current time from the injected `Clock`, never read directly) apply. The import flow returns a per-file summary (imported / skipped-as-duplicate / rejected-invalid counts) without exposing data across users.

Builds on platform-foundation, auth-jwt, and the existing `Transaction` ledger (manual-expenses, recurring-bills, credit-cards-invoices).

## Introduction

This specification adds **bulk CSV import** of transactions from bank/card statements into the shared `Transaction` ledger, upholding financial-rules **R6** (duplicate avoidance by date, amount, and description). It is the fourth producer to write into the ledger, using an **import source classification** distinct from `MANUAL`, `RECURRING`, and `CARD`, and it must preserve cross-source ledger protection so no feature mutates another's rows.

CSV content is **untrusted input**: the API validates the file's structure, size, row count, and each field's format before persisting anything, bounds resource usage, and never logs the raw file body ([[security]]). It reuses existing primitives: the global `JwtAuthGuard` + `@CurrentUser`, owner-scoped queries + `assertOwnership`, the canonical error envelope, request-id correlation, validated config, the shared `Money` (`createMoney`) and money/date mapper, the injected `Clock` port, and Prisma via `PrismaService`.

Requirements describe **what** must hold; the exact dedup-key normalization (trimming, casing, date granularity), whether duplicate protection is enforced app-level and/or by a database constraint, the CSV format/column mapping and delimiter handling, the transfer mechanism (multipart upload vs. inlined payload), and the import source enum value are decided in design.

**Out of scope (deliberately excluded):** bank API / Open Finance / direct-connect integrations, automatic categorization or ML classification, currencies other than BRL (MVP), editing/deleting imported transactions through this or other features' endpoints, undo/rollback of a completed import, background/async processing of very large files (MVP is synchronous within bounded limits), reconciliation against card invoices or recurring bills, an admin/RBAC system, and reminders/notifications.

## Requirements

### Requirement 1: Import Transactions from a CSV File
**Objective:** As an authenticated user, I want to upload a CSV statement, so that its transactions are added to my ledger without manual re-entry.

#### Acceptance Criteria
1. When an authenticated user submits a CSV import, the CSV Import Service shall parse each data row into a candidate transaction (date, amount in integer minor units, currency, description, optional category) and persist the accepted rows to the ledger owned by that user.
2. Each imported transaction shall be associated with the authenticated user's id derived from the token, never from the file or client input.
3. Each imported transaction shall be classified with the import ledger source (distinct from `MANUAL`/`RECURRING`/`CARD`) and `type = EXPENSE`, and shall carry the parsed amount, currency, date, and description.
4. While the request is unauthenticated, the CSV Import Service shall reject it with 401 before parsing or persisting anything.
5. When the import completes, the CSV Import Service shall return a per-file summary containing at least the imported count, the skipped-as-duplicate count, and the rejected-as-invalid count.

### Requirement 2: Duplicate Avoidance (financial-rules R6)
**Objective:** As the system, I want to avoid inserting duplicate transactions, so that a re-imported or overlapping statement does not double-count.

#### Acceptance Criteria
1. When an incoming row matches an **existing** ledger transaction on the normalized dedup key (date, amount, description), the CSV Import Service shall skip it (not insert) and count it as a duplicate.
2. When two rows **within the same import** share the same normalized dedup key, the CSV Import Service shall insert only the first and skip the subsequent matching rows as duplicates.
3. The dedup key shall be computed from **date, amount, and description** using a single, documented normalization (trimming, casing, and date granularity defined in design); the same normalization shall apply to both incoming rows and existing transactions.
4. The design shall define whether duplicate protection is enforced at the application level, by a database constraint, or both; where a database guarantee is used it shall be the source of truth and remain correct under retried/overlapping imports.
5. Duplicate avoidance (existing-match, within-file-match, and re-import of the same file) shall be covered by automated tests, including a near-miss case that differs on one dedup field and is therefore inserted.

### Requirement 3: Row Validation and Partial Success
**Objective:** As a user, I want malformed rows reported rather than silently dropped or blocking the whole file, so that I can trust and correct my import.

#### Acceptance Criteria
1. If a data row fails validation (unparseable date, non-positive or non-integer amount, unsupported currency, missing required field, or over-long field), then the CSV Import Service shall reject that row, count it as invalid, and continue processing the remaining rows.
2. The import summary shall report the number of rejected-invalid rows and shall identify each rejected row by its position (e.g. line number) with a non-sensitive reason, without echoing full row contents in logs.
3. `amount` shall be stored as a positive safe integer in minor units; `currency` shall be normalized to uppercase and accepted as `BRL` only for the MVP; other/invalid values shall cause the row to be rejected as invalid.
4. Dates shall be parsed to a calendar date (date-only, no timezone shift) per `docs/conventions.md`; a row whose date cannot be parsed to a valid calendar date shall be rejected as invalid.
5. In-code money shall be validated/constructed via the shared `createMoney`.

### Requirement 4: Untrusted-Input Safety and Limits
**Objective:** As the system, I want to treat the uploaded CSV as untrusted, so that a malformed or oversized file cannot exhaust resources or leak data.

#### Acceptance Criteria
1. The CSV Import Service shall validate the file's structure (expected columns/header) and reject a structurally invalid file with a 400 validation error before persisting anything.
2. If the file exceeds a configured maximum size or maximum row count, then the CSV Import Service shall reject the import with a 400 (or 413) error and shall not partially import it.
3. The CSV Import Service shall not log the raw CSV body or full row contents; logs shall contain only operation, userId, requestId, counts, and error codes ([[security]]).
4. The import of a file shall be processed synchronously within the configured bounds (MVP); asynchronous/background processing of large files is out of scope.

### Requirement 5: Per-User Data Isolation
**Objective:** As a user, I want my imports and imported transactions isolated from other users.

#### Acceptance Criteria
1. The system shall scope every import operation and duplicate check to the authenticated user; the dedup match shall only consider the authenticated user's existing transactions.
2. The system shall derive the owning user from the token, never from file or client-supplied input.
3. Cross-user data shall never be read or written by an import; the summary shall not expose counts or data belonging to another user.

### Requirement 6: Ledger Source Protection
**Objective:** As the system, I want imported, manual, recurring, and card ledger rows protected by source, so that one feature cannot accidentally mutate another feature's transactions.

#### Acceptance Criteria
1. Imported transactions shall use the import ledger source, distinct from `MANUAL`, `RECURRING`, and `CARD`.
2. Manual expense, recurring-bill, and credit-card endpoints shall not read, update, or delete import-sourced transactions.
3. The import flow shall only create import-sourced transactions and shall not mutate `MANUAL`, `RECURRING`, or `CARD` rows.
4. Automated tests shall prove that other features' endpoints cannot read, update, or delete an import-sourced transaction.

### Requirement 7: Money, Date, and Persistence
**Objective:** As a maintainer, I want exact money/date handling and robust persistence consistent with the ledger.

#### Acceptance Criteria
1. The system shall store monetary amounts as integer minor units plus an ISO-4217 currency and shall never use floating-point types for money.
2. The system shall store imported dates as date-only values and audit timestamps as UTC, taking any current-time need from the injected `Clock` rather than reading the system clock directly.
3. The system shall extend the ledger `source` classification to include the import source and persist imported rows via Prisma; any supporting structures shall reference the owning user with a foreign key and index the owner for efficient per-user queries.
4. The API shall represent failures using the canonical error envelope (400/401/413 as applicable), including the request id, and shall not leak internal/database details.

### Requirement 8: Test Coverage
**Objective:** As a maintainer, I want the import behavior and the R6 invariant covered by automated tests.

#### Acceptance Criteria
1. The system shall cover happy-path import, duplicate avoidance (existing-match, within-file-match, re-import, near-miss), row validation/partial success, structure/size limits, per-user isolation, and source protection with automated tests, including integration against a real PostgreSQL instance.
2. The dedup-key normalization shall have unit tests covering trimming, casing, and date-granularity edge cases as defined in design.
