# Financial Rules (Domain Invariants)

These are PayPilot's core domain invariants. They are **product requirements, not preferences** — every spec that touches money, bills, cards, imports, or reminders must uphold them, and each MUST be covered by automated tests ([[testing]]). When a spec's requirements/design are written, these rules should appear as explicit acceptance criteria.

## Money & Time Handling (cross-cutting)

- Represent money as integer minor units (cents) or a precise decimal — **never floating point**. Currency is explicit.
- Date-sensitive logic (due dates, closing days, reminder windows) takes the current time as an **injected input**, never reads the clock directly, so behavior is deterministic and testable. Be explicit about timezone.

## R1 — Reminders only for unpaid bills

A bill marked **paid must not generate due-date reminders**. Paid status is checked at the moment a reminder would be scheduled _and_ at the moment it would be sent (a bill can be paid between scheduling and sending).

## R2 — Reminders are idempotent (at most once per window)

An alert must not be sent more than once for the same **(bill, due date, reminder window)** combination. Persist a record of sent reminders and check it before sending; concurrent/retried jobs must not double-send. Treat send + record as a single guarded unit.

## R3 — Recurring bills don't duplicate monthly transactions

Generating the monthly transaction for a recurring bill must be **idempotent per (recurring bill, period)**. Running generation twice for the same month — including via retries or overlapping job runs — produces exactly one transaction. Enforce with a uniqueness guarantee on (recurring_bill_id, period), not just application-level checks.

## R4 — Correct invoice assignment for card purchases

A credit card purchase is assigned to an invoice based on the card's **closing day and due day**. A purchase on or before the closing day belongs to the current cycle's invoice; after the closing day it rolls to the next cycle. Define and test the boundary (closing-day-inclusive) and month-rollover/short-month edge cases explicitly.

## R5 — Predictable installments

An installment purchase generates a **predictable, deterministic set of future installments** (N installments across consecutive invoice cycles). The schedule is reproducible from the purchase inputs. Define how rounding remainders are handled (e.g. residual cents on first or last installment) and test it.

## R6 — CSV import duplicate avoidance

CSV import must avoid basic duplicates by matching on **date, amount, and description**. A row matching an existing transaction (or another row in the same import) on those three fields is flagged/skipped rather than silently inserted. Define exactly how the dedup key is normalized (trimming, casing, date granularity).

## R7 — External providers are abstracted

All external integrations (notably WhatsApp) are accessed through interfaces, never called directly from domain/use-case code. See [[integrations]].

## R8 — Secrets are never committed

No API tokens, provider credentials, or secrets in the repo. See [[security]].

## Testing expectation

Each rule above is a hard test target. A spec implementing any of these is not "done" until rules R1–R6 it touches have unit tests covering the happy path **and** the boundary/idempotency/duplicate edge cases. See [[testing]].

---

_Domain truth lives here. Specs reference these rules; they do not redefine them._
