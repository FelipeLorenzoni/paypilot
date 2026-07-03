# PayPilot

Personal finance automation. Monorepo with a NestJS API (`apps/api`), a Next.js
web app (`apps/web`), and framework-agnostic shared contracts
(`packages/shared`).

## Prerequisites

- **Node.js 24 LTS** — run `nvm use` (reads `.nvmrc`) or install Node `>=24 <25`.
- **pnpm 11** — via Corepack: `corepack enable` (the exact version is pinned by
  `packageManager` in `package.json`).
- **Docker** — required for the local database and for the integration test
  suite (Testcontainers spins up an ephemeral PostgreSQL).

## Setup

```bash
corepack enable                 # activate the pinned pnpm
pnpm install                    # install all workspaces
cp .env.example .env            # local-dev defaults (not real secrets)
pnpm db:generate                # generate the Prisma client (it is git-ignored)
docker compose up -d            # start PostgreSQL
```

> The Prisma client is a generated build artifact and is **git-ignored**, so run
> `pnpm db:generate` after installing (and whenever the schema changes).

## Running the apps

```bash
pnpm --filter @paypilot/api dev   # NestJS API on http://localhost:3000 (/api/v1)
pnpm --filter @paypilot/web dev   # Next.js web app
```

Health checks: `GET /api/v1/health/live` (liveness) and
`GET /api/v1/health/ready` (readiness — 200 when the DB is reachable, 503 when not).

## Quality commands

```bash
pnpm test            # all workspace tests incl. integration (REQUIRES Docker)
pnpm test:unit       # unit + web tests only (no Docker)
pnpm --filter @paypilot/api test:integration   # integration only (Docker)
pnpm lint            # ESLint across the monorepo
pnpm format          # Prettier write
pnpm format:check    # Prettier check (CI-friendly)
pnpm type-check      # TypeScript across workspaces
pnpm build           # build all workspaces
```

## Environment variables

Configuration is loaded from the environment and validated at startup (the API
fails fast and reports the offending variable name — never its value). See
`.env.example` for the full list. Key variables:

| Variable                   | Used by      | Notes                                                                 |
| -------------------------- | ------------ | --------------------------------------------------------------------- |
| `DATABASE_URL`             | API (Prisma) | PostgreSQL connection string                                          |
| `PORT`                     | API          | HTTP port (default 3000)                                              |
| `NODE_ENV`                 | API          | `development` \| `test` \| `production`                               |
| `NEXT_PUBLIC_API_BASE_URL` | Web          | **Public** (inlined into the browser bundle) — never put secrets here |

Real `.env` files are git-ignored; only `.env.example` (names + non-secret
defaults) is committed.

### Auth (JWT)

| Variable         | Default  | Notes                                                                                                                                                         |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`     | _(none)_ | **Required.** ≥256 bits of entropy (base64/base64url). Generate: `openssl rand -base64 48`. Weak/placeholder values are rejected at startup in non-test envs. |
| `JWT_ACCESS_TTL` | `15m`    | Access-token lifetime; must be between `5m` and `1h`.                                                                                                         |

Rate limits (per client IP; windows parsed by `ms`; the in-memory limiter is
**non-production-grade** — a shared store is a future deployment concern):

| Variable                                         | Default      | Purpose                      |
| ------------------------------------------------ | ------------ | ---------------------------- |
| `AUTH_LOGIN_RATE_LIMIT_POINTS` / `..._WINDOW`    | `5` / `1m`   | Login attempts per IP        |
| `AUTH_REGISTER_RATE_LIMIT_POINTS` / `..._WINDOW` | `3` / `1m`   | Registration attempts per IP |
| `AUTH_DEFAULT_RATE_LIMIT_POINTS` / `..._WINDOW`  | `100` / `1m` | App-wide default per IP      |

**Auth endpoints:** `POST /api/v1/auth/register` (public), `POST /api/v1/auth/login`
(public), `GET /api/v1/auth/me` (requires `Authorization: Bearer <token>`).
For local development the defaults in `.env.example` work out of the box (set a
real `JWT_SECRET`).

### Expenses

Manual expense CRUD over a generic transaction ledger (all routes require
`Authorization: Bearer <token>`; every expense is owner-scoped):

- `POST /api/v1/expenses` — create (201)
- `GET /api/v1/expenses` — list (paginated: `page`, `pageSize` ≤ 100; inclusive `from`/`to` date filter)
- `GET /api/v1/expenses/:id` — fetch one (404 if not owned)
- `PATCH /api/v1/expenses/:id` — partial update of editable fields
- `DELETE /api/v1/expenses/:id` — hard delete (204)

Request/response notes: `amountMinor` is a **positive integer** in minor units
(JSON number, MVP); `currency` is uppercase **BRL** (MVP); `expenseDate` is a
`YYYY-MM-DD` string. Cross-user access returns 404 (no disclosure).

### Recurring bills

Recurring monthly bill definitions plus **idempotent** generation of ledger
transactions (all routes require `Authorization: Bearer <token>`; owner-scoped):

- `POST /api/v1/recurring-bills` — create (201)
- `GET /api/v1/recurring-bills` — list (paginated: `page`, `pageSize` ≤ 100;
  optional `active=true|false` filter — any other value is a 400)
- `GET /api/v1/recurring-bills/:id` — fetch one (404 if not owned)
- `PATCH /api/v1/recurring-bills/:id` — partial update of editable fields
- `DELETE /api/v1/recurring-bills/:id` — **deactivate** (`isActive=false`),
  returns 204; never hard-deletes and never removes already-generated
  transactions

Fields mirror expenses plus `dayOfMonth` (1–31, clamped to the last day of short
months at generation), `startDate`, and optional `endDate` (`YYYY-MM-DD`,
`endDate >= startDate`).

**Generation.** A monthly job creates one `source = RECURRING` ledger
transaction per eligible bill per period. It is idempotent at the database level
(unique `(recurringBillId, periodKey)`), so retries and overlapping runs produce
**exactly one** transaction per bill/period (financial-rules R3). Manual expense
endpoints only ever touch `source = MANUAL` rows.

- **Schedule:** an in-process cron (`@nestjs/schedule`) runs daily and derives
  the target period from the **UTC calendar month** (via the `Clock` port), not
  server-local time. This is **non-production-grade** (a multi-instance deploy
  may double-fire; that is safe only because DB idempotency is the source of
  truth). No Redis/BullMQ.
- **Manual run (ops/local):** `pnpm --filter @paypilot/api generate:recurring
2026-03` (omit the period to use the current UTC month). There is no public
  HTTP generation endpoint.

### Credit cards & invoices

Credit cards, card purchases (single and installment), and derived monthly
invoices (all routes require `Authorization: Bearer <token>`; owner-scoped):

- `POST /api/v1/credit-cards` — create (201); `label`, `closingDay`/`dueDay`
  (1–31), optional `creditLimitMinor` (non-negative minor units; no
  available-limit enforcement in this spec)
- `GET /api/v1/credit-cards` — list (paginated; optional `active=true|false`)
- `GET /api/v1/credit-cards/:id` · `PATCH /api/v1/credit-cards/:id`
- `DELETE /api/v1/credit-cards/:id` — **deactivate** (`isActive=false`), 204;
  never hard-deletes and preserves generated transactions
- `POST /api/v1/credit-cards/:cardId/purchases` — record a purchase (201).
  Requires an `idempotencyKey`; `installments` is `1..24`
- `GET /api/v1/credit-cards/:cardId/invoices/:cycle` — the invoice for a
  `YYYY-MM` cycle (transactions + exact total + due date)

Card transactions use `source = CARD`; this spec does **not** support editing or
deleting them after creation (refund/chargeback/adjustment are future specs).

- **Invoice assignment (R4):** a purchase on or before the card's closing day
  lands on the current cycle; after it, the next cycle. `invoiceCycle` is the
  **closing month** (`YYYY-MM`); the due date is derived from the due day and may
  roll to the following month. Short months and year rollover are handled.
- **Installments (R5):** `N` installments over `N` consecutive cycles; amounts
  sum exactly to the total (residual cents on the first installment).
- **Idempotency (R13):** purchase creation is idempotent per
  `(user, idempotencyKey)` and atomic (all `N` rows or none). A retry with the
  same payload returns the existing purchase; the same key with a divergent
  payload or a different card returns **409**.

### CSV import

Bulk-import expense transactions from a bank/card statement CSV (all routes
require `Authorization: Bearer <token>`; owner-scoped):

- `POST /api/v1/imports` — multipart upload (field `file`), returns a 201
  summary: `{ importRunId, totalRows, importedCount, duplicateCount,
invalidCount, invalidRows[{ lineNumber, reasonCode }], duplicateRows }`
- `GET /api/v1/imports/:id` — the import run (status + counts; 404 if not owned)

**CSV schema (fixed, MVP).** UTF-8, header row required. Columns: **`date`**
(`YYYY-MM-DD`), **`amount`**, **`description`** (required) plus optional
`category` and `currency` (uppercase **BRL** only; defaults to BRL when
absent). Both `,` and `;` delimiters are supported (detected from the header
line). Amounts accept **dot-decimal** (`1234.56`) and **Brazilian**
(`1.234,56`) forms — under the `,` delimiter a comma-bearing amount must be
RFC-4180 quoted (`"1.234,56"`). Limits: **1 MiB** / **5000 rows** per file
(oversized → 413/400, nothing persisted).

Imported rows land in the ledger as `source = IMPORTED` (`type = EXPENSE` —
**expenses only** in the MVP; no editing or deleting of imported rows). A
structurally invalid file (bad header, malformed CSV) is rejected whole with
nothing persisted; invalid **rows** never abort the import — they are reported
in `invalidRows` with a stable `reasonCode` (`INVALID_DATE`,
`INVALID_AMOUNT_FORMAT`, `NON_POSITIVE_AMOUNT`, `UNSUPPORTED_CURRENCY`,
`MISSING_FIELD`, `FIELD_TOO_LONG`).

**Dedup (R6).** A row matching an already-imported row on
(date, amount, normalized description) is skipped, not duplicated — per-user,
against **imported** rows only, guaranteed at the database by a partial unique
index on `(userId, dedupHash)`; re-importing the same file inserts zero new
rows and concurrent imports converge. `importedCount`/`duplicateCount` are
DB-derived (`duplicateRows` line numbers are best-effort/informational).

### Due-date reminders

Proactive WhatsApp reminders for upcoming/same-day due dates of **unpaid**
bills — generated recurring occurrences (`source = RECURRING`) and credit-card
invoices (per card + cycle). Opt-in per user; all routes require
`Authorization: Bearer <token>`:

- `GET /api/v1/reminders/settings` — `{ phoneE164, enabled }` (defaults:
  `null` / `false` — reminders are opt-in)
- `PUT /api/v1/reminders/settings` — set the E.164 WhatsApp destination and
  the enabled flag (invalid phone → 400)
- `PUT /api/v1/reminders/paid` — mark/unmark an item paid (idempotent both
  ways): `{ targetType: "RECURRING_TRANSACTION", transactionId, paid }` or
  `{ targetType: "CARD_INVOICE", creditCardId, invoiceCycle, paid }`. Card
  paid status is **invoice-level** (one marker covers the whole cycle).
  Unknown/unowned/non-eligible targets → 404.

**Windows & schedule.** A daily in-process job (12:00 UTC — 09:00 América/São
Paulo; `pnpm --filter @paypilot/api remind:run [YYYY-MM-DD]` for manual runs)
evaluates windows **D-3** and **D-0** against the UTC calendar date. A missed
window is skipped silently (no stale reminders). Paid items are excluded at
selection **and** re-checked immediately before sending (R1) — marking paid
stops reminders; unmarking re-enables only windows not yet consumed (a
`SENT`/`SKIPPED` identity never re-fires).

**Delivery guarantee (R2).** At most one successful **recorded** delivery per
`(user, target, dueDate, window, channel)`, enforced by a DB unique index with
claim-before-send; retries after provider failures and concurrent/overlapping
runs converge to a single send. True exactly-once **external** delivery is out
of scope in this MVP: the default provider is the fake/log one
(`NOTIFICATION_PROVIDER=log`, no credentials, no real messages), and the
WhatsApp provider is a config-gated **stub** (`NOTIFICATION_PROVIDER=whatsapp`

- `WHATSAPP_API_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID`) that honestly records
  failures instead of sending — the real Cloud-API adapter (with provider
  idempotency/delivery confirmation) arrives in a future spec. Reminders never
  mutate ledger transactions.

## Dependency & supply-chain policy

Dependencies are pinned and hardened (see `docs/supply-chain.md` for the full
policy and verification). When adding a dependency:

- **Save exact versions.** `savePrefix: ""` is configured, so `pnpm add <pkg>`
  pins an exact version (no `^`/`~`). Do not hand-edit ranges back in.
- **Review the lockfile.** `pnpm-lock.yaml` is the trusted source of truth; any
  change to it must be reviewed intentionally. CI uses `pnpm install --frozen-lockfile`
  (`pnpm install:ci`).
- **Approve build scripts explicitly.** Dependency lifecycle/build scripts do not
  run unless listed under `allowBuilds` in `pnpm-workspace.yaml`. If a new package
  needs one, run `pnpm approve-builds` (`pnpm security:approve-builds`) and record
  the decision.
- **Audit.** Run `pnpm security:audit` (high) / `pnpm security:audit:prod`.
  Unresolved high/critical findings require a documented exception in
  `docs/supply-chain.md` (prefer upgrading/removing the dependency first).

Automated dependency-update tooling (Renovate/Dependabot) is intentionally **not**
part of this foundation.

## Conventions

Money and time modeling conventions (binding for all features) are documented in
`docs/conventions.md`.
