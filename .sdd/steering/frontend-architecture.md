# Frontend Architecture (Next.js Web App)

Steering for `apps/web`. The backend owns all financial truth ([[tech]]); the
frontend renders it, collects input, and never computes invoices, installments,
schedules, or reminder eligibility. Stack: **Next.js (App Router) + React +
TypeScript (strict) + Zod**; tests with **Vitest + Testing Library**.

## App Router Structure

- One route segment per business capability, mirroring backend features:
  `app/(public)/login`, `app/(app)/dashboard`, `app/(app)/expenses`,
  `app/(app)/bills`, `app/(app)/cards`, `app/(app)/imports`,
  `app/(app)/reminders`.
- **Route groups split public vs authenticated**: `(public)` (login/register)
  and `(app)` (everything else, wrapped by the authenticated layout with
  nav/sidebar/header). New authenticated pages go under `(app)` and inherit
  protection — no per-page auth wiring.
- Pages stay thin: a page composes feature components; data access and
  behavior live in the feature's components/hooks, not in `page.tsx`.

## Authenticated vs Public Routes

- **Client-side protection (MVP)**: the `(app)` layout checks for a session
  (stored JWT) and redirects to `/login` when absent or when any API call
  returns `UNAUTHORIZED`. Deny by default: a new route is protected unless
  deliberately placed in `(public)`.
- The JWT is never put in URLs or logs. Session expiry (401 from the API) must
  degrade to a redirect-to-login, never a broken page.

## API Client Pattern

- **Single typed client** (`src/lib/api/`), the only place that touches
  `fetch` and `NEXT_PUBLIC_API_BASE_URL` (via `src/env.ts` — the only public
  config; never secrets). Feature code calls typed functions
  (`listExpenses(...)`), never raw `fetch`.
- Request/response types come from **`@paypilot/shared`** where a contract
  exists; do not redeclare shared shapes locally.
- The client attaches the bearer token, parses errors into the canonical
  envelope, and returns a discriminated result or throws a single typed
  `ApiError` — one failure shape for the whole app.

## Error Handling (canonical envelope)

- Every non-2xx response is parsed as the shared `ErrorResponse`
  (`{ error: { code, message, requestId, timestamp, details? } }`).
- Map by `code`, not by HTTP status text: `VALIDATION_ERROR` → attach
  `details[{ field, issue }]` to the matching form fields; `UNAUTHORIZED` →
  session cleanup + redirect; `NOT_FOUND` → friendly not-found state;
  `TOO_MANY_REQUESTS`/`INTERNAL_ERROR` → retryable generic message showing the
  `requestId` for support correlation.
- Never render raw backend messages as the primary UX for known codes; never
  swallow the `requestId`.

## Forms & Validation

- **Zod schema per form**, validated client-side before submit; the schema
  mirrors (never widens) the backend DTO rules — e.g. positive integer minor
  units, uppercase `BRL`, `YYYY-MM-DD` dates, E.164 phone.
- Client validation is UX only; the backend remains the authority. Backend
  `VALIDATION_ERROR.details` must land on the same fields the Zod schema
  validates (shared field naming).
- Amount inputs accept user-friendly text (`1.234,56`) but submit **integer
  minor units**; conversion helpers live in one shared module, never inline.

## Loading / Empty / Error States

Every data-bearing view implements all four states — loading (skeleton or
spinner), **empty (first-class: guidance + primary action, not a blank
table)**, error (message + requestId + retry), and loaded. Shared primitives
(`<Loading />`, `<EmptyState />`, `<ErrorState />`) keep them consistent;
specs list which states each screen shows.

## Money & Date Display

- Money arrives as **integer minor units + explicit currency** and is
  formatted only at render time via a single shared formatter
  (`formatMoney(amountMinor, "BRL")` → `R$ 1.234,56`) — deterministic manual
  grouping, mirroring the API's reminder-message convention. **Never
  float-math on amounts in the frontend.**
- Dates are **date-only `YYYY-MM-DD` strings end-to-end**; render via a shared
  `formatDate` without constructing timezone-shifted `Date` objects (no
  `new Date("YYYY-MM-DD")` display math — string formatting only).

## Component Organization

- `src/components/ui/` — minimal reusable primitives (Button, Input, Field,
  Modal, EmptyState…): named by function, export component + props interface,
  **no business logic, no API calls**. This is a pattern library, not a design
  system (deliberately minimal for the MVP).
- `src/features/<feature>/` — feature components/hooks (mirror backend feature
  names: expenses, bills, cards, imports, reminders). May call the API client.
- Dependency direction: `app/` routes → `features/` → `components/ui/` +
  `lib/`. Never the reverse; `ui/` imports nothing from `features/`.

## Testing Expectations

- **Vitest + Testing Library (jsdom)**, colocated `*.test.tsx`. Test behavior
  through the DOM (roles/labels), not implementation details.
- Priorities: form validation + submit wiring, error-envelope rendering
  (incl. field mapping and requestId display), route-protection redirect,
  money/date formatters (pure unit tests), the four view states.
- **No real API calls in tests** — mock the API client module (the single
  boundary makes this cheap). Financial assertions use integer minor units.

## Accessibility Basics

- Semantic HTML first (`<button>`, `<nav>`, `<main>`, tables for tabular
  data). Every input has a `<label>`; validation messages are associated via
  `aria-describedby` and announced (`role="alert"` on form-level errors).
- Interactive elements are keyboard-reachable with visible focus; loading
  states use `aria-busy`/live regions rather than visual-only spinners.
  Testing-Library queries by role/label double as the enforcement mechanism.

## Frontend vs Backend vs Full-Stack Specs

- **Frontend-only spec**: consumes existing API endpoints as-is (screens,
  navigation, formatting, client state). Must list which endpoints it reads.
- **Backend-only spec**: new/changed endpoints, schema, jobs, providers — no
  UI beyond what already exists.
- **Full-stack spec**: requires BOTH a new/changed API contract and its UI.
  The requirements phase must state the split explicitly and identify backend
  gaps (new read models/endpoints) as their own numbered requirements, so a
  frontend spec never silently grows a backend.
- Shared request/response contracts introduced by any spec land in
  `packages/shared`, never duplicated on one side.

---

_Created 2026-07-06 for the phase-2 (frontend) specs. Update only when a
pattern changes — new screens that follow these patterns need no edit here._
