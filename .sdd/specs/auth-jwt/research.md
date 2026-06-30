# Research & Design Decisions — auth-jwt

## Summary
- **Feature**: `auth-jwt`
- **Discovery Scope**: Extension (brownfield) — integration-focused, builds on `platform-foundation`.
- **Key Findings**:
  - Reuse foundation primitives: `AppConfigModule`/Zod env validation (fail-fast), `AllExceptionsFilter` + `ErrorResponse` (`@paypilot/shared`), request-id middleware, `PrismaService` (Prisma 7 + pg adapter), global `ValidationPipe`.
  - This spec introduces PayPilot's **first Prisma model** (`User`) and **first migration**.
  - Stateless access tokens require a per-request active-user check in the guard (R3 design note).

## Integration Points (existing foundation)
- **Config**: extend the Zod env schema with `JWT_SECRET`, `JWT_ACCESS_TTL` (validated, fail-fast, reported by name).
- **Errors**: extend the shared `ErrorCode` enum (e.g. `UNAUTHORIZED`, `FORBIDDEN`, `CONFLICT`, `NOT_FOUND`, `TOO_MANY_REQUESTS`); keep the canonical envelope via `AllExceptionsFilter`.
- **Persistence**: add `User` model to `schema.prisma`; access via `PrismaService`.
- **Module wiring**: `AuthModule` registered in `AppModule`; global guard via `APP_GUARD`.

## Design Decisions

### Decision: JWT library & guard (@nestjs/jwt + custom global guard)
- **Alternatives**: (a) `@nestjs/jwt` + custom `JwtAuthGuard`; (b) `@nestjs/passport` + `passport-jwt`.
- **Selected**: `@nestjs/jwt` with a custom global `JwtAuthGuard` (`APP_GUARD`) + a `@Public()` metadata decorator for register/login/health.
- **Rationale**: explicit control over **algorithm pinning** (reject unexpected `alg`), fewer dependencies, simpler than Passport for a single strategy.
- **Tradeoffs**: we write the guard ourselves (small, testable).

### Decision: Password hashing (argon2id via @node-rs/argon2)
- **Alternatives**: `argon2` (native, node-gyp build script), `bcrypt` (native build), `bcryptjs` (pure JS, slower), `@node-rs/argon2` (prebuilt napi binaries).
- **Selected**: **argon2id** via `@node-rs/argon2` — prebuilt platform binaries, so **no build-script approval** is needed (aligns with supply-chain hardening). Min length 12, max 256 (reject, no truncation).
- **Rationale**: argon2id is a strong adaptive KDF; the napi package avoids native compilation friction seen with `argon2`/`bcrypt`.
- **Follow-up**: pin exact version + tune cost params at implementation; confirm prebuilt binary for the platform.

### Decision: Active-user verification (per-request lookup)
- **Context**: R3 note — stateless tokens can't be revoked; a disabled/deleted user must be rejected.
- **Selected**: the guard validates the token signature/exp/alg, then performs a **per-request lookup** of `sub` via `PrismaService` to confirm the user exists and `isActive`. Disabled/deleted → reject.
- **Tradeoff**: one indexed PK lookup per authenticated request (acceptable for MVP; can be cached later). Documented in design.

### Decision: Cross-user access response (404-like)
- **Context**: R4 note — 403 vs 404 while not revealing existence.
- **Selected**: ownership checks that fail return a **generic 404 (Not Found)** so the API does not reveal whether another user's record exists. (Reserve 403 for authenticated-but-explicitly-forbidden actions if introduced later.)

### Decision: Rate limiting (@nestjs/throttler, in-memory)
- **Selected**: `@nestjs/throttler` with the **default in-memory store**, stricter limits on `login`/`register`. Exceeding → `429` via the canonical envelope; responses don't reveal account existence.
- **Constraint**: **no Redis / jobs infra** (R10). The in-memory limiter is **non-production-grade** (per-instance) — documented; a shared store is a future concern.

## Risks & Mitigations
- **@node-rs/argon2 prebuilt availability** — verify the platform binary installs without a build script; fallback to `argon2` (with explicit `allowBuilds`) if unavailable.
- **In-memory rate limiter** — not shared across instances; acceptable for MVP, flagged for a future Redis-backed store.
- **Per-request user lookup latency** — single PK lookup; revisit with caching only if measured.

## References
- NestJS Authentication & Authorization docs (guards, `@nestjs/jwt`).
- `@nestjs/throttler` (rate limiting).
- `@node-rs/argon2` (prebuilt argon2 bindings).
- OWASP ASVS password storage / length guidance.
