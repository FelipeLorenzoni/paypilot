# Gap Analysis — manual-expenses

## Current State (existing assets)

The foundation + auth-jwt already provide most of the plumbing this feature needs:

| Asset | Location | Reuse for manual-expenses |
|-------|----------|---------------------------|
| Global `JwtAuthGuard` | `apps/api/src/auth/jwt-auth.guard.ts` | Expense routes are protected by default (no extra wiring); 401 handled |
| `@CurrentUser()` | `apps/api/src/auth/current-user.decorator.ts` | Inject the owning user's id (token-derived) |
| `assertOwnership` | `apps/api/src/common/ownership.ts` | 404-like cross-user denial |
| `UsersRepository` pattern | `apps/api/src/users/users.repository.ts` | Template for an `ExpensesRepository` over `PrismaService` |
| `PrismaService` | `apps/api/src/prisma/` | DB access; add `Expense`/`Transaction` model + migration |
| `AllExceptionsFilter` + `ErrorCode` | `apps/api/src/common/` | Canonical 400/401/404 envelope, requestId — no new error infra |
| Global `ValidationPipe` + DTO pattern | foundation + `auth/dto/*` | Request validation template |
| `Money` value object | `@paypilot/shared` (`amountMinor: number`, `currency`) | In-code money representation (R7) |
| Conventions | `docs/conventions.md` | money minor units, date-only, UTC timestamps |
| Testcontainers integration pattern | `apps/api/test/auth.int.spec.ts` | Template for expenses integration tests |
| Feature-module pattern | `auth.module.ts`, `users.module.ts` | Template for `ExpensesModule` |

**Conventions extracted:** kebab-case files, feature folders under `apps/api/src/<feature>/`, repository over `PrismaService`, DTOs with class-validator, `*.spec.ts` co-located unit + `test/*.int.spec.ts` integration, exact-version deps, per-route throttle defaults already global.

## Requirement → Asset Map (gaps tagged)

| Requirement | Existing asset | Gap |
|-------------|----------------|-----|
| R1–R5 CRUD | controller/service/DTO + ValidationPipe patterns | **Missing:** `ExpensesController/Service/Repository`, DTOs |
| R6 isolation | `@CurrentUser`, `assertOwnership`, scoped queries | **Constraint:** must scope every query by `userId` |
| R7 money/date | `Money`, conventions | **Unknown:** Prisma `BigInt` ↔ `Money.amountMinor: number` mapping |
| R8 persistence/ledger | `PrismaService`, `User` model + migration flow | **Missing:** ledger model + migration; **Decision:** model shape/extensibility, onDelete |
| R9 errors | `AllExceptionsFilter`, `ErrorCode` | None (reuse) |
| R10 tests | Jest + Testcontainers harness | **Missing:** expense unit + integration tests |

## Key Research / Decisions for Design

1. **BigInt ↔ number mapping (main risk).** Conventions say store money as `BIGINT` minor units, but `Money.amountMinor` is a JS `number` (safe integer) and Prisma maps `BigInt` columns to JS `bigint`. Design must define the boundary conversion (read `bigint` → validate `Number.isSafeInteger` → `number`; reject/flag overflow) **or** reconsider the column type. This is the one genuinely new integration concern.
2. **Model name / ledger shape (R8.3).** Generic `Transaction` (with a `source = MANUAL` enum + nullable feature-specific columns) vs. a dedicated `Expense` model now and generalize later. Affects how recurring-bills/cards/CSV extend it.
3. **Ownership enforcement style (R6).** Prefer scoping queries by `userId` in `WHERE` (cross-user simply "not found" → 404) over fetch-then-`assertOwnership` (avoids a TOCTOU window). Decide whether `assertOwnership` is still used as a guard rail.
4. **Date-only column.** Prisma `@db.Date` for `expenseDate`; confirm driver-adapter (pg) round-trips date-only cleanly.
5. **Pagination style** (offset `page/pageSize` vs cursor) and default ordering index (`userId, expenseDate desc`).
6. **onDelete** for the user FK: cascade vs restrict.

## Implementation Approach Options

- **Option A — Extend existing modules:** put expenses logic into existing files. ❌ Rejected — auth/users modules have a distinct responsibility; expenses is a new domain.
- **Option B — New `ExpensesModule` (recommended):** new `expenses/` feature folder (controller, service, repository, dto, model) mirroring the auth/users pattern, reusing guard/decorators/ownership/error/Money. ✅ Clean separation, isolated tests, matches structure steering.
- **Option C — Hybrid (ledger core + expense facade):** build a generic `ledger`/`transactions` module now and an expenses facade on top. ✅ Future-proofs R8.3; ❌ more upfront design for a single current consumer. Reasonable if the team wants the generic ledger immediately.

## Effort & Risk

- **Effort: M (3–7 days-equivalent).** Mostly CRUD + model + migration + tests reusing established patterns.
- **Risk: Low–Medium.** Low for CRUD/isolation (well-trodden here); Medium concentrated in the BigInt↔Money mapping and the ledger-shape decision (R8.3) — both are design-time decisions, not unknowns in tooling.

## Recommendations for Design

- Go with **Option B** (new `ExpensesModule`); keep the model named to reflect the ledger intent and document the extensibility path (lean toward a generic `Transaction` + `source` if recurring-bills/cards are imminent — they are, per the roadmap).
- **Resolve the BigInt↔number boundary explicitly** in the design (with a tested conversion helper), tied to the `Money` future-proofing note in `docs/conventions.md`.
- Enforce isolation via **userId-scoped queries** as the primary mechanism; use `assertOwnership` only where a record is fetched before mutation.
- Carry research items 1–6 above into the design phase.
