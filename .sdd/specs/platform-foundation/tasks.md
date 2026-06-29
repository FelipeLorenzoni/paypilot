# Implementation Plan — Executor-Grade

> Scope: scaffolding and technical baseline only. **No** business features, JWT/auth, WhatsApp/provider implementation, jobs infrastructure, CI pipeline files, E2E framework, or production deployment setup. These constraints apply to every task below.
> `(P)` marks tasks that can run in parallel (independent workspaces/files). Each task ends with `_Requirements: <ids>_` referencing `requirements.md`.
> Conventions used in Deliverables: `apps/api` = NestJS backend, `apps/web` = Next.js frontend, `packages/shared` = framework-agnostic shared package.

---

## 1. Monorepo and workspace foundation

- [x] 1.1 Initialize the pnpm + Turborepo monorepo

  **Goal**
  Establish a single-install monorepo with pinned runtime and package manager.

  **Deliverables**
  - Root `package.json` (private) with workspace metadata, `packageManager: "pnpm@11.9.0"`, `engines.node: ">=24 <25"`, `engines.pnpm: ">=11 <12"`.
  - `pnpm-workspace.yaml` with `packages: ["apps/*", "packages/*"]`.
  - `.nvmrc` containing `24`.
  - `turbo.json` configured for local caching only (no `remoteCache`/signature, no tokens).
  - Empty `apps/` and `packages/` directories; if they must be committed before any workspace exists, include `.gitkeep` placeholders (Git does not track empty directories).

  **Implementation notes**
  - Local caching only — must not reference Vercel/Turbo remote-cache credentials (design Resolved Decision 2).
  - Do not add app code yet; this task is workspace plumbing.

  **Acceptance criteria**
  - `pnpm install` from the root succeeds and resolves all workspaces.
  - `node -v` satisfies `>=24 <25`; `pnpm -v` is `11.9.0`.

  **Verification**
  - `pnpm install` → completes without errors.
  - `pnpm -v` → `11.9.0`; `cat .nvmrc` → `24`.

  **Out of scope**
  - App/source code, lint/test config, Docker, Prisma.

  _Requirements: 1.1, 1.4_

- [x] 1.2 Establish shared strict TypeScript configuration

  **Goal**
  Provide one strict TS baseline extended by every workspace.

  **Deliverables**
  - `packages/tsconfig` (or root `tsconfig.base.json`) with `strict: true`, `noUncheckedIndexedAccess`, `esModuleInterop`, modern `module`/`target`.
  - Each app/package `tsconfig.json` extends the base.

  **Implementation notes**
  - The base config is created **now**; each workspace `tsconfig.json` must `extend` it **when that workspace is introduced** — `packages/shared` (task 1.3), `apps/api` (task 4.1), and `apps/web` (task 7.1). No workspace tsconfigs are created in this task beyond the base.
  - No `any` allowed in domain/financial code (steering `tech.md`).
  - Keep base config framework-neutral; app-specific options live in each app's tsconfig.

  **Acceptance criteria**
  - A deliberate type error in any workspace fails `tsc --noEmit`.

  **Verification**
  - `pnpm -r exec tsc --noEmit` → passes on clean tree.

  **Out of scope**
  - ESLint/Prettier rules (task 1.4).

  _Requirements: 1.5_

- [x] 1.3 Build the framework-agnostic shared package

  **Goal**
  Create `packages/shared` holding pure TS contracts and the `Money` value object.

  **Deliverables**
  - `packages/shared` package with build/types output.
  - `Money` value object: `{ amountMinor: number; currency: string }`; factory validates integer + `Number.isSafeInteger`, rejects otherwise.
  - Canonical error `code` enum (e.g. `VALIDATION_ERROR`, `INTERNAL_ERROR`) and the `ErrorResponse` type.
  - At least one unit test for `Money` validation.

  **Implementation notes**
  - MUST NOT import NestJS, Next.js, Prisma, or infrastructure libraries (design `packages/shared` constraints).
  - Pure functions only; no side effects; safe to import from Node and browser.

  **Acceptance criteria**
  - `Money` factory throws on non-integer / unsafe-integer input and accepts valid values.
  - Package contains no disallowed imports.

  **Verification**
  - `pnpm --filter @paypilot/shared test` → Money tests pass.

  **Out of scope**
  - Domain entities, persistence, currency conversion logic.

  _Requirements: 1.2, 1.3, 4.4_

- [x] 1.4 Configure linting, formatting, and the shared-boundary rule

  **Goal**
  Uniform lint/format across workspaces plus enforcement of the shared boundary.

  **Deliverables**
  - Shared ESLint flat config and Prettier config at the root.
  - Root scripts: `lint`, `format`, `format:check`.
  - A lint rule (e.g. `no-restricted-imports`) forbidding NestJS/Next.js/Prisma/infra imports inside `packages/shared`.

  **Implementation notes**
  - `lint` and `format:check` must exit non-zero on violations.

  **Acceptance criteria**
  - Introducing a disallowed import into `packages/shared` fails `pnpm lint`.
  - An unformatted file fails `pnpm format:check`.

  **Verification**
  - `pnpm lint` → exit 0 on clean tree, non-zero with a planted violation.
  - `pnpm format:check` → exit 0 on clean tree.

  **Out of scope**
  - Turborepo pipeline wiring (task 1.5).

  _Requirements: 9.1, 9.2, 9.3, 1.3_

- [x] 1.5 Wire the Turborepo task pipeline

  **Goal**
  Single root commands fan out to all workspaces.

  **Deliverables**
  - `turbo.json` pipelines for `lint`, `test`, `format:check`, `build`.
  - Root scripts `lint`/`test`/`build` delegating to `turbo run ...`.

  **Implementation notes**
  - Web `test` (Vitest) and api/shared `test` (Jest) are both aggregated by `turbo run test` (task 8.3 finalizes web).

  **Acceptance criteria**
  - `pnpm test`/`pnpm lint`/`pnpm build` invoke every workspace's corresponding task.

  **Verification**
  - `pnpm lint` and `pnpm build` → run across all workspaces (even if some are no-ops initially).

  **Out of scope**
  - Test contents (tasks 8.x).

  _Requirements: 1.4, 9.1_

---

## 2. Dependency and supply-chain security

- [x] 2.1 Apply and verify pnpm hardening configuration

  **Goal**
  Harden dependency resolution and prove the pinned pnpm honors each control.

  **Deliverables**
  - `pnpm-workspace.yaml` additions: `savePrefix: ""`, `minimumReleaseAge: 1440`, `blockExoticSubdeps: true`, `auditLevel: high`, and an `allowBuilds` list for approved build scripts. `allowBuilds` MAY start empty if no current dependency requires an approved build script; the approval mechanism (`pnpm approve-builds`) must still be documented and used whenever a package later needs one.
  - Committed `pnpm-lock.yaml`.
  - A short `docs/supply-chain.md` (or README section) recording the verification result of each hardening key.

  **Implementation notes**
  - **Package-manager resolution check (do first):** confirm the exact `pnpm@11.9.0` resolves through Corepack / the npm registry before committing it. (Pre-verified: `https://registry.npmjs.org/pnpm/11.9.0` returns a valid manifest + tarball.) If a future re-pin does not resolve, select a valid exact pnpm 11 version and update the design and these tasks accordingly.
  - Acceptance gate: explicitly confirm pnpm 11.9.0 **recognizes and honors** `savePrefix`, `minimumReleaseAge`, `blockExoticSubdeps`, `allowBuilds`. If any key is unsupported/ignored, STOP and revise the design before continuing (design acceptance criterion; R11.4).
  - Direct deps are saved exactly (no `^`/`~`).

  **Acceptance criteria**
  - `corepack prepare pnpm@11.9.0 --activate` (or registry lookup) confirms the version resolves.
  - Adding a dependency writes an exact version (no range) to `package.json`.
  - Each of the four hardening keys is verified as recognized + honored, with method and result recorded in `docs/supply-chain.md`.

  **Verification**
  - `corepack prepare pnpm@11.9.0 --activate` → succeeds (version resolvable).
  - **Deterministic key check:** inspect the effective configuration (e.g. `pnpm config list` / parsed `pnpm-workspace.yaml`) to confirm pnpm 11.9.0 recognizes and applies each of `savePrefix`, `minimumReleaseAge`, `blockExoticSubdeps`, `allowBuilds` (an unknown/ignored key surfaces as absent from effective settings). Record the exact check used and its result in `docs/supply-chain.md`.
  - Add a throwaway dep with `pnpm add <pkg>` → recorded without `^`/`~`; then remove it.

  **Out of scope**
  - CI pipeline files; automated update tooling (Renovate/Dependabot).

  _Requirements: 11.1, 11.2, 11.3, 11.4, 11.6_

- [x] 2.2 Add reproducible install and audit scripts

  **Goal**
  Provide CI-ready dependency scripts without any pipeline file.

  **Deliverables**
  - Root scripts: `install:ci` (`pnpm install --frozen-lockfile`), `security:audit` (`pnpm audit --audit-level high`), `security:audit:prod` (`pnpm audit --prod --audit-level high`), `security:approve-builds` (`pnpm approve-builds`).

  **Implementation notes**
  - Scripts are for local + future-CI reuse; do not create workflow files.

  **Acceptance criteria**
  - `pnpm install --frozen-lockfile` succeeds against the committed lockfile.
  - Audit scripts run and return a meaningful exit status.

  **Verification**
  - `pnpm install:ci` → succeeds, lockfile unchanged.
  - `pnpm security:audit` → executes (exit 0 if no high vulns).

  **Out of scope**
  - GitHub Actions / GitLab CI / Vercel CI definitions.

  _Requirements: 11.2, 11.5_

---

## 3. Local development environment with Docker Compose

- [x] 3.1 (P) Provision PostgreSQL via Docker Compose

  **Goal**
  One command brings up a local PostgreSQL.

  **Deliverables**
  - `docker-compose.yml` with a single `postgres` service (pinned image, healthcheck, named volume, port mapping).
  - No Redis or jobs-backend service.

  **Implementation notes**
  - Must start without any real external provider credentials (R5.4).
  - Use Postgres env vars from the local `.env` (names only in `.env.example`).

  **Acceptance criteria**
  - `docker compose up -d` starts a healthy Postgres container.

  **Verification**
  - `docker compose up -d` then `docker compose ps` → postgres `healthy`.

  **Out of scope**
  - Redis/BullMQ/cron services; app containers.

  _Requirements: 5.1, 5.2, 5.4_

- [x] 3.2 Document local connection configuration

  **Goal**
  Make it clear how the apps connect to the provisioned database.

  **Deliverables**
  - `.env.example` entries (names only) for `DATABASE_URL` and related vars.
  - README snippet describing the compose-based dev flow.

  **Implementation notes**
  - No secret values committed; example values are placeholders.

  **Acceptance criteria**
  - Following the documented steps, the API can reach Postgres locally.

  **Verification**
  - With compose up and `.env` set, the API readiness check (task 6.2) reports DB reachable.

  **Out of scope**
  - Production/staging configuration.

  _Requirements: 5.3_

---

## 4. NestJS API baseline and global infrastructure

- [x] 4.1 Bootstrap the API with versioned routing and module structure

  **Goal**
  A bootable NestJS server with global prefix + URI versioning.

  **Deliverables**
  - `apps/api` NestJS project; `main.ts` with `setGlobalPrefix('api')` + URI versioning (default `v1`).
  - Root `AppModule` and a feature-module folder convention under `apps/api/src/<feature>/`.
  - `apps/api` `start`/`dev` scripts.

  **Implementation notes**
  - All future endpoints live under `/api/v1` (R2.7).
  - No business endpoints — only the module skeleton.

  **Acceptance criteria**
  - API starts and listens on the configured port; routes resolve under `/api/v1`.

  **Verification**
  - `pnpm --filter @paypilot/api dev` → server boots on configured port.

  **Out of scope**
  - Business controllers/services; validation/error filter (task 4.4).

  _Requirements: 2.1, 2.2, 2.7_

- [x] 4.2 Implement validated environment configuration

  **Goal**
  Fail-fast, typed configuration from the environment.

  **Deliverables**
  - `ConfigModule` using a schema (Zod) validating env at startup; typed, frozen `AppConfig`.
  - `.env.example` with required names (`DATABASE_URL`, `PORT`, ...) and no values; real `.env` git-ignored.

  **Implementation notes**
  - On missing/invalid required var: abort boot and report the variable **name**, never its value (R6.3, security steering).
  - Code reads config through `AppConfig`, not `process.env`.

  **Acceptance criteria**
  - Valid env → app boots; missing required var → process exits non-zero with the offending name (no value leaked).

  **Verification**
  - Start with a required var unset → boot fails fast, logs the name only.
  - Start with valid env → boot succeeds.

  **Out of scope**
  - Web env config (task 7.2); secrets management beyond `.env`.

  _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 4.3 Add request-id correlation

  **Goal**
  Stable per-request correlation id available to logs and the exception filter.

  **Deliverables**
  - Request-id middleware: use incoming `x-request-id` if present, else generate a UUID v4.
  - Request id attached to request context, included in request logs, and echoed on the `x-request-id` response header.

  **Implementation notes**
  - The exception filter (task 4.4) MUST be able to read this id for `ErrorResponse.requestId`.
  - Do NOT introduce OpenTelemetry or any external logging/telemetry infrastructure in this spec — Nest's built-in logger is sufficient.

  **Acceptance criteria**
  - A request with `x-request-id` echoes the same id; a request without one receives a generated UUID v4 echoed back.
  - The id appears in the corresponding log line and in error responses.

  **Verification**
  - `curl -i -H 'x-request-id: abc' .../api/v1/health/live` → response header `x-request-id: abc`.
  - `curl -i .../api/v1/health/live` → response header contains a UUID v4.

  **Out of scope**
  - Distributed tracing, log shipping, metrics backends.

  _Requirements: 2.5, 2.6_

- [x] 4.4 Add global validation and canonical error handling

  **Goal**
  Global request validation and a single canonical error envelope.

  **Deliverables**
  - Global `ValidationPipe` (whitelist + forbidNonWhitelisted, transform).
  - Global `AllExceptionsFilter` producing `ErrorResponse` (code, message, requestId, timestamp, optional validation `details`).

  **Implementation notes**
  - 4xx for validation; 5xx for unhandled errors with a generic, secret-free message (no stack traces).
  - Reuse the error `code` enum / `ErrorResponse` from `packages/shared` (task 1.3).
  - Configure global infrastructure only — do NOT add a production business endpoint to exercise it.

  **Acceptance criteria**
  - Invalid payloads return 400 `VALIDATION_ERROR` with field details; unhandled errors return 500 `INTERNAL_ERROR` with no internal detail; both include the request id.

  **Verification**
  - Covered by integration tests in task 8.2 (using a test-only controller).

  **Out of scope**
  - Business-rule (422/409) mappings; business endpoints.

  _Requirements: 2.3, 2.4, 2.5, 2.6_

---

## 5. PostgreSQL and Prisma integration

- [x] 5.1 Set up Prisma with explicit client generation (no business models)

  **Goal**
  Migration-driven Prisma wired with the `prisma-client` generator.

  **Deliverables**
  - `apps/api/prisma/schema.prisma` with datasource (PostgreSQL) and `generator client { provider = "prisma-client"; output = "../src/generated/prisma" }`.
  - `.gitignore` entry for the generated client folder.
  - Root `db:generate` script; `postinstall` hook running generate.
  - The migration mechanism ready to use (Prisma migrate configured), with **no business models** defined. Do **not** create a fake or placeholder migration just to satisfy the foundation; instead document the migration strategy (how/when migrations are created) and keep all business models out of scope for this spec.

  **Implementation notes**
  - The generated client is a **build artifact** — never hand-edited, not committed.
  - `db:generate` MUST succeed; the `postinstall` generate step MUST NOT require a live database connection (generation reads the schema only).
  - **Postinstall caveat:** keep `postinstall` only if it does not destabilize the first/clean workspace install (e.g. ordering or missing-schema issues). If `postinstall` proves problematic, STOP and propose switching to an explicit setup flow (`db:generate` run manually / via a `setup` script) before changing the design — do not silently work around it.
  - No domain tables in this spec — only datasource/generator/migration plumbing.

  **Acceptance criteria**
  - `pnpm db:generate` produces a usable client at the configured output path.
  - A fresh `pnpm install` (with no DB running) completes (generate does not need a DB).

  **Verification**
  - `pnpm db:generate` → client generated, no errors.
  - With Docker/Postgres stopped, `pnpm install` → succeeds.

  **Out of scope**
  - Any business model/table; seeding; query helpers.

  _Requirements: 4.1, 4.2_

- [x] 5.2 Provide an injectable PrismaService

  **Goal**
  Managed Prisma lifecycle plus a readiness ping.

  **Deliverables**
  - `PrismaService` (Nest provider) connecting on module init, disconnecting on shutdown, with `isHealthy()` running `SELECT 1`.

  **Implementation notes**
  - All data access goes through this service; imports `PrismaClient` from the generated output path.

  **Acceptance criteria**
  - Service connects against a real Postgres and `isHealthy()` returns true; resolves false when DB is down.

  **Verification**
  - Covered by integration test in task 8.2.

  **Out of scope**
  - Repositories/business queries.

  _Requirements: 4.1, 4.3, 7.2_

- [x] 5.3 Codify money and time modeling conventions

  **Goal**
  Make the money/time conventions authoritative and discoverable.

  **Deliverables**
  - A conventions doc (README section or `docs/conventions.md`) stating: money as BIGINT minor units + currency (no floating point); instants as UTC `timestamptz`; due dates/reference months as date-only; explicit UTC/local-date strategy.

  **Implementation notes**
  - Conventions are enforced in code by the shared `Money` (task 1.3) and the injected `Clock` (task 8.1); this task records the rules future specs follow (R4.6).

  **Acceptance criteria**
  - Doc explicitly covers money type, instant storage, calendar-date storage, and UTC/local strategy.

  **Verification**
  - Manual review against R4.4–R4.6.

  **Out of scope**
  - Implementing any money/date business logic.

  _Requirements: 4.4, 4.5, 4.6_

---

## 6. Health checks

- [x] 6.1 Implement the liveness endpoint

  **Goal**
  Dependency-free liveness probe.

  **Deliverables**
  - `GET /api/v1/health/live` (via `@nestjs/terminus`) returning `200 { status: "up" }`.

  **Implementation notes**
  - Performs no dependency checks so it stays green during transient DB blips.

  **Acceptance criteria**
  - Returns 200 whenever the process is running.

  **Verification**
  - `curl -s -o /dev/null -w "%{http_code}" .../api/v1/health/live` → `200`.

  **Out of scope**
  - DB/readiness checks.

  _Requirements: 7.1_

- [x] 6.2 Implement the readiness endpoint

  **Goal**
  Readiness reflects database reachability.

  **Deliverables**
  - `GET /api/v1/health/ready` composing a Prisma indicator from `PrismaService.isHealthy()`; 200 when DB up, 503 when down.

  **Implementation notes**
  - Path stays versioned for now; a future deployment spec may add unversioned aliases (design path note).

  **Acceptance criteria**
  - 200 when Postgres reachable; 503 when not.

  **Verification**
  - DB up → `curl` returns 200; stop Postgres → returns 503 (also asserted in task 8.2).

  **Out of scope**
  - Extra dependency indicators beyond the database.

  _Requirements: 7.2, 7.3_

---

## 7. Next.js web baseline

- [x] 7.1 (P) Stand up the Next.js app with a default page

  **Goal**
  Bootable Next.js (App Router) serving a default page.

  **Deliverables**
  - `apps/web` Next.js 16 app (App Router) with a default route/page.
  - `apps/web` `dev`/`build` scripts.

  **Implementation notes**
  - Keep the web app free of authoritative financial business rules (R3.3).

  **Acceptance criteria**
  - `pnpm --filter @paypilot/web dev` serves the default page over HTTP.

  **Verification**
  - `pnpm --filter @paypilot/web build` → succeeds.

  **Out of scope**
  - UI features, auth screens, dashboard.

  _Requirements: 3.1, 3.3_

- [x] 7.2 (P) Resolve the API base URL from validated config

  **Goal**
  Web reads its API base URL from environment configuration.

  **Deliverables**
  - A small web env module validating `NEXT_PUBLIC_API_BASE_URL`; `.env.example` entry.

  **Implementation notes**
  - `NEXT_PUBLIC_API_BASE_URL` is **public by design** (the `NEXT_PUBLIC_` prefix exposes it to the browser bundle); it MUST contain only a non-sensitive base URL and **never** secrets, tokens, or credentials.
  - Validation mirrors the fail-fast intent; no financial logic on the client.

  **Acceptance criteria**
  - Missing/invalid `NEXT_PUBLIC_API_BASE_URL` is surfaced; valid value is used by the app.

  **Verification**
  - Asserted by the web smoke test (task 8.3) and a successful `build`.

  **Out of scope**
  - API client/data fetching features.

  _Requirements: 3.2_

---

## 8. Testing harness

- [x] 8.1 Set up unit testing and the injectable clock

  **Goal**
  Fast unit tests plus a deterministic clock seam.

  **Deliverables**
  - Jest configured for `apps/api` and `packages/shared`, runnable via `turbo run test`.
  - `Clock` port with `SystemClock` and `FixedClock`; a test demonstrating clock + provider override via the Nest testing module.

  **Implementation notes**
  - Domain/use-case code must depend on `Clock`, never `Date.now()` (steering).

  **Acceptance criteria**
  - Unit tests run via a single command; `FixedClock` override works in a test.

  **Verification**
  - `pnpm --filter @paypilot/api test` and `pnpm --filter @paypilot/shared test` → pass.

  **Out of scope**
  - Integration/web tests (8.2, 8.3).

  _Requirements: 8.1, 8.3, 8.4_

- [x] 8.2 Add real-PostgreSQL integration tests

  **Goal**
  Verify DB, health, and error handling against a real Postgres.

  **Deliverables**
  - Testcontainers-backed integration tests: PrismaService connects + runs a trivial query; `/health/live` = 200; `/health/ready` = 200 (DB up) and 503 (DB down).
  - Validation/error-filter test driven by a **test-only controller/module declared inside the test suite** (not a production endpoint).

  **Implementation notes**
  - **Test runner decision:** integration tests are exposed as a dedicated `test:integration` script in `apps/api` AND included in the root `pnpm test` run. Therefore **`pnpm test` requires a running Docker daemon** (Testcontainers spins an ephemeral Postgres). A unit-only fast loop remains available via the api workspace's plain unit test script (task 8.1). Document the Docker requirement for `pnpm test` in the README prerequisites.
  - The test-only controller exercises the global `ValidationPipe` + `AllExceptionsFilter` (task 4.4) without polluting production routes.

  **Acceptance criteria**
  - All integration assertions pass; the suite exits non-zero on any failure.
  - `pnpm test:integration` runs the integration suite; the root `pnpm test` includes it (Docker required).

  **Verification**
  - With Docker running: `pnpm test:integration` → green; exits non-zero if a test fails.
  - With Docker stopped: integration tests fail clearly indicating Docker is required (not a silent pass).

  **Out of scope**
  - E2E browser tests; production endpoints.

  _Requirements: 8.2, 8.5, 4.3, 7.1, 7.2, 7.3, 2.3, 2.4, 2.5, 2.6_

- [x] 8.3 (P) Add the web test baseline

  **Goal**
  Minimal web tests so the monorepo-wide test command spans all workspaces.

  **Deliverables**
  - `apps/web` configured with **Vitest + React Testing Library + jsdom**.
  - At least one smoke/unit test asserting the default page (or a simple component) renders.

  **Implementation notes**
  - `turbo run test` must aggregate api (Jest), shared (Jest), and web (Vitest).

  **Acceptance criteria**
  - Web smoke test passes and is included in the root test run.

  **Verification**
  - `pnpm --filter @paypilot/web test` → passes; `pnpm test` includes the web test.

  **Out of scope**
  - E2E (Playwright/Cypress); component library coverage.

  _Requirements: 8.1, 3.1_

---

## 9. README and dependency-policy documentation

- [x] 9.1 Write the README setup and run guide

  **Goal**
  A new contributor can set up and run everything from the README.

  **Deliverables**
  - README sections: Prerequisites (Node 24 LTS via `nvm use`, pnpm, Docker — Docker required for integration tests), local environment startup, and how to run apps/tests/lint/format.
  - Required environment variables documented, referencing `.env.example`.

  **Implementation notes**
  - Keep commands consistent with the actual root scripts.

  **Acceptance criteria**
  - Following the README from a clean clone reaches a running stack.

  **Verification**
  - Manual dry-run of the documented steps.

  **Out of scope**
  - Architecture deep-dives; deployment docs.

  _Requirements: 10.1, 10.2, 10.3_

- [x] 9.2 Document the dependency-safety policy

  **Goal**
  Explain how to add dependencies safely.

  **Deliverables**
  - README/dependency-policy section covering exact-version saves, the build-script approval flow (`pnpm approve-builds` / `allowBuilds`), lockfile review, and running audits.

  **Implementation notes**
  - Reflects the hardening config from tasks 2.1/2.2 and the supply-chain design section.

  **Acceptance criteria**
  - Policy documents the full safe-add workflow and audit commands.

  **Verification**
  - Manual review against R11 and the supply-chain design section.

  **Out of scope**
  - Automated dependency-update tooling.

  _Requirements: 11.5_

---

## 10. Final integration and verification

- [x] 10.1 Run the quality-gate checklist

  **Goal**
  Prove the static + build + audit gates pass across the monorepo.

  **Deliverables**
  - A documented verification checklist (in README or `docs/verification.md`) listing the commands below and expected outcomes.

  **Implementation notes**
  - All commands must succeed on a clean checkout with dependencies installed.
  - **Audit findings:** an unresolved high/critical `pnpm audit` finding requires a **documented security exception** (affected package, rationale, and a revisit date) recorded in `docs/supply-chain.md`. Do **not** create exceptions unless genuinely necessary — prefer upgrading/removing the vulnerable dependency first.

  **Acceptance criteria**
  - Every command below exits 0, except `security:audit` which is satisfied by either no high/critical findings **or** a documented exception for each remaining finding.

  **Verification**
  - `pnpm install --frozen-lockfile` → succeeds, lockfile unchanged.
  - `pnpm lint` → exit 0.
  - `pnpm format:check` → exit 0.
  - `pnpm test` → all workspace tests pass (Docker running).
  - `pnpm build` → all workspaces build.
  - `pnpm security:audit` → no high-severity vulnerabilities.

  **Out of scope**
  - CI pipeline files; deployment.

  _Requirements: 1.4, 8.5, 9.3, 11.2, 11.5_

- [x] 10.2 Run the runtime verification checklist

  **Goal**
  Prove the stack boots, fails fast, and reports health correctly.

  **Deliverables**
  - Runtime checklist appended to the verification doc.

  **Implementation notes**
  - Exercises env validation (task 4.2) and health (tasks 6.1/6.2) end-to-end.

  **Acceptance criteria**
  - All runtime checks behave as specified.

  **Verification**
  - `docker compose up -d` → Postgres becomes healthy.
  - API boot with valid env → starts and serves health.
  - API boot with a required env var unset → fails fast, logs the variable name only.
  - `curl .../api/v1/health/live` → 200; `curl .../api/v1/health/ready` → 200 (DB up), 503 (DB stopped).

  **Out of scope**
  - Load/perf testing; production probes.

  _Requirements: 6.3, 7.1, 7.2, 7.3, 5.1_
