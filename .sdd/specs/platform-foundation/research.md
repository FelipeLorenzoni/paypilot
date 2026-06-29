# Research & Design Decisions

## Summary

- **Feature**: `platform-foundation`
- **Discovery Scope**: New Feature (greenfield) — full discovery
- **Key Findings**:
  - Current stable stack (June 2026): NestJS 11.1.x on Node 20 LTS + TypeScript 5.x; Next.js 16.2.x (App Router, Turbopack default, React 19.2, requires Node 20+); Prisma 7.6.x.
  - Prisma 7 changed the client generator (`prisma-client` emits TypeScript into the project instead of into `node_modules/.prisma`). It works with NestJS 11, but there is community friction reported — pin a known-good version and document the generated-client output path.
  - Per stakeholder direction, the foundation does **not** provision Redis or any jobs backend; Docker Compose provisions PostgreSQL only. Jobs infra is deferred to `due-date-reminders`.

## Research Log

### Stack versions (NestJS / Next.js / Prisma / Node)

- **Context**: Greenfield foundation must pin a current, mutually compatible stack; assistant knowledge cutoff (Jan 2026) predates current releases.
- **Sources Consulted**: nestjs/nest releases, prisma changelog + prisma/prisma discussion #29146, nextjs.org blog & v16 upgrade guide.
- **Findings**:
  - NestJS 11.1.x is the current v11 line; pairs with Node 20 LTS and TypeScript 5.x.
  - Next.js 16.2.x is current stable; Turbopack is the default dev/build bundler; minimum Node 20.
  - Prisma 7.6.x is current; new `prisma-client` generator emits TS files committed/generated into the repo.
- **Implications**: Use **Node.js 24 LTS** as the single runtime baseline for the whole monorepo (latest LTS; Node 26 Current is deliberately avoided until it reaches LTS). Next.js 16 requires Node 20.9+ and NestJS 11 requires v20+ and recommends latest LTS, so Node 24 satisfies both. Pin via `engines: ">=24 <25"`, `.nvmrc: 24`, and `node:24-bookworm-slim` Docker images. Treat Prisma 7's generated client output as a known integration detail: explicit `output` path, gitignored generated dir, `prisma generate` in postinstall/CI.

### Monorepo tooling & package manager

- **Context**: R1 requires a single-command install across apps and shared types; R8/R9 require unified test/lint/format commands.
- **Findings**: pnpm workspaces is the de-facto standard for TypeScript monorepos (efficient, strict node_modules). Turborepo adds task orchestration + caching to run `lint`/`test`/`build` across all workspaces with one command. pnpm 11 (current: 11.9, June 2026) enables `minimumReleaseAge` by default, supporting the supply-chain hardening posture.
- **Implications**: Use **pnpm 11** (exact pin `pnpm@11.9.0`, `engines.pnpm ">=11 <12"`) workspaces for dependency management and **Turborepo (local caching only)** for task running. `turbo run test` aggregates api (Jest), `packages/shared` (Jest), and web (Vitest + RTL + jsdom). Satisfies R1.4 (single install), R8.1/R8.5, R9.1–R9.3. Hardening keys (`savePrefix`, `minimumReleaseAge`, `blockExoticSubdeps`, `allowBuilds`) must be validated against the pinned pnpm version at implementation time.

### Integration testing against real PostgreSQL

- **Context**: R8.2 requires integration tests against a real PostgreSQL instance, deterministically and in CI.
- **Findings**: Testcontainers spins an ephemeral, disposable PostgreSQL container per test run; avoids shared-state flakiness and needs no pre-provisioned DB.
- **Implications**: Adopt Testcontainers for API integration tests; the same Docker dependency already required for local dev (R5) covers CI.

### Deterministic time & provider substitution

- **Context**: Steering (`testing.md`, `financial-rules.md`) mandates injected clock and substitutable providers; foundation must establish the seam now.
- **Findings**: NestJS DI supports injecting an abstract `Clock` token and overriding providers in tests via `Test.createTestingModule(...).overrideProvider(...)`.
- **Implications**: Define a `Clock` port (foundation) with a system implementation and a `FixedClock` test double. Establish the provider-port pattern (interface + DI token) so later specs (e.g. `NotificationProvider`) plug in without touching domain code.

## Architecture Pattern Evaluation

| Option                                       | Description                                                                                              | Strengths                                                           | Risks / Limitations                               | Notes                                          |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------- |
| Layered + feature modules (chosen)           | NestJS feature modules, each layered controller → use-case → domain → repository; ports for side-effects | Matches steering `structure.md`; low ceremony; testable pure domain | Requires discipline to keep domain framework-free | Selected                                       |
| Full Hexagonal (ports & adapters everywhere) | Strict ports/adapters around every boundary                                                              | Maximum decoupling                                                  | Overkill for a foundation; slows feature delivery | Adopt the "ports for side-effects" subset only |
| Nx monorepo                                  | Nx instead of pnpm+Turborepo                                                                             | Rich generators, graph tooling                                      | Heavier, more opinionated than needed now         | Rejected for simplicity                        |

## Design Decisions

### Decision: Money modeling

- **Context**: Steering forbids floating-point money; foundation must set the convention before any financial feature.
- **Alternatives Considered**:
  1. Integer minor units (cents) stored as BIGINT
  2. Prisma `Decimal` (arbitrary precision)
- **Selected Approach**: Integer minor units in BIGINT, paired with an explicit ISO-4217 currency code; a shared `Money` value object (amountMinor + currency) in `packages/shared`.
- **Rationale**: Integer arithmetic is exact and deterministic for installment/rounding rules (R5 in financial-rules); avoids decimal-library edge cases in JS.
- **Trade-offs**: Callers must convert to/from display units; mitigated by the shared `Money` helper.
- **Follow-up**: Define rounding-remainder rules in `credit-cards-invoices`.

### Decision: Date & time strategy (UTC/local)

- **Context**: R4.6 requires an explicit UTC/local-date strategy; due dates and reference months are calendar concepts, not instants.
- **Selected Approach**:
  - **Instants** (created_at, updated_at, audit) → stored UTC as `timestamptz`.
  - **Due dates / reference months** → stored as date-only values (no time, no tz), representing calendar dates in the user's local context.
  - Business logic never reads the wall clock; it receives an injected `Clock` and, where instant↔date conversion is needed, an explicit timezone.
- **Rationale**: Calendar-based rules (closing/due day, reminder windows) must not drift due to timezone-of-server; separating instants from calendar dates makes rules deterministic and testable.
- **Trade-offs**: Two distinct temporal types to keep straight; documented as a convention.
- **Follow-up**: Per-user timezone handling formalized when reminders/cards are specified.

### Decision: Prisma 7 with pinned version

- **Context**: Prisma 7 is current but introduces a new client generator and reported NestJS friction.
- **Selected Approach**: Adopt Prisma 7.6.x, pinned exactly; use the new `prisma-client` generator, gitignore the generated output, run `prisma generate` on postinstall and in CI; wrap PrismaClient in an injectable Nest `PrismaService` with lifecycle hooks.
- **Rationale**: Staying current avoids an early forced migration; the friction is a known, documented integration detail rather than a blocker.
- **Trade-offs**: Slightly more setup than Prisma 6; revisit if blocking issues surface.
- **Follow-up**: Validate `PrismaService` connect/disconnect + readiness check during implementation.

## Risks & Mitigations

- **Prisma 7 + NestJS integration friction** — **RESOLVED in design** (Resolved Decisions §1): pinned version, explicit generated-client output path (git-ignored), `prisma generate` in setup, access via injectable `PrismaService`, and a Testcontainers integration test connecting to real PostgreSQL.
- **Turborepo remote caching** — **DECIDED**: local caching only in the foundation; no external cache credentials. Revisit in a future CI/CD or DX spec (Resolved Decisions §2).
- **Domain logic leaking framework concerns** — enforce dependency direction in lint/structure; keep `Clock` and provider ports in domain layer.
- **Server-timezone drift in calendar rules** — codify the instants-vs-calendar-dates convention now; pass timezone explicitly.
- **Turbopack/Next 16 churn** — pin versions; foundation only needs a default page, limiting exposure.

## References

- [nestjs/nest releases](https://github.com/nestjs/nest/releases) — NestJS 11.1.x current line
- [Prisma changelog](https://www.prisma.io/changelog) — Prisma 7.6.x
- [Prisma discussion #29146](https://github.com/prisma/prisma/discussions/29146) — Prisma 7 + NestJS usability notes
- [Next.js v16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16) — Node 20+, Turbopack default
- [Next.js blog](https://nextjs.org/blog) — Next.js 16.2.x stable
