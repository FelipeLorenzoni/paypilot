# Implementation Plan — web-mvp-shell (Executor-Grade)

> **Frontend-only spec**: builds the authenticated shell in `apps/web` + contracts in `packages/shared`. **Zero edits under `apps/api`** — the 11 consumed endpoints are already shipped; tests mock the API-client boundary; runtime endpoint unavailability degrades via the shared `ErrorState` (requirement 6.7). **Out of scope:** backend changes, full CRUD UIs, the real monthly dashboard, paid/unpaid UI, charts, SSR of authenticated data, refresh tokens, Tailwind/TanStack Query (deferred — research.md), i18n.
>
> **Navigation ownership (validate-design fix, applied):** the API client detects `UNAUTHORIZED`, clears the session, and notifies via the SessionStore subscription; **AuthProvider/the `(app)` layout owns every redirect** — the client never navigates.
>
> `(P)` = parallel-safe (independent files). Tasks 4.1–4.5 are additionally parallel **among themselves** once tasks 1–3 land (each owns its own `features/<area>/` + route folder; shared files are frozen by then). Each task ends with `_Requirements: <ids>_`. Conventions per [[frontend-architecture]]: `app/` → `features/` → `components/ui` + `lib/`; CSS Modules + `tokens.css`; money as integer minor units via `lib/format`; dates as `YYYY-MM-DD` strings; tests with Vitest + Testing Library + user-event, querying by role/label, **no network**.

---

## 1. Foundations: contracts, formatters, UI primitives

- [x] 1.1 (P) Shared API contracts in `packages/shared`

  **Goal**
  One typed source for every request/response shape the web consumes; API untouched.

  **Deliverables**
  - `packages/shared/src/api/`: `AuthCredentials`, `AuthTokenResponse`, `MeResponse`, `PageMeta`, `Paginated<T>`, `ExpenseView`, `RecurringBillView`, `CreditCardView`, `InvoiceView` (+ its transaction line shape), `ImportSummary` (+ invalid-row shape), `ImportRunView`, `ReminderSettingsView` — field-for-field the shapes the API returns today (amounts integer minor units; dates `YYYY-MM-DD`; cycles `YYYY-MM`), exported from the package index.
  - Doc comment on the module stating the drift constraint (API does not import these yet; future cleanup spec — design.md clarification 2).

  **Acceptance criteria**
  - `pnpm --filter @paypilot/shared build`/`test` green; no `apps/api` file touched; types compile in web when imported.

  **Verification**
  - `pnpm type-check`.

  _Requirements: 4.2_

- [x] 1.2 (P) Formatters: money, date, amount input (pure + unit-tested)

  **Goal**
  The single deterministic money/date rendering path (no floats, no `Date` display math).

  **Deliverables**
  - `apps/web/src/lib/format/`: `formatMoney(amountMinor, "BRL")` → `R$ 1.234,56` (manual grouping — the API reminder-formatter algorithm); `parseAmountInput(text)` → integer minor units or null (accepts `1.234,56` and `1234.56` forms); `formatDate(dateIso)` → `DD/MM/YYYY` by string slicing (no `Date` construction for display).
  - Unit tests: grouping/cents edges (`1` → `R$ 0,01`, thousands, millions), invalid amount input → null, date edges, determinism.

  **Acceptance criteria**
  - No floating-point arithmetic on amounts anywhere in the module; identical output regardless of process TZ/locale.

  **Verification**
  - `pnpm --filter @paypilot/web test`.

  _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 1.3 (P) UI primitives + tokens (accessibility built in)

  **Goal**
  The minimal reusable component pattern every page copies — states + a11y solved once.

  **Deliverables**
  - `apps/web/src/app/tokens.css` (spacing/color/typography custom properties) imported by the root layout; CSS Modules per component.
  - `apps/web/src/components/ui/`: `Field` (label + input + `aria-describedby` error), `FormError` (`role="alert"`), `Button` (pending state), `Loading` (`aria-busy`), `EmptyState` (guidance + optional action), `ErrorState` (message + `requestId` + retry button), `Pagination`, `Table`. No business logic, no API imports.
  - Component tests (role/label queries): Field error association, FormError announcement, ErrorState renders requestId + fires retry, EmptyState action.
  - Dev dependency **`@testing-library/user-event` pinned exact `14.6.1`** (policy-checked in research.md); lockfile updated.

  **Acceptance criteria**
  - All primitives keyboard-operable with visible focus; `pnpm install --frozen-lockfile` reproduces; `pnpm security:audit` stays green.

  **Verification**
  - `pnpm --filter @paypilot/web test`; `pnpm lint`.

  _Requirements: 5.2, 8.1, 8.2, 9.1, 9.2, 9.3_

---

## 2. Session and API client

- [x] 2.1 SessionStore (localStorage + memory mirror + subscription)

  **Goal**
  Token persistence with change notification — the hook AuthProvider redirects from.

  **Deliverables**
  - `apps/web/src/lib/session/session-store.ts`: `get/set/clear/subscribe` — localStorage-backed with in-memory mirror (SSR-safe guards), `clear` idempotent, `subscribe` returns unsubscribe; listeners fired on set/clear.
  - Unit tests: round-trip, mirror consistency, subscription fired on clear/set, unsubscribe, no token ever passed to any logger.

  **Acceptance criteria**
  - No navigation and no React imports in this module; token never serialized anywhere except the storage key.

  **Verification**
  - `pnpm --filter @paypilot/web test`.

  _Requirements: 1.6, 2.5_

- [x] 2.2 Typed API client + `ApiError` + endpoint modules + query/mutation hooks

  **Goal**
  The single fetch boundary: typed results, canonical-error parsing, no navigation.

  **Deliverables**
  - `apps/web/src/lib/api/`: http core (`request(path, { method, body?, auth?, formData? })` reading `env.NEXT_PUBLIC_API_BASE_URL`, attaching bearer from SessionStore when `auth`); `ApiError` (`code | "NETWORK_ERROR"`, `message`, `requestId`, `details?`) parsed from the shared `ErrorResponse` (unparseable/network → `NETWORK_ERROR`, retryable); **on `UNAUTHORIZED`: `SessionStore.clear()` + typed error returned — no redirect here** (design fix); endpoint modules `auth/expenses/bills/cards/imports/reminders` typed by the 1.1 contracts (imports via `FormData` multipart).
  - `useApiQuery` (four states `loading|empty|error|loaded`, `retry()`, deps-driven refetch, component-local state) and `useApiMutation` (`run`, `pending`, `error`).
  - Unit tests (mocked `fetch`): bearer attach on/off, envelope parse incl. `details`, unparseable → `NETWORK_ERROR`, UNAUTHORIZED clears session without navigating, multipart path, hook state transitions incl. empty detection and retry.

  **Acceptance criteria**
  - No `fetch`/base-URL reference outside `lib/api`; no router/`window.location` inside it; expected failures never throw into React.

  **Verification**
  - `pnpm --filter @paypilot/web test`; `pnpm type-check`.

  _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 8.1, 8.3_

---

## 3. Routes, guard, shell, and auth screens

- [x] 3.1 Route groups + AuthProvider guard + app shell + dashboard landing + crash net

  **Goal**
  Deny-by-default protected area with the navigable shell; redirects owned here and only here.

  **Deliverables**
  - `app/(public)/` and `app/(app)/` route groups; `(app)/layout.tsx` renders `AuthProvider` + shell (header: product name, user email from `getMe`, logout button; sidebar nav: Dashboard, Expenses, Recurring bills, Cards & invoices, CSV imports, Reminders/settings — active-state marking via pathname).
  - `AuthProvider` (`lib/session/auth-context.tsx`): no token → redirect `/login`; token → `getMe()` with full-page `Loading` while pending (no content flash); **subscribes to SessionStore and redirects `/login` on clear** (logout or client-detected UNAUTHORIZED); exposes `useAuth(): { user, logout }`.
  - `(app)/dashboard/page.tsx`: greeting + shortcut links to the five areas (landing only). `(app)/error.tsx`: segment crash net rendering `ErrorState` inside the shell.
  - Tests: unauthenticated visit → redirected (router mocked); pending `getMe` → loading, no protected content; session-clear subscription triggers redirect; nav lists the six areas with landmarks (`nav`, `main`); logout clears + redirects.

  **Acceptance criteria**
  - No per-page auth wiring anywhere; a page throwing at render keeps header/sidebar functional; every redirect in the codebase lives in `AuthProvider`.

  **Verification**
  - `pnpm --filter @paypilot/web test`; `pnpm --filter @paypilot/web build`.

  _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 6.7, 8.1_

- [x] 3.2 Login and register pages (Zod + canonical-error mapping + auto-login)

  **Goal**
  The public entry: validated forms proving the form/error conventions end-to-end.

  **Deliverables**
  - `(public)/login/page.tsx` + `(public)/register/page.tsx` with `features/auth/` form components: Zod schemas (email format; password per auth-jwt rules), submit via `useApiMutation`; login success → `SessionStore.set` + redirect dashboard; register success → **auto-login** (register → login; mid-flow failure lands on `/login` with a prompt); links between the two screens.
  - Error mapping: `VALIDATION_ERROR.details[].field` → matching `Field` errors (form-level fallback), `UNAUTHORIZED` (bad credentials) / `CONFLICT` (email exists) → non-enumerating form-level message with `requestId`; form values preserved on failure.
  - Tests (user-event): Zod messages block submit; success path stores token + redirects; each error mapping; values preserved; labels/roles per a11y.

  **Acceptance criteria**
  - Token never appears in URLs or console; both pages reachable while unauthenticated only (authenticated visit → dashboard redirect, decided in design's guard).

  **Verification**
  - `pnpm --filter @paypilot/web test`.

  _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 5.1, 5.3, 9.1_

---

## 4. Feature pages (parallel after tasks 1–3)

- [x] 4.1 (P) Expenses page

  **Deliverables**
  - `(app)/expenses` + `features/expenses/`: paginated list via `GET /expenses` (`Paginated<ExpenseView>`), columns amount (`formatMoney`), date (`formatDate`), description, category; `Pagination` honoring `page`/`pageSize`; four states (`EmptyState` with guidance).
  - Tests: four states, pagination triggers refetch, formatted values, role/label queries.

  _Requirements: 6.1, 6.6, 6.7, 8.1, 8.2_

- [x] 4.2 (P) Recurring-bills page

  **Deliverables**
  - `(app)/bills` + `features/bills/`: paginated list via `GET /recurring-bills` (amount, day of month, description, active badge) + minimal `active` filter surfaced; four states.
  - Tests: list render, filter wiring, four states.

  _Requirements: 6.2, 6.6, 6.7, 8.1, 8.2_

- [x] 4.3 (P) Cards page + invoice view

  **Deliverables**
  - `(app)/cards` + `features/cards/`: card list via `GET /credit-cards` (label, closing/due day, active); per card a `YYYY-MM` cycle picker (defaulting to current month) linking to `(app)/cards/[cardId]/invoices/[cycle]`, which renders the derived invoice (due date, `formatMoney` total, transaction rows) via `GET /credit-cards/:cardId/invoices/:cycle`; invoice 404 → friendly not-found state ("no invoice for this cycle").
  - Tests: card list, picker navigation, invoice render, 404 mapping, four states.

  _Requirements: 6.3, 6.6, 6.7, 5.1, 8.1_

- [x] 4.4 (P) CSV-imports page

  **Deliverables**
  - `(app)/imports` + `features/imports/`: upload form (`file` input) posting multipart to `POST /imports`; summary render (totals + imported/duplicate/invalid counts + invalid rows table with line number/reason code); 400/413 whole-file rejections → form-level error with `requestId`; run lookup by id via `GET /imports/:id` rendering `ImportRunView`.
  - Tests: successful upload renders summary, 413/400 mapping, run lookup incl. `NOT_FOUND`, four states.

  _Requirements: 6.4, 6.6, 6.7, 5.1, 5.2, 8.1_

- [x] 4.5 (P) Reminders/settings page

  **Deliverables**
  - `(app)/reminders` + `features/reminders/`: settings form over `GET/PUT /reminders/settings` (E.164 phone with Zod mirroring `^\+[1-9]\d{7,14}$`, enabled toggle); server `VALIDATION_ERROR` mapped to fields; saved state confirmation.
  - Tests: round-trip render/update, invalid phone blocked client-side, server error mapping, four states.

  _Requirements: 6.5, 6.6, 6.7, 5.1, 8.1, 9.1_

---

## 5. Final gate

- [x] 5.1 README (web section) + full quality gate

  **Goal**
  Document the web app and confirm the monorepo gate is green end-to-end.

  **Deliverables**
  - README: web app section (routes map, auth flow incl. the localStorage trade-off pointer to the security note, dev workflow `pnpm --filter @paypilot/web dev`, env var), updated Quality commands if needed.

  **Acceptance criteria**
  - `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm format:check`, `pnpm type-check`, `pnpm test` (incl. API integration — must stay green untouched), `pnpm build`, `pnpm security:audit` all pass; `git diff --stat` shows no `apps/api` changes.

  **Verification**
  - Run the full gate; record results.

  _Requirements: 6.7, 10.1, 10.2, 10.3_
