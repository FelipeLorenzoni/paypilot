# Research & Design Decisions — credit-cards-invoices

## Summary
- **Scope**: Extension (brownfield) — a **3rd producer** into the shared `Transaction` ledger (`source = CARD`), plus a new `cards` feature with pure `invoice-assignment` + `installments` domain logic, a `CardPurchase` plan aggregate, and a **derived** invoice view. See `gap-analysis.md`.
- **Discovery type**: light (integration-focused). Reuses `Clock`, money/date helpers, `clampDay`/period math, owner-scoping, Testcontainers harness, the recurring-bills CHECK-constraint precedent.

## Design Decisions

### Decision: Ledger source value — `CARD`
`TransactionSource` gains `CARD`. `type` stays `EXPENSE` (a card purchase is an expense). Manual/recurring rows are unaffected.

### Decision: Purchase/plan model — `CardPurchase` aggregate
A `CardPurchase` row is the **originating purchase / installment plan** (one per recorded purchase). Every generated `Transaction` links to it via `cardPurchaseId` and also carries `creditCardId`, `invoiceCycle`, `installmentSeq`, `installmentTotal` (so a ledger row is self-describing without a join). Chosen over overloading recurring columns: keeps sources cleanly separated and gives idempotency a natural home.

### Decision: Idempotency — client key + `@@unique`, atomic creation (R13, R7 atomicity)
- The purchase request carries a required `idempotencyKey` (client-generated string). `CardPurchase` stores it with `@@unique([userId, idempotencyKey])` — a **DB-level** guarantee — plus a `requestHash` (sha-256 of the **normalized full payload that affects persisted output**: `creditCardId`, `purchaseDate`, `amountMinor`, `currency`, `description`, `category`, `installments`; normalized as currency-upper, description-trimmed, category-trimmed-or-null, date `YYYY-MM-DD`, integer amount/installments). Contract: one key per logical request; a retry reuses the same key + payload.
- Creation is atomic: `CardPurchase` + all `N` `Transaction` rows are written in a **single `prisma.$transaction`** — all-or-none, never a partial schedule.
- On a duplicate key (`P2002`), the service does a fresh read of the existing purchase and reconciles: matching `requestHash` **and** same `creditCardId` → return the existing result (idempotent success); divergent payload or different card under the same key → **409 `IDEMPOTENCY_KEY_REUSED`** (no silently-returned unrelated purchase). Overlapping requests block on the unique index until the winner commits, then read the committed row.

### Decision: `invoiceCycle` semantics — the **closing month** (`YYYY-MM`)
`invoiceCycle` is the calendar month **in which the invoice closes**. It is derived from the purchase date + `closingDay`, never from server time. The **due date** is derived from the cycle + `dueDay` and may fall in the following month.
- Assignment: effective closing day = `min(closingDay, daysInMonth(month))`. If `purchaseDay <= effectiveClosing` → cycle = purchase month; else → next month (rolling the year at December).
- Due date for a cycle: if `dueDay > closingDay` the due date is in the **closing month**, otherwise it rolls to the **following month**; the day is clamped to that month's length.
- **Worked examples** (`closingDay=10, dueDay=20`):
  - `2026-03-10` (on closing, inclusive) → cycle `2026-03`, due `2026-03-20`.
  - `2026-03-11` (after closing) → cycle `2026-04`, due `2026-04-20`.
  - `2026-12-15` (after closing, December) → cycle `2027-01`, due `2027-01-20`.

### Decision: Installment `transactionDate` — the cycle's **due date**
Each installment's `transactionDate` is the **due date of its invoice cycle** (date-only, UTC midnight, no tz shift). Invoice membership is driven by `invoiceCycle`, not by `transactionDate`. Tested for timezone safety (`TZ=America/Sao_Paulo`).

### Decision: Installment split — even split, **remainder on the first installment** (R5)
`splitInstallments(totalMinor, n)`: base = `floor(total / n)`, remainder = `total - base*n` added to installment **1**. Sum equals the total exactly. Cycles are `assignCycle(purchaseDate)` then `n-1` consecutive months. Deterministic and reproducible.

### Decision: Max installments — hard-coded constant `MAX_INSTALLMENTS = 24` (MVP)
Hard-coded for the MVP (documented); `installments` must be an integer `1..24`, else `400 VALIDATION_ERROR`. Revisit as validated config in a later spec if needed.

### Decision: Invoice — **derived view**, not a stored entity (R8)
No `Invoice` table. An invoice is computed on read: transactions where `creditCardId = :card AND invoiceCycle = :cycle` (owner-scoped), summed for the total, with the due date computed from the card. Always consistent; payment/status is out of scope so no stored invoice state is needed.

### Decision: Source protection + CHECK rewrite (R9)
- `CardsRepository`/invoice queries scope every read to `source = CARD` + `userId`. The card feature never mutates ledger rows after creation (no edit/delete this spec).
- `ExpensesRepository` already scopes to `MANUAL`; a regression test proves manual endpoints can't touch a `CARD` row. Recurring-bills exposes no transaction CRUD (generation-only), so it is vacuously safe.
- The existing `transactions_recurring_link_chk` CHECK is **replaced** by a source-aware constraint covering MANUAL / RECURRING / CARD valid states (see design). Migration drops the old constraint and adds the new one.

### Decision: Pure domain modules (structure steering)
`invoice-assignment.ts` and `installments.ts` are framework-free (no Nest/Prisma imports), taking `Clock`/dates/amounts as inputs — unit-tested directly, matching testing steering determinism rules.

## Risks & Mitigations
- **Duplicate installments on retry** → `@@unique([userId, idempotencyKey])` + single `$transaction` + `P2002` → return existing (tested).
- **Partial schedule on failure** → atomic `$transaction` (tested by asserting count is 0 or N).
- **R4 boundary/rollover/short-month errors** → pure assignment fn with explicit boundary/clamp/rollover unit tests.
- **R5 rounding** → sum-preserving split with documented remainder placement; non-even-division test.
- **Breaking manual/recurring** → CHECK rewrite covers all three sources; existing suites kept green.
- **tz shift on installment dates** → date-only mapping + `TZ=America/Sao_Paulo` integration test.

## References
- `gap-analysis.md`; `docs/conventions.md`; recurring-bills schema/migration (CHECK precedent), `generation.helpers.ts` (`clampDay`), `common/clock.ts`, `common/ledger-money-date.ts`.
