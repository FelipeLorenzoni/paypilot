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

## Requirements

<!-- Will be generated in /sdd:spec-requirements phase -->
