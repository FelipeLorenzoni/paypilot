# Research & Design Decisions — due-date-reminders

## Summary

- **Feature**: `due-date-reminders`
- **Discovery Scope**: Extension (light discovery; builds on the gap analysis in `gap-analysis.md`)
- **Key Findings**:
  - Due dates are already in the ledger for both target kinds (`transactionDate` of `RECURRING` rows and of `CARD` rows), so a single date-window query finds all due items — no new due-date computation is needed at evaluation time.
  - The repo already contains every precedent this feature needs: `Clock` port (whose docstring names `NotificationProvider` as the next port to follow it), in-process daily cron safe only via DB uniqueness, P2002-as-skip batch service, zod fail-fast env validation, and the serial non-UTC Testcontainers harness.
  - The timezone anchor question resolves by precedent: `deriveCurrentPeriod` uses the **UTC calendar date/month** of `clock.now()` explicitly to keep multi-instance behavior deterministic; reminders adopt the same UTC-date anchor.
  - No new dependency is required: `@nestjs/schedule` is installed, and the MVP WhatsApp provider is a config-gated stub (no HTTP client needed).

## Research Log

### Timezone anchor for "today" and day-window arithmetic

- **Context**: Requirement 8.2 demands a documented timezone anchor; date-only due dates must not drift under `TZ=America/Sao_Paulo`.
- **Sources Consulted**: `recurring-bills/generation.helpers.ts` (`deriveCurrentPeriod`, `isEligible`), `common/ledger-money-date.ts` (`toDateString`/`toDateOnly` UTC-based), cards tz tests.
- **Findings**: All existing date math is done on `YYYY-MM-DD` strings derived via UTC getters; strings compare lexicographically; ledger dates are `@db.Date`.
- **Implications**: Evaluation "today" = UTC calendar date of `clock.now()`. Window matching = `dueDate ∈ {today, today + 3d}` computed with UTC date arithmetic on strings. Reuses `toDateString`; a pure `addDays(dateIso, n)` helper is the only new date function.

### WhatsApp provider scope (Requirement 5, refinement 5)

- **Context**: Requirements allow a stub/optional implementation; no real integration is required unless design selects one; no test may call an external provider.
- **Sources Consulted**: steering `integrations.md` pattern; Meta WhatsApp Cloud API shape (from prior knowledge — send-message POST with bearer token + phone-number-id); supply-chain policy (exact pins, `minimumReleaseAge`).
- **Findings**: A real Cloud API adapter would need only native `fetch` (no dependency), but requires template pre-approval, a Meta business account, and webhook-less delivery uncertainty — none testable in this repo.
- **Implications**: **Design selects the stub**: `WhatsAppNotificationProvider` implements the port, is selected by validated config, logs a masked destination, and returns a wrapped failure (`WHATSAPP_NOT_IMPLEMENTED`) so deliveries record `FAILED` honestly (retriable daily, bounded). It never fabricates a `SENT`. The real adapter is a follow-up spec; swapping it in touches only the provider class (R7 payoff).

### ReminderDelivery claim state machine (R2)

- **Context**: Requirement 4.3–4.4 — send + record as a guarded unit; failed attempts retriable; successful sends never duplicated; DB uniqueness is the source of truth.
- **Sources Consulted**: `generation.service.ts` (P2002-as-skip precedent), Prisma `create`/`updateMany` semantics (atomic conditional transition), csv-import partial-unique precedent.
- **Findings**: A two-step guard works without locks: (1) `INSERT … PENDING` — unique violation means another claimer owns the identity; (2) if the existing row is `FAILED` (or `PENDING` staler than a documented threshold, i.e. an earlier run crashed mid-send), an atomic `updateMany({ where: { identity, status: FAILED | stale-PENDING }, data: PENDING, attempt+1 })` with `count === 1` re-claims it; `count === 0` means someone else won.
- **Implications**: Status enum `PENDING → SENT | FAILED | SKIPPED` (SKIPPED = paid/disabled discovered at send time; terminal). `SENT` and `SKIPPED` are terminal; `FAILED` and stale `PENDING` are re-claimable. One attempt at a time per identity is guaranteed by the atomic transition; at-most-one *successful* send by the unique index + terminal states.

### Canonical target identity encoding (Requirements 1.7, 4.1)

- **Context**: The identity must be one uniqueness-indexable value spanning two target shapes (uuid vs uuid+cycle), while keeping referential integrity.
- **Findings**: Nullable typed columns alone cannot carry the unique index (Postgres treats NULLs as distinct → would need per-type partial indexes on every table). A single NOT NULL canonical `targetKey` string plus typed FK columns gives one total unique index **and** FK integrity.
- **Implications**: `targetKey` encoding: `txn:<transactionId>` (RECURRING_TRANSACTION) and `card:<creditCardId>:<invoiceCycle>` (CARD_INVOICE). Typed columns (`transactionId`, `creditCardId`, `invoiceCycle`) carry FKs and a per-type CHECK; `targetKey` is derived server-side only (never client-supplied as a string).

### Windows, schedule time, and catch-up

- **Context**: Requirements 1.2–1.5 leave the window set, cadence, and catch-up policy to design.
- **Findings**: Product steering asks for "a nudge before a bill is due, never spam". csv-import precedent: hard-coded documented constants over config.
- **Implications**: `REMINDER_WINDOWS_DAYS_BEFORE = [3, 0]` (D-3 and D-0). Cron daily at **12:00 UTC** (09:00 América/São Paulo — a civil reminder hour, and hours after the 01:00 UTC generation run so the current period's occurrences exist). Catch-up: a window fires only when `dueDate − window == today`; missed windows are silently skipped (mirrors generation's harmless-daily-rerun philosophy; R2 unaffected).

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
| ------ | ----------- | --------- | ------------------- | ----- |
| A — Extend recurring-bills/cards | Reminder logic inside existing feature modules | No new module | Couples two shipped features; violates feature-first structure | Rejected |
| B — New `reminders/` + `integrations/notifications/` (selected) | Dedicated feature module + provider port; three side tables | Clean boundaries; steering names both folders verbatim; ledger untouched | More files; cross-feature reads (by design, read-only) | Matches gap-analysis recommendation |
| C — Paid marker as ledger column | Option B but `paidAt` on `transactions` | Paid visible to future features | CHECK/source-protection rewrite; wrong granularity for derived invoices | Rejected for MVP; revisit if other features need paid status |

## Design Decisions

### Decision: Paid markers, settings, and deliveries live in reminders-owned side tables

- **Context**: Requirement 2.1/2.4 — paid state must not alter ledger financial fields or cross-source protection; card paid status is invoice-level.
- **Alternatives Considered**: (1) `paidAt` column on `transactions`; (2) side tables keyed by canonical target identity.
- **Selected Approach**: Three new tables — `reminder_settings`, `payment_markers`, `reminder_deliveries` — all owned by the reminders feature; the ledger schema is untouched except Prisma inverse-relation fields (no SQL change to existing tables).
- **Rationale**: Invoice-level paid state has no single ledger row to annotate; side tables avoid rewriting the four-source CHECK and keep shipped semantics frozen.
- **Trade-offs**: Paid status is invisible to other features until promoted; acceptable — no current consumer exists.
- **Follow-up**: Verify Prisma inverse relations don't alter existing migrations (schema-only relation fields).

### Decision: Paid = row presence in `payment_markers`; unmark deletes

- **Context**: Requirement 2.2/2.3 — idempotent mark/unmark.
- **Selected Approach**: Mark = idempotent upsert (`ON CONFLICT DO NOTHING` on `(userId, targetType, targetKey)`); unmark = idempotent delete. `paidAt` from `Clock`.
- **Rationale**: Presence-as-state removes a boolean + partial-index dance; both operations are naturally idempotent.
- **Trade-offs**: No paid/unpaid audit history (out of scope).

### Decision: Already-claimed windows never re-fire after unpaid→paid→unpaid flips

- **Context**: Requirement 2.3 leaves re-fire semantics to design.
- **Selected Approach**: `ReminderDelivery` rows are never deleted by paid-status changes; terminal states (`SENT`, `SKIPPED`) permanently consume the identity.
- **Rationale**: R2's "at most once" reads naturally as per-identity-forever; re-firing would surprise users (spam) more than a missed re-reminder.

### Decision: Provider selection via `NOTIFICATION_PROVIDER` env (default `log`); WhatsApp ships as an honest stub

- **Context**: Requirement 5.2/5.3 and refinement 5.
- **Selected Approach**: `NOTIFICATION_PROVIDER ∈ {log, whatsapp}` default `log`; `whatsapp` requires `WHATSAPP_API_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` (fail-fast zod superRefine, names-only errors). The stub returns `{ ok: false, errorCode: "WHATSAPP_NOT_IMPLEMENTED" }`.
- **Rationale**: Boots-without-credentials satisfied by the default; a stub returning success would fabricate `SENT` records — honest `FAILED` keeps the delivery ledger truthful and retriable when the real adapter lands.
- **Trade-offs**: Configuring `whatsapp` in the MVP yields daily bounded retries that always fail — explicit and documented, preferable to silent false success.

## Risks & Mitigations

- **R2 correctness under concurrency** — the claim transition is a single atomic `updateMany`/`create`; integration tests run overlapping evaluations and assert one `SENT` per identity.
- **Timezone drift in window math** — all arithmetic on `YYYY-MM-DD` strings anchored to UTC; the suite runs under `TZ=America/Sao_Paulo` (existing harness) with boundary unit tests (month ends, D-3 across months).
- **Stale `PENDING` rows from a crash mid-send** — re-claimable after `STALE_CLAIM_HOURS = 12` (one daily run later); documented residual risk: a send whose outcome was lost may be repeated once — accepted for reminders (vs. payments) and noted in design.
- **Invoice paid marker for a not-yet-complete cycle** — marking a cycle paid while later installments still post to it is user-visible behavior; documented (paid marker is per (card, cycle), covers the whole invoice as of any composition).

## References

- `.sdd/specs/due-date-reminders/gap-analysis.md` — asset map and option analysis this design builds on
- `apps/api/src/recurring-bills/generation.*` — scheduler/idempotent-batch precedents
- `apps/api/src/common/clock.ts` — port pattern named as the template for `NotificationProvider`
- `.sdd/steering/integrations.md` — provider abstraction rules (R7)
- Meta WhatsApp Cloud API (send message) — shape informing the port's contract; not integrated in the MVP
