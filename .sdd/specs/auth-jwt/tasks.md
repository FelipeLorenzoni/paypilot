# Implementation Plan — auth-jwt (Executor-Grade)

> Builds on `platform-foundation`. Scope: authentication + per-user authorization baseline only. **No** business features/models beyond `User`; no Redis/jobs; no logout/revocation/refresh/OAuth/MFA/email-verify/password-reset.
> `(P)` marks parallel-safe tasks (independent files). Each task ends with `_Requirements: <ids>_` referencing `requirements.md`. Conventions: `apps/api` (NestJS), `packages/shared` (contracts).

---

## 1. Dependencies and foundation error-code mapping

- [x] 1.1 Install auth dependencies

  **Goal**
  Add the libraries the design selected, respecting supply-chain hardening.

  **Deliverables**
  - `apps/api` deps (exact): `@nestjs/jwt`, `@node-rs/argon2`, `@nestjs/throttler`, `ms`.
  - Dev types as needed (`@types/ms` if not bundled).
  - `pnpm-workspace.yaml` `allowBuilds` updated only if a new build script appears (prefer deny; `@node-rs/argon2` ships prebuilt binaries).

  **Implementation notes**
  - Prefer `@node-rs/argon2` (prebuilt napi) to avoid native build-script approval. If it needs a build script or lacks a platform binary, STOP and reconsider (`argon2` with explicit `allowBuilds`).
  - Versions saved exactly (`savePrefix: ""`).

  **Acceptance criteria**
  - `pnpm install` clean; no unexpected `ERR_PNPM_IGNORED_BUILDS` left unresolved.

  **Verification**
  - `pnpm install --frozen-lockfile` → exit 0; `pnpm --filter @paypilot/api exec node -e "require('@node-rs/argon2')"` loads.

  **Out of scope**
  - Any Redis client.

  _Requirements: 5.6_

- [x] 1.2 Extend shared ErrorCode + foundation status→code mapping

  **Goal**
  Make the canonical `code` correct for auth statuses (foundation change, item 9).

  **Deliverables**
  - `packages/shared`: extend `ErrorCode` enum with `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `TOO_MANY_REQUESTS`.
  - `apps/api` `AllExceptionsFilter`: add an HTTP-status → `ErrorCode` map (default to existing behavior for unmapped statuses); 5xx stays `INTERNAL_ERROR` generic.
  - Unit tests for the mapping.

  **Implementation notes**
  - Do not change the canonical envelope shape; only the `code` derivation for 4xx.
  - Keep `requestId` + `timestamp` on every error.

  **Acceptance criteria**
  - `401→UNAUTHORIZED`, `403→FORBIDDEN`, `404→NOT_FOUND`, `409→CONFLICT`, `429→TOO_MANY_REQUESTS`.
  - **Foundation behavior preserved:** `400` still maps to `VALIDATION_ERROR`; `5xx` still maps to `INTERNAL_ERROR` (generic, no leakage); the canonical envelope **shape is unchanged**; every error response still includes `requestId` and `timestamp`.

  **Verification**
  - `pnpm --filter @paypilot/shared test` and `pnpm --filter @paypilot/api test` → mapping tests pass, including regression assertions for 400/5xx and the unchanged envelope shape (`requestId`+`timestamp` present).

  **Out of scope**
  - Business-specific error codes.

  _Requirements: 7.1, 7.2, 7.3_

---

## 2. Authentication configuration

- [x] 2.1 Extend env schema for JWT and rate-limit config

  **Goal**
  Validated, fail-fast JWT config (strong secret + bounded TTL) and validated rate-limit config.

  **Deliverables**
  - `apps/api` env schema: `JWT_SECRET`, `JWT_ACCESS_TTL`, and the rate-limit variables added to `AppConfig`.
  - Rate-limit env (with defaults): `AUTH_LOGIN_RATE_LIMIT_POINTS=5`, `AUTH_LOGIN_RATE_LIMIT_WINDOW="1m"`, `AUTH_REGISTER_RATE_LIMIT_POINTS=3`, `AUTH_REGISTER_RATE_LIMIT_WINDOW="1m"`, `AUTH_DEFAULT_RATE_LIMIT_POINTS=100`, `AUTH_DEFAULT_RATE_LIMIT_WINDOW="1m"`.
  - `.env.example`: `JWT_SECRET="<replace-with-256-bit-random-secret>"`, `JWT_ACCESS_TTL="15m"`, and the six rate-limit vars with their defaults.
  - Unit tests for the new validation.

  **Implementation notes**
  - `JWT_SECRET`: require ≥ 256 bits entropy (decoded ≥ 32 bytes, base64/base64url); reject missing/short/placeholder (`secret`, `super-secret`, `changeme`)/malformed/weak **in non-test envs**. Report variable name only, never value.
  - `JWT_ACCESS_TTL`: parse with `ms`; default `15m`; reject `< 5m` or `> 1h`.
  - Rate-limit `*_POINTS`: positive integers (reject ≤ 0 / non-integer). Rate-limit `*_WINDOW`: parse with `ms`; reject invalid/non-positive durations.

  **Acceptance criteria**
  - Boot fails fast on missing/weak `JWT_SECRET`, out-of-range TTL, non-positive rate-limit points, or invalid rate-limit windows — naming the offending variable without its value.

  **Verification**
  - Unit: schema accepts strong secret + `15m` + valid limits; rejects `secret`, a 10-char secret, `2m`, `2h`, `AUTH_LOGIN_RATE_LIMIT_POINTS=0`, and `AUTH_LOGIN_RATE_LIMIT_WINDOW="nonsense"`.
  - Boot with weak `JWT_SECRET` → exit non-zero naming `JWT_SECRET`.

  **Out of scope**
  - Secret rotation; shared rate-limit store.

  _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 10.6_

---

## 3. User persistence

- [x] 3.1 Add the User model and migration

  **Goal**
  PayPilot's first Prisma model + migration.

  **Deliverables**
  - `User` model in `schema.prisma` (`id` uuid, `email` unique, `passwordHash`, `isActive` default true, `createdAt`/`updatedAt` `timestamptz`, `@@map("users")`).
  - A Prisma migration creating the `users` table with the unique index on `email`.
  - Regenerated client (`pnpm db:generate`).

  **Implementation notes**
  - Email stored **normalized**; uniqueness enforced by the DB index (race-safe → 409). Timestamps UTC per `docs/conventions.md`.
  - `isActive` boolean for MVP (note: `UserStatus` enum is a future option).

  **Acceptance criteria**
  - Migration applies on an empty DB; inserting a duplicate email violates the unique constraint.

  **Verification**
  - `pnpm db:generate` ok; migration applies against the Testcontainers/compose DB (asserted in 10.1).

  **Out of scope**
  - Any non-user/business table.

  _Requirements: 1.3, 1.5, 3.5_

- [x] 3.2 (P) UsersRepository

  **Goal**
  Encapsulate user data access behind a repository.

  **Deliverables**
  - `UsersRepository` (uses `PrismaService`): `create`, `findByEmail` (normalized), `findActiveById`.

  **Implementation notes**
  - All lookups use the shared normalization (task 4.1) for email. `findActiveById` returns only active users (supports guard active-check).

  **Acceptance criteria**
  - Create persists a normalized email; lookups are case-insensitive via normalization; disabled users excluded by `findActiveById`.

  **Verification**
  - Covered by integration tests (10.1).

  **Out of scope**
  - Business queries.

  _Requirements: 1.1, 3.3, 4.1, 4.2_

---

## 4. Email normalization

- [x] 4.1 (P) Shared email normalization function

  **Goal**
  One normalization function used everywhere.

  **Deliverables**
  - `normalizeEmail(email)` (trim + lowercase only) used by register, login, and repository lookups.
  - Unit tests.

  **Implementation notes**
  - Must NOT remove dots, strip `+` aliases, or apply provider-specific rules.

  **Acceptance criteria**
  - `User@Example.com`, ` user@example.com `, `user@example.com` → identical; `u.s.e.r@example.com` and `user+tag@example.com` stay distinct.

  **Verification**
  - `pnpm --filter @paypilot/api test` → normalization tests pass.

  **Out of scope**
  - Email validation rules beyond format (handled by DTO).

  _Requirements: 1.2_

---

## 5. Password hashing

- [x] 5.1 (P) PasswordHasher (argon2id) with precomputed dummy hash

  **Goal**
  Strong password hashing + constant-time-friendly dummy hash.

  **Deliverables**
  - `PasswordHasher` (argon2id via `@node-rs/argon2`): `hash`, `verify`.
  - A **dummy hash precomputed once** at startup/config using the same argon2id params.
  - Unit tests.

  **Implementation notes**
  - Tune argon2id cost params (documented). Never log passwords/hashes. The dummy hash is created once (not per request).

  **Acceptance criteria**
  - `hash` ≠ plaintext; `verify` true for correct, false for wrong; dummy hash uses identical params and is reused.

  **Verification**
  - `pnpm --filter @paypilot/api test` → hasher tests pass.

  **Out of scope**
  - Password rehash-on-login upgrades (future).

  _Requirements: 5.1, 5.6, 5.7, 2.2_

---

## 6. Token service

- [x] 6.1 (P) JwtTokenService (algorithm-pinned)

  **Goal**
  Sign/verify short-lived access tokens safely.

  **Deliverables**
  - `JwtTokenService` over `@nestjs/jwt`: `sign(userId)` and `verify(token)`.
  - Unit tests.

  **Implementation notes**
  - HS256 with the configured secret; claims `sub` + `exp` (+ `iat`, `iss="paypilot"`); `aud` omitted (MVP). Verification **pins** `algorithms: ["HS256"]`. Payload carries no PII/hash/secret. TTL from `JWT_ACCESS_TTL`.

  **Acceptance criteria**
  - `sign` sets `sub`/`exp`; `verify` rejects tampered, expired, and unexpected-algorithm (e.g. `none`) tokens.

  **Verification**
  - `pnpm --filter @paypilot/api test` → token tests pass (incl. `none`/alg-confusion rejection).

  **Out of scope**
  - Refresh tokens.

  _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 2.7_

---

## 7. Authentication guard and authorization primitives

- [x] 7.1 JwtAuthGuard, @Public, @CurrentUser, active-user check

  **Goal**
  Global authentication with stateless active-user verification.

  **Deliverables**
  - `JwtAuthGuard` (registered as `APP_GUARD`), `@Public()` metadata decorator, `@CurrentUser()` param decorator.
  - Guard verifies the token then loads `sub` via `UsersRepository.findActiveById`.
  - **Mark existing foundation health endpoints `@Public()`** so they stay unauthenticated under the new global guard: `GET /api/v1/health/live`, `GET /api/v1/health/ready`.

  **Implementation notes**
  - Route publicity: `POST /api/v1/auth/register` public, `POST /api/v1/auth/login` public, `GET /api/v1/auth/me` protected; health endpoints public. All public routes skip auth via `@Public()`.
  - Missing/invalid/expired token or disabled/deleted user → `UnauthorizedException` (401) canonical (design chose 401). Attach safe user/id for `@CurrentUser()`.

  **Acceptance criteria**
  - Protected route without/with-invalid token → 401; with valid active-user token → handler receives identity; disabled user → 401.
  - After the global guard is enabled, `GET /api/v1/health/live` and `/ready` still return their normal status **unauthenticated** (no regression).

  **Verification**
  - Covered by integration tests (10.1).

  **Out of scope**
  - Role/permission checks.

  _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 7.2 (P) Ownership authorization primitive

  **Goal**
  Reusable per-user ownership enforcement (404-like).

  **Deliverables**
  - `assertOwnership(resourceOwnerId, currentUserId)` throwing a generic `NotFoundException` on mismatch.
  - Unit tests.

  **Implementation notes**
  - Cross-user access returns 404 (non-disclosure). Owner derives from token, never client input. Reusable by future services/repositories.

  **Acceptance criteria**
  - Passes for owner; throws 404-like for non-owner without revealing existence.

  **Verification**
  - Unit test; isolation proven end-to-end in 10.1 via a test-only resource.

  **Out of scope**
  - Production business resources.

  _Requirements: 4.3, 4.4, 4.5_

---

## 8. Rate limiting

- [x] 8.1 ThrottlerModule with concrete defaults and guard order

  **Goal**
  Abuse protection on auth endpoints, throttling before auth work.

  **Deliverables**
  - `ThrottlerModule` configured (current `@nestjs/throttler` shape for the pinned version) **from the validated rate-limit env config (task 2.1)** — not hard-coded literals; `ThrottlerGuard` as `APP_GUARD` **registered before** `JwtAuthGuard`.
  - Per-route limits driven by env: login `AUTH_LOGIN_RATE_LIMIT_*` (default 5/min), register `AUTH_REGISTER_RATE_LIMIT_*` (default 3/min), app-wide `AUTH_DEFAULT_RATE_LIMIT_*` (default 100/min) — all per client IP.

  **Implementation notes**
  - Keys on client IP (not email). 429 surfaces via the canonical envelope (`TOO_MANY_REQUESTS`). In-memory store documented as non-production-grade. Guard registration order documented in code (not comments only).

  **Acceptance criteria**
  - Exceeding login/register limits → 429 canonical; ordering ensures throttling occurs before the guard's DB lookup.

  **Verification**
  - Integration (10.1): 429 on limit; guard-order proof — a valid-Bearer-token request to a protected route, after the limit is exceeded, returns 429 with `JwtTokenService.verify` and `UsersRepository.findActiveById` not called.

  **Out of scope**
  - Shared/distributed limiter store (Redis) — future.

  _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6, 10.7_

---

## 9. Auth API (DTOs, service, controller)

- [x] 9.1 Registration/login DTOs with password policy

  **Goal**
  Validated request contracts at the API boundary.

  **Deliverables**
  - `RegisterDto`, `LoginDto` (email + password) with class-validator rules.
  - Unit/validation tests.

  **Implementation notes**
  - Password: min 12, **max 256 (reject, no truncation)**, allow spaces/printable, no composition rules. Email format validated; normalization applied in service/repository.

  **Acceptance criteria**
  - Invalid/oversized password or bad email → 400 `VALIDATION_ERROR`.

  **Verification**
  - Integration (10.1): 400 on `<12`, `>256`, malformed email.

  **Out of scope**
  - Password strength meters.

  _Requirements: 5.1, 5.2, 5.3, 5.4, 1.6_

- [x] 9.2 AuthService + AuthController (register, login, me) + logging

  **Goal**
  Wire the endpoints with secure behavior and safe logging.

  **Deliverables**
  - `AuthService`: `register` (hash, normalized email, 409 on duplicate), `login` (constant-time verify, generic 401, sign token), `toSafeUser`.
  - `AuthController`: `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `GET /api/v1/auth/me` (guarded).
  - `AuthModule` wired into `AppModule`.
  - A `SafeUser` type/mapper used by both register and `/auth/me` responses.
  - A unit/integration test with a **mocked logger** asserting log contents on failed login/auth.

  **Implementation notes**
  - **SafeUser shape:** `{ id, email, createdAt }` only. MUST NOT include `passwordHash`, tokens, secrets, or internal auth fields. Both register and `/auth/me` return exactly this shape.
  - **Duplicate email:** map the Prisma unique-constraint violation on `User.email` (e.g. `P2002`) to `409 CONFLICT` via the canonical envelope; database/internal error details MUST NOT leak to the client (generic message).
  - Login runs `verify` for existing **and** missing users (precomputed dummy hash) — generic 401; never reveal which field failed.
  - `/auth/me` returns the `SafeUser`, guarded.
  - Logging: failed login must not log the full email; may log event type / request-id / result / user-id (when safely known); never raw JWT, `Authorization` header, password, password hash, or credential-validation inputs.

  **Acceptance criteria**
  - Register returns `SafeUser` (`id`,`email`,`createdAt`) and never the password/hash; duplicate (incl. DB-constraint race) → 409 with no internal detail leak.
  - Login valid → token; invalid → generic 401; `/me` → `SafeUser` and 401 when unauthenticated/disabled.
  - **Logging assertion:** with a mocked logger, a failed login/auth log entry contains none of: raw email, password, password hash, raw JWT, `Authorization` header, credential inputs — and may contain event type, request id, result, and user id (when safe).

  **Verification**
  - Integration (10.1) covers all HTTP paths; the mocked-logger test asserts log redaction.

  **Out of scope**
  - Logout/refresh endpoints.

  _Requirements: 1.1, 1.4, 1.7, 2.1, 2.2, 2.4, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 9.1, 9.2, 9.3, 9.4_

---

## 10. Integration tests and verification

- [x] 10.1 Auth integration suite (Testcontainers)

  **Goal**
  Prove the auth flows, isolation, rate limiting, and guard order against real PostgreSQL.

  **Deliverables**
  - Integration tests (`apps/api/test/*.int.spec.ts`) using Testcontainers + the migrated schema, including a **test-only owned resource module** declared in the suite for isolation.

  **Implementation notes**
  - Apply the same global setup as `main.ts` (request-id, prefix/versioning, ValidationPipe, filter, guards). No production business endpoints.

  **Acceptance criteria** (all pass; suite exits non-zero on failure)
  - Register → safe profile; duplicate (incl. concurrent) → single user + 409.
  - Login valid → token; invalid → generic 401.
  - `/auth/me`: valid → safe profile (no hash); missing/expired/disabled-user → 401 canonical.
  - Guard: protected route blocked without token; `@Public()` open.
  - Isolation: owner reads test-only resource; other user → 404-like.
  - Rate limit: login >5/min, register >3/min → 429 canonical.
  - **Guard-order proof (strengthened):** a request carrying a **valid Bearer token** to a protected test route, sent **after the limit is exceeded**, returns **429 before authentication work happens** — spies on `JwtTokenService.verify` **and** `UsersRepository.findActiveById` assert they were **not called** for the throttled request. (Proves throttling precedes auth even when the request would otherwise trigger token verification + active-user lookup.)

  **Verification**
  - `pnpm --filter @paypilot/api test:integration` → green (Docker required).

  **Out of scope**
  - E2E browser tests.

  _Requirements: 1.1, 1.4, 1.5, 2.1, 2.2, 3.1, 3.2, 3.4, 3.5, 4.1, 4.2, 4.3, 4.6, 8.9, 9.1, 9.2, 9.3, 9.4, 10.1, 10.2, 10.3, 10.4_

- [x] 10.2 Docs and final quality gate

  **Goal**
  Document auth env/usage and confirm the monorepo gate is green.

  **Deliverables**
  - README: auth env vars + how to generate a strong secret; brief auth endpoint list.
    - `JWT_SECRET`, `JWT_ACCESS_TTL`.
    - The **six rate-limit vars** from task 2.1 — `AUTH_LOGIN_RATE_LIMIT_POINTS` (5), `AUTH_LOGIN_RATE_LIMIT_WINDOW` (`1m`), `AUTH_REGISTER_RATE_LIMIT_POINTS` (3), `AUTH_REGISTER_RATE_LIMIT_WINDOW` (`1m`), `AUTH_DEFAULT_RATE_LIMIT_POINTS` (100), `AUTH_DEFAULT_RATE_LIMIT_WINDOW` (`1m`) — documenting each var's **default, purpose** (login/register/app-wide per-IP limits), and **local-development guidance** (defaults work out of the box; the in-memory limiter is per-instance / non-production-grade).
  - Update `docs/verification.md` if needed.

  **Implementation notes**
  - Keep `.env.example` consistent; never commit real secrets.

  **Acceptance criteria**
  - `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm format:check`, `pnpm test` (incl. integration), `pnpm build`, `pnpm security:audit` all pass.

  **Verification**
  - Run the full gate; record results.

  **Out of scope**
  - CI pipeline files; deployment.

  _Requirements: 6.3, 8.9_
