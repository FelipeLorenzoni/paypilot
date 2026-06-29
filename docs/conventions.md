# Money & Time Conventions (authoritative)

These conventions are binding for every PayPilot feature spec. They make the
financial rules in `.sdd/steering/financial-rules.md` deterministic and testable.
The foundation enforces them in code via the shared `Money` value object and the
injectable `Clock` port; feature specs follow them when adding models/migrations.

## Money

- Represent money as **integer minor units** (e.g. cents) — **never** floating point.
- Always pair an amount with an explicit **ISO-4217 currency** code.
- In code: the shared `Money` value object (`@paypilot/shared`) — `amountMinor`
  (validated as a safe integer via `Number.isSafeInteger`) + `currency`.
- In the database: store as `BIGINT` minor units **plus** a currency column.
- If amounts ever exceed `Number.MAX_SAFE_INTEGER` minor units, migrate the API
  boundary representation to `string`/`bigint` (documented evolution path; not MVP).

## Time

- **Instants** (`created_at`, `updated_at`, audit timestamps): store in **UTC** as
  `timestamptz`.
- **Calendar values** (due dates, reference months): store as **date-only** values
  (no time, no timezone). A "reference month" is represented by the first day of
  that month.
- **Clock**: business logic never reads the wall clock directly; it receives the
  current instant through the injected `Clock` port (`SystemClock` in prod,
  `FixedClock` in tests). Converting an instant to a calendar date requires an
  **explicit timezone** — never the server's implicit zone.

## Why

Calendar-based rules (credit-card closing/due day, reminder windows, recurring
monthly generation) must not drift with server timezone or floating-point error.
Separating instants from calendar dates, and injecting the clock, keeps these
rules reproducible in unit tests.
