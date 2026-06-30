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
