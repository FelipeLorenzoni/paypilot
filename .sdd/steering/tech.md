# Technology Stack

## Architecture

Decoupled web app: a **Next.js** frontend talking to a **NestJS** REST API over JWT-authenticated HTTP. The backend owns all financial logic; the frontend never computes invoices, installments, or reminder schedules. Background work (reminders, recurring-bill generation) runs as scheduled/queued jobs separate from request handling. External systems (WhatsApp, future bank integrations) sit behind provider interfaces — see [[integrations]].

Intended layout is a single repo containing `apps/api` (NestJS), `apps/web` (Next.js), and shared types. Confirm/lock the exact monorepo tooling in the first foundation spec.

## Core Technologies

- **Language**: TypeScript (strict mode), shared across backend and frontend
- **Backend framework**: NestJS
- **Frontend framework**: Next.js
- **Runtime**: Node.js (LTS; pin the version in the foundation spec)
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Background jobs**: BullMQ (Redis-backed) or a cron-based scheduler — decision deferred to the reminders/recurring-bills specs; default to BullMQ if Redis is acceptable
- **Local environment**: Docker Compose (Postgres, Redis if BullMQ, the app services)

## Key Libraries

Only what shapes patterns: Prisma (data access), Nest's DI/module system (composition + provider abstraction), a validation layer at the API boundary (e.g. class-validator/DTOs), and a date library for due/closing-day math — money and date arithmetic must be deliberate, not ad hoc.

## Development Standards

### Type Safety

TypeScript strict mode. No `any` in domain/financial code. Model money with integer minor units (e.g. cents) or a precise decimal type — never floating-point — and keep currency explicit.

### Code Quality

ESLint + Prettier, enforced in CI. Domain logic lives in services/use-cases, kept free of framework and transport concerns so it is unit-testable in isolation.

### Testing

Financial rules ([[financial-rules]]) MUST have automated tests — this is a hard product requirement, not a guideline. See [[testing]] for what to test and how. CI must run the suite and block merges on failure.

## Development Environment

### Required Tools

Node.js (LTS), Docker + Docker Compose, package manager (lock choice in foundation spec). `docker compose up` should provision Postgres (and Redis if used) for a working local stack.

### Common Commands

```bash
# To be defined by the foundation spec — update this block once apps/api and apps/web exist.
# Dev:   <command>
# Build: <command>
# Test:  <command>
# Single test: <command>
```

## Key Technical Decisions

- **Backend owns financial truth.** Invoice assignment, installment generation, recurring-bill creation, and reminder eligibility are computed server-side and covered by tests.
- **Providers are abstracted behind interfaces** with a fake/log implementation as the development default — see [[integrations]]. No real WhatsApp calls in dev or tests.
- **JWT auth initially**, with room to evolve. Keep auth concerns centralized; see [[security]].
- **Secrets never committed.** Config comes from environment, validated at startup; see [[security]].

---

_Document standards and patterns, not every dependency_
