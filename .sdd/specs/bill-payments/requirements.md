# Requirements Document

## Project Description (Input)

bill-payments: introduce a product-level paid/unpaid status for payable items in PayPilot.

Scope:

- Mark recurring bill occurrences as paid/unpaid.
- Mark credit-card invoices as paid/unpaid.
- Preserve financial ledger rows unchanged.
- Store paidAt and user ownership.
- Provide APIs and minimal UI hooks for paid status.
- Align with due-date-reminders paid marker semantics or migrate/reuse the same model if already implemented.
- Ensure per-user isolation.
- Ensure idempotent mark/unmark behavior.
- Keep compatibility with due-date-reminders.

Out of scope:

- real bank payment
- invoice settlement reconciliation
- partial payments
- payment methods
- refunds/chargebacks
- automatic paid detection

Goal:
Make paid/unpaid status a product-level concept, not only a reminder-specific marker.

## Introduction

Today "paid" exists only as a reminder-side marker: `due-date-reminders`
stores one marker per payable item and exposes `PUT /reminders/paid`, and
`monthly-dashboard` reads those markers to show each bill as Overdue, Due or
Paid. There is no product-level way for a user to say "I paid this", so a bill
paid outside PayPilot stays Overdue on the dashboard.

This spec makes paid/unpaid a product-level concept for the two payable item
kinds PayPilot knows — a generated recurring bill occurrence and a credit-card
invoice — with one canonical identity, one store, a product-level API, and the
minimal UI to mark and unmark from where the user sees their bills. Reminders
keep working unchanged on the same paid state.

### Terminology

- **Payable item** — a generated `RECURRING` ledger occurrence, or a
  credit-card invoice identified by (card, invoice cycle). `MANUAL` and
  `IMPORTED` rows are already-incurred spend and are never payable items.
- **Paid state** — whether a payable item has a payment record, plus the
  recorded payment date.
- **Payment record** — the stored fact "user U paid item I on date D". It
  never modifies the item's ledger rows.

## Requirements

### Requirement 1: One product-level paid state

**Objective:** As a user, I want a single paid status per bill or invoice, so
that every part of PayPilot agrees on whether I already paid it.

#### Acceptance Criteria

1. The Bill Payments Service shall keep at most one payment record per (user,
   payable item).
2. The Bill Payments Service shall identify a payable item with the same
   canonical identity already used by reminders and the dashboard (a recurring
   occurrence by its ledger transaction, a card invoice by card and invoice
   cycle).
3. The Bill Payments Service shall record a card invoice's paid state at the
   invoice level, covering every ledger row of that card and cycle.
4. The Bill Payments Service shall store, for each payment record, the owning
   user, the payable item, the payment date and the instant it was recorded.
5. The Bill Payments Service shall never create, modify or delete ledger
   transaction rows when paid state changes.
6. The Bill Payments Service shall reuse the payment records already written
   through the reminders flow, so that items marked paid before this feature
   remain paid without a data migration step by the user.

### Requirement 2: Mark an item as paid

**Objective:** As a user, I want to mark a bill or invoice as paid, so that it
stops showing as overdue or due.

#### Acceptance Criteria

1. When the user marks an owned unpaid payable item as paid, the Bill Payments
   Service shall create its payment record and return the item's paid state.
2. When the user marks an item as paid without a payment date, the Bill
   Payments Service shall record today's date, where "today" is the UTC
   calendar date of the injected clock.
3. When the user marks an item as paid with a payment date, the Bill Payments
   Service shall record that date as the payment date.
4. If the supplied payment date is later than today, the Bill Payments Service
   shall reject the request with a validation error and record nothing.
5. If the supplied payment date is not a valid `YYYY-MM-DD` calendar date, the
   Bill Payments Service shall reject the request with a validation error.
6. When the user marks an already-paid item as paid again, the Bill Payments
   Service shall keep the existing payment record unchanged and return the
   current paid state (idempotent mark).
7. The Bill Payments Service shall allow marking an item paid regardless of
   whether its due date is in the past, today or the future.

### Requirement 3: Unmark an item

**Objective:** As a user, I want to undo a paid mark, so that a mistake does
not hide a bill I still owe.

#### Acceptance Criteria

1. When the user unmarks an owned paid payable item, the Bill Payments Service
   shall remove its payment record and return the item as unpaid.
2. When the user unmarks an item that is already unpaid, the Bill Payments
   Service shall change nothing and return the item as unpaid (idempotent
   unmark).
3. When an item is unmarked, the Bill Payments Service shall derive its
   status again from its due date and today (Overdue or Due), with no stored
   residue of the removed payment.

### Requirement 4: Ownership and isolation

**Objective:** As a user, I want my payments to be private and only apply to
my own bills, so that nobody else can see or change them.

#### Acceptance Criteria

1. The Bill Payments Service shall require an authenticated user for every
   paid-state operation.
2. If the target does not exist, belongs to another user, or is not a payable
   item (including a `MANUAL` or `IMPORTED` transaction), the Bill Payments
   Service shall respond with not-found without disclosing whether the target
   exists.
3. If a card invoice target names a cycle in which the owned card has no
   ledger rows, the Bill Payments Service shall respond with not-found.
4. The Bill Payments Service shall scope every read and write of payment
   records to the requesting user.
5. The Bill Payments Service shall derive the canonical item identity
   server-side from validated parts and never accept an opaque identity string
   from the client.

### Requirement 5: Paid state visible where bills are shown

**Objective:** As a user, I want to see what I already paid, and when, on the
screens where I look at my bills.

#### Acceptance Criteria

1. The Monthly Dashboard shall show each due item's paid state and, for paid
   items, the payment date.
2. When an item's paid state changes, the Monthly Dashboard shall reflect the
   new status, the overdue/still-to-pay totals and the list order on its next
   load, as computed by the backend.
3. The Invoice page shall show whether the displayed card invoice is paid and,
   if so, its payment date.
4. The Web App shall display paid state only as reported by the backend and
   shall never infer it in the browser.

### Requirement 6: Mark and unmark from the UI

**Objective:** As a user, I want to mark a bill as paid right where I see it,
so that keeping PayPilot up to date takes one action.

#### Acceptance Criteria

1. The Monthly Dashboard shall offer a "Mark as paid" action on every unpaid
   due item and an "Undo" action on every paid due item.
2. The Invoice page shall offer the same mark and undo actions for the
   displayed invoice.
3. When the user triggers mark as paid, the Web App shall let the user keep
   today's date or choose an earlier payment date before confirming.
4. While a mark or undo request is in progress, the Web App shall disable that
   item's action and indicate that it is working.
5. When a mark or undo request succeeds, the Web App shall refresh the
   affected summary so the item's status, the totals and the order come from
   the backend.
6. If a mark or undo request fails, the Web App shall keep the previous state
   on screen and show a generic error with the request id.
7. The Web App shall make every mark and undo action keyboard reachable and
   labelled with the item it applies to.

### Requirement 7: Compatibility with reminders

**Objective:** As a user, I want reminders to respect the bills I mark as paid,
so that I never get a nudge for something already settled.

#### Acceptance Criteria

1. The Reminder Service shall treat an item marked paid through this feature as
   paid, both when selecting reminders and immediately before sending
   (financial rule R1).
2. The Reminder Service shall treat an item unmarked through this feature as
   unpaid for any reminder window that has not been sent yet.
3. While the existing `PUT /reminders/paid` endpoint remains available, the
   Bill Payments Service shall keep its request and response behaviour
   unchanged and backed by the same payment records.
4. The Bill Payments Service shall not alter reminder delivery records when
   paid state changes.

### Requirement 8: Quality and safety

**Objective:** As the PayPilot team, I want paid state covered by automated
tests, so that the financial rules stay protected.

#### Acceptance Criteria

1. The Bill Payments Service shall be covered by unit tests for mark, re-mark,
   unmark, re-unmark, back-dated payment date and future payment date.
2. The Bill Payments Service shall be covered by integration tests against a
   real database for per-user isolation, not-found on `MANUAL`/`IMPORTED`
   targets, unchanged ledger row counts, and the dashboard and reminders
   reading the new paid state.
3. The Bill Payments Service shall be covered by a concurrency test in which
   two simultaneous mark requests for the same item yield exactly one payment
   record.
4. The Web App shall be covered by tests for the mark and undo actions,
   including the in-progress, success-refresh and failure states.
5. The Bill Payments Service shall take "today" from the injected clock and
   never read the system clock directly.
6. The Bill Payments Service shall introduce no secrets and no new public
   configuration.

## Out of Scope

- Real bank payments, payment initiation or payment methods.
- Invoice settlement reconciliation, partial payments, refunds, chargebacks.
- Automatic paid detection (for example from imported statements or email).
- Paying `MANUAL` or `IMPORTED` rows — they are already-incurred spend.
- Bulk mark/unmark of several items in one action.
