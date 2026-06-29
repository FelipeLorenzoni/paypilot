# Foundation Verification Checklist

Run from the repo root after `corepack enable && pnpm install && pnpm db:generate`.
Docker must be running (Postgres + integration tests).

## Quality gates

| Command                          | Expected                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | exit 0; lockfile unchanged                                                          |
| `pnpm lint`                      | exit 0                                                                              |
| `pnpm format:check`              | exit 0; "All matched files use Prettier code style!"                                |
| `pnpm test`                      | all workspace suites pass (unit + web + integration; **requires Docker**)           |
| `pnpm build`                     | all workspaces build                                                                |
| `pnpm security:audit`            | exit 0 (no high/critical; remaining moderate findings tracked in `supply-chain.md`) |

Last verified: all green (Node 24.18.0, pnpm 11.9.0).

## Runtime

| Check                 | Command                                    | Expected                                                              |
| --------------------- | ------------------------------------------ | --------------------------------------------------------------------- |
| Database up           | `docker compose up -d`                     | `paypilot-postgres` becomes `healthy`                                 |
| Liveness              | `GET /api/v1/health/live`                  | `200 { "status": "up" }`                                              |
| Readiness (DB up)     | `GET /api/v1/health/ready`                 | `200 { "status": "up", "checks": { "database": "up" } }`              |
| Readiness (DB down)   | stop Postgres, `GET /api/v1/health/ready`  | `503` (canonical error envelope)                                      |
| Valid-env boot        | `node apps/api/dist/main.js` (with `.env`) | starts; health endpoints respond                                      |
| Invalid-env fail-fast | run with `DATABASE_URL` unset              | exits non-zero; logs `Offending variable(s): DATABASE_URL` (no value) |

Last verified: liveness 200, readiness 200/503, valid boot OK, fail-fast exits 1 naming `DATABASE_URL`.
