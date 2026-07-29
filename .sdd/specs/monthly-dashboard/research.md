# Research & Design Decisions — monthly-dashboard

## Summary

- **Feature**: `monthly-dashboard`
- **Discovery Scope**: Extension (light discovery). Full-stack spec, but every
  building block already exists: unified ledger, materialized `RECURRING`
  occurrences, derived card invoices, paid markers, owner-scoped repository
  pattern, injected `Clock`, shared-contract package, and the web four-state
  data-access hook. **No new runtime dependency is introduced.**
- **Key Findings**:
  1. The ledger's `transactionDate` column carries **different semantics per
     source** — spend date for `MANUAL`/`IMPORTED`, occurrence date for
     `RECURRING`, and the **invoice due date** for `CARD` (documented in
     `schema.prisma` and relied upon by `RemindersRepository.findDueItems`).
     This is the single correctness decision of the whole feature (D1).
  2. Paid status is **readable today**: `payment_markers` is keyed by the
     canonical `(targetType, targetKey)` identity built by pure helpers in
     `reminders/domain/reminder-target.ts`. Requirement 5 does not have to wait
     for `bill-payments` (D3).
  3. `apps/api` **already depends on `@paypilot/shared`** (`createMoney`,
     `ErrorCode`). The dashboard contract can therefore be a shared type that
     the API service *implements* and the web client *consumes*, making
     Requirement 8.7 a compile-time guarantee instead of the hand-maintained
     mirror `web-mvp-shell` had to settle for (D5).

## Research Log

### Ledger month-membership semantics

- **Context**: Requirement 2 asks for "total spent this month"; Requirement 4
  asks for "what is still due this month". Both are computed from the same
  `transactions` table, whose date column does not mean the same thing for
  every source.
- **Sources Consulted**: `apps/api/prisma/schema.prisma` (Transaction model
  comments), `cards/card-ledger-writer.ts`, `cards/domain/invoice-assignment.ts`
  (`assignCycle`, `dueDate`), `recurring-bills/generation.helpers.ts`
  (`clampDay`), `reminders/reminders.repository.ts` (the existing cross-feature
  reader of the same rows).
- **Findings**:
  - `MANUAL` / `IMPORTED` → `transactionDate` is the spend/statement date.
  - `RECURRING` → `transactionDate` is the occurrence's due date, clamped to
    the month length; the whole period is materialized by the daily generation
    job, not day by day.
  - `CARD` → one ledger row per purchase **installment**, whose
    `transactionDate` is the **due date of the invoice cycle it was assigned
    to**, not the purchase date. Every row of a `(card, cycle)` therefore
    shares one date, which is what lets the reminders repository group rows
    into invoices without recomputing `dueDate`.
- **Implications**: A uniform `transactionDate BETWEEN monthStart AND monthEnd`
  filter yields a **cash-out / obligation view** of the month, not an accrual
  view. Totals and the upcoming-due list then derive from exactly the same row
  set, which is the property that keeps them consistent. See D1.

### Reuse of the reminder target identity

- **Context**: Requirement 9.1 requires paid status "using the existing
  payment-marker semantics from `due-date-reminders`".
- **Sources Consulted**: `reminders/domain/reminder-target.ts`,
  `reminders/paid-status.service.ts`, `payment_markers` unique index
  `(userId, targetType, targetKey)`.
- **Findings**: `recurringTarget(txnId)` → `txn:<id>` and
  `cardInvoiceTarget(cardId, cycle)` → `card:<cardId>:<cycle>` are pure,
  framework-free functions; markers are invoice-level for cards. Marker row
  presence *is* paid; there is no `paid` column to read.
- **Implications**: The dashboard derives the same keys from the month's rows
  and does a single `payment_markers` lookup. Key construction is **not**
  duplicated — the dashboard domain imports the existing helpers, so the string
  format can never drift from the DB unique index. See D3.

### Aggregation strategy (SQL `groupBy` vs in-memory)

- **Context**: The summary needs three aggregations (per currency, per source,
  per category) plus an invoice grouping over the same rows.
- **Sources Consulted**: `expenses/expenses.repository.ts` (owner-scoped
  Prisma access + `@@index([userId, transactionDate, id])`),
  `common/ledger-money-date.ts` (`toAmountNumber` BigInt guard).
- **Findings**: A Prisma `groupBy` per dimension would mean 3–4 round trips and
  would still not produce the invoice grouping or the paid join; money would
  also have to leave `bigint` in several places. One indexed range query returns
  the month's rows (tens to low hundreds for a personal-finance user).
- **Implications**: Fetch the month once, aggregate in a **pure domain function
  over `bigint` accumulators**, convert to `number` only at the response
  boundary via the existing `toAmountNumber` guard. Two queries total (rows +
  markers). See D6.

### Frontend composition

- **Context**: The dashboard route exists but renders a placeholder shortcut
  list; nothing else is missing.
- **Sources Consulted**: `apps/web/src/features/expenses/expenses-page.tsx`
  (canonical four-state page), `lib/api/hooks.ts` (`useApiQuery`),
  `lib/format/{money,date}.ts`, `components/ui/*`, `frontend-architecture`
  steering.
- **Findings**: Every primitive the dashboard needs already exists except a
  month-label formatter (`"2026-07"` → `"July 2026"`). The established
  formatters are deliberately locale-data-free (manual grouping / string
  slicing), so the month formatter follows the same shape: a frozen 12-entry
  name table, no `Date` construction.
- **Implications**: No new dependency; one new pure formatter; the page is a
  composition of existing primitives. See D8.

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
| ------ | ----------- | --------- | ------------------- | ----- |
| A — Extend each feature service | `expenses`, `cards`, `recurring-bills` each gain a month-summary method; the web page fans out and merges | No new backend feature folder | The summary is inherently cross-source; month/isolation/currency logic gets duplicated 3–4×, and the **frontend would merge financial data** — a direct violation of "backend owns financial truth" ([[tech]]) | Rejected |
| B — New read-only `dashboard` feature | One module + controller + service + repository + pure domain; single owner-scoped month query | Matches "specs map to features" ([[structure]]); one place for the month rule; trivially unit-testable | Adds a feature folder that owns no table (read-only) | Selected |
| C — B + shared extractions | B, but promoting `reminder-target.ts` and a month-range util into `common/` | Slightly cleaner ownership | Touches a tested financial feature (`reminders`) for cosmetic reuse, with no behavior gain in this spec | Deferred to `bill-payments`, which will own paid status |

**Selected: B**, importing the existing pure `reminder-target` helpers as-is
(no move). The month-range helper is new and lives in the dashboard domain.

## Design Decisions

### D1 — Month membership is `transactionDate`, uniformly, for all four sources

- **Context**: `CARD` rows carry the invoice **due date**, so a purchase made
  in July on a card that closes in July and is due in August lands in August.
  Bucketing uniformly by `transactionDate` mixes spend-date and due-date
  semantics across sources.
- **Alternatives Considered**:
  1. **Accrual view** — join `card_purchases` and bucket `CARD` rows by
     `purchaseDate`. "Total spent" would then mean money *committed* this
     month. But an installment's amount belongs to a future cycle, so the
     month's total would no longer equal what the user pays, and the total
     would stop being reconcilable with the upcoming-due list (two different
     row sets, two different date rules, one screen).
  2. **Cash-out view** — every row belongs to the month of its
     `transactionDate`; a card invoice counts in the month it is **due**.
- **Selected Approach**: (2). One rule, one row set, one query. `totalMinor`
  answers "what leaves my account this month"; the upcoming-due list is the
  still-unpaid, still-future subset of the very same rows.
- **Rationale**: It is the only rule under which Requirement 2 and Requirement 4
  cannot contradict each other, and it is the rule the reminders feature already
  applies to the same table. It also matches the product's purpose — PayPilot
  is a bill/due-date tool, not an accounting ledger ([[product]]).
- **Trade-offs**: A card purchase made this month is invisible in this month's
  total (it appears in its invoice's due month). This is a real user-facing
  surprise and must be **stated in the UI**, not just in the design.
- **Follow-up**: Unit tests must pin the rule per source, including a purchase
  after the closing day rolling into the next cycle's due month, and a
  short-month (`dayOfMonth = 31` in February) recurring occurrence.

### D2 — The upcoming-due unit is the invoice, never the ledger row

- **Context**: A card invoice is many `CARD` rows sharing `(creditCardId,
  invoiceCycle)` and one due date; listing rows individually would show the user
  five "due items" for one bill they pay once.
- **Selected Approach**: Group `CARD` rows by `(creditCardId, invoiceCycle,
  currency)` and emit **one** due item per group, amount = `SUM` of rows,
  description = the card's label, `dueDate` = the shared `transactionDate`.
  `RECURRING` rows are one item each. `MANUAL` and `IMPORTED` rows **never**
  produce due items — they are already-incurred spend, not payable-later.
- **Rationale**: Mirrors `RemindersRepository.findDueItems`, so the dashboard
  and the WhatsApp reminders describe the same world. The `currency` in the
  grouping key is defensive: the schema permits mixed-currency rows in one
  cycle, and summing across them would violate 2.3 / 10.3. In practice (BRL
  only) it yields exactly one item per invoice.
- **Trade-offs**: A mixed-currency invoice would surface as two items sharing
  one `targetKey` (and therefore one paid state). Acceptable and documented;
  the alternative is an unsound sum.

### D3 — Read paid status now, from `payment_markers`, via the canonical identity

- **Context**: Requirement 5 is written as conditional ("when available") and
  Requirement 9 declares a soft dependency on the future `bill-payments` spec.
  But the markers are already there and already correct.
- **Selected Approach**: Derive each due item's `(targetType, targetKey)` with
  the existing pure helpers, look the keys up in `payment_markers` in one
  owner-scoped query, and return `paid` + `paidAt` on every due item. **Paid
  items stay in the list**, flagged — Requirement 5.2 asks to *distinguish*
  them, not to hide them (this is deliberately unlike the reminders selection,
  which excludes paid items because a reminder for a paid bill would be wrong).
- **Rationale**: Requirement 5 is satisfiable today with zero new schema, and
  the conditional wording in 5.3 / 9.3 exists precisely to allow this.
- **Trade-offs**: `bill-payments` will later own the mark/unmark UX. Because the
  dashboard emits the same `targetType`/`targetKey` the `PUT /reminders/paid`
  endpoint already accepts, that spec can add a toggle to these rows **without
  changing this contract**.
- **Follow-up**: `paidAt` is an ISO instant (marker semantics), not a date-only
  string — the only non-date-only temporal field in the contract.

### D4 — Currency partitions the whole summary; `hasActivity` separates "zero" from "empty"

- **Context**: 2.3 forbids cross-currency sums; 2.4 wants a **zero total**
  when the month is empty; 7.3 wants a **first-class empty state** when the
  month is empty. Taken literally, 2.4 and 7.3 describe the same month.
- **Selected Approach**: The response is a list of `CurrencySummary` blocks —
  each carries its own total, its four source subtotals, and its category
  breakdown — so no aggregate can ever span currencies *by construction*. When
  the month has no rows at all, the API returns one zeroed `BRL` block
  (Requirement 2.4) **and** `hasActivity: false`, which is what drives the page
  into `<EmptyState />` (Requirement 7.3).
- **Rationale**: An explicit flag beats making the frontend infer emptiness from
  "all totals are zero" — a month can legitimately net to zero. It also keeps
  the "frontend computes nothing" rule intact.
- **Trade-offs**: The default-currency constant (`BRL`) lives in the API. It is
  already the MVP-wide assumption (`formatMoney` accepts only `"BRL"`).

### D5 — The contract is a shared type, implemented by the API and consumed by the web client

- **Context**: `web-mvp-shell` copied the API's response shapes into
  `packages/shared/src/api/` by hand and documented the drift risk, because that
  spec was forbidden from touching `apps/api`. This spec is full-stack, and
  `apps/api` already depends on `@paypilot/shared`.
- **Selected Approach**: Define `MonthlySummaryView` (and its nested types) in
  `packages/shared/src/api/dashboard.ts`; the **API service's return type is the
  shared type**, and the web client's `getMonthlySummary` returns the same type.
- **Rationale**: Requirement 8.7 ("no shape duplicated across frontend and
  backend") becomes a compile-time guarantee: a field renamed on one side fails
  `type-check` on the other. This is the first contract in the repo with that
  property, and it is the pattern the eventual shared-contract cleanup should
  follow.
- **Trade-offs**: Adds a build-order coupling (`packages/shared` must build
  before `apps/api` type-checks) — already true today.

### D6 — One indexed month query + one marker query; BigInt sums in a pure domain function

- **Selected Approach**: `DashboardRepository` performs (a) a
  `transaction.findMany` scoped by `userId` and `transactionDate` within the
  month (served by `@@index([userId, transactionDate, id])`), selecting the card
  label via relation, and (b) a `paymentMarker.findMany` restricted to the keys
  derived from (a). `summarizeMonth(...)` — pure, framework-free, no clock — does
  all grouping and summing over `bigint` accumulators and converts to `number`
  only through `toAmountNumber`.
- **Rationale**: Keeps every financial rule in a file that unit tests can call
  with a plain array ([[structure]]: "financial rules are isolated and pure so
  tests don't need a database"). Also makes the isolation guarantee (10.2) a
  property of one `where` clause instead of four.
- **Follow-up**: If a user's month ever grows past a few thousand rows, revisit
  with SQL-side aggregation; nothing in the contract would change.

### D7 — The dashboard reads only the materialized ledger

- **Context**: `RECURRING` occurrences exist only after the daily generation job
  has run for the period (01:00 UTC).
- **Selected Approach**: The read model reads rows; it never generates,
  anticipates, or projects occurrences — and the frontend certainly never does.
- **Rationale**: A read endpoint that writes ledger rows would break Requirement
  8.6 (read-only) and R3 idempotency reasoning.
- **Trade-offs**: A bill created mid-month shows up in the summary only after
  the next generation run. Documented; acceptable for the MVP.

### D8 — Month boundaries and "today" are UTC, derived server-side

- **Context**: Requirement 8.4 demands an injected clock and an explicit
  timezone. The repo's precedent (`RemindersScheduler`, `toDateOnly`,
  `toDateString`) is: the UTC calendar date of the injected clock *is* "today".
- **Selected Approach**: Same rule. The response carries `today`, `monthStart`,
  and `monthEnd` so the browser never reads a clock or constructs a `Date`.
- **Trade-offs**: For a user in `America/Sao_Paulo` (UTC−3), the month flips at
  21:00 local on the last day. This is the behavior the reminder pipeline
  already has; changing it is a repo-wide decision, not a dashboard decision.

## Risks & Mitigations

- **Card purchases appear in the month they are due, not the month they were
  made (D1).** The largest source of "the number looks wrong" support load.
  → Mitigation: the totals panel states the rule in plain language; unit tests
  pin it; the design records it as an intentional product semantic.
- **Early-month gap in `RECURRING` rows (D7).** → The summary is correct for
  what is materialized; generation runs daily and the gap self-heals within a
  day. No client-side projection.
- **UTC month boundary (D8).** → Consistent with reminders; documented.
- **Shared-type drift (D5).** → Eliminated for this contract by having both
  sides import it; a type-check failure is the enforcement.
- **Mixed-currency invoice (D2).** → Grouping key includes `currency`; never
  cross-summed. Surfaces as two items rather than one wrong number.

## References

- Steering: `.sdd/steering/financial-rules.md` (money/time invariants, R1–R6),
  `frontend-architecture.md` (four states, API client, formatters),
  `structure.md` (feature folders, pure domain), `testing.md` (fixed clock, DB
  isolation), `tech.md` (backend owns financial truth).
- Code: `apps/api/prisma/schema.prisma` (Transaction, PaymentMarker),
  `apps/api/src/reminders/reminders.repository.ts` (the precedent for reading
  the same rows), `apps/api/src/reminders/domain/reminder-target.ts` (canonical
  identity), `apps/api/src/common/{clock,ledger-money-date}.ts`,
  `apps/web/src/features/expenses/expenses-page.tsx` (four-state page shape).
- Prior spec docs: `.sdd/specs/monthly-dashboard/gap-analysis.md`,
  `.sdd/specs/due-date-reminders/design.md` (target identity rationale).
