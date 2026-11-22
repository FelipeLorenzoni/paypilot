# Implementation Plan — monthly-dashboard

> Full-stack, read-only feature: one owner-scoped monthly summary endpoint, a shared contract consumed by both sides, and the `/dashboard` page. No schema change, no migration, no new runtime dependency. Includes the 2026-11-21 design-review revision (research.md D9): every payable item carries a server-computed status `OVERDUE` / `DUE` / `PAID`, and unpaid items of the 3 previous months are carried over into the due list without touching the month's totals.

- [x] 1. Shared monthly-summary contract
  - Define the summary response shape once in the shared package: per-currency blocks (total, the four source subtotals, category breakdown), the due list with status, paid timestamp and carried-over flag, the per-currency overdue/due counts and amounts, the month boundaries, "today", the look-back start month and the activity flag
  - Export it from the shared package so the API service declares it as its return type and the web client consumes the same type, making any rename a type-check failure on the other side
  - _Requirements: 8.1, 8.3, 8.7, 8.8, 4.2, 4.4_

- [x] 2. Pure domain: month boundaries, status rule and summary
- [x] 2.1 (P) Month boundary helpers
  - Derive the UTC calendar month of an instant and the inclusive first/last day of a `YYYY-MM` month from its real length (February, 31-day months, December→January)
  - Derive the look-back start month three calendar months before a given month, crossing year boundaries correctly
  - Reject malformed month strings with a domain error
  - Unit tests covering February (leap and non-leap), a 31-day month, the year boundary and the look-back across January
  - _Requirements: 8.4, 10.1_

- [x] 2.2 (P) Due status rule
  - One pure rule: paid when a marker exists, otherwise overdue when the due date is before "today", otherwise due
  - Unit tests on the boundary: due today unpaid is due, due yesterday unpaid is overdue, any date with a marker is paid
  - _Requirements: 4.2, 8.8, 10.1_

- [x] 2.3 Monthly summary aggregation
  - Partition the month's rows by currency; per currency compute the total, all four source subtotals (zero when absent) and the category breakdown with a single uncategorized bucket, ordered by amount descending then label
  - Keep every money accumulator as an exact integer until one guarded conversion at the output; never sum across currencies
  - Derive payable items from the month's rows and the look-back rows with the same rule: one item per recurring occurrence, one item per card invoice summing its rows; manual and imported rows never become payable items
  - Attach paid state through the canonical paid identity shared with reminders and compute each item's status with the rule from 2.2
  - Build the due list from every payable item of the month plus only the overdue look-back items, flagged as carried over; order overdue → due → paid, then due date, then identity
  - Compute per-currency overdue and due counts and amounts over the whole due list; look-back rows must change nothing in the month's totals, subtotals, categories or activity flag
  - Return a zeroed default-currency block with the activity flag off for an empty month
  - Depends on 2.1 and 2.2
  - _Requirements: 2.1, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 4.1, 4.3, 4.4, 4.5, 5.1, 5.2, 6.1, 6.2, 6.3, 6.4, 8.2, 8.3, 8.8_

- [x] 2.4 Unit tests for the summary aggregation
  - Four sources present and one source absent (asserting a zero entry, not a missing one)
  - Multi-currency month yields separate blocks with exact minor-unit sums and no cross-currency arithmetic, including in the overdue/due totals
  - Card rows of one invoice collapse into one due item; manual and imported rows produce none; a paid item stays listed as paid
  - An unpaid month item due before today is listed as overdue (the regression fixed by this revision)
  - Carry-over: an unpaid look-back item is overdue and carried over, a paid look-back item is dropped, and look-back rows leave totals and the activity flag unchanged
  - Ordering by status, then due date, then identity is deterministic for identical inputs
  - _Requirements: 2.3, 3.2, 3.3, 4.1, 4.3, 4.4, 4.5, 5.2, 6.2, 6.3, 10.1, 10.3_

- [x] 3. Backend read path and endpoint
- [x] 3.1 Owner-scoped read-only repository
  - Read the month's ledger rows for one user with the card label, served by the existing user/date index
  - Read the look-back window's recurring and card rows for one user, ending the day before the month starts
  - Read the paid markers for one user restricted to a given set of target keys, short-circuiting to nothing for an empty set
  - Filter by the user in every query and expose no write operation at all
  - _Requirements: 8.5, 8.6, 9.1, 9.2_

- [x] 3.2 Summary service and endpoint
  - Read the injected clock once per request to derive "today", the requested or current month, its boundaries and the look-back window
  - Orchestrate the three reads, then delegate all aggregation to the pure summary function and return the shared contract type
  - Expose the authenticated summary endpoint under the dashboard path with an optional `YYYY-MM` month parameter validated into the canonical 400 error; an empty month is a valid zeroed response, never a 404
  - Register the module in the application; rely on the global authentication guard and current-user resolution
  - Depends on 1, 2.3 and 3.1
  - _Requirements: 1.4, 8.1, 8.2, 8.4, 8.5, 8.6, 8.7, 9.1, 9.3, 10.5_

- [x] 3.3 Integration tests against a real database
  - Two users with rows in the same month: each summary contains only its owner's amounts and due items
  - All four sources end-to-end under a fixed clock, including a two-installment card invoice surfacing as one due item
  - A paid marker written through the existing paid endpoint surfaces as paid on the matching due item
  - Carry-over end-to-end: an unpaid recurring row two months back is listed as overdue and carried over, a row four months back is not, and neither changes the month's total
  - Ledger row and marker counts are unchanged after the request; a malformed month returns the validation error
  - _Requirements: 8.5, 8.6, 9.1, 9.2, 4.1, 4.5, 10.1, 10.2_

- [x] 4. Dashboard page
- [x] 4.1 (P) Web client call and month label formatter
  - Typed client call for the summary returning the shared contract through the existing request helper and error mapping
  - Month-label formatter turning `YYYY-MM` into a human-readable label without constructing dates or relying on locale data, with unit tests
  - Can run in parallel with 2 and 3 once 1 is done
  - _Requirements: 1.4, 7.4, 8.7_

- [x] 4.2 Summary panels
  - Month header with the human-readable month label
  - One totals panel per currency block with the total, the four source subtotals and a plain-language note that card invoices count in the month they are due
  - Due summary panel showing, per currency, "Overdue" and "Still to pay" counts and amounts exactly as reported by the backend
  - Category breakdown table with labels as stored and the uncategorized bucket
  - All money and dates rendered through the shared formatters, no client-side arithmetic
  - Depends on 4.1
  - _Requirements: 1.4, 2.1, 2.2, 2.3, 3.3, 3.4, 4.4, 6.1, 6.2, 6.3, 6.4, 7.4, 7.5_

- [x] 4.3 Due items list
  - Semantic table of due items in the order received, showing description, source, due date, amount and a text status badge ("Overdue", "Due", "Paid") that is never colour-only
  - Mark carried-over items as belonging to an earlier month
  - Own empty sub-state when the list is empty but the month has activity
  - Display status only as reported by the backend; never compare dates or infer paid state in the browser
  - Depends on 4.1
  - _Requirements: 4.2, 4.3, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2, 5.3, 5.4, 7.4, 7.5_

- [x] 4.4 Page composition and view states
  - Replace the placeholder dashboard route with a thin composition of the feature page, keeping navigation owned by the authenticated layout
  - Render exactly one of loading, error with generic message, request id and retry, empty with guidance and a primary action, or the loaded panels and list
  - When the month has no activity but carried-over overdue items exist, show the empty guidance next to the due list instead of hiding it
  - Unauthorized responses keep flowing through the existing session-clear and redirect path
  - Depends on 4.2 and 4.3
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 7.1, 7.2, 7.3, 7.5_

- [x] 4.5 Frontend tests
  - The four view states with the client call mocked, including the empty-month-with-overdue-items case
  - Error state shows the generic message and the request id, and retry refetches
  - Each status is announced by text, carried-over items show their marker, and the due summary renders backend counts verbatim
  - Money and dates render through the shared formatters, and the month label formatter output is asserted
  - Redirect on unauthorized follows the existing protected-route behavior
  - _Requirements: 1.2, 1.3, 4.4, 4.5, 4.8, 5.2, 7.1, 7.2, 7.3, 7.4, 10.4_

- [x] 5. End-to-end verification
  - Run type-check across the workspace to prove the shared contract is consumed identically by API and web
  - Run lint, unit tests and the integration suite; confirm no new public configuration or secrets were introduced
  - Start the API and web app locally and load the dashboard for a seeded user with an overdue bill, a due bill, a paid bill and a carried-over bill
  - _Requirements: 8.7, 10.1, 10.2, 10.3, 10.4, 10.5_
