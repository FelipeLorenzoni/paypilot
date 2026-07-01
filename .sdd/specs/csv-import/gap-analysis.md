# Gap Analysis — csv-import

## Current State (existing assets)

| Asset | Location | Reuse |
|-------|----------|-------|
| `Transaction` ledger (+ `type`/`source` enums) | `apps/api/prisma/schema.prisma` | Imported rows are `Transaction` with a **new** `source`; `type` stays `EXPENSE` |
| `TransactionSource { MANUAL, RECURRING, CARD }` | schema | **Extend** with an import source value |
| Source-aware CHECK precedent (`transactions_source_link_chk`) + link columns | schema + card/recurring migrations | Template if imported rows need a stored dedup-hash column + CHECK branch |
| money/date helpers (`createMoney`, bigint guard, `YYYY-MM-DD`) | `common/ledger-money-date.ts`, `@paypilot/shared` | Money/date for parsed rows |
| `IsIsoCalendarDate` (pure calendar validation) | `common/is-iso-date.validator.ts` | Date validation for parsed rows |
| Owner-scoped repository pattern | `expenses/`, `recurring-bills/`, `cards/` | Template for the import repository / dedup query |
| Global `JwtAuthGuard`, `@CurrentUser`, `assertOwnership` | `auth/*`, `common/ownership.ts` | Auth + isolation |
| `AllExceptionsFilter` + `ErrorCode` | `common/` | Canonical 400/401/413 |
| `@nestjs/platform-express` (+ multer `>=2.2.0` override) | `apps/api/package.json`, `pnpm-workspace.yaml` | Multipart upload via `FileInterceptor` (memory storage + limits) — no new prod dep for transport |
| Testcontainers integration harness (serial, non-UTC TZ) | `apps/api/test/*.int.spec.ts` | Import + dedup + isolation tests on real PostgreSQL |

**Notable absences:** no `IMPORTED` source value; **no CSV parser dependency**; no file-upload interceptor/config anywhere; no dedup-key/hash concept in the ledger; no shared "ledger writer" (each of the 4 producers writes `Transaction` on its own).

## Requirement → Asset Map (gaps tagged)

| Requirement | Existing | Gap |
|-------------|----------|-----|
| R1 import + summary | ledger + repo pattern | **Missing:** import module/controller/service; **Decision:** transfer mechanism (multipart vs inline) |
| R2 dedup (R6) | — | **Unknown/Decision:** dedup-key normalization (trim/casing/date granularity); app-level vs DB constraint; **scope** (imported-only vs all the user's rows) |
| R3 row validation / partial success | `createMoney`, `IsIsoCalendarDate` | **Missing/Decision:** per-row validation + rejection reporting; **amount parsing** from CSV decimal strings → minor units (locale/format) |
| R4 untrusted input + limits | multer via platform-express | **Missing/Decision:** structure/header validation, max size + max row count, memory-storage config; no raw-body logging |
| R5 isolation | guard/`@CurrentUser`/scoped queries | **Constraint:** dedup query + writes scoped to the user |
| R6 source protection | source-aware CHECK precedent | **Required:** new source value; extend CHECK if a dedup column is added; other features must not touch imported rows + tests |
| R7 money/date/persistence | `createMoney`, mapper, `Clock`, Prisma | **Missing:** migration (enum + optional dedup column/index) |
| R8 tests | Testcontainers | **Missing:** import/dedup/limits/isolation + normalization unit tests |

## Key Research / Decisions for Design

1. **Dedup enforcement + scope (R6 — main risk).**
   - **Normalization:** define the canonical dedup key from date (date-only), amount (minor units), and description (trim + case-fold + collapse internal whitespace). Document exactly.
   - **Scope:** decide whether the dedup match considers **only import-sourced** rows or **all** of the user's transactions. (The financial rule targets statement re-imports; matching against manual/card rows risks false-positive skips. Recommend: scope to the user's rows, decision documented; a per-row "matched existing id/source" is not exposed.)
   - **App-level vs DB:** options — **(A)** app-level: query existing rows by normalized key within the user scope, plus an in-batch `Set`; simple, but a race between concurrent imports could double-insert. **(B, recommended for a hard guarantee)** store a nullable `dedupHash` (sha-256 of the normalized key) on imported `Transaction` rows with a **partial unique index** `(userId, dedupHash) WHERE source = 'IMPORTED'`, and treat a unique violation as "duplicate, skip" (mirrors the recurring/card idempotency precedent). Extend the source-aware CHECK so `IMPORTED` requires `dedupHash` and non-import rows leave it NULL.
2. **CSV parser dependency.** No parser exists. Prefer a small, vetted RFC-4180 parser (e.g. `csv-parse`) pinned exact, respecting the supply-chain policy (`minimumReleaseAge`, `allowBuilds`, exact version). Alternative: hand-roll a minimal parser — riskier for quoted fields/embedded delimiters on untrusted input. **Research Needed:** release-age + build-script check for the chosen parser.
3. **Transfer mechanism.** **Recommended: multipart upload** via `FileInterceptor` (from `@nestjs/platform-express`, multer already overridden `>=2.2.0`) with **memory storage** and a hard `limits.fileSize` + max row count; no disk writes. Alternative: inline payload (base64/text field) — avoids multer but awkward and still needs size bounds. Multipart is idiomatic and bounds size natively.
4. **Amount parsing from CSV.** Statement amounts arrive as decimal strings (possibly `1.234,56` or `1234.56`). Define a deterministic parse to integer minor units (documented decimal/locale handling), then validate via `createMoney`. Non-parseable/negative/zero → row rejected (R3).
5. **CSV format / column mapping.** Define required columns (date, amount, description; optional category/currency), header requirement, delimiter, and accepted date format(s). Keep it a fixed MVP schema; reject structurally invalid files (R4.1).
6. **Shared ledger-writer (DRY across 4 producers).** With import as the 4th `Transaction` producer, seriously consider extracting a small shared ledger-writer/mapper used by expenses, recurring-bills, cards, and import. Optional but increasingly worthwhile.
7. **`type` stays `EXPENSE`; import source value** (e.g. `IMPORTED`) added to the enum.

## Implementation Approach Options
- **Option A — Extend expenses module:** ❌ distinct concern (parsing, dedup, untrusted upload); would bloat expenses.
- **Option B — New `CsvImportModule` (recommended):** upload controller (multipart) + parser + a pure dedup-key/normalization module + import service (validate → dedup → persist) + owner-scoped repository; plus the enum extension and (if chosen) the `dedupHash` column + partial unique + CHECK branch. Clean, testable, matches structure steering (`apps/api/src/imports/` or `csv-import/`).
- **Option C — Hybrid (shared ledger-writer):** Option B plus extracting a shared ledger writer used by all four producers. ✅ DRY now that there are four; ❌ upfront refactor touching three shipped features. Reasonable to schedule but adds risk to this spec.

## Effort & Risk
- **Effort: M–L.** Upload + parsing + validation + summary is moderate; the weight is the dedup normalization/enforcement decision, untrusted-input limits, and amount-string parsing.
- **Risk: Medium.** Concentrated in (a) dedup correctness under re-import/concurrency and false-positive scope, (b) safe parsing of untrusted CSV within resource bounds, and (c) deterministic amount parsing. A new parser dependency is a supply-chain touchpoint (mitigated by the existing policy).

## Recommendations for Design
- **Option B**; **multipart upload** (memory storage + size/row limits); a **pure normalization module** with unit tests; dedup via a stored `dedupHash` + **partial unique index** (Option 1B) treating unique-violation as skip, scoped per user to imported rows; extend the **source-aware CHECK** for the import source; add a vetted **CSV parser** pinned exact (research release-age/build-scripts first).
- Make source protection explicit and tested (other features can't touch imported rows).
- Consider (Option C) extracting a shared ledger writer, or defer with a note if it would over-scope this spec.
- Carry research items 1–7 into the design; decide dedup scope, normalization, parser, column schema, and amount-format there.
