# Requirements Document

## Project Description (Input)

web-mvp-shell: build the initial authenticated web application shell for PayPilot.

Scope:

- Next.js web app foundation for the user-facing MVP.
- Login/register screens consuming the existing auth-jwt API.
- Authenticated layout with navigation/sidebar/header.
- Basic route protection on the client.
- API client layer for the existing backend.
- Error handling based on the backend canonical error envelope.
- Empty/loading/error states pattern.
- Shared UI conventions for forms, validation messages, money/date display, and request errors.
- Initial pages/routes for:
  - dashboard
  - manual expenses
  - recurring bills
  - credit cards/invoices
  - CSV imports
  - reminders/settings

Out of scope:

- complex charts
- advanced dashboard analytics
- editing every backend entity in full detail
- real payment settlement
- real WhatsApp integration
- mobile app
- full design system beyond a minimal reusable component pattern

Goal:
Make the PayPilot web app navigable and ready for feature-specific UI specs.

## Introduction

This specification turns the scaffold-only Next.js app (`apps/web`) into the **authenticated web shell** of PayPilot: public register/login screens over the existing auth-jwt API, a protected application layout with navigation for all six product areas, a single typed API client over the `packages/shared` contracts, and the shared UI conventions (forms + Zod validation, canonical-error rendering, loading/empty/error states, money/date formatting) that every future feature-UI spec will build on.

Per [[frontend-architecture]], this is a **frontend-only spec**: it consumes existing API endpoints as-is and introduces no backend change. Endpoints consumed: `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `GET /api/v1/auth/me`, `GET /api/v1/expenses`, `GET /api/v1/recurring-bills`, `GET /api/v1/credit-cards`, `GET /api/v1/credit-cards/:cardId/invoices/:cycle`, `POST /api/v1/imports`, `GET /api/v1/imports/:id`, `GET /api/v1/reminders/settings`, `PUT /api/v1/reminders/settings`. The frontend computes **no financial logic** ([[tech]]): amounts arrive as integer minor units and are formatted only at render time; dates stay `YYYY-MM-DD` strings end-to-end.

The initial feature pages are deliberately shallow: owner-scoped **read/list views** (plus the two flows whose UI is inherently part of the shell — CSV upload and reminder settings), proving the conventions end-to-end. Full CRUD editing per entity arrives in feature-specific UI specs on top of this shell.

**Backend API prerequisites.** This spec may define pages and API-client functions for backend features whose specs are approved even where an endpoint is not yet available in a given environment (all 11 endpoints listed above are implemented on `main` at the time of writing; the clause guards environment/timing gaps). The rules: (a) **final integration acceptance requires the corresponding backend APIs to exist**; (b) during frontend development, pages and tests may mock the API-client boundary; (c) if an endpoint is unavailable at runtime, the UI shall fail gracefully through the shared `ErrorState` — the shell itself never breaks; (d) this spec shall **not** implement, modify, or stub backend endpoints.

**Shared contract placement.** The design may promote request/response shapes consumed by the web app to `packages/shared`, under these constraints: web-mvp-shell remains frontend-only and backend behavior must not change; updating the API to import the new shared types is **optional** and shall only happen where it introduces zero backend logic changes; otherwise the type-drift risk is documented and backend adoption is left for a future cleanup spec.

**Out of scope (deliberately excluded):** create/edit/delete UIs for expenses, bills, cards, and purchases (beyond what is listed here); the real monthly dashboard (own spec: monthly-dashboard); paid/unpaid actions in the UI (own spec: bill-payments); complex charts or analytics; server-side rendering of authenticated data / middleware-based auth (client-side protection is the MVP baseline); refresh tokens or session persistence beyond the stored access token; offline support; mobile app; i18n beyond a single fixed locale (pt-BR display, en codebase); and any full design system.

## Requirements

### Requirement 1: Public Authentication Screens
**Objective:** As a visitor, I want to register and log in from the browser, so that I can access my PayPilot data without any API tooling.

#### Acceptance Criteria
1. The Web App shall provide public `/login` and `/register` routes rendering forms with client-side Zod validation mirroring the backend rules (email format; password rules as enforced by auth-jwt), validated before submit.
2. When registration succeeds, the Web App shall either log the user in (register → login flow) or direct them to log in, per a single documented flow decided in design.
3. When login succeeds, the Web App shall store the access token per the documented session-storage decision (design fixes the mechanism), and shall redirect to the authenticated dashboard route.
4. If login or registration fails, then the Web App shall render the canonical-error mapping (Requirement 5) — including field-level details for `VALIDATION_ERROR` and a non-enumerating message for invalid credentials/conflict — without clearing the whole form.
5. When an authenticated user triggers logout, the Web App shall discard the stored session and redirect to `/login`.
6. The Web App shall never place the JWT in URLs, query strings, or logs.

### Requirement 2: Session Handling and Route Protection
**Objective:** As the system, I want authenticated routes protected on the client, so that unauthenticated visitors always land on login and expired sessions degrade gracefully.

#### Acceptance Criteria
1. The Web App shall organize routes into a public group (login/register) and an authenticated group (everything else); every route in the authenticated group shall be protected by the shared authenticated layout with no per-page auth wiring (deny by default).
2. While no session is present, when a visitor navigates to any authenticated route, the Web App shall redirect to `/login` without rendering protected content or issuing authenticated API calls.
3. If any API call returns the `UNAUTHORIZED` error code, then the Web App shall discard the session and redirect to `/login` (session-expiry degradation — never a broken page).
4. When a session is present, the Web App shall resolve the current user via `GET /api/v1/auth/me` for display in the shell; while this resolution is pending, the shell shall show a loading state rather than flashing protected content.
5. The design shall document the chosen token-storage mechanism and its trade-offs explicitly. Where browser storage (e.g. localStorage + in-memory mirror) is chosen, the design shall state that: it is an MVP UX decision carrying a residual XSS-exposure risk; the API remains the security boundary (client-side protection is a UX guard only); tokens are never logged or placed in URLs (per 1.6); and future auth-hardening shall consider httpOnly cookies and/or a refresh-token flow.

### Requirement 3: Authenticated Application Shell
**Objective:** As a user, I want a consistent layout with navigation, so that every PayPilot area is reachable in one click.

#### Acceptance Criteria
1. The Web App shall render authenticated pages inside a shared shell containing a header (product name, current user identification, logout control) and a navigation sidebar listing exactly: Dashboard, Expenses, Recurring bills, Cards & invoices, CSV imports, Reminders/settings.
2. When the user navigates, the Web App shall mark the active area in the navigation and shall keep the shell stable (no full-page reload between authenticated routes).
3. The Web App shall provide a dashboard route that renders a simple navigable landing (greeting + links/shortcuts into the areas); the real monthly overview is out of scope (monthly-dashboard spec).
4. The shell and navigation shall be keyboard-operable and expose landmarks (`nav`, `main`) per Requirement 9.

### Requirement 4: Typed API Client Layer
**Objective:** As a maintainer, I want a single typed boundary to the backend, so that features never hand-roll `fetch` calls and contracts stay consistent.

#### Acceptance Criteria
1. The Web App shall access the backend exclusively through a single API-client module: feature code shall not call `fetch` directly nor read `NEXT_PUBLIC_API_BASE_URL` outside it.
2. The API client shall expose typed functions per endpoint consumed by this spec, reusing `packages/shared` contracts where they exist (e.g. `ErrorResponse`, `ErrorCode`) and defining request/response types once for the rest.
3. The API client shall attach the stored bearer token to authenticated requests and shall not attach it to public auth requests.
4. If a response is non-2xx, then the API client shall parse the body as the canonical `ErrorResponse` and surface exactly one typed failure shape (e.g. `ApiError` carrying `code`, `message`, `requestId`, `details?`) to callers; a non-parseable failure body shall degrade to an `INTERNAL_ERROR`-equivalent typed failure, never an unhandled exception shape.
5. The API client shall support multipart upload for the CSV import endpoint within the same error contract.

### Requirement 5: Canonical Error Handling UX
**Objective:** As a user, I want clear, actionable error feedback, so that failures tell me what to fix or how to get help.

#### Acceptance Criteria
1. The Web App shall map failures by canonical `code`: `VALIDATION_ERROR` → attach each `details[].issue` to the form field matching `details[].field` (with a form-level fallback for unmatched fields); `UNAUTHORIZED` → Requirement 2.3; `NOT_FOUND` → friendly not-found state; `CONFLICT` → actionable message on the offending flow; `TOO_MANY_REQUESTS` and `INTERNAL_ERROR` → generic retryable message.
2. Error surfaces for request-level failures shall display the `requestId` for support correlation and shall offer a retry action where the operation is safely repeatable (reads; idempotent writes).
3. The Web App shall not render raw backend messages as the primary UX for known codes and shall never log tokens or full error bodies to the browser console in production builds.

### Requirement 6: Initial Feature Pages (read/list slices)
**Objective:** As a user, I want each product area to show my real data, so that the app is genuinely navigable before deep feature UIs exist.

#### Acceptance Criteria
1. The Web App shall provide an Expenses page listing the user's manual expenses via `GET /api/v1/expenses` with pagination controls honoring the API's `page`/`pageSize` contract, rendering amount (formatted per Requirement 7), date, description, and category.
2. The Web App shall provide a Recurring-bills page listing the user's bills via `GET /api/v1/recurring-bills` (amount, day of month, description, active status), with the API's pagination/`active` filter surfaced minimally.
3. The Web App shall provide a Cards page listing the user's credit cards via `GET /api/v1/credit-cards` (label, closing day, due day, active status) and, per card, a way to view one invoice cycle (cycle input or navigation) rendering the derived invoice (due date, total, transactions) via the existing invoice read endpoint.
4. The Web App shall provide a CSV-imports page with a file-upload form posting to `POST /api/v1/imports` (multipart), rendering the returned summary (totals, imported/duplicate/invalid counts, invalid rows with line number + reason code) and handling 400/413 whole-file rejections via Requirement 5; it shall allow fetching a past run by id via `GET /api/v1/imports/:id`.
5. The Web App shall provide a Reminders/settings page that reads `GET /api/v1/reminders/settings` and updates via `PUT /api/v1/reminders/settings` (E.164 phone + enabled flag) with Zod validation mirroring the backend format and field-level error mapping.
6. Every page in this requirement shall implement the four view states of Requirement 8 and shall render only the authenticated user's data (owner-scoping comes from the API; the Web App shall send no user identifiers of its own).
7. If a consumed endpoint is unavailable at runtime (unreachable, or an unexpected failure shape), then the affected page shall degrade to the shared error state while the shell (layout, navigation, other pages) remains fully functional; final acceptance of each page requires the corresponding backend API to exist, while automated tests exercise the mocked API-client boundary. This spec shall not implement or modify any backend endpoint.

### Requirement 7: Money and Date Display Conventions
**Objective:** As a maintainer, I want one deterministic way to render money and dates, so that financial display can never drift from the backend's conventions.

#### Acceptance Criteria
1. The Web App shall render monetary amounts from **integer minor units + explicit currency** through a single shared formatter (`R$ 1.234,56` for BRL, deterministic manual grouping); floating-point arithmetic shall not be used on amounts anywhere in the frontend.
2. Where a form accepts an amount, the Web App shall accept user-friendly decimal input and convert to integer minor units in one shared helper before submit; unparseable input shall fail Zod validation client-side.
3. The Web App shall treat dates as date-only `YYYY-MM-DD` strings end-to-end and shall format them for display via a shared string-based formatter without constructing timezone-shifting `Date` objects for display math.
4. The formatters shall have unit tests covering grouping, cents, and date edge cases.

### Requirement 8: Loading, Empty, and Error States
**Objective:** As a user, I want every screen to communicate its state, so that slow, empty, and failed loads are never a blank or broken page.

#### Acceptance Criteria
1. Every data-bearing view shall implement four states: loading (skeleton/spinner with `aria-busy`), empty (first-class: guidance text + a primary action where applicable), error (message + `requestId` + retry per Requirement 5.2), and loaded.
2. The Web App shall implement these states via shared primitives (e.g. `Loading`, `EmptyState`, `ErrorState`) reused across all pages of Requirement 6 — no page-local one-off state markup.
3. While an authenticated page's data is loading, previously rendered data from another user shall never be displayed (no stale cross-session leakage after logout/login).

### Requirement 9: Accessibility Basics
**Objective:** As a user relying on assistive tech or a keyboard, I want the shell and forms operable, so that the MVP is not exclusionary from day one.

#### Acceptance Criteria
1. Every form input shall have an associated label; validation messages shall be programmatically associated (`aria-describedby`) and form-level errors announced via `role="alert"`.
2. All interactive elements shall be keyboard-reachable with visible focus; navigation and content shall use semantic landmarks (`nav`, `main`, headings; tables for tabular data).
3. Accessibility affordances shall be exercised by tests through role/label-based queries (Requirement 10).

### Requirement 10: Test Coverage
**Objective:** As a maintainer, I want the shell's behavior protected by tests, so that conventions cannot regress as feature UIs land on top.

#### Acceptance Criteria
1. The Web App shall cover with automated tests (Vitest + Testing Library, jsdom): login/register form validation and submit wiring; canonical-error rendering including `VALIDATION_ERROR` field mapping and `requestId` display; route-protection redirect for unauthenticated access; `UNAUTHORIZED` session-expiry handling; the four view states on at least one representative list page; the CSV upload summary rendering; reminder-settings round-trip; and the money/date formatters (pure unit tests).
2. Tests shall mock the API-client module at its boundary; no test shall perform real network calls.
3. Tests shall query by role/label (enforcing Requirement 9) and shall assert monetary values via integer minor units at the boundary and formatted strings at render.
