# Requirements Document

## Project Description (Input)

monthly-dashboard: build the first PayPilot monthly overview dashboard.

Scope:

- Authenticated dashboard page.
- Show current month financial summary.
- Aggregate manual expenses, recurring bill occurrences, card invoices, and imported transactions.
- Show total expenses for the month.
- Show upcoming due items.
- Show paid/unpaid status when available.
- Show category breakdown using existing category labels.
- Use existing APIs where possible.
- Define backend gaps if new read models/endpoints are required.
- Keep calculations deterministic and based on integer minor units.
- Frontend should follow the frontend-architecture steering.

Out of scope:

- complex forecasting
- budgets
- AI categorization
- payment settlement
- advanced charts
- export/reporting

Goal:
Create the first useful financial overview page for the user.

## Introduction

This feature delivers PayPilot's first monthly overview: an authenticated
`/dashboard` page that shows the user, at a glance, what they spent and what
they still owe in the **current month**, aggregated across all four ledger
sources (manual expenses, recurring bills, credit-card invoices, imported
transactions), with a category breakdown and a list of upcoming due items.

**Spec split (per `frontend-architecture` steering): this is a FULL-STACK
spec.** The current backend exposes no current-month aggregation surface:

- `GET /expenses?from&to` returns only `MANUAL` ledger rows.
- `GET /recurring-bills` returns bill **definitions** (`dayOfMonth`, amount),
  not the occurrences/generated rows for a month.
- Generated `RECURRING` transactions and `IMPORTED` transactions exist in the
  ledger but have **no listing endpoint**.
- Credit-card invoices are readable only one at a time
  (`GET /credit-cards/:cardId/invoices/:cycle`).
- Paid status has only a write path (`PUT /reminders/paid`); there is **no
  read** of paid/unpaid state.

Because the backend owns all financial truth and the frontend must never
compute schedules, invoices, or occurrences, the aggregation cannot be
assembled client-side from the endpoints above. Requirements are therefore
split into **frontend requirements** (the dashboard page and its behavior) and
explicit, separately numbered **backend read-model gap requirements** (a
server-computed monthly-summary capability). Shared request/response contracts
land in `packages/shared`.

Cross-cutting financial invariants from `financial-rules` apply: money is
integer minor units with explicit currency and never float-math; date-sensitive
logic ("current month", "upcoming") derives from an **injected** current time,
never a direct clock read, so the summary is deterministic and testable; the
dashboard is **read-only** and mutates no ledger rows (source protection).

### Terminology

- **Current month** — the calendar month (in the application's configured
  timezone) that contains the injected "today".
- **Summary source** — one of `MANUAL`, `RECURRING`, `CARD`, `IMPORTED`.
- **Payable item** — a recurring bill occurrence or a card invoice. Manual and
  imported rows are already-incurred spend and are never payable items.
- **Due item** — a payable item shown in the dashboard's due list. It is either
  a payable item of the current month (any due date within the month), or an
  **unpaid** payable item of an earlier month inside the overdue look-back
  window (a *carried-over* item).
- **Due status** — a backend-reported state of a due item: `PAID` (a paid
  marker exists), `OVERDUE` (unpaid and due date before "today"), or `DUE`
  (unpaid and due date on or after "today").
- **Overdue look-back window** — the fixed number of calendar months before the
  current month whose unpaid payable items are carried over into the due list
  (MVP: 3 months, a backend constant).
- **Paid status "when available"** — displayed only where a backend read of
  paid/unpaid state exists; this depends on the `bill-payments` spec and must
  degrade gracefully until then.

## Requirements

### Requirement 1: Authenticated monthly overview page

**Objective:** As an authenticated PayPilot user, I want a dashboard page for
the current month, so that I have one place to see my monthly finances without
opening each feature area.

#### Acceptance Criteria

1. The PayPilot Dashboard shall expose the overview at the authenticated route
   `app/(app)/dashboard` and inherit protection from the `(app)` layout.
2. If a user without a valid session requests the dashboard, then the PayPilot
   Dashboard shall redirect to `/login` and render no financial data.
3. If any dashboard API call returns `UNAUTHORIZED`, then the PayPilot Dashboard
   shall clear the session and redirect to `/login` (never a broken page).
4. When the dashboard loads, the PayPilot Dashboard shall determine the current
   month from the injected "today" and present it as the active period, with a
   human-readable month label.
5. The PayPilot Dashboard `page.tsx` shall stay thin — composing feature
   components from `src/features/dashboard/` — and shall place no `fetch` calls
   or aggregation logic in the route file.

### Requirement 2: Monthly spending total

**Objective:** As a user, I want the total I spent this month, so that I know my
overall monthly outflow at a glance.

#### Acceptance Criteria

1. When the monthly summary is loaded, the PayPilot Dashboard shall display the
   total expense amount for the current month as **integer minor units
   formatted at render time** via the shared money formatter.
2. The PayPilot Dashboard shall compute no monetary totals client-side; it shall
   render totals exactly as provided by the backend summary read model
   (Requirement 8).
3. Where transactions of more than one currency exist in the month, the PayPilot
   Dashboard shall present totals grouped per currency and shall never sum
   amounts across different currencies.
4. If the current month has no transactions in any source, then the PayPilot
   Dashboard shall display a zero-value total for the month's currency context
   rather than an error or a blank value.

### Requirement 3: Aggregation across all ledger sources

**Objective:** As a user, I want the overview to include every kind of expense
(manual, recurring, card, imported), so that the picture is complete and I do
not have to reconcile areas myself.

#### Acceptance Criteria

1. When the monthly summary is loaded, the PayPilot Dashboard shall represent
   contributions from all four summary sources (`MANUAL`, `RECURRING`, `CARD`,
   `IMPORTED`) that fall within the current month.
2. The PayPilot Dashboard shall attribute each summarized amount to exactly one
   source so that no amount is double-counted across sources.
3. Where a source has no activity in the current month, the PayPilot Dashboard
   shall show that source as zero/empty rather than omitting it in a way that
   makes the breakdown ambiguous.
4. The PayPilot Dashboard shall present a per-source subtotal so the user can
   see how the monthly total decomposes by source.

### Requirement 4: Due items — overdue, due, and paid

**Objective:** As a user, I want one list that tells me what is overdue, what is
still to be paid, and what is already paid, so that I can act on late bills
and before due dates pass — and an unpaid bill never disappears from view just
because its due date has passed.

> **Revision (design review, 2026-11-21):** the original 4.1 listed only items
> with `dueDate >= today`, which hid unpaid bills the day after their due date.
> Requirement 4 now covers overdue items explicitly.

#### Acceptance Criteria

1. When the monthly summary is loaded, the PayPilot Dashboard shall display a
   due list containing (a) every payable item of the current month, whatever
   its due date, and (b) every **unpaid** payable item of the overdue
   look-back window (carried-over items).
2. The PayPilot Dashboard shall show each due item's due status exactly as
   reported by the backend: `OVERDUE`, `DUE`, or `PAID`.
3. The PayPilot Dashboard shall order the due list `OVERDUE` first, then
   `DUE`, then `PAID`; within each status by due date ascending; and shall
   render each item's amount, due date, source, description, and status.
4. The PayPilot Dashboard shall display, as reported by the backend, the count
   and the per-currency amount of `OVERDUE` items and of `DUE` items, so the
   user sees "how much is late" and "how much is still to pay" at a glance.
5. The PayPilot Dashboard shall mark carried-over items as belonging to an
   earlier month, and carried-over items shall **not** contribute to the
   current month's totals, source subtotals, or category breakdown
   (Requirements 2, 3, 6).
6. The PayPilot Dashboard shall render due dates as date-only `YYYY-MM-DD`
   values via the shared date formatter, without constructing timezone-shifted
   `Date` objects.
7. If the due list is empty, then the PayPilot Dashboard shall render a
   first-class empty state (e.g. "nothing overdue or due this month"), not a
   blank list.
8. Status shall be conveyed by text (a badge label), never by colour alone.

### Requirement 5: Paid / unpaid status (when available)

**Objective:** As a user, I want to see which payable items are already paid, so
that upcoming-due information is not misleading.

#### Acceptance Criteria

1. Where the backend provides paid/unpaid state for a payable item, the PayPilot
   Dashboard shall display that item's paid or unpaid status.
2. Where paid state is available, the PayPilot Dashboard shall visually
   distinguish paid items from unpaid (overdue or due) items in the due list.
3. While no backend read of paid state is available, the PayPilot Dashboard
   shall omit paid indicators gracefully and shall neither error nor block the
   rest of the summary.
4. The PayPilot Dashboard shall never infer paid status by computing it
   client-side; it shall display paid state only as reported by the backend.

### Requirement 6: Category breakdown

**Objective:** As a user, I want my monthly spending broken down by category, so
that I understand where my money went.

#### Acceptance Criteria

1. When the monthly summary is loaded, the PayPilot Dashboard shall display a
   category breakdown that groups the month's expense amounts by the existing
   category label carried on ledger rows.
2. Where a transaction has no category label (`null`), the PayPilot Dashboard
   shall group it under a single explicit "Uncategorized" bucket.
3. The PayPilot Dashboard shall render each category's total as formatted money
   and shall order categories by amount descending.
4. The PayPilot Dashboard shall not introduce a category taxonomy, renaming, or
   re-categorization (owned by the future `categories-and-budgets` spec); it
   shall display labels exactly as stored.

### Requirement 7: View states, formatting, and accessibility

**Objective:** As a user, I want the dashboard to behave predictably while
loading, when empty, and on error, so that I always understand its state.

#### Acceptance Criteria

1. While the monthly summary is loading, the PayPilot Dashboard shall render a
   loading state using the shared `<Loading />` primitive with `aria-busy`.
2. If a summary request fails with a retryable code (`INTERNAL_ERROR`,
   `TOO_MANY_REQUESTS`), then the PayPilot Dashboard shall render the shared
   `<ErrorState />` with a generic message, the `requestId`, and a retry
   action.
3. When the current month has no data in any source, the PayPilot Dashboard
   shall render a first-class empty state with guidance and a primary action
   (e.g. add an expense / import a statement), not a blank page.
4. The PayPilot Dashboard shall format all money via the shared
   `formatMoney(amountMinor, currency)` helper and all dates via the shared
   date formatter, performing no float math on amounts.
5. The PayPilot Dashboard shall use semantic HTML (tabular data in tables,
   `<main>`/`<nav>` landmarks) and keep all interactive elements
   keyboard-reachable with visible focus.

### Requirement 8: Backend monthly-summary read model (gap)

**Objective:** As the frontend, I want a single backend capability that returns
the aggregated current-month summary, so that the dashboard renders financial
truth without computing schedules, invoices, or occurrences client-side.

#### Acceptance Criteria

1. The PayPilot API shall provide a read-only capability that returns, for the
   authenticated user and a requested month, the monthly total(s), per-source
   subtotals, category breakdown, the due list with each item's due status,
   and the overdue/due counts and amounts, in one response.
8. The PayPilot API shall compute due status server-side from the injected
   "today" and the paid markers; the frontend shall never derive `OVERDUE`
   from comparing dates.
2. The PayPilot API shall aggregate all four ledger sources (`MANUAL`,
   `RECURRING`, `CARD`, `IMPORTED`) server-side, including generated `RECURRING`
   and `IMPORTED` rows and derived card invoices, so no source is missing from
   the summary.
3. The PayPilot API shall return all monetary values as integer minor units with
   explicit currency, and shall never emit floating-point amounts.
4. The PayPilot API shall derive "current month" and "upcoming" boundaries from
   an **injected** current time (never a direct clock read), so the summary is
   deterministic and unit-testable, and shall be explicit about the timezone
   used for month boundaries.
5. The PayPilot API shall scope every summary strictly to the authenticated
   user's own data and shall not disclose or aggregate any other user's rows.
6. The read model shall be **read-only**: computing a summary shall mutate no
   ledger rows and no paid-status markers.
7. The request and response contracts for the summary shall be defined as shared
   types in `packages/shared` and consumed by the web API client (no shape
   duplicated across frontend and backend).

### Requirement 9: Paid-status read exposure (gap, dependency)

**Objective:** As the frontend, I want to read paid/unpaid state for the
month's payable items, so that Requirement 5 can show accurate status.

#### Acceptance Criteria

1. Where paid-status read exposure exists, the PayPilot API shall report, for
   the current month's payable items and the look-back window's payable items,
   whether each item is paid, using the existing payment-marker semantics from
   `due-date-reminders`.
2. The PayPilot API shall report paid state without mutating markers or ledger
   rows, and shall keep it scoped to the authenticated user.
3. This requirement depends on the `bill-payments` spec; while paid-status read
   is not yet available, the summary shall remain valid and complete for all
   non-paid fields, and Requirement 5.3 (graceful omission) shall govern the UI.

### Requirement 10: Financial-rule alignment and non-functional guarantees

**Objective:** As the product owner, I want the dashboard to uphold PayPilot's
domain invariants, so that the first overview page is trustworthy.

#### Acceptance Criteria

1. The monthly-summary capability shall be covered by automated tests that
   assert determinism under a fixed injected "today", including month-boundary
   and short-month edge cases.
2. The monthly-summary capability shall be covered by automated tests asserting
   per-user isolation (one user's summary never includes another user's rows).
3. The monthly-summary capability shall be covered by automated tests asserting
   integer-minor-unit math with no floating-point drift and no cross-currency
   summing.
4. The PayPilot Dashboard shall be covered by tests for the four view states,
   error-envelope rendering (including `requestId` display), the
   route-protection redirect, and money/date formatting.
5. The feature shall introduce no secrets into the repository and shall add no
   new public frontend configuration beyond the existing
   `NEXT_PUBLIC_API_BASE_URL`.
