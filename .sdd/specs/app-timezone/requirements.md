# Requirements Document

## Project Description (Input)

app-timezone: derive every business calendar date ("today", the current month)
from one configured application timezone instead of the UTC date.

Scope:

- One validated setting for the business timezone (default America/Sao_Paulo).
- Monthly dashboard, bill payments, due-date reminders and recurring-bill
  generation all use it.
- Scheduled jobs run at a fixed time of the business day, not the server's
  implicit timezone.

Out of scope:

- Per-user timezones (a later spec, when users outside one timezone exist).
- Schema, migration or public API contract changes.
- Re-deriving stored dates (existing `paidOn`, due dates, periods stay as is).
- Web-side "today" (the web keeps using the backend's `today` where it has it).

Goal:
A user in Brazil sees the dashboard, payment defaults and reminders for their
own calendar day, also after 21:00 local time and on the last evening of a
month.

## Introduction

PayPilot turns the injected clock's instant into a calendar date in four
places — monthly dashboard, bill payments, due-date reminders and
recurring-bill generation — and each takes the **UTC** date. `docs/conventions.md`
requires an explicit timezone for that conversion, and UTC is explicit, but it
is not the user's day: between 21:00 and 24:00 in São Paulo the dashboard and
the default payment date are already "tomorrow", and on the last evening of a
month the dashboard already shows the next month. Separately, the recurring-bill
generation job is scheduled in the server's implicit timezone, which the same
convention forbids.

This spec introduces one **business timezone**, configured once for the whole
application, and makes every calendar-date derivation use it.

### Terminology

- **Business timezone** — the IANA timezone configured for the application
  (e.g. `America/Sao_Paulo`).
- **Business today** — the calendar date (`YYYY-MM-DD`) of the injected clock's
  current instant in the business timezone.
- **Business month** — the `YYYY-MM` of business today.

## Requirements

### Requirement 1: Configured business timezone

**Objective:** As an operator, I want to set the application's timezone once,
so that every date PayPilot shows or acts on follows the users' calendar.

#### Acceptance Criteria

1. The PayPilot API shall read the business timezone from a single environment
   setting.
2. When the setting is absent, the PayPilot API shall use `America/Sao_Paulo`.
3. If the setting is not a valid IANA timezone name, then the PayPilot API shall
   refuse to start and report only the variable's name, never its value.
4. The PayPilot API shall accept `UTC` as a valid business timezone.
5. The PayPilot API shall document the setting in the environment example file
   with its default.

### Requirement 2: One derivation of business today

**Objective:** As a developer, I want a single tested way to turn the clock
into a business date, so that no feature can drift into UTC or server time.

#### Acceptance Criteria

1. The PayPilot API shall derive business today and business month from the
   injected clock and the business timezone only, never from the server
   process's timezone.
2. When the clock reads `2026-11-22T01:30:00Z` and the business timezone is
   `America/Sao_Paulo`, the PayPilot API shall derive business today
   `2026-11-21`.
3. When the clock reads `2026-11-22T03:00:00Z` and the business timezone is
   `America/Sao_Paulo`, the PayPilot API shall derive business today
   `2026-11-22`.
4. When the clock reads `2026-12-01T02:00:00Z` and the business timezone is
   `America/Sao_Paulo`, the PayPilot API shall derive business month `2026-11`.
5. Where the business timezone observes daylight saving time, the PayPilot API
   shall derive the correct business date on both sides of each transition.
6. The PayPilot API shall derive the same business date for the same instant
   regardless of the server process's `TZ` setting.

### Requirement 3: Monthly dashboard follows the business day

**Objective:** As a user, I want the dashboard to show my current month and
today's status, so that bills are not reported overdue or "next month" early.

#### Acceptance Criteria

1. When the monthly summary is requested without a month, the Dashboard Service
   shall summarize the business month.
2. The Dashboard Service shall compute Overdue and Due status against business
   today.
3. The Dashboard Service shall return business today as the summary's `today`.
4. When the monthly summary is requested with an explicit month, the Dashboard
   Service shall summarize that month and still compute status against business
   today.
5. When the clock reads `2026-12-01T02:00:00Z` with `America/Sao_Paulo`, the
   Dashboard Service shall summarize `2026-11` and treat a bill due
   `2026-11-30` as Overdue only if it is unpaid and business today is after it.

### Requirement 4: Bill payment dates follow the business day

**Objective:** As a user, I want "today" as the payment default to be my day,
so that a bill paid tonight is not recorded as paid tomorrow.

#### Acceptance Criteria

1. When an item is marked paid without a payment date, the Bill Payments
   Service shall record business today as the payment date.
2. If the requested payment date is after business today, then the Bill
   Payments Service shall reject the request as invalid.
3. When the clock reads `2026-11-22T01:30:00Z` with `America/Sao_Paulo`, the
   Bill Payments Service shall accept `2026-11-21` and reject `2026-11-22`.
4. The Bill Payments Service shall keep recording the marking instant in UTC,
   unchanged.
5. The Bill Payments Service shall leave existing payment records' dates
   unchanged.

### Requirement 5: Reminders evaluate the business day

**Objective:** As a user, I want reminders to fire on my calendar day, so that
"due today" and "due in 3 days" mean what they say.

#### Acceptance Criteria

1. When the scheduled reminder evaluation runs, the Reminders Service shall
   evaluate reminder windows against business today.
2. The Reminders Service shall run the scheduled evaluation at a fixed local
   time of the business day.
3. The Reminders Service shall keep R1 (no reminders for paid items) and R2 (at
   most once per item, due date and window) unchanged.
4. The Reminders Service shall keep the reminder delivery identity unchanged,
   so that deliveries recorded before this change are never re-sent.

### Requirement 6: Recurring bills generate for the business month

**Objective:** As a user, I want my recurring bills generated for my current
month, so that a new month's bills appear when my month starts.

#### Acceptance Criteria

1. When scheduled generation runs, the Recurring Bills Service shall generate
   occurrences for the business month.
2. The Recurring Bills Service shall run scheduled generation at a fixed local
   time of the business day, never in the server's implicit timezone.
3. When a business month starts, the Recurring Bills Service shall generate
   that month's occurrences no later than the first scheduled run on that
   business day.
4. The Recurring Bills Service shall keep R3 (one occurrence per bill and
   period) unchanged, including when generation runs twice across a timezone
   boundary.
5. The Recurring Bills Service shall finish scheduled generation before the
   same business day's reminder evaluation starts.

### Requirement 7: Compatibility and determinism

**Objective:** As a developer, I want this change to be safe and reproducible,
so that nothing else in PayPilot moves.

#### Acceptance Criteria

1. The PayPilot API shall not change the database schema or any public API
   request or response shape.
2. Where the business timezone is `UTC`, the PayPilot API shall behave exactly
   as before this change.
3. The PayPilot API shall keep invoice assignment, installment schedules and
   CSV import independent of the business timezone, since they use stored
   dates only.
4. The PayPilot API's automated tests shall cover business-date derivation with
   a fixed clock at instants on both sides of local midnight and of a month
   boundary, independent of the test process's `TZ`.
