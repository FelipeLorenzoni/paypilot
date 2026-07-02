# Implementation Plan — csv-import (Executor-Grade)

> Builds on platform-foundation + auth-jwt + the shared `Transaction` ledger (manual-expenses, recurring-bills, credit-cards-invoices). Scope: multipart CSV upload → parse → per-row validation → **DB-level dedup** (R6) → atomic persist (`source = IMPORTED`, expenses only) + `ImportRun` provenance + owner-scoped run retrieval. **Out of scope:** income/refunds/credits/chargebacks/transfers/negative amounts/balances/reconciliation, dedup vs MANUAL/RECURRING/CARD, async processing, editing/deleting imported rows, undo/rollback, bank integrations, multi-currency, admin/RBAC.
> `(P)` = parallel-safe (independent files). Each task ends with `_Requirements: <ids>_`. Conventions: `apps/api/src/imports/`, pure domain with no framework imports (no clock read), repository/writer over `PrismaService`, reuse global guard / `@CurrentUser` / `AllExceptionsFilter` / `Money` / date-only mapper. The partial unique index + `createMany skipDuplicates` are the dedup source of truth.

---

## 1. Dependency: CSV parser

- [ ] 1.1 (P) Add `csv-parse` as an exact dependency

  **Goal**
  Bring in the vetted RFC-4180 parser (no hand-rolled parsing of untrusted input).

  **Deliverables**
  - `apps/api/package.json`: `csv-parse` pinned to an **exact** version (7.0.0 verified: published 2026-06-14 ≫ `minimumReleaseAge`, no install/lifecycle scripts, no runtime deps); lockfile updated.

  **Implementation notes**
  - Respect the supply-chain policy (`savePrefix ""`, `minimumReleaseAge`, `allowBuilds` — no new build approvals expected). Use the **sync API** (`csv-parse/sync`) — the MVP import is synchronous within bounded limits.

  **Acceptance criteria**
  - `pnpm install --frozen-lockfile` reproduces; version exact; `pnpm security:audit` stays green.

  **Verification**
  - `pnpm install` + `pnpm --filter @paypilot/api build`.

  **Out of scope**
  - Parser wiring (task 4).

  _Requirements: 9.3_

---

## 2. Schema, IMPORTED source, dedup index, and CHECK rewrite

- [ ] 2.1 `ImportRun` model, `IMPORTED` enum value, `Transaction` import columns, partial unique index, source-aware CHECK (two-step migration)

  **Goal**
  Persist provenance and give dedup + valid link states a DB-level guarantee.

  **Deliverables**
  - `schema.prisma`:
    - `enum ImportStatus { PROCESSING COMPLETED }` — **no `FAILED` in the MVP**: structural failures persist nothing and the atomic run+rows transaction means an observer only ever sees `COMPLETED` (`PROCESSING` is transient inside the transaction; a `FAILED` status arrives with a future async-import spec). `model ImportRun` (`id @db.Uuid`, `userId` FK → User `onDelete: Restrict`, `status @default(PROCESSING)`, `totalRows`/`importedCount`/`duplicateCount`/`invalidCount Int @default(0)`, `fileHash @db.Char(64)?`, timestamps, `@@index([userId])`, `@@map("import_runs")`).
    - `enum TransactionSource` += `IMPORTED`.
    - `Transaction` += `dedupHash @db.Char(64)?`, `importRunId @db.Uuid?` (FK → ImportRun, Restrict). Inverse relations on `User`/`ImportRun`.
  - **Two migrations** (see research — avoids "unsafe use of new enum value" in the partial-index predicate):
    1. `ALTER TYPE "TransactionSource" ADD VALUE 'IMPORTED';` **alone**.
    2. `ImportStatus` enum + `import_runs` table + `Transaction` columns/FK + **hand-appended SQL**: drop `transactions_source_link_chk`, add the four-source CHECK (`IMPORTED` ⇒ `dedupHash` + `importRunId` NOT NULL and recurring/card cols NULL; `MANUAL`/`RECURRING`/`CARD` ⇒ `dedupHash`/`importRunId` NULL plus their existing rules), and `CREATE UNIQUE INDEX "transactions_user_dedup_uq" ON "transactions" ("userId","dedupHash") WHERE source = 'IMPORTED';`
  - Regenerated client.

  **Implementation notes**
  - Generated via `migrate diff` → hand-edit → `migrate deploy` (precedent: recurring/cards). Existing MANUAL/RECURRING/CARD rows satisfy the new CHECK (import columns default NULL) — backward-compatible swap.

  **Acceptance criteria**
  - Both migrations apply in order on a DB holding rows of the other three sources; the partial unique index and the named CHECK exist; client typechecks with `IMPORTED`.

  **Verification**
  - `pnpm db:generate` ok; migrations apply against Testcontainers (asserted in 8.x).

  **Out of scope**
  - Service/domain logic.

  _Requirements: 2.4, 2.5, 6.1, 7.3, 8.1, 8.2, 8.4_

---

## 3. Pure domain: dedup key, amount parsing, row validation

- [ ] 3.1 (P) dedup-key module (normalization + hash)

  **Goal**
  Deterministic dedup key identical for equivalent rows.

  **Deliverables**
  - `normalizeDescription(raw)`: trim → collapse internal whitespace to one space → lowercase.
  - `dedupHash(dateIso, amountMinor, description)`: sha-256 hex of `"{date}|{amountMinor}|{normDescription}"`.
  - Unit tests.

  **Implementation notes**
  - Pure, framework-free, no clock/tz. Same normalization used for incoming rows and comparisons (the stored hash **is** the comparison).

  **Acceptance criteria**
  - Equivalent rows (extra spaces, different casing) → same hash; a one-field near-miss (different date, amount, or description) → different hash.

  **Verification**
  - `pnpm --filter @paypilot/api test`.

  **Out of scope**
  - Persistence.

  _Requirements: 2.3, 10.2_

- [ ] 3.2 (P) Amount parser + RowValidator (pure)

  **Goal**
  Deterministic row validation with stable reason codes; expenses only.

  **Deliverables**
  - Amount parser: accepts **dot-decimal** (`1234.56`) and **Brazilian** (`1.234,56`) forms (≤ 2 decimals, optional trimmed currency symbol/whitespace) → integer minor units; anything else unparseable.
  - `RowValidator.validate(raw, lineNumber)` → `{ ok: true, candidate }` or `{ ok: false, reasonCode }` with stable codes: `INVALID_DATE`, `INVALID_AMOUNT_FORMAT`, `NON_POSITIVE_AMOUNT`, `UNSUPPORTED_CURRENCY`, `MISSING_FIELD`, `FIELD_TOO_LONG`. Candidate: `date` (`YYYY-MM-DD` via `isIsoCalendarDate`), `amountMinor` (validated via `createMoney`), `currency` (uppercase, `BRL` only; default `BRL` when the optional column is absent), `description` (trim, ≤255), `category` (trim-or-null, ≤100).
  - Unit tests.

  **Implementation notes**
  - Pure, no clock. Non-positive (zero/negative) amounts rejected (`NON_POSITIVE_AMOUNT`) — MVP imports expenses only.

  **Acceptance criteria**
  - `"1.234,56"` → `123456`; `"1234.56"` → `123456`; `"10"` → `1000`; `"1,2,3"`/3-decimals → `INVALID_AMOUNT_FORMAT`; `"0"`/`"-5"` → `NON_POSITIVE_AMOUNT`; bad date → `INVALID_DATE`; `USD` → `UNSUPPORTED_CURRENCY`; missing/over-long fields → their codes.

  **Verification**
  - `pnpm --filter @paypilot/api test`.

  **Out of scope**
  - CSV structure (task 4).

  _Requirements: 3.1, 3.3, 3.4, 3.5, 9.4, 10.2_

---

## 4. CSV parsing & structural validation

- [ ] 4.1 CsvParser wrapper (csv-parse sync + schema check)

  **Goal**
  Safely parse the untrusted buffer and enforce the fixed MVP schema.

  **Deliverables**
  - A wrapper over `csv-parse/sync`: UTF-8, header row required; **delimiter detection** — deterministic from the header line: contains `;` → `;`, otherwise `,` (header names never contain either); validates the header against the accepted names (required: date, amount, description; optional: category, currency); skips blank lines; returns `{ header, delimiter, rows: Array<{ record, lineNumber }> }` or a structural error.
  - Unit tests (quoted fields, embedded delimiters/quotes, blank lines, bad header, empty file, both delimiters).

  **Implementation notes**
  - **BR amounts vs delimiter:** under `;`, `1.234,56` may appear unquoted; under `,`, a comma-bearing amount MUST be RFC-4180 quoted (`"1.234,56"`) — an unquoted comma splits the row (structural/row failure), documented behavior.
  - Structural failure (missing/unknown required header, unparseable file) → typed error the service maps to **400** with nothing persisted. Row count is checked by the service against `MAX_ROWS` after parse; `csv-parse` options bound record size.

  **Acceptance criteria**
  - Valid file → rows with correct `lineNumber`s (header = line 1); RFC-4180 quoting handled; **semicolon-delimited file with unquoted `1.234,56` parses**; **comma-delimited file with quoted `"1.234,56"` parses**; bad header/undecodable file → structural error (no partial results).

  **Verification**
  - `pnpm --filter @paypilot/api test`.

  **Out of scope**
  - Row-level field validation (3.2); limits config (task 6).

  _Requirements: 4.1, 9.1, 9.2, 10.2_

---

## 5. Repository & atomic writer

- [ ] 5.1 ImportsRepository + ImportLedgerWriter

  **Goal**
  Owner-scoped reads and an atomic run+rows persist where a unique conflict is a skip, not a failure.

  **Deliverables**
  - `ImportsRepository`: `findExistingHashes(userId, hashes)` (returns which of the given `dedupHash`es already exist for the user's `IMPORTED` rows), `findOwnedRun(userId, id)`.
  - `ImportLedgerWriter.persist(run, survivors)`: single `prisma.$transaction` — create `ImportRun` (status `PROCESSING`), `transaction.createMany({ data: survivors, skipDuplicates: true })` (each row: `userId`, `type=EXPENSE`, `source=IMPORTED`, amount/currency/date/description/category, `dedupHash`, `importRunId`), then update the run with final counts + status `COMPLETED`; returns the DB insert count and the run.
  - Unit tests (mocked prisma) for mapping + count flow.

  **Implementation notes**
  - `skipDuplicates` emits `ON CONFLICT DO NOTHING` — covers the partial unique index, so an overlapping/concurrent import converges without error. Any unexpected failure rolls back run + rows together (persist-nothing).

  **Acceptance criteria**
  - Insert count comes from `createMany` (DB truth); rows carry `dedupHash`/`importRunId`; a forced mid-transaction failure persists neither run nor rows.

  **Verification**
  - `pnpm --filter @paypilot/api test`; end-to-end in 8.1.

  **Out of scope**
  - Orchestration/summary (task 6).

  _Requirements: 1.1, 2.1, 2.4, 5.1, 7.3, 8.1, 8.2_

---

## 6. Import orchestration service

- [ ] 6.1 ImportsService (import + getRun, DB-derived counts)

  **Goal**
  Orchestrate limits → parse → validate → dedup → persist and build the summary; expose owner-scoped run retrieval.

  **Deliverables**
  - `import(userId, file)`: enforce `MAX_FILE_BYTES`/`MAX_ROWS` (whole-file 413/400, persist nothing) → CsvParser (structural 400, persist nothing) → RowValidator per row (collect `invalidRows` with `lineNumber`+`reasonCode`) → compute `dedupHash` per valid row → app-level pre-pass (existing hashes via repository + in-file first-wins) for best-effort `duplicateRows` → writer persists survivors → build `ImportSummary`.
  - **Guaranteed counts are DB-derived**: `importedCount` = writer insert count; `duplicateCount = validRows − importedCount`; `invalidCount` = rejections; `totalRows = validRows + invalidCount`. `duplicateRows` is informational only and never contradicts the counts.
  - `getRun(userId, id)` → `ImportRunView` (id, status, counts, createdAt); not owned/unknown → 404.
  - Optional `fileHash` = sha-256 of the file bytes stored on the run. Unit tests.

  **Implementation notes**
  - Never log the raw body/rows — only operation, userId, requestId, counts, error codes. Summary exposes no cross-user/cross-source data. Constants in a documented module, hard-coded for the MVP: **`MAX_FILE_BYTES = 1_048_576` (1 MiB)** and **`MAX_ROWS = 5000`**.

  **Acceptance criteria**
  - Oversized/too-many-rows/bad-header → whole-file error, zero rows + zero runs persisted; mixed file → valid imported, invalids reported with codes, duplicates skipped; counts consistent (`totalRows = imported + duplicate + invalid`); `getRun` owner-scoped 404 semantics.

  **Verification**
  - `pnpm --filter @paypilot/api test`; end-to-end in 8.1.

  **Out of scope**
  - HTTP wiring (task 7).

  _Requirements: 1.1, 1.2, 1.5, 2.1, 2.2, 3.1, 3.2, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 8.2, 8.3, 8.5_

---

## 7. Controller & module wiring

- [ ] 7.1 ImportsController + ImportsModule

  **Goal**
  Expose the multipart upload + run retrieval, protected by the global guard.

  **Deliverables**
  - `ImportsController`: `POST /api/v1/imports` — `FileInterceptor('file')` (memory storage, `limits.fileSize = MAX_FILE_BYTES`), owner from `@CurrentUser`, 201 `ImportSummary`; missing/non-CSV file → 400. `GET /api/v1/imports/:id` (`ParseUUIDPipe`) → 200 `ImportRunView`.
  - `ImportsModule` (controller + service + repository + writer + parser), wired into `AppModule`.

  **Implementation notes**
  - Routes protected by default (global `JwtAuthGuard`) → 401. Errors via `AllExceptionsFilter` (400/401/404/413 canonical, requestId). Multer size overflow maps to **413**. No endpoints to edit/delete imported transactions.

  **Acceptance criteria**
  - Unauthenticated → 401; upload → 201 summary; oversized → 413; malformed `:id` → 400; cross-user/unknown run → 404.

  **Verification**
  - Covered by integration (8.1); `pnpm --filter @paypilot/api build`.

  **Out of scope**
  - Any transaction-mutation endpoints.

  _Requirements: 1.1, 1.4, 1.5, 4.2, 5.2, 7.4, 8.5_

---

## 8. Integration & final gate

- [ ] 8.1 CSV import integration suite (Testcontainers)

  **Goal**
  Prove import, dedup (R6), partial success, limits, provenance, and isolation against real PostgreSQL.

  **Deliverables**
  - `apps/api/test/csv-import.int.spec.ts` using Testcontainers + `migrate deploy` + the global app setup, registering users via the auth flow; uploads via `supertest .attach()`.

  **Acceptance criteria** (all pass; suite exits non-zero on failure)
  - **Happy path**: N valid rows → N `IMPORTED`/`EXPENSE` rows owned by the user; `ImportRun` persisted with matching counts; summary counts DB-derived and self-consistent.
  - **Dedup / R6**: existing-match skipped; in-file duplicate skipped (first wins); **re-import of the same file → zero new rows**; near-miss (one differing field) inserted; **overlapping/concurrent imports** of the same file converge to no duplicate `(userId, dedupHash)`.
  - **Partial success**: mixed file → valid rows imported, invalid rows reported with `lineNumber` + `reasonCode` (incl. `NON_POSITIVE_AMOUNT`, `INVALID_DATE`); import not aborted.
  - **Delimiters/BR amounts**: a **semicolon-delimited** file with unquoted `1.234,56` imports correctly; a **comma-delimited** file with quoted `"1.234,56"` imports correctly.
  - **Whole-file**: bad header → 400 and **nothing persisted** (no run, no rows); oversized file → 413; too many rows → 400 — nothing persisted in each case.
  - **Provenance**: `GET /api/v1/imports/:id` returns the owner's run; cross-user/unknown → 404.
  - **Isolation**: user B's identical rows import fine (dedup is per-user); user B cannot read user A's run.
  - **tz safety**: an imported date round-trips unchanged under `TZ=America/Sao_Paulo`.

  **Verification**
  - `pnpm --filter @paypilot/api test:integration` (Docker required).

  **Out of scope**
  - Source protection + CHECK (8.2).

  _Requirements: 1.1, 1.2, 1.3, 1.5, 2.1, 2.2, 2.4, 2.6, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 5.1, 5.2, 5.3, 7.1, 7.2, 8.1, 8.2, 8.5, 10.1, 10.3_

- [ ] 8.2 Source-protection + CHECK-constraint integration assertions

  **Goal**
  Prove four-source ledger protection and reject invalid link states at the DB.

  **Deliverables**
  - Tests exercising other features' endpoints vs `IMPORTED` rows and raw invalid inserts.

  **Acceptance criteria**
  - **Source protection**: manual expense endpoints cannot list/read/update/delete an `IMPORTED` row (404 / absent); recurring/card endpoints never touch it; the import flow creates only `IMPORTED` rows; existing manual/recurring/cards suites stay green.
  - **CHECK**: raw inserts rejected for — `IMPORTED` without `dedupHash`/`importRunId`; `MANUAL` (or `CARD`/`RECURRING`) with `dedupHash`/`importRunId` populated; valid states accepted.

  **Verification**
  - `pnpm --filter @paypilot/api test:integration`.

  **Out of scope**
  - App-level fallback.

  _Requirements: 6.1, 6.2, 6.3, 6.4, 10.1_

- [ ] 8.3 README + final quality gate

  **Goal**
  Document the import endpoints and confirm the monorepo gate is green.

  **Deliverables**
  - README: `POST /api/v1/imports` (multipart, CSV schema — required date/amount/description, optional category/currency; accepted date/amount formats incl. BR `1.234,56`; limits), summary shape, `GET /api/v1/imports/:id`, `source = IMPORTED`, dedup semantics (per-user, imported-only, DB-guaranteed), expenses-only MVP note.

  **Acceptance criteria**
  - `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm format:check`, `pnpm test` (incl. integration), `pnpm build`, `pnpm security:audit` all pass.

  **Verification**
  - Run the full gate; record results.

  **Out of scope**
  - CI pipeline files; deployment.

  _Requirements: 7.4, 10.1_
