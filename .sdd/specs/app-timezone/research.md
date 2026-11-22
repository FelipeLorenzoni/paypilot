# Research & Design Decisions

## Summary

- **Feature**: `app-timezone`
- **Discovery Scope**: Extension (cross-cutting change to existing date
  derivation; no new boundary, no schema or contract change)
- **Key Findings**:
  - Six call sites turn `Clock.now()` into a calendar value, all via UTC
    getters: `DashboardService` (`toDateString` + `monthOf`),
    `BillPaymentsService` (`toDateString`), `RemindersScheduler` and
    `remind.cli` (`toDateString`), `GenerationScheduler` and `generate.cli`
    (`deriveCurrentPeriod`).
  - `GenerationScheduler` uses `@Cron(CronExpression.EVERY_DAY_AT_1AM)` with no
    `timeZone`, i.e. the server's implicit zone — a pre-existing violation of
    `docs/conventions.md` ("never the server's implicit zone").
  - Node 24's built-in ICU (`Intl.DateTimeFormat` with `timeZone`) converts an
    instant to a calendar date in any IANA zone, DST included. No date library
    is needed.
  - `@Cron` options are static decorator arguments, evaluated at class load,
    before `@nestjs/config` loads `.env`; the timezone cannot come from the
    validated config there.

## Research Log

### Converting an instant to a business date without a dependency

- **Context**: Requirement 2 (one derivation; DST-correct; independent of
  process `TZ`).
- **Sources Consulted**: ECMA-402 `Intl.DateTimeFormat` (`timeZone`,
  `formatToParts`, `hourCycle`); local probe on Node v24.18.0.
- **Findings**:
  - `new Intl.DateTimeFormat("en-US", { timeZone, year, month, day, hour,
    hourCycle: "h23" }).formatToParts(instant)` yields the wall-clock parts in
    that zone; the result never depends on the process `TZ`.
  - An unknown name throws `RangeError` (`foo/bar` → error).
  - Accepted but not IANA names: offset strings (`+03:00`) are accepted by
    current V8; names are case-insensitive (`utc` → `UTC`); aliases resolve
    (`Asia/Kolkata` → `Asia/Calcutta`).
  - `Intl.supportedValuesOf("timeZone")` does not list `UTC` on this runtime,
    so it cannot be the sole validator (requirement 1.4 requires `UTC`).
- **Implications**: Validate with "constructor succeeds **and** the value is not
  an offset string". Build one formatter per zone and reuse it.

### Scheduling at a local hour

- **Context**: Requirements 5.2, 6.2, 6.3, 6.5.
- **Sources Consulted**: `@nestjs/schedule` 6.1.3 (`@Cron(expr, { timeZone })`,
  `SchedulerRegistry`); `apps/api/package.json`.
- **Findings**:
  - `@Cron(..., { timeZone })` needs the zone at decoration time — not
    available from the validated config.
  - A dynamic `CronJob` registered through `SchedulerRegistry` would need the
    `cron` package as a direct dependency (pnpm's strict layout does not expose
    transitive packages).
  - `GenerationService.generateForPeriod` makes one insert attempt per active
    bill and treats a unique violation as `skipped` (R3); repeated runs are
    harmless and cheap at MVP scale.
  - The reminder evaluation run retries FAILED/stale deliveries; running it
    more than once a day would change retry cadence.
- **Implications**: Keep static UTC crons on an hourly tick and decide in code,
  from the business calendar, whether this tick is the job's local hour.

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
| ------ | ----------- | --------- | ------------------- | ----- |
| A. Business calendar provider | One injectable wrapping `Clock` + configured zone; exposes `today()`, `month()`, `hour()` | Single source (2.1); tests keep overriding `CLOCK`; call sites become one-liners | One more global provider | Selected |
| B. Pure helper + config at each call site | `businessDate(clock.now(), config.timeZone)` everywhere | No new provider | Every caller injects `APP_CONFIG`; easy to forget one | Rejected |
| C. Wrap `Clock` itself (`now()` shifted) | Return a "local" `Date` | No caller change | Corrupts instants (`paidAt`, `sentAt` must stay UTC — 4.4) | Rejected |

## Design Decisions

### Decision: `APP_TIME_ZONE` in the validated config

- **Context**: Requirement 1.
- **Alternatives Considered**:
  1. A constant in code — no operator control.
  2. `TZ` of the process — exactly the implicit zone the convention forbids,
     and it would silently change every `Date` getter.
- **Selected Approach**: Optional `APP_TIME_ZONE`, default `America/Sao_Paulo`,
  validated in `env.schema.ts` `superRefine`; exposed as `AppConfig.timeZone`.
- **Rationale**: Follows the existing env/zod pattern; startup fails with the
  variable name only (security steering).
- **Trade-offs**: One zone for every user — per-user zones are a later spec.

### Decision: Hourly UTC tick with a local-hour gate

- **Context**: Requirements 5.2, 6.2, 6.3, 6.5; no new dependency.
- **Alternatives Considered**:
  1. `SchedulerRegistry` + `CronJob` with the configured zone — needs the
     `cron` package as a direct dependency.
  2. Read `process.env.APP_TIME_ZONE` at decoration time — bypasses
     validation and the `.env` loader.
- **Selected Approach**:
  - Generation: `@Cron("0 * * * *", { timeZone: "UTC" })`, every hour, no
    gate. The first tick of a new business month generates it, in any zone and
    across DST (6.3); later ticks are R3 no-ops.
  - Reminders: `@Cron("15 * * * *", { timeZone: "UTC" })`, gated to run only
    when the business hour is `REMINDER_LOCAL_HOUR` (9). Runs once per business
    day at 09:15 local (09:45 in half-hour zones), after that day's 00:00
    generation tick (6.5).
- **Rationale**: Static decorators stay static; the zone comes from validated
  config at run time; gate logic is a pure, unit-tested function.
- **Trade-offs**: 24 generation ticks a day instead of 1 (cheap, idempotent);
  generation logs are reduced to runs that create rows or fail, so the extra
  ticks do not flood the log.
- **Follow-up**: 09:00 is outside every IANA DST transition window, so the gate
  matches exactly once per business day.

### Decision: Delivery identity and stored dates unchanged

- **Context**: Requirements 4.5, 5.4, 7.1.
- **Selected Approach**: Only the *input* date changes. Delivery identity stays
  `(user, target, dueDate, window, channel)`; `paidOn` back-fill and existing
  rows are not touched; no migration.
- **Rationale**: A switch-over day can at worst evaluate the same business date
  twice (UTC run already done, local run again); R2's unique identity makes the
  second run a no-op, so nothing is re-sent.

## Risks & Mitigations

- **Existing unit tests assert UTC semantics** near midnight
  (`generation.helpers.spec.ts`, `month-range.spec.ts`) — rewrite them against
  the business calendar; integration suites already run with
  `TZ=America/Sao_Paulo` and noon-UTC fixed clocks, so their dates do not move.
- **Operator sets a wrong zone** — startup fails fast; documented default.
- **Half-hour / 45-minute offset zones** — the hourly tick lands at :15/:45
  local; the gate compares hours only, so it still fires once per day.

## References

- ECMA-402 — `Intl.DateTimeFormat` `timeZone` option and `formatToParts`.
- `@nestjs/schedule` — `@Cron` decorator options (`timeZone`).
- `docs/conventions.md` — Time section.
