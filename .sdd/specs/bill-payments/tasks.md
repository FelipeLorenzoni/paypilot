# Implementation Plan — bill-payments

> Full-stack extension: a `bill-payments` module takes write ownership of the existing `payment_markers` store, adds a payment date (one additive migration), exposes `PUT /bill-payments`, and the web app gains mark/undo actions on the dashboard and invoice page. Reminders keep reading the same records; `PUT /reminders/paid` keeps its behaviour.

- [x] 1. Payment date in the data model
  - Add a date-only payment date column to the payment records, back-filled for existing records from the UTC calendar date of their recorded instant, then made required
  - Regenerate the Prisma client and keep the recorded instant's meaning unchanged
  - Verify the back-fill on a migrated database with a record written before the column existed
  - _Requirements: 1.4, 1.6_

- [x] 2. Shared payment contracts
  - Define the mark/unmark request (identity parts, paid flag, optional payment date) and the payment status response (canonical key, paid flag, payment date, recorded instant)
  - Extend the due-item view with the payment date and the identity parts, and the invoice view with paid flag and payment date, without changing existing fields
  - _Requirements: 1.4, 4.5, 5.1, 5.3_

- [x] 3. Bill payments backend
- [x] 3.1 Owned payable-target resolution and payment store
  - Move the owned-target resolution out of the reminders repository unchanged in behaviour: owned recurring occurrence, or owned card with at least one card row in the cycle; manual, imported, foreign and unknown targets resolve to nothing
  - Mark creates the record with its payment date and recorded instant, returns an existing record unchanged, and on a concurrent unique-key conflict returns the winning record
  - Unmark deletes the user's record and is a no-op when none exists; a single-item read returns the record or nothing
  - Every query is scoped to the user and no method writes ledger rows
  - Unit tests for each path, including the conflict path and the moved resolution cases
  - Depends on 1
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 2.1, 2.6, 3.1, 3.2, 4.2, 4.3, 4.4, 4.5, 8.1_

- [x] 3.2 Payment service and endpoint
  - Read the injected clock once; default the payment date to today; reject a future date before resolving the target; map an unresolved target to not-found
  - Never check the item's due date
  - Validate the request shape, including a malformed payment date and a payment date sent with an unmark
  - Expose the authenticated idempotent PUT endpoint and register the module, exporting what reminders and cards need
  - Unit tests under a fixed clock: default today, back-dated, future rejected with nothing written, not-found, unmark
  - Depends on 2 and 3.1
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 3.1, 3.2, 4.1, 8.1, 8.5_

- [x] 3.3 (P) Reminders delegate to bill payments
  - Make the reminders paid-status service a thin adapter over the payment service, keeping the existing endpoint's request and response unchanged
  - Remove the moved resolution from the reminders repository; leave reminder selection and send-time paid reads untouched
  - Adapter unit test asserting the unchanged response shape
  - Depends on 3.2
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 3.4 (P) Paid state in the dashboard and invoice reads
  - Carry the payment date and identity parts through the dashboard's marker read and summary aggregation into each due item
  - Add the invoice's paid flag and payment date to the invoice response using the single-item read
  - Update the affected unit tests
  - Depends on 2 and 3.1
  - _Requirements: 3.3, 5.1, 5.2, 5.3_

- [x] 3.5 Integration tests against a real database
  - Mark, re-mark, unmark and re-unmark round trip with ledger row counts unchanged
  - Back-dated payment date stored and returned; future date rejected with nothing written
  - Another user's item and manual/imported transactions return not-found
  - Two parallel marks of one item yield exactly one record
  - Dashboard reports paid with its date after marking and overdue again after undo; invoice endpoint reports its paid state
  - An item marked through the new endpoint gets no reminder; once unmarked, an unsent window fires
  - The existing reminders paid endpoint still behaves as before
  - Depends on 3.3 and 3.4
  - _Requirements: 1.5, 2.4, 3.3, 4.2, 5.2, 7.1, 7.2, 7.3, 8.2, 8.3_

- [x] 4. Mark and undo in the web app
- [x] 4.1 (P) Client call and silent refresh
  - Typed client call for the payment endpoint through the existing request helper
  - Give the query hook's loaded state a refresh that refetches without a loading state, replaces data on success and keeps it on failure
  - Hook tests for both refresh outcomes
  - Can run in parallel with 3 once 2 is done
  - _Requirements: 5.4, 6.5, 6.6_

- [x] 4.2 Payment action component
  - Unpaid: "Mark as paid" opens an inline optional date (empty means today, no later than the backend's today when known) with confirm and cancel
  - Paid: a single "Undo"
  - Disable the active control and show progress while a request runs; on success await the page refresh; on failure keep the state and show a generic alert with the request id
  - Accessible names include the item description; every control is keyboard reachable
  - Component tests for default and chosen date, cancel, pending, success refresh, failure and accessible names
  - Depends on 4.1
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

- [x] 4.3 Dashboard and invoice page integration
  - Add an actions column to the dashboard's due list and a "Paid on" date for paid items, wired to the page refresh
  - Show "Paid on" or "Not paid" and one payment action on the invoice page
  - Render paid state only as reported by the backend
  - Page tests for the new column, the paid date and the invoice paid state
  - Depends on 3.4 and 4.2
  - _Requirements: 5.1, 5.3, 5.4, 6.1, 6.2_

- [x] 5. End-to-end verification
  - Run type-check, lint, unit, integration and build across the workspace; confirm no secrets or new public configuration
  - Run the API and web app locally: mark an overdue bill with an earlier date, see it move to paid with its date and the totals update, undo it, and mark an invoice paid from its page
  - _Requirements: 8.4, 8.6_
