# Gap Analysis — credit-cards-invoices

## Current State (existing assets)

| Asset | Location | Reuse |
|-------|----------|-------|
| `Transaction` ledger (+ `type`/`source` enums) | `apps/api/prisma/schema.prisma` | Card purchases are `Transaction` rows with a **new** `source` (e.g. `CARD`); `type` stays `EXPENSE` |
| `TransactionSource { MANUAL, RECURRING }` | schema | **Extend** with a card source value |
| Recurring link columns + `@@unique` + CHECK constraint | schema + migration | Precedent for adding card-link columns + revising the valid-state CHECK |
| money/date helpers (`createMoney`, bigint guard, `YYYY-MM-DD`) | `common/ledger-money-date.ts`, `@paypilot/shared` | Money + dates for cards/purchases/installments |
| `clampDay` / period helpers (short-month clamp, `YYYY-MM`) | `recurring-bills/generation.helpers.ts` | Same math powers closing/due-day clamping + cycle keys (extract to shared) |
| `Clock` port (`CLOCK`, `SystemClock`, `FixedClock`) | `common/clock.ts` | Injected time for assignment/due-date (R11.5) — deterministic tests |
| `ExpensesRepository` (scoped `source: "MANUAL"`) + `RecurringBillsRepository` | `expenses/`, `recurring-bills/` | Template for `CreditCardsRepository`; manual repo already excludes non-MANUAL rows |
| Global `JwtAuthGuard`, `@CurrentUser`, `assertOwnership` | `auth/*`, `common/ownership.ts` | Auth + isolation, 404-like |
| `AllExceptionsFilter` + `ErrorCode` | `common/` | Canonical 400/401/404 |
| DTO + `ParseUUIDPipe` + `ValidationPipe` + `IsIsoCalendarDate` | `expenses/dto/*`, `common/` | Card/purchase DTOs + params |
| Testcontainers integration harness (serial, non-UTC TZ) | `apps/api/test/*.int.spec.ts` | Assignment/installment/source-protection tests on real PostgreSQL |

**Notable absences:** no `CreditCard` model; no invoice concept (stored or derived); no installment logic; no invoice-assignment domain rule; `TransactionSource` has no card value; the existing CHECK constraint is written specifically around `RECURRING` and would reject card rows that carry extra link columns unless revised.

## Requirement → Asset Map (gaps tagged)

| Requirement | Existing | Gap |
|-------------|----------|-----|
| R1–R4 card CRUD | expenses/recurring CRUD pattern | **Missing:** `CreditCard` model + module/controller/service/repo + DTOs; deactivate-on-DELETE (mirror recurring-bills) |
| R5 record purchase | `Transaction` ledger | **Missing:** purchase use-case that writes card-sourced rows; **Decision:** link shape (cardId, invoiceCycle, installment seq/total) |
| R6 invoice assignment (R4) | `clampDay`/period helpers, `Clock` | **Missing/Constraint:** pure `invoice-assignment` domain rule — closing-day-inclusive, after-closing→next, short-month/`dueDay` clamp, month+year rollover |
| R7 installments (R5) | money helpers | **Missing/Decision:** pure installment splitter — N consecutive cycles, sum-preserving, **rounding-remainder placement** to define |
| R8 view invoice | ledger queries | **Unknown/Decision:** invoice as **stored entity vs derived view**; total = exact sum; due date computed |
| R9 source protection | `ExpensesRepository` scoped to MANUAL | **Required change:** new repo scoped to card source; revise CHECK to allow card link state; ensure manual/recurring can't touch card rows (and vice versa) + tests |
| R10 isolation | guard/`@CurrentUser`/scoped queries | **Constraint:** owner-scope all card/purchase/invoice queries; generated rows owned by card's user |
| R11 money/date/clock | `createMoney`, mapper, `Clock` | **Constraint:** validation (closing/due 1–31, BRL, safe ints); inject clock, never read directly |
| R12 persistence/errors/tests | Prisma, filter, Testcontainers | **Missing:** migration + extend `source` enum + revise CHECK + R4/R5 edge tests |

## Key Research / Decisions for Design

1. **Card link columns + CHECK revision (main schema risk).** Card rows need `cardId` (FK) and an **invoice cycle** identifier, plus installment `sequence`/`total`. The current CHECK is `(RECURRING ⇒ recurringBillId+periodKey set) AND (non-RECURRING ⇒ both NULL)`. Adding card columns means the constraint must become source-aware for three sources. **Decision:** add dedicated card columns (e.g. `creditCardId`, `invoiceCycle CHAR(7)`, `installmentSeq`, `installmentTotal`) rather than overloading `periodKey`/`recurringBillId`, and rewrite the CHECK to cover MANUAL/RECURRING/CARD valid states.
2. **Invoice: stored vs derived (R8).** Either (a) **derive** an invoice on read by grouping card transactions by `(cardId, invoiceCycle)` and summing — no extra table, always consistent; or (b) a stored `Invoice` row per cycle. Recommend **derived** for the MVP unless a stored invoice status (open/closed/paid) is needed (payment is out of scope), with the cycle + due date computed deterministically.
3. **Invoice assignment rule (R4) as pure domain.** A framework-free `invoice-assignment.ts` (`assignCycle(purchaseDate, closingDay) → "YYYY-MM"` and `dueDate(cycle, dueDay) → date`) with closing-day-inclusive boundary, short-month clamping (reuse `clampDay`), and month/year rollover. Unit-tested directly per testing steering.
4. **Installment splitter (R5) as pure domain.** `splitInstallments(total, n) → number[]` that sums exactly to `total`; **decide remainder placement** (recommend residual cents on the **first** installment) and document it. Schedule = N consecutive cycles from the assigned start cycle.
5. **Installment transaction date.** Decide each installment row's `transactionDate` (e.g. the cycle's due date or a representative date) so date-only ledger semantics stay consistent; the **invoice cycle** (not the date) drives assignment.
6. **Shared ledger-writer (DRY across 3 producers).** With cards as the third `Transaction` producer, consider extracting a small shared ledger-writer/mapper used by expenses, recurring-bills, and cards. Optional but increasingly attractive.
7. **`type` stays `EXPENSE`.** Card purchases are expenses; only `source` is extended. Confirm no new `TransactionType` is needed.

## Implementation Approach Options

- **Option A — Extend expenses/transaction module:** ❌ distinct domain (cards, invoices, installments, assignment rules); would bloat expenses.
- **Option B — New `CreditCardsModule` (recommended):** card CRUD (mirror expenses/recurring) + pure `invoice-assignment` and `installments` domain modules + a purchase use-case writing card-sourced ledger rows + a derived invoice view; plus the schema change (new source, card columns, revised CHECK) and a card-scoped repository. Clean, testable, matches structure steering (`apps/api/src/cards/`).
- **Option C — Hybrid (shared ledger-writer):** Option B plus extracting a shared ledger-writer used by all three producers. ✅ DRY now that there are three; ❌ more upfront abstraction. Reasonable to fold in.

## Effort & Risk

- **Effort: L (1–2 weeks).** Card CRUD is routine (reuse); the weight is the two pure financial rules (R4 assignment, R5 installments) with their edge cases, the schema/CHECK revision, the invoice view, and source protection across three producers.
- **Risk: Medium.** Concentrated in (a) R4 boundary/rollover/short-month correctness, (b) R5 rounding determinism, (c) revising the existing CHECK constraint without breaking manual/recurring, and (d) keeping the three-source protection airtight. All are design-time decisions, not tooling unknowns.

## Recommendations for Design
- **Option B** (optionally C): new `cards` feature with **pure, injected-clock** `invoice-assignment` and `installments` domain logic; **derived** invoices for the MVP; dedicated card link columns + a **rewritten source-aware CHECK** constraint; card-scoped repository; new `CARD` source value.
- Make source protection explicit and tested in **both** directions (manual/recurring can't touch CARD rows; card endpoints can't touch MANUAL/RECURRING).
- Carry research items 1–7 into the design; decide rounding placement, invoice storage, max-installments cap, and installment dating there.
