# Implementation Plan — due-date-reminders (Executor-Grade)

> Builds on platform-foundation + auth-jwt + recurring-bills + credit-cards-invoices. Scope: daily scheduled evaluation of unpaid due items (windows **D-3**/**D-0**, UTC-date anchor) → claim-before-send `ReminderDelivery` (R2 DB-guaranteed identity `(userId, targetType, targetKey, dueDate, windowDaysBefore, channel)`) → send via the new `NotificationProvider` port (Log default, WhatsApp **stub**); plus paid markers (invoice-level for cards), reminder settings endpoints, and provenance-grade delivery records. **Out of scope:** real WhatsApp API integration, other channels, OTP verification, custom windows/quiet hours/snooze, predictive reminders for not-yet-generated occurrences, reminders for `MANUAL`/`IMPORTED`, reminder-history API, BullMQ/distributed locking, i18n.
>
> **Cross-feature data dependency (explicit):** card-invoice reminders rely on the credit-cards-invoices invariant that every `CARD` ledger row's `transactionDate` **is the invoice cycle's due date** (and recurring reminders on `RECURRING` rows' `transactionDate` being the occurrence due date). The due-item query builds entirely on this; if that invariant ever changes, `findDueItems` breaks. Asserted explicitly in the integration suite (task 8).
>
> **Delivery semantics (stated precisely):** the MVP guarantees at most one successful **recorded** delivery per identity at the DB level; true exactly-once **external** delivery is out of scope (stub + log providers only — a future real-provider spec must add provider idempotency/delivery confirmation).
>
> `(P)` = parallel-safe (independent files). Each task ends with `_Requirements: <ids>_`. Conventions: `apps/api/src/reminders/` + `apps/api/src/integrations/notifications/`, pure domain with no framework imports (no clock read — evaluation date is an input), repository/store over `PrismaService`, reuse global guard / `@CurrentUser` / `AllExceptionsFilter` / `Clock` / money-date helpers. The unique index on `reminder_deliveries` is the R2 source of truth.

---

## 1. Schema: enums, settings, paid markers, deliveries

- [ ] 1.1 New enums + `reminder_settings` + `payment_markers` + `reminder_deliveries` (single migration, ledger untouched)

  **Goal**
  Persist reminder settings, paid state, and the R2 delivery ledger with DB-level guarantees; leave existing tables' SQL untouched.

  **Deliverables**
  - `schema.prisma`: enums `ReminderTargetType { RECURRING_TRANSACTION CARD_INVOICE }`, `NotificationChannel { WHATSAPP }`, `ReminderDeliveryStatus { PENDING SENT FAILED SKIPPED }`; models per design: `ReminderSettings` (1:1 user, `phoneE164 VarChar(16)?`, `enabled` default false), `PaymentMarker` (typed target columns + `targetKey VarChar(90)`, `paidAt`, `@@unique([userId, targetType, targetKey])`), `ReminderDelivery` (typed target columns + `targetKey`, `dueDate @db.Date`, `windowDaysBefore SmallInt`, `channel`, `status` default `PENDING`, `attempt` default 1, `errorCode VarChar(64)?`, `sentAt?`, `@@unique([userId, targetType, targetKey, dueDate, windowDaysBefore, channel])`). All FKs `onDelete: Restrict`; `@@index([userId])` on markers/deliveries; inverse relations on `User`/`Transaction`/`CreditCard` (schema-file-only — no SQL change to their tables).
  - One migration (`migrate diff` → hand-append SQL, csv-import precedent): tables + FKs + indexes + **CHECK** on `payment_markers` and `reminder_deliveries` — `RECURRING_TRANSACTION` ⇒ `transactionId NOT NULL AND creditCardId IS NULL AND invoiceCycle IS NULL`; `CARD_INVOICE` ⇒ inverse.
  - Regenerated client.

  **Acceptance criteria**
  - Migration applies on a DB holding data from all four ledger sources; existing tables' SQL is untouched (verify migration contains no `ALTER TABLE "transactions"`/`"users"`/`"credit_cards"`); unique indexes + named CHECKs exist; client typechecks.

  **Verification**
  - `pnpm db:generate` ok; migration applies against Testcontainers (asserted in 8.x).

  **Out of scope**
  - Any service/domain logic.

  _Requirements: 2.1, 4.1, 4.2, 6.1_

---

## 2. Integrations: NotificationProvider port

- [ ] 2.1 (P) Port + Log provider + WhatsApp stub + config-driven selection

  **Goal**
  First provider port (R7): every send behind a PayPilot-owned interface; fake/log default; honest WhatsApp stub; fail-fast config.

  **Deliverables**
  - `apps/api/src/integrations/notifications/`: `OutboundNotification` (channel, destination, body), `NotificationResult` (`{ok:true} | {ok:false; errorCode}` — providers **never throw**), `NotificationProvider` interface + `NOTIFICATION_PROVIDER` token (Clock-port pattern), `LogNotificationProvider` (logs op + **masked** destination + result; returns ok), `WhatsAppNotificationProvider` (**MVP stub**: masked log + `{ok:false, errorCode:"WHATSAPP_NOT_IMPLEMENTED"}` — never fabricates success), `NotificationsModule` selecting the provider by config.
  - `config/env.schema.ts` + `app-config.ts`: `NOTIFICATION_PROVIDER ∈ {log, whatsapp}` default `log`; `WHATSAPP_API_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` required iff `whatsapp` (superRefine, names-only errors); credentials never logged; `.env.example` names only.
  - Unit tests: selection (default log; whatsapp requires credentials; boots without credentials on log), masked logging, stub failure result.

  **Acceptance criteria**
  - Domain/use-case code can depend only on the interface; `NOTIFICATION_PROVIDER=whatsapp` without credentials fails boot with variable names only; log provider needs no env; no vendor shapes in the port.

  **Verification**
  - `pnpm --filter @paypilot/api test`.

  **Out of scope**
  - Real WhatsApp HTTP call (follow-up spec, per design).

  _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

---

## 3. Pure domain: windows, target identity, message

- [ ] 3.1 (P) Window/date logic + constants

  **Goal**
  Deterministic window selection anchored to the UTC calendar date.

  **Deliverables**
  - Constants module (documented): `REMINDER_WINDOWS_DAYS_BEFORE = [3, 0]`, `STALE_CLAIM_HOURS = 12`, cron expression `0 12 * * *` (UTC), E.164 regex `^\+[1-9]\d{7,14}$`.
  - `addDays(dateIso, days)` (UTC string arithmetic) and `windowsFor(dueDate, todayUtc)` → matching windows (`[]` when none; past windows never match — catch-up = exact-match-only). Pure, framework-free, no clock read.
  - Unit tests: D-3/D-0 boundaries, month/year rollover (e.g. due `2026-03-02` matched at `2026-02-27`), leap February, no stale matches.

  **Acceptance criteria**
  - Same results regardless of process TZ (string math only); `windowsFor` returns exactly the windows where `addDays(today, w) === dueDate`.

  **Verification**
  - `pnpm --filter @paypilot/api test`.

  _Requirements: 1.2, 1.5, 8.1, 8.2, 10.3_

- [ ] 3.2 (P) Canonical target identity + message template

  **Goal**
  One stable identity used by markers and deliveries; deterministic user-facing message.

  **Deliverables**
  - Target builders + `encodeTargetKey`: `txn:<transactionId>` / `card:<creditCardId>:<invoiceCycle>` (server-derived only, never client-supplied as a string); validation of constituent parts (uuid, `YYYY-MM`).
  - `formatReminderMessage(item, windowDays)`: description/card label, deterministic BRL formatting from integer minor units (`123456` → `R$ 1.234,56` — manual grouping, no locale dependency, no floats), due date, D-3 vs D-0 phrasing (fixed pt-BR template); only the owner's data.
  - Unit tests: encodings, invalid parts rejected, formatting edges (`0` invalid upstream, `1` → `R$ 0,01`, thousands grouping), both phrasings.

  **Acceptance criteria**
  - Equal inputs → identical string output; message contains no identifiers beyond bill/card label, amount, due date, window context.

  **Verification**
  - `pnpm --filter @paypilot/api test`.

  _Requirements: 1.7, 7.1, 7.2, 8.3_

---

## 4. Data: due-item queries, paid checks, ownership

- [ ] 4.1 RemindersRepository

  **Goal**
  Owner-correct reads: due unpaid items for enabled users; send-time paid re-check; target ownership resolution.

  **Deliverables**
  - `findDueItems(dueDates)`: `RECURRING` rows with `transactionDate IN dueDates` + `CARD` invoices grouped `(creditCardId, invoiceCycle)` with `transactionDate IN dueDates` and `SUM(amountMinor)` — **relies on the documented invariant that `CARD` rows' `transactionDate` is the cycle due date** (and `RECURRING` rows' the occurrence due date); joined to `reminder_settings` (`enabled` + `phoneE164 NOT NULL`) and excluding items with a `payment_markers` row (R1 at selection). Returns `DueItem`s with destination.
  - `isPaid(userId, target)` (send-time re-check) and `resolveOwnedTarget(userId, input)` (RECURRING → owned `source=RECURRING` transaction exists; CARD_INVOICE → owned card + ≥1 `CARD` row in the cycle; else null). `MANUAL`/`IMPORTED` ids resolve to null.
  - Unit tests (mocked prisma) for shaping/mapping; behavior proven in 8.x.

  **Acceptance criteria**
  - Query filters exclude paid items and non-opted-in users at selection; invoice amount = sum of its rows; no cross-user rows ever returned.

  **Verification**
  - `pnpm --filter @paypilot/api test`; end-to-end in 8.1.

  _Requirements: 1.1, 2.5, 3.1, 6.3, 9.1, 9.2_

---

## 5. Data: ReminderDelivery claim state machine

- [ ] 5.1 ReminderDeliveryStore (claim / finalize)

  **Goal**
  R2 as code: claim-before-send with the unique index as the source of truth; safe failed-retry; terminal states.

  **Deliverables**
  - `claim(identity)`: `create(… PENDING, attempt 1)`; on P2002 → atomic `updateMany({ where: identity + (status FAILED OR (PENDING AND updatedAt < now − STALE_CLAIM_HOURS)), data: { status: PENDING, attempt: increment } })` → `count 1` = re-claimed, else `already-owned`. `SENT`/`SKIPPED` never re-claimable (incl. after paid→unpaid flips).
  - `finalize(identity, SENT | FAILED | SKIPPED, errorCode?)`: sets `sentAt` (from `Clock`) on SENT; stores stable `errorCode` only (never message body/PII).
  - Unit tests (mocked prisma): create-claim, P2002 → reclaim path, count-0 skip, finalize transitions.

  **Acceptance criteria**
  - Two concurrent claims for one identity → exactly one `claimed`; FAILED then re-claim increments `attempt`; SENT/SKIPPED rows are never modified by later claims.

  **Verification**
  - `pnpm --filter @paypilot/api test`; concurrency proven on real PostgreSQL in 8.2.

  _Requirements: 4.1, 4.2, 4.3, 4.4_

---

## 6. Application: settings, paid status, HTTP endpoints

- [ ] 6.1 ReminderSettingsService + PaidStatusService + RemindersController + module wiring

  **Goal**
  Owner-scoped settings and idempotent mark/unmark-paid over the canonical identity; wire the feature module.

  **Deliverables**
  - `ReminderSettingsService`: `get` (defaults `{phoneE164: null, enabled: false}` when absent) and `upsert` (E.164 validation → 400; phone always masked in logs).
  - `PaidStatusService.setPaid(userId, input, paid)`: resolve owned target via repository (null → 404 without disclosure); mark = upsert marker (`ON CONFLICT DO NOTHING`, `paidAt` from `Clock`), unmark = idempotent delete; never mutates ledger rows.
  - DTOs (class-validator; `targetType` discriminates required fields) + `RemindersController`: `GET/PUT /api/v1/reminders/settings`, `PUT /api/v1/reminders/paid` — global guard (401), canonical envelope.
  - `RemindersModule` wired into `AppModule`. Unit tests for both services (mocked repo/prisma).

  **Acceptance criteria**
  - Marking paid twice / unmarking twice → 200 both times, single marker end-state; cross-user or `MANUAL`/`IMPORTED` target → 404; invalid phone/cycle → 400; unauthenticated → 401.

  **Verification**
  - `pnpm --filter @paypilot/api test`; `pnpm --filter @paypilot/api build`; endpoint semantics proven in 8.3.

  _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 6.1, 6.2, 6.4, 9.1_

---

## 7. Application: evaluation orchestration + scheduler

- [ ] 7.1 ReminderEvaluationService + RemindersScheduler + CLI

  **Goal**
  The daily run: select → claim → re-check paid → send → finalize, with per-item isolation and counts-only summary.

  **Deliverables**
  - `evaluate(todayUtc)`: compute due dates per window (`addDays`), `findDueItems` (already settings-filtered + selection-paid-filtered), per item×window: `claim` (skip if owned) → `isPaid` re-check (paid → finalize `SKIPPED`) → `formatReminderMessage` → provider `send` → finalize `SENT`/`FAILED(errorCode)`. Per-item try/catch (failure logged with codes, run continues). Returns `EvaluationSummary` counts only.
  - `RemindersScheduler`: `@Cron("0 12 * * *", UTC)` deriving `todayUtc` from `CLOCK` (UTC calendar date); multi-instance safety = the DB claim (documented, recurring-bills precedent). `remind.cli.ts` for manual runs (generation precedent).
  - Logging: operation, userId, targetKey, window, outcome code — **never** message body or unmasked phone.
  - Unit tests (mocked repo/store/provider): flow order, paid-at-send → SKIPPED (no provider call), provider failure → FAILED, claim-lost → no send, summary counts, isolation of a throwing item.

  **Acceptance criteria**
  - No send ever happens without a successful claim; paid-at-send never calls the provider; one item's exception doesn't abort others; summary is internally consistent.

  **Verification**
  - `pnpm --filter @paypilot/api test`; scheduled behavior via service call in 8.x (no cron waiting).

  _Requirements: 1.3, 1.4, 1.5, 1.6, 3.1, 3.2, 3.3, 4.3, 6.3, 7.3, 8.1, 9.2_

---

## 8. Integration & final gate

- [ ] 8.1 Reminder evaluation integration suite (Testcontainers)

  **Goal**
  Prove eligibility, windows, R1, settings/opt-in, isolation, and the cross-feature due-date invariant on real PostgreSQL.

  **Deliverables**
  - `apps/api/test/due-date-reminders.int.spec.ts`: Testcontainers + `migrate deploy` + global app setup + auth-flow users; a recording fake provider bound to `NOTIFICATION_PROVIDER` token; evaluation invoked directly with fixed `todayUtc`.

  **Acceptance criteria** (all pass)
  - **Happy path**: enabled user with an unpaid `RECURRING` row due D-3 and a card invoice due D-0 → one `SENT` delivery each with correct identity; invoice amount = SUM of the cycle's rows; **card invoice due date comes from `CARD` rows' `transactionDate` (cross-feature invariant asserted via rows created through the real card-purchase flow)**.
  - **R1**: paid occurrence and invoice-level paid marker → not selected; marker inserted **between claim and send** (fake provider hook) → `SKIPPED`, provider not called.
  - **SKIPPED terminal (explicit)**: identity finalized `SKIPPED` via paid-before-send, then item unmarked unpaid → re-running the same evaluation does **not** re-open or send for that identity; a **future** window's identity still fires normally.
  - **Windows/tz**: D-3 and D-0 selected for the right dates across a month boundary under `TZ=America/Sao_Paulo`; no window → no rows written.
  - **Opt-in**: disabled or missing phone → no delivery rows at all; `MANUAL`/`IMPORTED` rows never produce reminders.
  - **Isolation**: user B's identical due items are independent; nothing of user A appears in B's messages/records.

  **Verification**
  - `pnpm --filter @paypilot/api test:integration` (Docker required).

  _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 1.7, 3.1, 3.2, 3.3, 3.4, 6.3, 7.1, 7.2, 8.2, 9.1, 9.3, 10.1, 10.3_

- [ ] 8.2 R2 idempotency + concurrency integration assertions

  **Goal**
  Prove at-most-one recorded delivery per identity under re-run, retry, and overlap — at the DB.

  **Acceptance criteria**
  - Re-running the same evaluation → zero new sends (`already-owned`); **two overlapping evaluations** (Promise.all) → exactly one `SENT` per identity; provider forced to fail → `FAILED` recorded with `errorCode`, next run retries and succeeds → still exactly one `SENT`, `attempt` incremented; raw duplicate-identity insert rejected by the unique index; stale `PENDING` (backdated `updatedAt`) is re-claimed, fresh `PENDING` is not.

  **Verification**
  - `pnpm --filter @paypilot/api test:integration`.

  _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 10.1_

- [ ] 8.3 Settings/paid endpoints + ledger-untouched integration assertions

  **Goal**
  Prove endpoint semantics and that reminders never mutate the ledger.

  **Acceptance criteria**
  - Settings: GET defaults; PUT validates E.164 (400) and round-trips; cross-user isolation (404/scoping). Paid: idempotent mark/unmark for both target types; invoice-level marker suppresses the whole invoice; cross-user/unknown/`MANUAL`/`IMPORTED` target → 404. **Ledger untouched**: `transactions` rows byte-identical before/after evaluation + paid operations; existing manual/recurring/cards/import suites stay green.
  - CHECK constraints: raw inserts with inconsistent typed target columns rejected for both new tables.

  **Verification**
  - `pnpm --filter @paypilot/api test:integration`.

  _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 6.1, 6.2, 6.4, 9.1, 9.3, 10.1_

- [ ] 8.4 README + final quality gate

  **Goal**
  Document the reminder endpoints/behavior and confirm the monorepo gate is green.

  **Deliverables**
  - README: settings + paid endpoints, reminder windows (D-3/D-0, 12:00 UTC daily), paid semantics (invoice-level for cards; consumed identities never re-fire), delivery-guarantee wording (recorded-delivery guarantee; external exactly-once out of scope; WhatsApp stub), env vars (names only).

  **Acceptance criteria**
  - `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm format:check`, `pnpm test` (incl. integration), `pnpm build`, `pnpm security:audit` all pass.

  **Verification**
  - Run the full gate; record results.

  _Requirements: 10.1, 10.2_
