# Requirements Document

## Project Description (Input)

Create PayPilot foundation with a monorepo structure, NestJS backend, Next.js frontend, PostgreSQL, Prisma, Docker Compose, environment configuration, health checks, base testing setup, linting, formatting and README.

## Introduction

This specification defines the technical foundation for PayPilot: the monorepo, the backend and frontend application skeletons, the database/ORM setup, the local development environment, configuration handling, health checks, the testing harness, code-quality tooling, and project documentation. Its scope is **scaffolding and technical baseline only**.

**Out of scope (deliberately excluded from this spec):** any business feature or domain logic, including JWT authentication (covered by `auth-jwt`), the WhatsApp/notification provider implementation (covered by `due-date-reminders`), recurring bills, transactions/expenses, credit cards and invoices, the dashboard/UI features, reminders, and CSV import. This spec establishes the global infrastructure and conventions those later specs build on; it does not implement business endpoints, screens, or rules.

The foundation must be correct enough to protect PayPilot's financial invariants later: it establishes the conventions for money and time handling and a testing harness capable of deterministic financial-rule tests, per the project's steering (`financial-rules.md`, `testing.md`, `security.md`). Requirements describe **what** the foundation must provide; concrete tooling choices (package manager, Node version, jobs backend) are settled in the design phase.

## Requirements

### Requirement 1: Monorepo Structure

**Objective:** As a developer, I want a single monorepo housing backend, frontend, and shared code, so that the whole system is developed and versioned consistently.

#### Acceptance Criteria

1. The monorepo shall contain a separate application for the NestJS backend and a separate application for the Next.js frontend.
2. The monorepo shall provide a shared location for TypeScript types/contracts consumed by both applications.
3. Where shared types are defined, the web and backend applications shall import them from the shared location rather than duplicating definitions.
4. When a developer installs dependencies from the repository root, the system shall install dependencies for all applications and packages with a single command.
5. The monorepo shall enforce TypeScript strict mode across all applications and packages.

### Requirement 2: Backend Application Baseline

**Objective:** As a developer, I want a running NestJS backend skeleton with global request-validation and error-handling infrastructure, so that feature modules can be added later following a consistent structure. This requirement covers **global backend infrastructure only** — it does not implement any business endpoints.

#### Acceptance Criteria

1. When the backend is started in development, the API service shall expose an HTTP server on a configurable port.
2. The API service shall organize code by feature/domain modules following the project structure conventions.
3. The API service shall configure a global request-validation mechanism at the API boundary (e.g. a global validation pipe over typed request objects), without defining business endpoints.
4. If an incoming request fails validation, then the API service shall reject it with a 4xx response using the canonical error body.
5. If an unhandled error occurs while processing a request, then the API service shall return a 5xx response using the canonical error body and shall not leak internal details or secrets.
6. The API service shall define the canonical error response shape as global infrastructure (e.g. a global exception filter); the concrete shape is specified during the design phase.
7. The API service shall establish a consistent route prefix and API versioning convention (e.g. `/api/v1/...`) that all future endpoints follow.

### Requirement 3: Frontend Application Baseline

**Objective:** As a developer, I want a running Next.js frontend skeleton, so that UI features can be added against the API.

#### Acceptance Criteria

1. When the frontend is started in development, the web application shall serve a default page over HTTP.
2. The web application shall resolve the API service base URL from environment configuration.
3. The web application shall not implement authoritative financial business rules; financial calculations and invariants shall be enforced by the backend/domain layer.

### Requirement 4: Database and ORM

**Objective:** As a developer, I want PostgreSQL accessed through Prisma, so that schema and data access are type-safe and migration-driven.

#### Acceptance Criteria

1. The API service shall connect to a PostgreSQL database through Prisma.
2. The system shall manage all schema changes through Prisma migrations.
3. When migrations are applied to an empty database, the system shall produce the expected schema without manual SQL.
4. The system shall represent monetary values using integer minor units or a precise decimal type, and shall never use floating-point types for money.
5. The system shall store timestamps as timezone-aware values.
6. The foundation shall document the project's money and time modeling conventions, and that documentation shall establish that:
   - money must never use floating-point types;
   - timestamps are stored consistently across the system;
   - due dates and reference months are modeled as date-based values (not timestamps) where appropriate;
   - the design defines the UTC/local-date strategy (how stored values map to user-facing dates).

### Requirement 5: Local Development Environment

**Objective:** As a developer, I want a one-command local environment, so that I can run the full stack without manually installing services.

#### Acceptance Criteria

1. When a developer runs the Docker Compose startup command, the development environment shall provision a PostgreSQL instance.
2. The development environment shall not provision Redis or any background-jobs backend unless the foundation design explicitly chooses to include one; by default, jobs infrastructure is deferred to the `due-date-reminders` spec.
3. The development environment shall allow the backend and frontend applications to run against the provisioned services using documented configuration.
4. The development environment shall not require any real external provider credentials to start.

### Requirement 6: Environment Configuration and Validation

**Objective:** As a developer, I want configuration via validated environment variables with no committed secrets, so that the application fails fast and stays secure.

#### Acceptance Criteria

1. The system shall load runtime configuration from environment variables rather than hard-coded values.
2. When the application starts, the system shall validate that all required environment variables are present and well-formed.
3. If a required environment variable is missing or invalid, then the application shall fail to start and report the offending variable name without exposing its value.
4. The repository shall include an example environment file that lists required variable names without real secret values.
5. The system shall not commit secrets, tokens, or credentials to the repository.

### Requirement 7: Health Checks

**Objective:** As an operator, I want health endpoints, so that liveness and readiness can be monitored.

#### Acceptance Criteria

1. The API service shall expose a liveness endpoint that returns a success status while the process is running.
2. The API service shall expose a readiness endpoint that returns success only when its required dependencies are reachable.
3. If a required dependency is unreachable, then the readiness endpoint shall return a non-success status.

### Requirement 8: Testing Harness

**Objective:** As a developer, I want a base testing setup that supports deterministic financial-rule tests, so that domain invariants can be covered from the start.

#### Acceptance Criteria

1. The system shall provide a unit-testing setup that runs via a single command.
2. The system shall support integration tests that run against a real PostgreSQL instance.
3. The testing harness shall allow the current time/clock to be injected so date-sensitive logic is deterministic in tests.
4. The testing harness shall allow external providers to be substituted with fake/log implementations in tests.
5. When the test command runs, the system shall execute the suite and exit with a non-zero status if any test fails.

### Requirement 9: Linting and Formatting

**Objective:** As a developer, I want consistent linting and formatting, so that code style is uniform and issues are caught early.

#### Acceptance Criteria

1. The system shall provide a lint command covering all applications and packages.
2. The system shall provide a formatting command (or formatting check) that applies a single shared style across the monorepo.
3. If the lint command detects violations, then the system shall exit with a non-zero status.

### Requirement 10: Project Documentation

**Objective:** As a new contributor, I want a README, so that I can set up and run the project quickly.

#### Acceptance Criteria

1. The README shall document the prerequisites and how to start the local development environment.
2. The README shall document how to run the applications, tests, linting, and formatting.
3. The README shall document the required environment variables and reference the example environment file.

### Requirement 11: Dependency and Supply-Chain Security

**Objective:** As a maintainer, I want pinned, hardened, reproducible dependency management, so that the project resists supply-chain attacks and installs deterministically.

#### Acceptance Criteria

1. The root `package.json` shall pin an exact package manager version and an explicit Node engine range, and shall declare a compatible pnpm engine range.
2. The project shall commit `pnpm-lock.yaml` and treat it as the trusted source of truth; reproducible installs shall use a frozen lockfile.
3. The workspace shall save direct dependencies with exact versions (no dynamic semver ranges) and configure dependency hardening: a minimum release age, blocking of exotic transitive sources, and explicit approval of dependency build/lifecycle scripts.
4. When the configured pnpm version does not support or honor a required hardening setting, the supply-chain setup shall be treated as incomplete and the design shall be revisited before proceeding.
5. The project shall provide reproducible install and security-audit scripts suitable for CI usage (without committing any CI pipeline file).
6. If a dependency defines build/lifecycle scripts, then those scripts shall not run without explicit approval.
