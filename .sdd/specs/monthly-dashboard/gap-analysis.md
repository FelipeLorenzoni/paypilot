# Gap Analysis — monthly-dashboard

## Current State (existing assets)

| Asset | Location | Reuse |
|-------|----------|-------|
| **Unified `transactions` ledger** (`amountMinor` BIGINT, `currency`, `transactionDate` DATE, `categoryLabel`, `source`, per-source link cols) | `apps/api/prisma/schema.prisma` | The single source for the whole summary — all four sources live in one table |
| `TransactionSource { MANUAL, RECURRING, CARD, IMPORTED }` (all four exist) | schema | Group-by dimension for per-source subtotals (Req 3) |
| Index `@@index([userId, transactionDate, id])` | schema | Supports the owner-scoped month-range query (Req 8) |
| `dueDate(cycle, closingDay, dueDay)` invoice-assignment helper + `InvoicesService` (groups CARD rows by `(creditCardId, invoiceCycle)`, sums, computes due date) | `apps/api/src/cards/domain/invoice-assignment.ts`, `cards/invoices.service.ts` | Reuse for grouping card invoices into "upcoming due items" |
| **Recurring occurrences fully materialized** for the current period by the daily scheduler (`generateForPeriod` creates a row per eligible bill for the whole month, not just past days; `transactionDate = clampDay(dayOfMonth, period)`) | `recurring-bills/generation.service.ts`, `generation.helpers.ts`, `generation.scheduler.ts` | RECURRING month rows are readable from the ledger — no projection needed |
| **`PaymentMarker` table exists** (`payment_markers`, unique `(userId, targetType, targetKey)`, `paidAt`); keys `txn:<transactionId>` \| `card:<creditCardId>:<cycle>` | schema, `reminders/domain/reminder-target.ts`, `reminders/paid-status.service.ts` | Paid status is **readable now** by keying markers to payable items (Req 9) |
| Owner-scoped repository pattern + `JwtAuthGuard` (global) + `@CurrentUser` + `assertOwnership` | `expenses/`, `cards/`, `common/ownership.ts`, `auth/*` | Auth + per-user isolation for the new endpoint |
| `AllExceptionsFilter` + canonical `ErrorCode` envelope | `common/` | Reuse for 401/404/500 responses |
| Injected `Clock` (`clock.now()`) precedent | `reminders/`, generation services | Deterministic "current month" / "upcoming" boundaries (Req 8.4, Req 10.1) |
| `ledger-money-date.ts` (BigInt money, `YYYY-MM-DD`) | `apps/api/src/common/` | Minor-unit math + date-only handling server-side |
| Shared API contract pattern (plain TS types) | `packages/shared/src/api/*.ts` | New `dashboard.ts` contract |
| **Frontend shell**: `features/dashboard/dashboard-page.tsx` placeholder, typed API client (`lib/api/`), `useApiQuery` four-state hook, `<Loading/>`/`<EmptyState/>`/`<ErrorState/>`, `formatMoney`/`formatDate` | `apps/web/src/` (web-mvp-shell, commit `bf89b31`) | Compose the dashboard UI without new infra |

**Notable absences:** no aggregation endpoint of any kind (each feature reads its own slice); no listing of `RECURRING` or `IMPORTED` ledger rows; no multi-card / whole-month invoice view (invoices are read one `(card, cycle)` at a time); **no read path for paid status** (only `PUT /reminders/paid`); no month-boundary utility; no `apps/api/src/dashboard/` feature; the dashboard frontend is a stub.

## Requirement → Asset Map (gaps tagged)

| Requirement | Existing | Gap |
|-------------|----------|-----|
| R1 authenticated page / current-month context | `(app)` layout protection, dashboard stub, injected clock | **Missing:** compose real page; **Decision:** where "today"/month comes from (server response vs client) |
| R2 monthly total (per currency) | ledger `amountMinor`/`currency`; `formatMoney` | **Missing:** server aggregation; **Decision:** multi-currency grouping (never cross-sum) |
| R3 aggregate all 4 sources | unified ledger + `source` | **Missing:** group-by-source query; **Constraint:** attribute each row to exactly one source (no double count) |
| R4 upcoming due items | CARD rows carry due date as `transactionDate`; RECURRING carry occurrence date; `dueDate` helper | **Missing:** select/sort due items; **Decision:** invoice-level grouping vs per-row; what counts as a "due item" for MANUAL/IMPORTED (likely none) |
| R5 paid status (when available) | `payment_markers` + key builders | **Missing:** read markers by key; **Decision:** soft dependency on `bill-payments` (see below) |
| R6 category breakdown | `categoryLabel` (nullable free text) | **Missing:** group-by-label + `null → "Uncategorized"`; **Constraint:** no taxonomy (owned by `categories-and-budgets`) |
| R7 view states / formatting / a11y | `useApiQuery`, UI primitives, formatters | **Missing:** wire states in dashboard components (established pattern) |
| R8 backend monthly-summary read model | ledger, index, `Clock`, invoice helper, shared-contract pattern | **Missing (core):** new `dashboard` feature — module/controller/service/DTO + shared contract; **Decision:** `transactionDate` bucketing semantics (see Research #1) |
| R9 paid-status read exposure | `payment_markers` readable today | **Constraint:** fold marker read into R8 service; forward-compatible with `bill-payments` |
| R10 financial-rule alignment / NFR | Testcontainers int-test harness, unit-test precedent | **Missing:** determinism (fixed clock), isolation, minor-unit, and frontend view-state tests |

## Key Research / Decisions for Design

1. **`transactionDate` bucketing semantics (main correctness risk).** The single
   ledger column means different things per source: MANUAL/IMPORTED = spend/statement
   date, RECURRING = clamped occurrence date, **CARD = the invoice's due date** (not the
   purchase date). Bucketing "current month" uniformly by `transactionDate` therefore mixes
   spend-date and due-date semantics. This is fine (arguably ideal) for **"what's due this
   month"**, but means a card *purchase* made this month appears in its invoice's *due* month.
   Design must define and document the month-membership rule per source and confirm it matches
   Req 2 ("total spent") vs Req 4 ("upcoming due") intent — possibly total = spend-oriented,
   due-list = due-oriented, computed from the same rows.
2. **Recurring materialization / scheduler lag.** Current-month RECURRING rows exist only
   after the daily scheduler has run for the period. Decide: dashboard reads **materialized
   ledger only** (recommended — keeps "backend owns truth", frontend never projects) and
   documents the early-in-month edge, OR the read model triggers/anticipates generation.
   Recommend read-only + note; do **not** project occurrences client-side.
3. **Upcoming-due unit: invoice vs row.** Card invoices are many CARD rows sharing
   `(creditCardId, invoiceCycle)` and one due date. "Upcoming due items" should list one entry
   **per invoice** (grouped, summed via the existing `InvoicesService` logic), not per CARD
   row; RECURRING items are one row = one item. Decide whether MANUAL/IMPORTED ever appear as
   "due" (likely no — they are already-incurred, not payable-later).
4. **Paid-status read scope (Req 9).** Markers are readable now via `txn:<id>` /
   `card:<card>:<cycle>` keys. Decide whether the dashboard reads markers **directly** in this
   spec (fast, unblocks Req 5) or waits for `bill-payments` to expose a product-level read.
   Recommend: read markers directly now, keep the mapping in one place so `bill-payments` can
   later own it without changing the dashboard contract. Soft dependency, not a blocker.
5. **Multi-currency handling.** MVP is BRL, but rows carry explicit currency. Define totals as
   **per-currency groups**; never sum across currencies (Req 2.3). Decide presentation when only
   one currency exists (common case) vs multiple.
6. **Month parameterization.** Requirements scope the UI to the current month, but the read
   model naturally takes a `month=YYYY-MM` param. Decide: expose the param (future month-switch,
   cheap) but default the UI to current month; validate the param server-side (reject malformed).
7. **Endpoint shape & contract.** Likely `GET /dashboard/summary?month=YYYY-MM` returning
   `{ month, totalsByCurrency, subtotalsBySource, categoryBreakdown, upcomingDueItems }`.
   Define the shared type in `packages/shared/src/api/dashboard.ts`; the web client adds
   `getMonthlySummary`. (Per web-mvp-shell notes, contracts are plain TS types, not Zod, on the
   shared side.)

## Implementation Approach Options

- **Option A — Extend existing feature services** (expenses gains a month-summary method,
  cards exposes a whole-month multi-invoice read, etc.): ❌ the summary is inherently
  cross-source; spreading it bloats 3–4 features and duplicates month/isolation logic. Rejected.
- **Option B — New read-only `apps/api/src/dashboard/` feature (recommended):** one module +
  `DashboardController` (`GET /dashboard/summary`) + `DashboardService` running a single
  owner-scoped month-range ledger query, grouping by source and `categoryLabel`, grouping CARD
  rows into invoices (reusing `dueDate`), and joining `payment_markers` for paid state; injected
  `Clock`; shared contract in `packages/shared`. Frontend: real `features/dashboard/` components
  composed via `useApiQuery` + a `getMonthlySummary` client fn. Matches the "spec ↔ feature
  folder" structure rule; clean, unit-testable, read-only.
- **Option C — Hybrid (Option B + small shared extractions):** extract a reusable month-boundary
  util and reuse the reminder `targetKey` builders + invoice `dueDate` helper rather than
  re-deriving them, keeping paid-key logic in one place for `bill-payments` to inherit. ✅ avoids
  duplicating date/key logic across dashboard and reminders; minimal refactor. **Recommended
  refinement of B.**

## Effort & Risk

- **Effort: M (3–7 days).** The heavy lifting (unified ledger, materialized occurrences,
  invoice/dueDate helper, paid markers, four-state frontend, shared-contract + client patterns)
  already exists. Net-new is one aggregation service + DTO + a handful of dashboard components.
- **Risk: Low–Medium.** Concentrated almost entirely in the **`transactionDate` bucketing
  semantics** decision (Research #1) and the **invoice-grouping** for due items (#3); everything
  else extends established patterns. Determinism/isolation/minor-unit correctness are well-served
  by the existing `Clock`, ownership, and BigInt precedents.

## Recommendations for Design

- **Option C** (new `dashboard` feature, read-only, reusing `dueDate`/`targetKey`/month util).
- Nail down **month-membership semantics per source** (#1) and the **due-item unit = invoice**
  (#3) as explicit, tested rules; document that CARD `transactionDate` is the due date.
- Read the summary from the **materialized ledger only** (#2); never project occurrences on the
  client or in the read model.
- **Read `payment_markers` directly now** (#4) to satisfy Req 5 without waiting for
  `bill-payments`; keep the key-mapping in one place for later ownership handoff.
- Totals **per currency**, never cross-summed (#5); parameterize the endpoint by `month` but
  default the UI to the current month (#6).
- Carry the R10 test targets: fixed-clock determinism (month-boundary/short-month), per-user
  isolation, minor-unit/no-cross-currency, and frontend four-state + error-envelope tests.
