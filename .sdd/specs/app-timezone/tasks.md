# Implementation Plan — app-timezone

> Backend-only extension: one validated business timezone setting, one business calendar over the existing clock, and the six clock-to-date call sites switched to it. Scheduled jobs move to hourly UTC ticks (generation ungated, reminders gated to the local reminder hour). No schema, migration, contract or dependency change.

- [x] 1. Business timezone setting
  - Add an optional application timezone setting defaulting to São Paulo, validated at startup as an IANA name: unknown names and offset strings are rejected, UTC is accepted
  - An invalid value fails startup naming only the variable, never its value
  - Expose the zone in the typed application configuration and document it with its default in the environment example file
  - Unit tests: default, UTC, a valid IANA name, unknown name, offset string, empty value, and an error message that omits the value
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 2. Business calendar
  - Convert an instant into the business date, month and hour of a zone using the runtime's built-in timezone support, reusing one formatter per zone
  - Provide it globally next to the clock, reading the injected clock once per call, so tests that replace the clock drive it
  - Never return or alter instants
  - Unit tests: São Paulo on both sides of local midnight and of a month boundary, UTC reproducing the previous UTC-date results, a DST zone on both sides of both 2026 transitions, and identical results under a different process timezone
  - Depends on 1
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 7.2, 7.4_

- [x] 3. Feature call sites use the business calendar
- [x] 3.1 (P) Monthly dashboard on business today and month
  - Default the summarized month to the business month and compute status against business today, also when an explicit month is requested; return business today as the summary's today
  - Remove the now-unused UTC month-of-instant helper and its tests
  - Unit tests under a fixed clock just after UTC midnight on the first of a month: the previous business month is summarized and a bill due on its last day is still Due
  - Depends on 2
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3.2 (P) Bill payments on business today
  - Default the payment date to business today and reject dates after it; keep recording the marking instant from the raw clock
  - Leave existing payment records untouched
  - Unit tests under a fixed clock at 22:30 São Paulo time on the day before the UTC date: default is the local date, the UTC date is rejected as future, the recorded instant is unchanged
  - Depends on 2
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 3.3 (P) Reminders on the business day
  - Replace the fixed daily UTC schedule with an hourly UTC tick that evaluates only when the business hour is the reminder hour, using business today
  - The manual reminder command defaults to business today
  - Keep evaluation, windows, paid checks and delivery identity unchanged
  - Unit tests: evaluates with business today at the reminder hour, does nothing at other hours
  - Depends on 2
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 3.4 (P) Recurring bills on the business month
  - Replace the daily schedule in the server's implicit timezone with an hourly UTC tick generating the business month
  - The manual generation command defaults to the business month; remove the UTC period helper and rewrite its tests against the business calendar
  - Log a scheduled run only when it created rows or had failures
  - Unit tests: the tick just before and just after local midnight on the first of a month targets the previous and the new month
  - Depends on 2
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 4. Integration verification and compatibility
  - Dashboard and bill-payments integration cases with a fixed clock late on a São Paulo evening whose UTC date is already the next day
  - Reminder integration case evaluating the same business date twice sends once, covering the switch-over day
  - Run the full unit and integration suites (process timezone São Paulo) and confirm the existing noon-UTC cases, invoice assignment, installments and CSV import are unchanged
  - Confirm no schema, migration or shared-contract changes, then type-check, lint and build the workspace
  - Depends on 3.1, 3.2, 3.3, 3.4
  - _Requirements: 3.5, 4.3, 5.4, 6.4, 7.1, 7.2, 7.3, 7.4_
