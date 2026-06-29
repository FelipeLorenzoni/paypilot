# Dependency & Supply-Chain Security

This document records PayPilot's dependency-hardening configuration and the
verification that the pinned package manager honors each control. It satisfies
Requirement 11 and the supply-chain section of the foundation design.

## Package manager

- Pinned exactly via `packageManager: "pnpm@11.9.0"` (Corepack) in the root `package.json`.
- Engine guards: `engines.node: ">=24 <25"`, `engines.pnpm: ">=11 <12"`.
- Resolution verified: `corepack`/registry resolves `pnpm@11.9.0`
  (`https://registry.npmjs.org/pnpm/11.9.0` returns a valid manifest + tarball).

## Hardening configuration

Configured in `pnpm-workspace.yaml`:

```yaml
savePrefix: ""
minimumReleaseAge: 1440
blockExoticSubdeps: true
auditLevel: high
allowBuilds:
  "@swc/core": false
  unrs-resolver: false
```

## Verification (pnpm 11.9.0)

Method: `pnpm install` emits **no "Unknown setting" warnings**, and
`pnpm config list` shows each key present in the **effective** configuration
(an unrecognized key would be absent). Functional checks performed where
practical.

| Key                  | Configured            | Verification method                                                                                                         | Result                                                 |
| -------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `savePrefix`         | `""` (exact)          | `pnpm add is-number` (no `-E`) then inspect `package.json`                                                                  | Saved as `is-number: 7.0.0` (no `^`/`~`) — **honored** |
| `minimumReleaseAge`  | `1440` (24h)          | present in `pnpm config list`; `pnpm install` reports `✓ Lockfile passes supply-chain policies`                             | Recognized + enforced (pnpm 11 enables it by default)  |
| `blockExoticSubdeps` | `true`                | present in `pnpm config list`; no unknown-setting warning                                                                   | Recognized + enforced via lockfile policy check        |
| `allowBuilds`        | map (deny by default) | `@swc/core` / `unrs-resolver` build scripts were blocked during install (`ERR_PNPM_IGNORED_BUILDS`) until explicitly listed | Recognized + enforced                                  |

Outcome: all four hardening keys are supported and honored by pnpm 11.9.0.
No design revision required (design acceptance criterion / R11.4 satisfied).

## Build-script approval

- Dependency lifecycle/build scripts do **not** run without explicit approval
  (`allowBuilds`). Current decisions:
  - `@swc/core` → `false` (uses prebuilt platform binaries; build not needed).
  - `unrs-resolver` → `false` (prebuilt; build not needed).
- To approve a new package's build when genuinely required: run
  `pnpm approve-builds` (script: `security:approve-builds`) and record the entry
  in `allowBuilds`.

## Auditing

- `pnpm security:audit` → `pnpm audit --audit-level high`
- `pnpm security:audit:prod` → `pnpm audit --prod --audit-level high`

### Overrides (force-patched transitive vulnerabilities)

- **multer `>=2.2.0`** (`pnpm-workspace.yaml` `overrides`) — `@nestjs/platform-express`
  pulls in multer `<2.2.0` (high-severity DoS via deeply nested field names). Not
  exercised (no multipart endpoints), but overridden to clear the high advisory;
  api build/tests verified compatible.

### Security exceptions

An unresolved high/critical audit finding requires a documented exception below
(affected package, rationale, revisit date). Prefer upgrading/removing or an
override before creating an exception. **No high/critical exceptions at this time.**

| Package  | Advisory | Rationale | Revisit by |
| -------- | -------- | --------- | ---------- |
| _(none)_ |          |           |            |

> `pnpm audit --audit-level high` currently passes (exit 0). A few **moderate**
> advisories remain in dev/transitive tooling; they are below the enforced `high`
> gate and require no exception. Re-audit when dependencies are updated.
