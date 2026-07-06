# Requirements Document

## Project Description (Input)

categories-and-budgets: introduce normalized categories and monthly budgets for PayPilot.

Scope:

- Category entity owned by user.
- Assign categories to manual, recurring, card, and imported expenses where supported.
- Monthly budget per category.
- Budget summary and overspending indicators.
- Keep existing categoryLabel compatibility or define a migration path.
- UI for managing categories and budgets.
- Backend APIs for category and budget CRUD.
- Deterministic monthly budget calculations using integer minor units.

Out of scope:

- AI categorization
- shared/global category taxonomy
- multi-currency
- complex forecasting
- bank reconciliation
- automatic category assignment unless explicitly added later

Goal:
Introduce structured financial organization and the first budgeting capability.

## Requirements

<!-- Will be generated in /sdd:spec-requirements phase -->
