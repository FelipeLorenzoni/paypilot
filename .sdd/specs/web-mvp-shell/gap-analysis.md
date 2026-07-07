# Gap Analysis — web-mvp-shell

## Current State (existing assets)

| Asset | Location | Reuse |
|-------|----------|-------|
| Next.js 16 (App Router) + React 19 + TS strict scaffold | `apps/web` | The foundation this spec fills in; currently ONE public page + root layout, no route groups |
| Validated public env (`NEXT_PUBLIC_API_BASE_URL`, zod) | `apps/web/src/env.ts` | The API client's only config source (steering: the single public config) |
| Vitest + Testing Library (jsdom) harness, colocated `*.test.tsx` | `apps/web/vitest.config.ts`, `page.test.tsx` | Test setup exists and runs in the monorepo gate (`pnpm test:unit`) |
| Shared contracts: `ErrorCode`, `ErrorResponse`, `ErrorDetail`, `Money`, `createMoney` | `packages/shared` | Error envelope typing for the API client; money type |
| Backend API surface (11 endpoints, all shipped and integration-tested) | `apps/api` | Everything Req 6 lists exists: auth (`{ accessToken }`), paginated lists (`{ data, meta: { page, pageSize, total } }`), derived invoice view, multipart import + summary, reminder settings |
| Canonical error envelope produced by `AllExceptionsFilter` (incl. `VALIDATION_ERROR.details[{field,issue}]`, `requestId`) | `apps/api/src/common` | The exact shape Req 5 maps; field names align with DTOs |
| Frontend steering (route groups, client boundary, conventions) | `.sdd/steering/frontend-architecture.md` | The structure this spec instantiates — written for it |
| Reminder message BRL formatting precedent (manual grouping, minor units) | `apps/api/src/reminders/domain/reminder-message.ts` | Template for the web `formatMoney` (same deterministic algorithm) |
| Zod 4 (already a web dependency) | `apps/web/package.json` | Form schemas — no new dependency |

**Notable absences:** no route groups / protected layout; no login/register pages; no session storage or auth context; **no API client** (nothing calls the API today); no `components/ui/` or `features/` folders; **no styling setup at all** (no CSS file, no library); no data-fetching pattern; no endpoint request/response TS contracts anywhere (`packages/shared` has only errors + money — auth/list/invoice/import/settings shapes are typed only inside the API's controllers/services); no `@testing-library/user-event`; no logout endpoint in the API (logout is purely client-side session discard — consistent with Req 1.5).

## Requirement → Asset Map (gaps tagged)

| Requirement | Existing | Gap |
|-------------|----------|-----|
| 1 Auth screens | auth API + envelope | **Missing:** pages/forms/flows; **Decision:** post-register flow (auto-login vs redirect) |
| 2 Session + protection | — | **Missing entirely.** **Decision:** token storage (localStorage vs memory vs cookie) — cookie would need backend work (out of scope for a frontend-only spec) |
| 3 App shell | root layout only | **Missing:** `(public)`/`(app)` groups, header/sidebar/nav, dashboard landing |
| 4 API client | `env.ts`, shared `ErrorResponse` | **Missing:** the client; **Decision:** where endpoint contracts live (promote to `packages/shared` vs define in `apps/web/src/lib/api`) — steering says spec-introduced shared contracts land in `packages/shared`, but the API does not consume TS response types from shared today (risk of drift either way; document) |
| 5 Error UX | envelope + codes shipped | **Missing:** `ApiError` + per-code mapping + `requestId` surfaces |
| 6 Feature pages | all endpoints live | **Missing:** 6 pages; **Decision:** invoice-cycle navigation UX (cycle input vs derived links); import-run lookup UX |
| 7 Money/date display | API reminder formatter as algorithm precedent | **Missing:** web `formatMoney`/`formatDate`/amount-input helper (+ unit tests) |
| 8 View states | — | **Missing:** `Loading`/`EmptyState`/`ErrorState` primitives; **Constraint:** no stale cross-user data after logout (cache keyed/cleared by session) |
| 9 Accessibility | — | **Missing:** conventions applied in `ui/` primitives (labels, `aria-describedby`, `role="alert"`, landmarks) |
| 10 Tests | vitest harness + 1 smoke test | **Missing:** all behavioral tests; **Likely new dev-dep:** `@testing-library/user-event` (supply-chain policy applies: exact pin, release age) |

## Key Research / Decisions for Design

1. **Token storage (Req 2 — main security trade-off).** Options: **(a, lean recommendation for MVP)** `localStorage` + in-memory mirror — survives reload, simple, XSS-exposed (documented residual risk; no cookie infra exists); **(b)** memory-only — safest, but every reload logs out (poor UX); **(c)** httpOnly cookie — best security but requires backend cookie issuance/CORS work → out of scope here, candidate for a later auth-hardening spec. Design must document the choice + risk explicitly.
2. **Data-fetching pattern.** Options: **(a, recommendation)** a small hand-rolled `useApiQuery`/`useApiMutation` hook pair over the typed client (zero new prod deps — supply-chain-friendly; four states map 1:1) vs **(b)** TanStack Query (caching/retries for free, one more prod dep + learning surface for a shell this shallow). Revisit (b) when feature UIs get data-heavy.
3. **Styling approach.** Nothing exists. Options: **(a, recommendation)** CSS Modules + a small set of design tokens (zero deps, Next-native, enough for a minimal component pattern) vs **(b)** Tailwind (faster iteration, new build-time dep chain). The out-of-scope list ("no full design system") favors (a).
4. **Endpoint contract placement.** (a) types module inside `apps/web/src/lib/api` (fast, but duplicates shapes the API already types internally) vs **(b, recommendation)** promote the small response/request contracts consumed here (auth, pagination meta, expense/bill/card/invoice views, import summary, reminder settings) to `packages/shared` per steering, adopting them API-side opportunistically in later specs. Decide + document drift mitigation.
5. **Post-register flow (Req 1.2).** Auto-login (register → login call → dashboard; smoother) vs redirect-to-login (simpler, one flow). Recommend auto-login — both endpoints exist.
6. **Auth-pending UX (Req 2.4).** `GET /auth/me` gate on the `(app)` layout: loading state pattern to avoid protected-content flash; define once in the layout.
7. **New dev dependency.** `@testing-library/user-event` for form interaction tests — verify exact pin + `minimumReleaseAge` against the supply-chain policy (research in design).
8. **Route/page inventory.** Fix the exact route map (`(public)/login`, `(public)/register`, `(app)/dashboard|expenses|bills|cards|imports|reminders`) and which shared primitives each page consumes, so tasks parallelize per page.

## Implementation Approach Options

- **Option A — Grow pages ad hoc under `app/`:** ❌ no shared client/primitives; each page would re-solve auth, errors, and states; violates the steering just written.
- **Option B — Instantiate the steering structure (recommended):** `src/lib/api/` (typed client + `ApiError`), `src/lib/session/` (storage + auth context), `src/lib/format/` (money/date), `src/components/ui/` (Field/Button/Loading/EmptyState/ErrorState…), `src/features/<area>/` (page bodies), `app/(public)` + `app/(app)` route groups with the protected layout. Contracts promoted to `packages/shared` (decision 4b). Pure additive; nothing to migrate.
- **Option C — Option B + adopt TanStack Query and Tailwind now:** ✅ stronger base for data-heavy feature UIs later; ❌ two new dependency chains for a deliberately minimal shell, against the MVP's out-of-scope line. Defer unless design argues otherwise.

## Effort & Risk

- **Effort: M–L.** ~8 routes + client + session + primitives + conventions + tests; no backend work. The weight is in doing the conventions well once (they get copied by every future spec).
- **Risk: Medium-Low.** No financial logic and no schema/API risk. Concentrated in (a) token-storage trade-off (XSS exposure — documented, revisitable), (b) contract drift between web types and API responses (no runtime contract check; mitigate with shared types + integration smoke later), (c) client-side-only protection being a UX guard, not a security boundary (the API remains the enforcement point — steering already states this).

## Recommendations for Design

- **Option B.** localStorage+memory session (risk documented); hand-rolled query/mutation hooks; CSS Modules + tokens; contracts promoted to `packages/shared`; auto-login after register; `user-event` as the only new (dev) dependency, policy-checked.
- Fix the route/page inventory and the primitive set in design so tasks parallelize per page with no file contention.
- Carry decisions 1–8 into design; 1 (storage) and 4 (contract placement) need explicit resolution with trade-offs recorded.
