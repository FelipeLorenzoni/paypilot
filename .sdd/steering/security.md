# Security Standards

## Philosophy

Secure by default, fail closed, validate at boundaries. PayPilot handles personal financial data, so least privilege and not leaking data through logs matter as much as auth correctness.

## Secrets & Configuration (invariant R8 — see [[financial-rules]])

- **Never commit secrets** — API tokens, provider credentials, DB URLs, JWT signing keys. The repo ships `.env.example` with names only; real values live in environment/secret store and are git-ignored.
- **Validate required env vars at startup; fail fast** if missing or malformed. The app must not boot half-configured.
- Provider credentials are absent in development by default — the fake/log provider needs none ([[integrations]]).

## Authentication & Authorization

- **JWT initially** (per stack decision). Issue short-lived tokens; keep the signing secret in env. Centralize auth in guards/middleware — don't duplicate checks per handler.
- **Authorization is per-user data isolation**: every financial record (expense, bill, card, invoice, import) belongs to a user, and queries are always scoped to the authenticated user. A user must never read or mutate another user's financial data. Deny by default.
- Reject unauthenticated/unauthorized requests before business logic runs.

## Input & Output

- Validate at the API boundary with typed DTOs; reject early. CSV import is untrusted input — validate structure, size, and field formats before processing, and bound resource usage.
- Money and dates are parsed/validated, not trusted raw from clients or CSVs.

## Sensitive Data & Logging

- Minimize collection; scope access to the owning user.
- **Never log** secrets, JWTs, full PII, or full request/CSV bodies. Log operation, userId, error code, and a requestId for correlation. Notification provider logs (incl. the dev log provider) must not dump credentials.

## Transport

- TLS in deployed environments; security headers on the API. (Local Docker Compose may run plain HTTP.)

---

_Patterns and posture. Concrete configs live in ops/deployment docs._
