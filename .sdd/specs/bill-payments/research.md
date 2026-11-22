# Research & Design Decisions — bill-payments

## Summary

- **Feature**: `bill-payments`
- **Discovery Scope**: Extension (light discovery). Paid state already exists
  as the reminders-owned `payment_markers` table plus `PUT /reminders/paid`;
  `monthly-dashboard` already reads it. This spec promotes it to a product
  concept, adds a payment date, a product-level endpoint and the UI actions.
- **Key Findings**:
  1. `payment_markers` already has the right identity and isolation:
     `@@unique([userId, targetType, targetKey])`, typed FK columns, and
     server-derived keys from `reminders/domain/reminder-target.ts`. Reusing it
     satisfies 1.1, 1.2, 1.3 and 1.6 with no data move.
  2. The table has no **payment date**: `paidAt` is the instant the marker was
     written (`Clock.now()` in `PaidStatusService`). Requirement 2.3 (back-dated
     payment) needs a date that can differ from the recording instant.
  3. The owned-target resolution (`RemindersRepository.resolveOwnedTarget`)
     and the mark/unmark logic (`PaidStatusService`) already implement 2.1,
     2.6, 3.1, 3.2 and 4.2–4.5; they live in the reminders feature.
  4. `PaidStatusService` uses Prisma `upsert` with `update: {}`. Two
     simultaneous first marks can still race on the unique index (P2002);
     the repo already reconciles P2002 elsewhere (`generation.service.ts`,
     `purchases.service.ts`, `reminder-delivery.store.ts`).
  5. The web `useApiQuery` hook exposes `retry` only in the error state, and a
     dependency change resets the page to `loading`. Requirement 6.5 (refresh
     after a mark) would therefore flash the whole dashboard and lose focus.

## Research Log

### Payment date vs recording instant

- **Context**: 1.4 asks for both the payment date and the recording instant;
  2.2/2.3 let the user keep today or choose an earlier date.
- **Sources Consulted**: `apps/api/prisma/schema.prisma` (`PaymentMarker`),
  `reminders/paid-status.service.ts`, `dashboard/dashboard.repository.ts`
  (reads `paidAt`), migration `20260703043000_add_reminders`.
- **Findings**: `paidAt` is `timestamptz`, always `Clock.now()`, and is part of
  the `PUT /reminders/paid` response (`paidAt: ISO instant`). `createdAt` and
  `updatedAt` also exist.
- **Implications**: A date-only `paidOn` column is the honest model (the
  steering forbids timezone-shifting date-only values). `paidAt` keeps its
  current meaning, so `PUT /reminders/paid` stays byte-for-byte compatible
  (7.3).

### Ownership of the paid-state logic

- **Context**: The goal is a product-level concept, not a reminder marker.
- **Sources Consulted**: `reminders.module.ts`, `reminders.controller.ts`,
  `reminders.repository.ts`, `reminder-evaluation.service.ts` (uses
  `repo.isPaid` at send time).
- **Findings**: Only two callers write markers (`PaidStatusService`) and two
  read them (`RemindersRepository.findDueItems`/`isPaid`,
  `DashboardRepository.findPaidKeys`). Reads are by `(userId, targetType,
  targetKey)` and never depend on who wrote the row.
- **Implications**: Move write ownership to a new `bill-payments` module and
  make `PaidStatusService` a thin adapter over it. Reminder reads keep working
  untouched (7.1, 7.2, 7.4).

### Concurrent first marks

- **Context**: 8.3 requires exactly one record under two simultaneous marks.
- **Sources Consulted**: `generation.service.ts` (`PRISMA_UNIQUE_VIOLATION`),
  `purchases.service.ts`.
- **Findings**: The established pattern is "attempt the write, catch P2002,
  re-read the winner".
- **Implications**: `create` + catch P2002 + `findUnique` gives the same
  outcome as upsert without depending on whether Prisma issues a native
  `ON CONFLICT`. Verified by an integration test with two parallel requests.

### Refreshing the dashboard after a mark

- **Context**: 6.5 refresh from the backend; 6.6 keep the previous state on
  failure; 6.7 keyboard and focus.
- **Sources Consulted**: `apps/web/src/lib/api/hooks.ts`,
  `features/reminders/reminders-page.tsx` (mutation usage).
- **Findings**: No silent refetch exists. Re-keying deps sets `loading`.
- **Implications**: Add a `refresh()` to the hook's `loaded` state that
  refetches and swaps data in place, keeping the current data on failure.
  Additive: existing pages ignore it.

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
| ------ | ----------- | --------- | ------------------- | ----- |
| A — Endpoint only | Add `PUT /bill-payments` calling `PaidStatusService` | Smallest diff | Paid logic stays reminder-owned; no payment date | Fails the spec goal |
| B — New owner module over the same table | `bill-payments` owns writes + target resolution; reminders delegate; add `paidOn` | Product-level ownership, one store, compatible | One migration; touches reminders wiring | **Selected** |
| C — New `payments` table | Separate product table, migrate markers | Clean slate | Data migration, dual-read period, R1 risk during cut-over | Rejected |

## Design Decisions

### D1 — Reuse `payment_markers`; `bill-payments` owns writes

- **Context**: 1.1–1.6, 7.x.
- **Alternatives Considered**: A, B, C above.
- **Selected Approach**: B. `BillPaymentsRepository` (owned-target resolution,
  create/delete, P2002 reconciliation) and `BillPaymentsService` (paid-date
  rules, clock). `PaidStatusService` delegates and keeps its response shape.
  The pure identity helpers stay in `reminders/domain/reminder-target.ts`,
  imported cross-feature as `monthly-dashboard` already does.
- **Rationale**: One store and one identity means reminders, dashboard and the
  new endpoint can never disagree (1.1, 7.1). No data move (1.6).
- **Trade-offs**: The identity helpers keep a reminders path; moving them to
  `common/` is cosmetic and would touch tested reminder code for no behaviour.
- **Follow-up**: A later cleanup may relocate `reminder-target.ts`.

### D2 — Payment date is a new `paidOn DATE` column

- **Context**: 1.4, 2.2–2.5, 5.1, 5.3.
- **Alternatives Considered**:
  1. Store the chosen date in `paidAt` at 00:00Z — changes the meaning of an
     existing field returned by `PUT /reminders/paid` (breaks 7.3).
  2. Use `createdAt` as recording instant and repurpose `paidAt` — same break.
  3. New `paidOn DATE NOT NULL`, back-filled from `paidAt` (UTC date).
- **Selected Approach**: 3. Migration `add_payment_date`: add nullable column,
  back-fill `("paidAt" AT TIME ZONE 'UTC')::date`, set `NOT NULL`.
- **Rationale**: Date-only values stay date-only end to end (steering); the
  recording instant keeps its meaning.
- **Trade-offs**: One migration on a small reminders-era table.

### D3 — One idempotent `PUT /bill-payments`

- **Context**: 2.x, 3.x, 4.x.
- **Selected Approach**: `PUT /api/v1/bill-payments` with
  `{ targetType, transactionId? | creditCardId? + invoiceCycle?, paid, paidOn? }`,
  mirroring `PUT /reminders/paid`. `paidOn` is only allowed with `paid: true`.
  Re-marking keeps the original record (2.6); changing a date is unmark + mark.
- **Rationale**: Same validated-parts identity as today (4.5); PUT semantics
  match idempotency (2.6, 3.2).
- **Trade-offs**: No "edit payment date" action in the MVP.

### D4 — Future-date rule lives in the service, against the injected clock

- **Context**: 2.4, 8.5.
- **Selected Approach**: The DTO validates the `YYYY-MM-DD` shape; the service
  compares `paidOn <= today` where `today = toDateString(clock.now())`.
- **Rationale**: Validators cannot see the injected clock.

### D5 — Additive contract changes

- **Context**: 5.1, 5.3.
- **Selected Approach**: `DueItemView` gains `paidOn: string | null`; the shared
  `InvoiceView` gains `paid: boolean` and `paidOn: string | null`; new shared
  `SetBillPaymentRequest` and `BillPaymentView`. Existing fields are unchanged.

### D6 — Silent `refresh()` in `useApiQuery`

- **Context**: 6.4–6.6.
- **Selected Approach**: In the `loaded` state the hook also returns
  `refresh(): Promise<boolean>`, which refetches and replaces `data` only on
  success. Mark/undo buttons await it, so status, totals and order all come
  from the backend (5.4, 6.5) without a loading flash.

## Risks & Mitigations

- **Migration on a live table** — small table, additive column with back-fill
  in one transaction; integration tests run migrations from scratch.
- **R1 regression** — reminders' read path is untouched; an integration test
  marks through `PUT /bill-payments` and asserts no reminder is sent.
- **Concurrent marks** — P2002 reconciliation plus a parallel-request test.
- **Back-dated date earlier than the occurrence** — allowed in the MVP (a user
  may prepay); no lower bound is specified by the requirements.

## References

- `.sdd/specs/due-date-reminders/design.md` — marker semantics and R1.
- `.sdd/specs/monthly-dashboard/research.md` D9 — why unmarked payments show
  as overdue until this spec.
- `.sdd/steering/financial-rules.md` — R1, money and time handling.
