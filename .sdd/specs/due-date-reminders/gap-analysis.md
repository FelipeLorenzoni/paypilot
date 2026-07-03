# Gap Analysis — due-date-reminders

## Current State (existing assets)

| Asset | Location | Reuse |
|-------|----------|-------|
| `Clock` port (`CLOCK` token, `SystemClock`, `FixedClock`) | `common/clock.ts` | Time source for evaluation; its docstring explicitly names it "the template pattern future provider ports (e.g. NotificationProvider) follow" |
| In-process cron precedent (`GenerationScheduler`, `@nestjs/schedule`, daily run, no lock — DB uniqueness is the safety) | `recurring-bills/generation.scheduler.ts` | Same pattern for the reminder evaluation job; R2's DB uniqueness plays the role R3's does there |
| Idempotent batch service precedent (P2002 → skip, per-item try/catch, counts-only summary, failures logged + run continues) | `recurring-bills/generation.service.ts` | Template for the reminder evaluation loop (Req 1.6, 4) |
| CLI manual-trigger precedent | `recurring-bills/generate.cli.ts` | Optional manual reminder run |
| Due dates already in the ledger: `RECURRING` rows — `transactionDate` = due date; `CARD` rows — `transactionDate` = cycle due date | `schema.prisma`, `cards/card.mapper.ts` | A single date-window query over `transactions` can find both kinds of due items |
| Derived `InvoiceView` (no stored entity): (cardId, cycle) → `dueDate(cycle, closingDay, dueDay)`, `totalMinor` | `cards/invoices.service.ts`, `cards/domain/invoice-assignment.ts` | Invoice identity/total/due date for card reminders |
| DB idempotency precedents: `@@unique(recurringBillId, periodKey)`; partial unique dedup index; source-aware CHECK | schema + migrations | Template for the reminder-record uniqueness (R2) and for any new constrained table |
| Validated env config (zod, fail-fast, names-only errors) | `config/env.schema.ts` | WhatsApp credentials as optional validated vars; absent → fake provider |
| Global `JwtAuthGuard` + `@CurrentUser`, owner-scoped repos, `AllExceptionsFilter` + request-id envelope | `auth/`, `common/` | Settings + mark-paid endpoints |
| Money/date helpers (`toAmountNumber`, `toDateString`, `toDateOnly`, `createMoney`) | `common/ledger-money-date.ts`, `@paypilot/shared` | Message amount formatting; date-only math |
| Testcontainers integration harness (serial, `TZ=America/Sao_Paulo`) | `apps/api/test/*.int.spec.ts` | R1/R2 integration + concurrency tests |
| `users/` module (repository only, no profile endpoints) | `users/` | Ownership FK for settings; **not** an existing settings surface |

**Notable absences:** no `integrations/` folder — the `NotificationProvider` port **does not exist** (only `Clock` was delivered); **no paid concept anywhere** (no column, no table, no endpoint); no phone/contact field on `User`; no reminder/notification tables; no outbound message templating; no HTTP client dependency for a provider call.

## Requirement → Asset Map (gaps tagged)

| Requirement | Existing | Gap |
|-------------|----------|-----|
| 1 Eligibility + scheduled evaluation | ledger due dates, scheduler + batch-service precedents | **Missing:** reminders module, window logic; **Decision:** window set, card granularity, tz anchor, catch-up policy |
| 2 Paid status | — | **Missing entirely.** **Decision:** marker placement (ledger column vs side table) and item identity for derived invoices |
| 3 R1 paid-aware | — | **Missing:** check at selection + re-check at send (depends on Req 2 model) |
| 4 R2 idempotent record | P2002-as-skip + unique-constraint precedents | **Missing:** reminder-record table + DB uniqueness; **Decision:** claim-before-send semantics, FAILED-retry state machine |
| 5 R7 provider port | `Clock` port as pattern; DI/config precedent | **Missing:** `integrations/notifications` (interface + Log fake + WhatsApp impl); **Research:** WhatsApp API surface, HTTP client (native `fetch` vs dep) |
| 6 Settings/opt-in | guard, envelope, users FK | **Missing:** settings model + endpoints; **Decision:** phone format/validation (E.164), settings home |
| 7 Message content/privacy | money/date formatters; log-hygiene precedent | **Missing:** message template; masked-phone logging |
| 8 Time/money conventions | `Clock`, date-only ledger, minor units | **Constraint:** define the timezone anchor for "today" (generation derives period from UTC) |
| 9 Isolation | owner-scoped patterns | **Constraint:** evaluation iterates all users — per-user scoping inside the job |
| 10 Tests | Testcontainers harness, FixedClock | **Missing:** window unit tests, R1/R2 integration incl. concurrent runs |

## Key Research / Decisions for Design

1. **Paid-marker placement (Req 2 — shapes everything).** Options: **(a)** `paidAt` column on `transactions` — natural for RECURRING rows but wrong for card invoices (an invoice is a *group* of rows; paying it row-by-row is not the product semantics) and touches the source-aware CHECK. **(b, lean recommendation)** a reminders-owned side table (e.g. `payment_markers`) keyed by item identity — `(userId, itemKind, itemKey)` where `itemKey` = transactionId for RECURRING and `(creditCardId, invoiceCycle)` for CARD — leaving the ledger untouched (no CHECK rewrite, no cross-source risk). Design must fix identity encoding + FK strategy.
2. **Reminder record + claim semantics (R2).** New table (e.g. `reminder_log`) unique on (item identity, dueDate, window). Claim-before-send: `INSERT` the record in a claiming state before calling the provider (P2002 → someone else owns it, skip), then finalize SENT/FAILED. **Decision:** whether FAILED rows are re-claimable (status-transition `updateMany` guard) or terminal for the window; whether user-skips (no destination/disabled) are recorded.
3. **Card reminder granularity.** Recommend **per invoice** (card + cycle, derived due date + total) — matches the product's "invoice due" mental model; per-installment-row is the simpler-but-noisier alternative.
4. **Settings home.** Recommend a reminders-owned `reminder_settings` table (1:1 user, phone, enabled) + small settings endpoints inside the reminders module, leaving `users`/auth untouched. Alternative: columns on `users` (fewer joins, but bloats auth's model).
5. **Window set + tz anchor.** Hard-coded documented constants (csv-import limits precedent), e.g. D-3 and D-0. Anchor "today" consistently with recurring generation (UTC clock date) or product tz (America/São Paulo) — **Research/Decision**; must be deterministic under `TZ=America/Sao_Paulo` tests either way.
6. **WhatsApp provider implementation.** **Research:** target API (e.g. Meta WhatsApp Cloud API) request shape + auth; native Node `fetch` (no new dependency — preferred under the supply-chain policy) vs SDK; env var names + optional-credentials validation (absent → Log provider, boots fine). No real call in dev/tests regardless.
7. **Catch-up policy.** Daily run + windows matched against the evaluation date only (missed window ⇒ silently skipped, mirroring generation's harmless-daily-rerun philosophy) is the simplest R2-safe policy; design documents it explicitly.
8. **Unpaid→paid→unpaid re-fire semantics** (Req 2.3): recommend "already-sent windows never re-fire" (the reminder record survives), documented in design.

## Implementation Approach Options

- **Option A — Extend recurring-bills/cards modules:** ❌ reminders are a cross-feature read-side concern (both sources) plus an outbound integration; would couple two shipped features and violate feature-first structure.
- **Option B — New `reminders` feature module + new `integrations/notifications` (recommended):** `apps/api/src/reminders/` (scheduler, evaluation service, pure window/eligibility domain, settings + mark-paid endpoints, repository, reminder-record writer) + `apps/api/src/integrations/notifications/` (port + Log + WhatsApp). New tables: reminder settings, payment markers, reminder log. Clean boundaries, matches steering `structure.md` examples verbatim (`reminders/`, `integrations/notifications/`).
- **Option C — Hybrid (paid marker in the ledger):** Option B but with `paidAt` on `transactions` instead of a side table. ✅ one less table, paid visible to future features; ❌ CHECK/source-protection rewrite, awkward for derived invoices, mutates shipped ledger semantics. Only worth it if design decides paid status must live on the ledger for other consumers.

## Effort & Risk

- **Effort: M–L.** Three small tables + two modules + provider port is moderate; the weight is the R2 claim state machine, the paid-item identity for derived invoices, and first-time provider wiring.
- **Risk: Medium.** Concentrated in (a) R2 correctness under concurrency/retry (claim-before-send), (b) timezone anchoring of date-only windows, (c) WhatsApp API specifics (mitigated: fake provider is the default and the real impl is config-gated).

## Recommendations for Design

- **Option B.** Side tables for paid markers + settings + reminder log (ledger untouched, no CHECK rewrite); per-invoice card granularity; claim-before-send reminder record with DB uniqueness as the R2 source of truth; in-process daily cron (recurring-bills precedent, BullMQ stays out of scope); hard-coded window constants; `NotificationProvider` port + Log default + fetch-based WhatsApp impl gated by optional validated env credentials.
- Carry research items 1–8 into design; items 5 (tz anchor) and 6 (WhatsApp API + client choice) need explicit resolution there.
