# Project Structure

## Organization Philosophy

Monorepo with clear app boundaries, and **feature/domain-first organization inside the backend**. Code is grouped by business capability (expenses, bills, cards, imports, reminders), not by technical layer spread across the whole app. Within a feature, separate the layers: transport (controllers) → application (use-cases/services) → domain (entities + rules) → data (Prisma repositories). Pure financial rules live in the domain layer with no framework imports so they can be unit-tested directly.

## Directory Patterns

> Proposed; the foundation spec finalizes and creates these. Document the _pattern_, let files follow it.

### Backend apps

**Location**: `apps/api/src/<feature>/`
**Purpose**: One folder per domain feature, each self-contained (module, controller, service/use-cases, domain logic, repository, DTOs, tests).
**Example**: `apps/api/src/bills/`, `apps/api/src/cards/`, `apps/api/src/reminders/`

### Provider abstractions

**Location**: `apps/api/src/integrations/<provider-kind>/`
**Purpose**: An interface plus interchangeable implementations (real + fake/log). Features depend on the interface, never a concrete provider. See [[integrations]].
**Example**: `integrations/notifications/` with `NotificationProvider` + `LogNotificationProvider` + `WhatsAppNotificationProvider`

### Frontend

**Location**: `apps/web/`
**Purpose**: Next.js UI. Calls the API; holds no financial computation.

### Shared

**Location**: `packages/` (e.g. `packages/shared`)
**Purpose**: Types/contracts shared between web and api.

## Naming Conventions

- **Files**: kebab-case (`recurring-bill.service.ts`, `invoice-assignment.ts`)
- **Classes / types**: PascalCase (`RecurringBill`, `NotificationProvider`)
- **Functions / variables**: camelCase
- **Database**: `snake_case`, plural tables, `{table}_id` foreign keys — see [[financial-rules]] and database conventions

## Import Organization

```typescript
import { InvoiceAssignmentService } from "@/cards/invoice-assignment.service"; // absolute, app-internal
import { NotificationProvider } from "@/integrations/notifications"; // depend on interface
import { toMinorUnits } from "./money"; // relative, same feature
```

**Path Aliases**:

- `@/`: backend app `src/` root (confirm in foundation spec)

## Code Organization Principles

- **Dependency direction points inward**: controllers depend on use-cases, use-cases on domain; domain depends on nothing framework-specific.
- **Financial rules are isolated and pure** so tests don't need a database or HTTP. Side-effecting concerns (DB, providers, time) are injected.
- **Time and money are inputs, not globals**: pass `now`/clock and amounts in explicitly so date- and money-sensitive rules ([[financial-rules]]) are deterministic in tests.
- **Specs map to features**: a new `.sdd/specs/<feature>` should usually correspond to one backend feature folder.

---

_Document patterns, not file trees. New files following patterns shouldn't require updates_
