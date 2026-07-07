# Research & Design Decisions — web-mvp-shell

## Summary

- **Feature**: `web-mvp-shell`
- **Discovery Scope**: Extension (light discovery; builds on `gap-analysis.md`)
- **Key Findings**:
  - All 11 consumed endpoints are implemented and integration-tested on `main`; the response shapes to type are small and stable (`{ accessToken }`, `{ data, meta: { page, pageSize, total } }` lists, `InvoiceView`, `ImportSummary`, `ReminderSettingsView`).
  - `apps/web` needs no new **prod** dependency: Zod is installed for forms, CSS Modules are Next-native for styling, and a ~100-line hand-rolled hook pair covers the data-fetching needs of read/list pages.
  - The only new dependency is dev-only: `@testing-library/user-event` **14.6.1** (checked 2026-07-07: zero runtime deps, no lifecycle scripts, last publish 2025-12-13 ≫ `minimumReleaseAge`) — policy-compliant, pinned exact.
  - Next App Router route groups (`(public)`/`(app)`) give the deny-by-default protected layout for free; a segment-level `error.tsx` in `(app)` is the safety net that keeps the shell alive when a page crashes (requirement 6.7).

## Research Log

### Token storage (requirement 2.5, clarification 3)

- **Context**: JWT session must survive navigation; cookie issuance would need backend work (out of scope for a frontend-only spec).
- **Findings**: Three options — memory-only (logout on reload), localStorage (XSS-readable), httpOnly cookie (backend change). No refresh-token flow exists (access TTL 5m–1h).
- **Implications**: **localStorage + in-memory mirror** selected as an MVP UX decision with the residual XSS risk documented verbatim in design (API stays the security boundary; client protection is UX-only; tokens never in URLs/logs; auth-hardening spec should consider httpOnly cookies and/or refresh tokens). The mirror avoids repeated storage reads and lets logout clear both synchronously.

### Data fetching: hand-rolled hooks vs TanStack Query

- **Findings**: The shell's pages are shallow reads + three mutations (login/register/settings/upload). TanStack Query's value (cache invalidation, background refetch) is unused at this depth and adds a prod dependency chain.
- **Implications**: `useApiQuery` / `useApiMutation` (thin, typed, states = `loading | empty | error | loaded` mapping 1:1 to requirement 8). Revisit TanStack Query in a later data-heavy spec; the hook API is deliberately shaped so a swap stays inside `lib/api`.

### Styling

- **Findings**: Zero styling infra exists. Tailwind adds a build-time dependency chain; the spec's out-of-scope line says "no full design system".
- **Implications**: **CSS Modules + a single `tokens.css`** (spacing/color/typography custom properties). Component-scoped styles colocated (`button.module.css`). No new dependency; enough for a minimal, consistent component pattern.

### Shared contract placement (clarification 2)

- **Context**: Steering says spec-introduced shared contracts land in `packages/shared`; the API types its responses internally and does not import response types from shared today.
- **Implications**: Promote the consumed request/response shapes to `packages/shared/src/api/` (auth, pagination meta, expense/bill/card/invoice views, import summary, reminder settings) — single source for the web. **Backend adoption is NOT done in this spec** (frontend-only; zero backend edits at all, the conservative reading of "optional"): the drift risk (API changes a response, shared type goes stale) is documented in design; mitigation is a future cleanup spec having the API controllers/mappers implement the shared types, plus integration smoke once e2e tooling exists.

### `@testing-library/user-event` policy check

- **Sources Consulted**: `npm view @testing-library/user-event` (2026-07-07).
- **Findings**: v14.6.1; `dependencies: {}`; no install scripts; last publish 2025-12-13.
- **Implications**: Add as exact-pinned devDependency of `@paypilot/web`; satisfies `savePrefix ""`, `minimumReleaseAge`, `allowBuilds` untouched.

### Keeping the shell alive when a page fails (requirement 6.7)

- **Findings**: App Router `error.tsx` at the `(app)` segment catches render/runtime errors below the layout, preserving nav/header; expected API failures never throw to React anyway (the client returns typed failures rendered as `ErrorState`).
- **Implications**: Two layers — typed `ApiError` → per-page `ErrorState` (normal path, incl. endpoint-unavailable mapped to a retryable failure), and `(app)/error.tsx` as the unexpected-crash net. The shell chrome renders independently of page data.

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
| ------ | ----------- | --------- | ------------------- | ----- |
| A — Ad hoc pages under `app/` | Each page self-contained | Fast start | Re-solves auth/errors/states per page; violates steering | Rejected |
| B — Instantiate steering structure (selected) | `lib/api` + `lib/session` + `lib/format` + `components/ui` + `features/` + route groups | Conventions built once, copied by every future UI spec; purely additive | More upfront files | Matches `frontend-architecture.md` verbatim |
| C — B + TanStack Query + Tailwind | Stronger data/styling base | Better for data-heavy UIs later | Two new dependency chains for a minimal shell | Deferred; hook/API shape keeps the swap cheap |

## Design Decisions

### Decision: Auto-login after successful registration
- **Alternatives**: redirect-to-login (simpler, extra user step).
- **Selected**: register → login call with the same credentials → dashboard. Both endpoints exist; one less dead end; the register form reuses the login mutation path.
- **Trade-offs**: two sequential requests on one submit; failure between them degrades to the login screen with a prompt (documented flow).

### Decision: Session in localStorage + in-memory mirror
- See Research Log (token storage). Risk statement reproduced in design.md Security Considerations, per clarification 3.

### Decision: Contracts promoted to `packages/shared`, backend untouched
- See Research Log (shared contract placement). Zero `apps/api` edits in this spec.

### Decision: Invoice-cycle navigation via cycle picker on the Cards page
- **Context**: The invoice read requires (cardId, cycle); no "list cycles" endpoint exists.
- **Selected**: each card row exposes a `YYYY-MM` cycle picker (defaulting to the current month) linking to `cards/[cardId]/invoices/[cycle]`; a 404 renders the friendly not-found state ("no invoice for this cycle").
- **Trade-offs**: user may pick empty cycles (guided by the not-found state); avoids inventing a backend endpoint (frontend-only constraint).

## Risks & Mitigations

- **XSS token exposure (localStorage)** — MVP decision, documented; API remains the boundary; no third-party scripts in the app; revisit in auth-hardening (httpOnly cookie / refresh flow).
- **Type drift between shared contracts and API responses** — documented; future cleanup spec makes the API implement the shared types; runtime failures degrade via `ErrorState`, never crash the shell.
- **Client-side-only protection** — UX guard, not security (steering already states it); every page's data comes owner-scoped from the API.
- **No e2e coverage of the real HTTP boundary** — unit/component tests mock the client per requirement 10.2; a future spec can add Playwright against the real API.

## References

- `.sdd/specs/web-mvp-shell/gap-analysis.md` — asset map and options this design resolves
- `.sdd/steering/frontend-architecture.md` — the structure/conventions instantiated here
- `packages/shared/src/errors.ts` — canonical envelope consumed by the client
- npm registry — `@testing-library/user-event` 14.6.1 policy check (2026-07-07)
