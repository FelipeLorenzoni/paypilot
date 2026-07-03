# Requirements Document

## Project Description (Input)

due-date-reminders: due-date reminder engine for PayPilot — notify users about upcoming/due unpaid bills (recurring-bill occurrences and credit-card invoices) via an abstracted NotificationProvider with a WhatsApp implementation. Reminders only for unpaid bills (financial-rules R1), idempotent at most once per reminder window (R2), external providers abstracted behind the NotificationProvider port from platform-foundation (R7). Depends on recurring-bills and credit-cards-invoices.

## Introduction

This specification adds the **due-date reminder engine**: PayPilot proactively notifies a user on WhatsApp about upcoming and same-day due dates of **unpaid** bills — recurring-bill occurrences (`source = RECURRING` ledger rows, whose `transactionDate` is the due date) and credit-card invoices (`source = CARD` rows grouped per card + `invoiceCycle`, whose due date is derived per financial-rules R4). It upholds financial-rules **R1** (never remind for a paid bill — checked at scheduling *and* at send), **R2** (at most one successful send per `(userId, targetType, targetKey, dueDate, reminderWindow, channel)`, guaranteed under retries and concurrent runs — `channel` is part of the identity from day one even though the MVP ships WhatsApp only), and **R7** (the WhatsApp integration sits behind a PayPilot-owned provider interface).

Three gaps in the current codebase are closed by this spec and are therefore in scope:

1. **The `NotificationProvider` port does not exist yet.** Only the `Clock` port was delivered by platform-foundation. This spec introduces `integrations/notifications` (interface + fake/log default + WhatsApp implementation) following [[integrations]].
2. **No paid status exists anywhere in the schema.** R1 is meaningless without it, so this spec introduces a user-facing "mark as paid / unpaid" capability for reminder-eligible items. It must not alter the financial fields of ledger rows nor break cross-source ledger protection.
3. **No notification destination exists on `User`.** This spec introduces per-user reminder settings (WhatsApp destination + enabled flag).

It reuses existing primitives: the global `JwtAuthGuard` + `@CurrentUser`, owner-scoped queries, the canonical error envelope + request-id, validated config, integer-minor-unit money, date-only due dates, the injected `Clock` (never a direct clock read), Prisma via `PrismaService`, and the in-process `@nestjs/schedule` cron precedent from recurring-bills (final scheduling mechanism decided in design).

Decisions fixed by these requirements: the reminder idempotency identity (`userId + targetType + targetKey + dueDate + reminderWindow + channel`), the canonical target identities (generated `RECURRING` transaction id; `creditCardId + invoiceCycle`), invoice-level paid granularity for cards, recurring reminders targeting already-generated rows only, and a WhatsApp provider delivered as a DI boundary (stub/optional implementation) rather than a mandatory real integration. Decisions deliberately left to design: the exact reminder-window set (e.g. D-3 and D-0), where the paid marker lives (ledger column vs side table), the ReminderDelivery status model and failed-retry transition, phone storage format/validation, the timezone anchor for "days before" boundaries, catch-up policy after downtime, and the scheduling mechanism.

**Out of scope (deliberately excluded):** channels other than WhatsApp (email/SMS/push/in-app — though `channel` is part of the persisted reminder identity to accommodate them later); a mandatory real WhatsApp API integration (the provider may ship as a stub/optional implementation per Requirement 5); real delivery confirmation, provider webhooks, or read receipts; phone-number verification flows (OTP); per-bill or user-customized reminder windows; quiet hours, snooze, or digest/batching preferences; reminders for `MANUAL` or `IMPORTED` transactions; **predictive reminders for recurring occurrences not yet generated** (reminders target existing `RECURRING` ledger rows); automatic paid detection or bank reconciliation; a reminder-history API beyond what R2 persistence requires; BullMQ/Redis or distributed locking for multi-instance deployments (in-process precedent stands); message localization/i18n beyond a single fixed template; and admin/RBAC.

## Requirements

### Requirement 1: Reminder Eligibility and Scheduled Evaluation
**Objective:** As a user, I want PayPilot to detect my upcoming unpaid due dates automatically, so that I am nudged before a bill slips past without tracking anything manually.

#### Acceptance Criteria
1. The Reminder Service shall treat as reminder-eligible exactly: (a) recurring-bill occurrences — **already-generated** `source = RECURRING` ledger rows, due date = the row's `transactionDate` — and (b) credit-card invoices — `source = CARD` rows grouped per (card, `invoiceCycle`), due date as derived by the existing R4 logic; each scoped to its owning user. `MANUAL` and `IMPORTED` transactions shall never produce reminders, and predictive reminders for recurring occurrences that have not been generated yet are out of scope unless explicitly added in design.
2. The Reminder Service shall evaluate reminders against a fixed, documented set of reminder windows relative to the due date, including at least one days-before window and one on-due-date window (the exact set is fixed in design and documented).
3. When a scheduled evaluation runs, the Reminder Service shall select, for each user, the reminder-eligible unpaid items whose due date matches an active reminder window for the evaluation date, computing "today" from the injected `Clock` with a documented timezone anchor (date-only comparison, no timezone drift).
4. The Reminder Service shall run its evaluation on a recurring schedule at least once per day without requiring any user/HTTP trigger; the scheduling mechanism shall follow the precedent established by recurring-bills unless design documents a stronger need.
5. If an evaluation runs after a window's date has already passed (e.g. downtime), the Reminder Service shall not send stale reminders for past windows except as explicitly allowed by the catch-up policy defined in design.
6. The Reminder Service shall bound each evaluation's work per run and process users' items independently, so one user's failure does not prevent other users' reminders (a failure is logged and evaluation continues).
7. The design shall define a stable **canonical target identity** (`targetType` + `targetKey`) for each reminder-eligible item, used consistently by paid markers and ReminderDelivery records: for recurring occurrences, the generated `RECURRING` transaction id is preferred for the MVP (reminders target already-generated ledger rows); for card invoices, `creditCardId` + `invoiceCycle`.

### Requirement 2: Paid Status for Reminder-Eligible Items
**Objective:** As a user, I want to mark a bill occurrence or card invoice as paid (and undo it), so that PayPilot stops reminding me about money I have already settled.

#### Acceptance Criteria
1. The system shall persist a paid marker for each reminder-eligible item, keyed by the canonical target identity (Requirement 1.7), owned by the item's user and defaulting to unpaid. For card invoices the paid marker shall be **invoice-level** — `(userId, creditCardId, invoiceCycle)` — not per individual `CARD` transaction, unless design explicitly justifies another model; for recurring occurrences it is per generated occurrence. The marker's storage location (ledger column vs side table) is decided in design.
2. When an authenticated user marks one of their reminder-eligible items as paid, the system shall persist the paid state with a paid-at timestamp taken from the injected `Clock`, and the operation shall be idempotent (marking an already-paid item paid again succeeds without side effects).
3. When an authenticated user unmarks a previously paid item they own, the system shall restore it to unpaid (re-enabling future windows per Requirement 3; whether already-sent windows re-fire is fixed in design and documented).
4. Marking paid/unpaid shall not modify the financial fields of ledger rows (amount, currency, date, description, source, links) and shall not violate cross-source ledger protection: manual/recurring/card/import endpoints keep their existing behavior.
5. If the target item does not exist or belongs to another user, then the system shall respond 404 without disclosure; while the request is unauthenticated, the system shall reject it with 401.

### Requirement 3: Reminders Only for Unpaid Bills (financial-rules R1)
**Objective:** As a user, I want to never be reminded about a bill I already paid, so that reminders stay trustworthy instead of becoming noise.

#### Acceptance Criteria
1. While an item is marked paid, the Reminder Service shall not select it for any reminder window.
2. The Reminder Service shall check paid status at the moment a reminder is selected/scheduled **and** again immediately before the send is executed; when the item was paid between selection and send, the Reminder Service shall skip the send.
3. When an item is unpaid at selection and unpaid at send time, the Reminder Service shall proceed with the send (subject to Requirements 4–6).
4. Paid-awareness (including the paid-after-scheduling race) shall be covered by automated tests.

### Requirement 4: Idempotent Reminders (financial-rules R2)
**Objective:** As the system, I want at most one reminder per (user, target, due date, window, channel), so that retries, restarts, and concurrent runs never spam the user.

#### Acceptance Criteria
1. The system shall model each reminder as one logical **ReminderDelivery** record identified by the composite identity `(userId, targetType, targetKey, dueDate, reminderWindow, channel)`, carrying at least an outcome status and created/sent timestamps. The `channel` dimension is part of the identity from the start (MVP value: WhatsApp only) so adding future channels requires no identity/schema change.
2. The system shall not successfully send more than one reminder for the same `(userId, targetType, targetKey, dueDate, reminderWindow, channel)` combination; this shall be enforced by a **database-level uniqueness guarantee** on the ReminderDelivery record (the source of truth under concurrency), not only application-level checks.
3. When two evaluations run concurrently or a run is retried, the send + record operation shall behave as a single guarded unit (e.g. claim-the-ReminderDelivery-before-send), so exactly one send occurs and the loser skips without error.
4. If a provider send fails, then the system shall record the failure on the ReminderDelivery such that it is not counted as sent, and a later run within the same window may safely retry it (one attempt at a time); a successful send shall never be duplicated for that identity. The status model (e.g. pending/sent/failed) and the failed-retry transition are fixed in design.
5. Idempotency shall be covered by automated tests including a re-run of the same evaluation, a retry after a provider failure, and a concurrent/overlapping evaluation converging to a single send.

### Requirement 5: Provider Abstraction and WhatsApp Implementation (financial-rules R7)
**Objective:** As a maintainer, I want all outbound notifications behind a PayPilot-owned interface, so that swapping or adding providers never touches domain code and tests never hit a real API.

#### Acceptance Criteria
1. The Reminder Service shall send every notification through a `NotificationProvider` interface owned by PayPilot (located per [[structure]] under the integrations pattern), whose contract models PayPilot's needs (an outbound notification with destination and message) and not any vendor's API shapes.
2. The system shall provide a fake/log implementation as the default in development and automated tests; no real WhatsApp call shall ever occur in development or tests.
3. The system shall provide a WhatsApp provider as a **DI boundary** — a stub or optional implementation selected via validated configuration when credentials are present; a real WhatsApp API integration is **not required** for the MVP unless design explicitly selects one. While credentials are absent, the system shall fall back to the fake/log provider and shall still boot successfully.
4. If the concrete provider fails or throws, then the system shall wrap the failure into PayPilot's error model (no vendor exception/response shapes leaking into domain or use-case code) and shall handle it per Requirement 4.4.
5. Provider credentials shall come exclusively from environment configuration validated at startup, shall never be committed (financial-rules R8), and shall never be logged.

### Requirement 6: Reminder Settings — Destination and Opt-In
**Objective:** As a user, I want to set my WhatsApp number and turn reminders on or off, so that I control where and whether PayPilot messages me.

#### Acceptance Criteria
1. When an authenticated user sets their reminder settings (a WhatsApp destination phone number and an enabled/disabled flag), the system shall validate and persist them scoped to that user, and shall let the user read their own current settings.
2. The destination phone number shall be validated against a documented format (design fixes the format, e.g. E.164) and rejected with 400 and a canonical error when invalid.
3. While a user has no destination configured or has reminders disabled, the Reminder Service shall skip that user's sends without treating it as an error; whether skipped windows are recorded is fixed in design.
4. The stored phone number shall never be written to logs in full (masked at most); reminder settings shall never be readable or writable by another user (404/401 semantics consistent with the rest of the API).

### Requirement 7: Message Content and Privacy
**Objective:** As a user, I want the reminder message to tell me what is due, how much, and when, so that the message is actionable without leaking anything it shouldn't.

#### Acceptance Criteria
1. The reminder message shall identify the bill (description or card label), the amount formatted from integer minor units with explicit currency (BRL), the due date, and the window context (e.g. due in N days / due today), containing only data owned by the recipient user.
2. The message shall never include another user's data, other items' details beyond the reminder subject, secrets, or internal identifiers not needed by the user.
3. Logs for the reminder flow shall contain only operation, userId, item/run identifiers, window, counts, and outcome codes — never the message body, the full phone number, or provider credentials ([[security]]).

### Requirement 8: Time and Money Conventions
**Objective:** As a maintainer, I want reminder date math and amount formatting to follow the repo conventions, so that behavior is deterministic and testable.

#### Acceptance Criteria
1. All reminder logic that needs the current time shall take it from the injected `Clock`; domain/window computation shall be pure over explicit inputs and shall never read the system clock directly.
2. Due-date and window arithmetic shall operate on date-only values with a documented timezone anchor, and shall behave identically under a non-UTC process timezone (verified under `TZ=America/Sao_Paulo`).
3. Amounts shall be handled as integer minor units end-to-end and formatted deterministically for the message; floating-point money shall not be used anywhere in the flow.

### Requirement 9: Per-User Isolation
**Objective:** As a user, I want my reminders, paid markers, and settings isolated from other users.

#### Acceptance Criteria
1. The system shall scope reminder evaluation, paid-status operations, settings, and reminder records to the owning user; no cross-user read or write shall occur in any part of the flow.
2. The owning user shall be derived from the authenticated token (for API operations) or from the item's ownership (for scheduled evaluation), never from client-supplied identifiers.
3. Automated tests shall prove that one user's paid markers, settings, and reminder records are invisible to and unaffected by another user.

### Requirement 10: Test Coverage
**Objective:** As a maintainer, I want R1/R2 and the reminder flow protected by automated tests, so that the invariants cannot regress silently.

#### Acceptance Criteria
1. The system shall cover with automated tests: window selection (days-before and on-due-date boundaries), R1 paid-awareness (including paid-after-scheduling), R2 idempotency (re-run, retry-after-failure, and concurrent/overlapping runs), settings/opt-in skip behavior, provider fallback selection, per-user isolation, and paid-marker semantics — including integration tests against a real PostgreSQL instance proving the DB-level uniqueness behind R2.
2. All tests shall use the fake/log provider; no test shall depend on external network calls.
3. Pure window/date logic shall have unit tests with a fixed injected clock covering month boundaries and non-UTC timezone behavior.
