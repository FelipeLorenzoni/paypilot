# Requirements Document

## Project Description (Input)

import-reconciliation: allow users to review and reconcile imported CSV transactions.

Scope:

- Review imported rows before final confirmation or after import as pending review.
- Suggest possible matches against manual, recurring, and card transactions.
- Allow the user to accept, ignore, or keep imported rows.
- Avoid automatic cross-source deletion or mutation without explicit user action.
- Preserve ledger source protection.
- Provide UI for reviewing possible duplicates.
- Define whether reconciliation requires new backend state, such as review status or matched transaction references.
- Keep all operations scoped to the authenticated user.

Out of scope:

- bank API integrations
- ML categorization
- automatic irreversible merges
- payment settlement
- refunds/chargebacks
- modifying unrelated ledger rows without explicit user confirmation

Goal:
Move beyond simple imported-only dedup and support user-driven reconciliation across sources.

## Requirements

<!-- Will be generated in /sdd:spec-requirements phase -->
