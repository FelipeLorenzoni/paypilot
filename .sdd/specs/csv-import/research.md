# Research & Design Decisions — csv-import

## Summary
- **Scope**: Extension (brownfield) — **4th producer** into the shared `Transaction` ledger (`source = IMPORTED`), plus a new `imports` feature (multipart upload → parse → validate → dedup → persist), an `ImportRun` provenance record, and DB-level duplicate protection. See `gap-analysis.md`.
- **Discovery type**: light (integration-focused) + one dependency evaluation (`csv-parse`).

## Design Decisions

### Decision: Source value — `IMPORTED`
`TransactionSource` gains `IMPORTED`. `type` stays `EXPENSE` (MVP imports expenses only). Manual/recurring/card rows are unaffected.

### Decision: CSV parser — `csv-parse` (exact, sync API)
- Evaluated `csv-parse` **7.0.0** (published 2026-06-14; ~17 days old ≫ `minimumReleaseAge` 1 day). **No install/postinstall lifecycle scripts** (ships prebuilt dist; no native build) and **no runtime dependencies** → no `allowBuilds` approval needed. RFC-4180 compliant, battle-tested.
- Use the **synchronous** API (`csv-parse/sync`) — the MVP import is synchronous within bounded limits. Pin an **exact** version per the supply-chain policy. A hand-rolled parser is rejected (quoted fields / embedded delimiters on untrusted input are error-prone).

### Decision: Transfer — multipart upload (memory storage + limits)
- `FileInterceptor('file')` from `@nestjs/platform-express` (multer already overridden `>=2.2.0`), **memory storage**, hard `limits.fileSize`, and a max row count enforced after parse. No disk writes. Structurally invalid / oversized files are rejected whole (R4.1/R4.2) before any persistence.

### Decision: Dedup — DB-level partial unique on a normalized `dedupHash`
- **Normalization** (documented, applied identically to incoming rows): dedup key = `date` (`YYYY-MM-DD`) + `amountMinor` (integer) + `description` normalized as **trim → collapse internal whitespace to a single space → case-fold (lowercase)**. `dedupHash = sha-256(hex)` of `"{date}|{amountMinor}|{normDescription}"`.
- **DB guarantee (source of truth):** add nullable `dedupHash CHAR(64)` to `Transaction`; a **partial unique index** `(userId, dedupHash) WHERE source = 'IMPORTED'` prevents duplicate imported rows per user. Scope is **IMPORTED-only** (no dedup against MANUAL/RECURRING/CARD — avoids false-positive skips).
- **Insert with skip:** persist survivors via Prisma `createMany({ skipDuplicates: true })` → emits `ON CONFLICT DO NOTHING`, so a unique conflict (e.g. an overlapping import) is **skipped, not fatal**. `importedCount` = the returned insert count (DB is the truth); `duplicateCount = validRows - importedCount`.
- **App-level pre-pass (summary quality):** before insert, fetch the user's existing `IMPORTED` `dedupHash`es + dedup within the file (first wins) to attribute duplicate `lineNumber`s in the summary. This is best-effort reporting; the DB index is the guarantee under races/retries.

### Decision: Valid-state CHECK — rewrite to four sources
The existing `transactions_source_link_chk` is replaced so each source sets exactly its own columns and nulls the rest, now including `dedupHash` + `importRunId`:
- `IMPORTED` ⇒ `dedupHash` NOT NULL **and** `importRunId` NOT NULL; recurring/card columns NULL.
- `MANUAL`/`RECURRING`/`CARD` ⇒ `dedupHash` NULL **and** `importRunId` NULL (plus their existing rules).

### Decision: Provenance — `ImportRun` model + `importRunId` link
- `ImportRun` (owned by user): `status`, `totalRows`, `importedCount`, `duplicateCount`, `invalidCount`, optional `fileHash` (sha-256 of file bytes), timestamps. **Never** stores the raw CSV body.
- Imported `Transaction` rows carry `importRunId` (provenance link; required for IMPORTED per the CHECK). The run + its rows are written in one interactive transaction (run created, rows `createMany`, counts finalized) so a failure persists nothing.

### Decision: Two-step migration for the new enum value
Adding `IMPORTED` and then referencing it in a **partial index predicate** in the same transaction risks Postgres's "unsafe use of new enum value" error (a predicate is stricter than the CHECK literal comparisons used for CARD/RECURRING). **Split into two migrations:** (1) `ALTER TYPE ... ADD VALUE 'IMPORTED'` alone; (2) tables/columns/FK/partial-unique-index + CHECK rewrite. `migrate deploy` commits (1) before (2) runs.

### Decision: Amount parsing
CSV amount strings → integer minor units via a documented decimal parse (fixed 2-decimal BRL; accepted decimal format defined in design), then validated via `createMoney`. Non-positive / unparseable → row rejected as invalid (R3).

## Risks & Mitigations
- **Duplicate under concurrency/re-import** → partial unique index + `createMany skipDuplicates` (DB truth); tested by re-import + overlapping imports.
- **False-positive skips** → dedup scoped to IMPORTED-only.
- **Untrusted file DoS** → memory storage + `limits.fileSize` + max row count + whole-file structural rejection; no raw-body logging.
- **Enum-in-predicate migration failure** → two-step migration.
- **Amount locale ambiguity** → documented decimal format + `createMoney` validation; ambiguous rows rejected.
- **Breaking the other 3 producers** → CHECK rewrite covers all four sources; existing suites kept green.

## References
- `gap-analysis.md`; `docs/conventions.md`; card/recurring migrations (CHECK + partial-index precedent), `common/ledger-money-date.ts`, `common/is-iso-date.validator.ts`, `@nestjs/platform-express` (multer).
