# Research & Design Decisions — manual-expenses

## Summary
- **Scope**: Extension (brownfield) — new `ExpensesModule` on the existing NestJS app; see `gap-analysis.md` for the full asset/gap map.
- **Key resolutions** (carry-forward from requirements + gap analysis are all decided below).

## Design Decisions

### Decision: Persistence model — generic `Transaction` exposed via `/expenses`
- Internal model **`Transaction`** (the shared ledger spine) with `type`/`source` enums; this spec exposes only `/api/v1/expenses` and only creates `type=EXPENSE, source=MANUAL`.
- **Rationale**: recurring-bills, cards, CSV import (imminent on the roadmap) write into the same table without duplicating financial records (R8.3).

### Decision: Money — BIGINT column, validated bigint→number boundary
- `amountMinor` stored as Postgres `BIGINT`; Prisma returns a JS `bigint`. A **mapper** converts `bigint → number` guarded by `Number.isSafeInteger` (throws if out of safe range), and `number → bigint` on write. In-code domain uses the shared `Money` (`amountMinor: number`).
- **Rationale**: keeps the `Money` MVP representation (`number`) while DB stays BIGINT for headroom; the future-proofing path (string/bigint at the API) stays open per `docs/conventions.md`.
- **Follow-up**: unit-test the mapper incl. the unsafe-integer guard.

### Decision: Ownership via user-scoped queries
- All reads/mutations use `WHERE id = ? AND userId = ?` (e.g. `findFirst`, `updateMany`/`deleteMany` with count check). Not found / not owned → `NotFoundException` (404-like, no disclosure). Avoids fetch-then-check TOCTOU.

### Decision: Date-only handling (no timezone shift)
- DB column `transactionDate DateTime @db.Date` (generic ledger name; API exposes `expenseDate`). Mapping: parse `YYYY-MM-DD` → `new Date("<d>T00:00:00.000Z")` (UTC midnight) on write; on read format `date.toISOString().slice(0, 10)`. Keeps the calendar date stable regardless of server timezone — **verified by a blocking non-UTC round-trip test**.

### Decision: Pagination — offset, bounded
- Query `page` (default 1) + `pageSize` (default 20, **max 100**, rejected above). Response `meta { page, pageSize, total }`. **Deterministic order** `transactionDate desc, id desc`. Composite index `(userId, transactionDate)` supports ordering + the inclusive date-range filter.

### Decision: Filtering
- Required-for-usefulness `from`/`to` `expenseDate` range, **inclusive** on both ends. Optional `currency`/`category` deferred (may be added in design-of-list without breaking).

### Decision: Currency policy — BRL-only (MVP)
- Normalize to uppercase; accept only `BRL` for the MVP (reject others with 400). `currency` field retained for future multi-currency.

### Decision: Status — omitted
- No status field (R12 recommendation): a manual expense is already-registered spending, effective immediately.

### Decision: User FK onDelete = Restrict
- `Transaction.userId → User.id` with `onDelete: Restrict`. There is no user-deletion flow in this spec, and financial ledger rows must not be silently purged via user deletion; an explicit account-lifecycle/purge spec defines that behavior later.

## Risks & Mitigations
- **bigint→number overflow** — guarded by `Number.isSafeInteger`; input DTO also caps `amountMinor ≤ Number.MAX_SAFE_INTEGER` and `> 0`.
- **Date tz drift** — fixed by the UTC-midnight mapping convention; covered by tests.

## References
- `gap-analysis.md` (asset/gap map, options A/B/C — Option B chosen).
- `docs/conventions.md` (money/time), auth-jwt primitives (`@CurrentUser`, guard, `assertOwnership`).
