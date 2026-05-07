# QUALITY_GAP_ANALYSIS.md

Last updated: 2026-05-07
Repo: `devnw/codepros/geode/geode-ui`
Source: `/codepros:audit` Phase 4 — quality-issue-tracker

## Scope

This document tracks the quality findings produced by the `/codepros:audit` Phase 3 deep
review of `geode-ui` (Go server under `internal/server/`, React/TypeScript UI under `src/`,
plus repo-level toolchain). Findings are scored with the codepros quality-scoring framework
(`PriorityScore = Impact × Likelihood × 4`, range 0-100). Each finding has a corresponding
GitLab issue with file:line evidence, recommended fix, and acceptance criteria.

Out of scope here: performance, security, and gap-analysis findings — those are tracked in
their own GAP files.

## Tool Results Summary

| Tool                 | Result      | Notes                                                                                  |
|----------------------|-------------|----------------------------------------------------------------------------------------|
| `tsc --noEmit`       | clean (post-Q11) | Q11 closed (`1fda90a` + `0e22763`); type-check now green.                          |
| ESLint               | clean       | No new violations on changed files.                                                    |
| Prettier             | clean       | `pnpm format:check` clean.                                                             |
| Jest (`pnpm test`)   | green       | No `--coverage` threshold enforced (see Q14).                                          |
| `go vet ./...`       | clean       |                                                                                        |
| `gofmt -l`           | clean       |                                                                                        |
| `go test -cover`     | server ~68.7% line coverage | Floor candidate for Q14 gate.                                            |
| `golangci-lint`      | not wired   | See Q13.                                                                               |
| `make web-build`     | green (post-Q11) | Q11 closed; build succeeds.                                                       |

## Findings Table (sorted by PriorityScore desc)

| ID  | Title                                                                | Severity | Score | Issue                                                                                | File:Line                                                                                                      | Action / Status                                                                |
|-----|----------------------------------------------------------------------|----------|-------|--------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------|
| Q1  | Split util.go (318 LOC, 6 concerns) into focused files               | High     |    80 | [#27](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/27)              | `internal/server/util.go` (whole file)                                                                          | **Closed** 2026-05-07 (`55b5e69`) -- split into context.go / quoting.go / sqlexec.go / coerce.go (errors_test pinning kept). |
| Q2  | Extract shared `useApiResource` hook with AbortController **[CLOSED]** | High   |    80 | [#29](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/29)              | `src/hooks/useApiResource.ts` (new); migrated `UsersPage.tsx`, `RolesPage.tsx`, `PoliciesPage.tsx`, `BackupPage.tsx`, `MigrationsPage.tsx`, `AuditLogPage.tsx` (6 pages; `RestorePage.tsx` had no on-mount fetch to migrate) | **Closed** 2026-05-07 (`2b28b85`) -- hook owns AbortController + mounted/aborted guards; pages call `refetch()` after mutations. AuditLogPage poll gated on `document.visibilityState`. |
| Q3  | Rename `userDB`/`userErr`/`userResponseErr`/`userRowToMap`           | High     |    80 | [#31](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/31)              | `internal/server/handlers_backups.go:62, :135, :162, :189, :212`                                                | Rename to db()/responseErr()/rowToMap() or move to handlers_common.go           |
| Q4  | `PatchUsername` runs 3 statements without a transaction              | High     |    80 | [#32](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/32)              | `internal/server/handlers_users.go:154-171`                                                                      | **Closed** 2026-05-07 (`af74e47`) -- Email/Password/Roles wrapped in BEGIN/COMMIT with rollback-on-error; tests cover partial-failure paths. |
| Q5  | MigrationsPage raw fetch bypasses typed `@api` client                | Medium   |    48 | [#34](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/34)              | `src/components/ops/MigrationsPage.tsx:305-318`                                                                  | Add typed multipart endpoint to genapi config; remove raw fetch                  |
| Q6  | `isWireFeatureMissing` substring sniffing of driver messages         | Medium   |    48 | [#36](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/36)              | `internal/server/util.go:144-162`                                                                                | Prefer typed errors; pin substring fallbacks in `errors_test.go`                |
| Q7  | `emitAudit` errors swallowed at 8 call sites                         | Medium   |    48 | [#37](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/37)              | `internal/server/handlers_users.go:107, :188, :238, :265` and `handlers_backups.go:119, :177, :203, :235`        | Log+continue or fail-hard; pick one policy and apply consistently               |
| Q8  | Inconsistent contract: typed `User`/`Permission` vs `[]jsontext.Value` | Medium |    48 | [#38](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/38)              | `internal/server/handlers_users.go:53-302`                                                                       | Pick one shape (typed) and migrate all list responses                           |
| Q9  | DRY: 9 user handlers repeat `userDB`+`quoteIdent` preamble           | Medium   |    40 | [#41](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/41)              | `internal/server/handlers_users.go` (9 sites)                                                                    | Extract `withUserDBAndIdent(ctx, name, fn)`                                     |
| Q11 | Drop `@types/cytoscape` — blocks `make web-build`                    | Medium   |    40 | [#43](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/43)              | `package.json` devDependencies                                                                                    | **Closed** 2026-05-07 (`1fda90a`, `0e22763`) -- stub removed; tsc errors uncovered by removal fixed in follow-up commit; `make web-build` now succeeds. |
| Q13 | Adopt `golangci-lint` (errcheck, staticcheck, ...)                   | Low      |    36 | [#46](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/46)              | (repo root) `.golangci.yml`, `Makefile`, `.gitlab-ci.yml`                                                         | Add config, `make lint` target, CI lint job                                     |
| Q14 | Wire coverage gates (Go ~68.7% floor, Jest threshold)                | Low      |    32 | [#48](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/48)              | (repo root) CI + Jest config                                                                                      | Enforce floors; ratchet up monthly                                              |
| Q10 | Missing `docs/adr/` + `internal/server/README.md`                    | Low      |    24 | [#42](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/42)              | `docs/adr/` (missing), `internal/server/README.md` (missing)                                                      | Create ADR dir + package README; collapse per-file 30-line preambles            |
| Q12 | Two lockfiles committed (`package-lock.json` + `pnpm-lock.yaml`)     | Low      |    24 | [#44](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/44)              | `package-lock.json`, `pnpm-lock.yaml`                                                                              | Delete `package-lock.json`; gitignore                                            |
| Q15 | Pin Node toolchain (`.tool-versions`/`.nvmrc` + `packageManager`)    | Low      |    24 | [#49](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/49)              | (repo root) `.tool-versions`, `.nvmrc`, `package.json`                                                            | Add the three artifacts; consistent with CI image                               |

### Counts by Severity

- High: 4
- Medium: 6 (includes Q11 bumped from Low because it blocks `make web-build`)
- Low: 5

## Findings by Category

### Architecture / Maintainability (Q1, Q3, Q9, Q10)

Catch-all files, name leakage, and missing package-level docs. Mechanical fixes; the work is
mostly bookkeeping with an outsized payoff in code-review velocity.

### Correctness / Data integrity (Q4, Q6, Q7)

Q4 (`PatchUsername` non-atomic) is the only finding with a direct production-data risk in
this batch. Q6 and Q7 are observability traps — they hide failures rather than create them.

### API / Contract (Q5, Q8)

The typed-client boundary is leaking on both sides (raw fetch in TS, raw `jsontext.Value` in
Go). Best fixed together so the genapi config is the single source of truth.

### Frontend reliability (Q2, Q11)

Q2 (AbortController) is the highest-leverage frontend change — it touches six pages and
removes a whole class of stale-data bugs. Q11 unblocks the build right now.

### CI / Tooling (Q12, Q13, Q14, Q15)

Standard hygiene. Each is small alone; together they upgrade the floor of every future MR.

## Roadmap

### Quick wins (< 1 day each)

- Q11 — drop `@types/cytoscape` (unblocks `make web-build`).
- Q12 — delete `package-lock.json`.
- Q15 — pin Node toolchain.
- Q3 — rename `user*` helpers (mechanical s/// + test).
- Q10 — create `docs/adr/` + `internal/server/README.md` skeleton.

### Medium (1-5 days each)

- Q1 — split `util.go`.
- Q2 — extract `useApiResource` and migrate 6+ pages.
- Q4 — wrap `PatchUsername` in a transaction (incl. tests for partial-failure paths).
- Q6 — typed-error path + `errors_test.go` pinning.
- Q7 — pick audit-failure policy and apply across 8 sites.
- Q9 — extract `withUserDBAndIdent` (depends on Q3 rename direction).
- Q13 — wire `golangci-lint` and burn down initial findings.
- Q14 — wire coverage gates.

### Strategic (> 5 days)

- Q5 + Q8 — tighten the typed-client boundary end-to-end (genapi config additions, regenerate
  client, fix downstream callers, remove `jsontext.Value` from list responses). Best done as
  one coordinated MR with the genapi maintainer.

## Verdict

**B+ overall.** The codebase is fundamentally sound: type-checked TS, vetted/formatted Go,
generated API client, clean ESLint/Prettier, Jest/Go tests in place. The Phase 3 reviewer
language captures it precisely — there are no architectural smoking guns, no security
nightmares hiding in the handler family, and no panic-inducing dependency choices.

What keeps this from an A is concentrated in a small number of well-localized smells:
a 318-line catch-all (`util.go`), a missing transactional boundary on a user-facing PATCH,
seven copy-pasted `useEffect`/`fetch` shells without cancellation, and one currently-broken
build path (`@types/cytoscape`). Every one of them is mechanically fixable in days, not
weeks. Closing the four High-severity items alone would move the rating to A-.

The strongest signal that the team has a healthy quality posture: the issues are findable.
Naming is consistent enough that "show me everywhere `userDB` is called from a non-user
file" is a one-liner. That is the precondition for everything in this report being
actionable rather than aspirational.
