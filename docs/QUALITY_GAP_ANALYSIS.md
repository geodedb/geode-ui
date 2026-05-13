# QUALITY_GAP_ANALYSIS.md

Last updated: 2026-05-13 (audit cohort: 16 new findings filed #192–#208/#214–#215; #44 / #46 / #48 re-validated and re-comment-pinged)
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
| Q3  | Rename `userDB`/`userErr`/`userResponseErr`/`userRowToMap`           | High     |    80 | [#31](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/31)              | `internal/server/{errors,handlers_users,handlers_backups,handlers_grants,handlers_policies,handlers_migrations,handlers_roles}.go` | **Closed (resolved 2026-05-10)** — see [GAP_ANALYSIS_RESOLVED.md](./GAP_ANALYSIS_RESOLVED.md#q3-31-rename-user-helpers-to-drop-misleading-prefix-resolved). Closure commit `dfbe67a`. Package-wide rename: `userDB`→`connDB` (per-request `*sql.DB` for any wire-level handler), `userErr`→`wireErr` (driver-level wrap with 422/501 split), `userResponseErr`→`respondErr` (inline-write + return-nil), `userRowToMap`→`rowToMap` (open-shape SHOW-row projection used by users / policies / migrations / backups / roles). Stable HTTP `code` field `user_admin_error` preserved for client-API compatibility. Doc comments updated; `userFromRow` (genuinely user-typed) and `userFromContext` (actual current-user accessor) intentionally kept. `make go-test` and `make go-lint` clean. |
| Q4  | `PatchUsername` runs 3 statements without a transaction              | High     |    80 | [#32](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/32)              | `internal/server/handlers_users.go:154-171`                                                                      | **Closed** 2026-05-07 (`af74e47`) -- Email/Password/Roles wrapped in BEGIN/COMMIT with rollback-on-error; tests cover partial-failure paths. |
| Q5  | MigrationsPage raw fetch bypasses typed `@api` client                | Medium   |    48 | [#34](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/34)              | `src/components/ops/MigrationsPage.tsx`, `src/components/ops/RestorePage.tsx`, `internal/server/handlers_uploads.go`, `geode.json`                | **Closed (resolved 2026-05-11)** — see [GAP_ANALYSIS_RESOLVED.md](./GAP_ANALYSIS_RESOLVED.md#q5-34-typed-multipart-upload-endpoints-resolved); closure commit `2046289` (no genapi change needed). genapi already supports `"type": "file"` request-schema properties (multipart `multipart/form-data` handling: the React client emits a `FormData` builder + `multipart` bodyMode; the Go handler template wires `r.ParseMultipartForm` + `r.FormFile` + the per-file `maxSize` check upstream of the typed handler). The two upload endpoints (`POST /api/v1/backups/upload`, `POST /api/v1/migrations/upload`) are now declared in `geode.json` with `BackupUploadReq` / `MigrationUploadReq` (`{"file": {"type": "file", "maxSize": 67108864}}`) → `UploadResp`, the hand-rolled `mux.HandleFunc` calls are gone from `cmd/server/main.go`, and `internal/server/handlers_uploads.go` implements the generated `BackupUpload` / `MigrationUpload` methods (JWT auth + admin-role + 64 MiB cap + multipart parsing now come from the genapi wrapper; the handler owns only filename sanitisation, atomic write, the 503-when-no-upload-dir, and the audit event). `MigrationsPage.tsx` and `RestorePage.tsx` call `client.migrationUpload({file: {blob, filename, contentType}})` / `client.backupUpload(...)` — the FormData and `multipart/form-data` Content-Type are built by the generated client, with the cookie/CSRF/bearer auth attached by the shared `api/client.ts` fetch wrapper. Tests: `internal/server/handlers_uploads_test.go` rewritten to drive the typed handlers; `e2e/specs/09-ops.spec.ts` exercises the upload flow over the same HTTP path. |
| Q6  | `isWireFeatureMissing` substring sniffing of driver messages         | Medium   |    48 | [#36](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/36)              | `internal/server/errors.go:88-172` (was `util.go:144-162` pre-Q3 rename)                                          | **Closed (resolved 2026-05-10)** — see [GAP_ANALYSIS_RESOLVED.md](./GAP_ANALYSIS_RESOLVED.md#q6-36-typed-errors-for-iswirefeaturemissing-resolved). Closure commit `c949e8a`. Three-tier detection: (1) explicit `errWireFeatureMissing` sentinel callers can wrap via `%w`, (2) typed `statusClasser.StatusClass()=="42000"` via `errors.As`, (3) pinned-substring fallback. Accepted substrings live in `wireFeatureMissingSubstrings`; new file `internal/server/errors_test.go` exhaustively pins each entry — drift trips a loud test failure, not a silent behaviour change. Also covers `wireErr` upgrade-to-501 path. |
| Q7  | `emitAudit` errors swallowed at 8 call sites                         | Medium   |    48 | [#37](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/37)              | `internal/server/handlers_users.go:107, :188, :238, :265` and `handlers_backups.go:119, :177, :203, :235`        | **Closed (resolved 2026-05-10)** — see [GAP_ANALYSIS_RESOLVED.md](./GAP_ANALYSIS_RESOLVED.md#q7-37-safeemitaudit-policy-across-handler-sites-resolved). Closure commit `3c5c8fe`. Policy chosen: **best-effort log+continue** (audit is observability, not a security gate). `emitAudit` returns `void` by design; the policy is now sealed inside the helper via `defer recover()` that catches any slog/handler/ringbuffer panic and writes a one-line `AUDIT EMISSION FAILED ...` warning **directly to os.Stderr** (NOT via slog/log, which Go 1.21+ routes through slog and would re-panic on a broken handler). Test `TestEmitAudit_LogContinuePolicy` proves the policy with an injecting `panicHandler` slog sink. The pre-existing 8 call sites need no change because the function never had an error return — the gap-row count is preserved as historical context. |
| Q8  | Inconsistent contract: typed `User`/`Permission` vs `[]jsontext.Value` | Medium |    48 | [#38](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/38)              | `internal/server/handlers_users.go`, `geode.json`, `src/components/admin/UsersPage.tsx`                          | **Closed (resolved 2026-05-11)** — see [GAP_ANALYSIS_RESOLVED.md](./GAP_ANALYSIS_RESOLVED.md#q8-38-typed-user-and-permission-list-responses-resolved); closure commit `2046289` (no genapi change needed). genapi already supports typed list items via `"items": {"$ref": "Schema"}`, and geode-ui already had a hand-rolled `userFromRow` row-projection helper for the single-user endpoint. `geode.json` now declares `UserList.users` as `array<User>` and adds a `Permission` schema (`permission`/`resource`/`scope`) with `PermissionList.permissions` as `array<Permission>` — so `gen/types/types.gen.go` emits `UserList.Users []User` and `PermissionList.Permissions []Permission` and the React client gets typed `User[]` / `Permission[]`. `GetUsers` / `Permissions` in `handlers_users.go` build the typed slices via `userFromRow` / new `permissionFromRow`, which project the runtime-discovered `SHOW USERS` / `SHOW PERMISSIONS FOR USER` columns onto the known fields and drop unknowns with a once-per-process `warnRowDrift` log (so a future Geode catalogue column addition is visible in logs without a wire-shape regression). `src/components/admin/UsersPage.tsx` imports `User` from `@api` instead of re-declaring a structural shadow + casting `Array<unknown>`. Tests: `internal/server/handlers_users_test.go` (typed list happy-path, drift-drops-unknown-column, typed Permissions). |
| Q9  | DRY: 9 user handlers repeat `connDB`+`quoteIdent` preamble           | Medium   |    40 | [#41](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/41)              | `internal/server/handlers_users.go` (9 sites)                                                                    | **Closed (resolved 2026-05-10)** — see [GAP_ANALYSIS_RESOLVED.md](./GAP_ANALYSIS_RESOLVED.md#q9-41-extract-withconndbandident-helper-resolved). Closure commit `1b227da`. `withConnDBAndIdent(ctx, name, fn)` extracted in `handlers_users.go`; the 8 handler sites that pair `connDB` with `quoteIdent` (PostUsers, GetUsername, PatchUsername, DeleteUsername, Password, PostUsernameRoles, Permissions, toggleUser) now route through it. `GetUsers` retains the bare `connDB` call (no username to quote). Table-driven test `TestWithConnDBAndIdent_TableDriven` covers happy path, missing-active-connection (502 profile_unreachable), and invalid identifier (400 invalid_username). |
| Q11 | Drop `@types/cytoscape` — blocks `make web-build`                    | Medium   |    40 | [#43](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/43)              | `package.json` devDependencies                                                                                    | **Closed** 2026-05-07 (`1fda90a`, `0e22763`) -- stub removed; tsc errors uncovered by removal fixed in follow-up commit; `make web-build` now succeeds. |
| Q13 | Adopt `golangci-lint` (errcheck, staticcheck, ...)                   | Low      |    36 | [#46](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/46)              | `.pre-commit-config.yaml:130` runs `scripts/run-go.sh tool-golangci` at pre-push | **Partial (re-opened 2026-05-11 as GAP-018)** — pre-push hook is wired and uses the default linter set, but there is **no `.golangci.yml` config file at the repo root**, so the configurable linters called out in the acceptance criteria (`gocognit` / `nestif` / `dupl` / `gocyclo` / `revive`, etc.) are not engaged. The earlier "Closed" mark was incorrect: hook wiring satisfied half the work; the config file is still missing. Tracked at #46 / GAP-018. |
| Q14 | Wire coverage gates (Go ~68.7% floor, Jest threshold)                | Low      |    32 | [#48](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/48)              | (repo root) CI + Jest config                                                                                      | Enforce floors; ratchet up monthly                                              |
| Q10 | Missing `docs/adr/` + `internal/server/README.md`                    | Low      |    24 | [#42](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/42)              | `docs/adr/0000-record-architecture-decisions.md` (new), `internal/server/README.md` (new)                         | **Closed (resolved 2026-05-10)** — see [GAP_ANALYSIS_RESOLVED.md](./GAP_ANALYSIS_RESOLVED.md#q10-42-add-docsadr-skeleton--internalserverreadmemd-resolved). Closure commit `bceb198`. ADR meta-record added under `docs/adr/` (Nygard convention, four-section template, supersession protocol documented); `internal/server/README.md` documents per-file layout, audit/rate-limit conventions, generated-code policy, and the `GOEXPERIMENT=jsonv2` build-env requirement. |
| Q12 | Two lockfiles committed (`package-lock.json` + `pnpm-lock.yaml`)     | Low      |    24 | [#44](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/44)              | `package-lock.json`, `pnpm-lock.yaml`                                                                              | Delete `package-lock.json`; gitignore                                            |
| Q15 | Pin Node toolchain (`.tool-versions`/`.nvmrc` + `packageManager`)    | Low      |    24 | [#49](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/49)              | `.tool-versions`, `.nvmrc`, `package.json:packageManager`                                                            | **Closed** 2026-05-08 — `.nvmrc` pinned to `22.14.0` (matching `engines.node`); `.tool-versions` adds `nodejs 22.14.0` for asdf/mise users; `package.json` declares `"packageManager": "npm@10.9.0"` so corepack picks the same client every time. |

### Counts by Severity

- High: 4 (4 closed: Q1, Q2, Q3 (2026-05-10), Q4)
- Medium: 6 (6 closed: Q11, Q6, Q7, Q9, Q5 (2026-05-11), Q8 (2026-05-11))
- Low: 5 (3 closed: Q13, Q15 + Q12 deferred-not-tracked-as-bug; 2 open: Q14, Q10)

### Closure run 2026-05-08

- **Q13 (#46)** — already-done. `golangci-lint` runs in pre-push at
  `.pre-commit-config.yaml:130` via `scripts/run-go.sh tool-golangci`.
  Findings have been burned down through earlier session work
  (QF1001/QF1008/unused all clean as of 99ab113).
- **Q15 (#49)** — Node toolchain pinned. `.nvmrc` (`22.14.0`),
  `.tool-versions` (`nodejs 22.14.0`), and `package.json`'s
  `packageManager: npm@10.9.0` field land in this commit. Matches
  `engines.node ">=22.14.0"`.

## New findings — 2026-05-08 audit pass

| ID  | Title | Severity | Score | Status | File:Line | Action |
|-----|-------|----------|-------|--------|-----------|--------|
| Q-NEW-1 | Electron preload bridge has zero unit tests | High | 80 | **Closed** 2026-05-08 | `electron/preload.ts:22-40`, `electron/main.ts:108-115,289-297` → refactored to `electron/lib/safety.ts` | Path-traversal + URL-whitelist logic extracted into `electron/lib/safety.ts`; **58 unit tests** in `__tests__/electron-safety.test.ts` cover `isAllowedExternal`, `resolveProtocolAsset`, `contentTypeFor`. Tests pass without `electron` in deps. |
| Q-NEW-2 | No lint preventing JSX HTML renderers consuming `t()` values | Medium | 36 | **Closed** 2026-05-08 | `scripts/check-html-renderers.mjs` (new) | New audit script greps for `__html` JSX prop + `<Trans>` usage; pre-commit + CI gate; zero hits at land time, strict mode. Discipline doc at `docs/I18N.md`. |
| Q-NEW-3 | `<datalist>` materialises every node/edge id (no cap) | Medium | 48 | **Closed** 2026-05-08 (cross-closed via P-NEW-2) | `src/components/results/GraphView.tsx:402-417,421-436` | Capped at `ID_PICKER_OPTION_CAP = 1000` via `nodeIds.slice(0, CAP)` / `edgeIds.slice(0, CAP)`. Lookup Maps are NOT capped, so resolving a typed-in id beyond the cap still works. |
| Q-NEW-4 | `cellLines` walks node `properties` with no key-count cap | Low | 16 | **Closed** 2026-05-08 | `src/components/results/TableView.tsx:CELL_LINES_PROP_CAP` | `propCount` clamped to `Math.ceil(ROW_HEIGHT_MAX / ROW_LINE_HEIGHT)`. The cap matches the row-height cap so iterating beyond it can never affect the rendered height. |
| Q-NEW-5 | Theme contract has no compile-time / runtime structural test | Low | 16 | **Closed** 2026-05-08 | `src/theme/theme.test.ts` (new, +5 tests) | Tests assert: light/dark expose identical leaf-path sets; the leaf paths the contrast script reads are present; variant tag matches; breakpoints scale strictly increasing; touch targets meet WCAG 2.5.5. |
| Q-NEW-6 | `detect:hardcoded-strings` only scans `.tsx`, not `.ts` | Low | 8 | **Closed** 2026-05-08 | `scripts/detect-hardcoded-strings.mjs`, `.pre-commit-config.yaml:166` | Walker now matches `\.(ts\|tsx)$` (excluding `.d.ts`); pre-commit + CI gates updated. Zero new hits at land time. |
| Q-NEW-7 | `LocalizationProvider` swallows localStorage errors silently | Low | 8 | **Closed** 2026-05-08 | `src/services/i18n/LocalizationProvider.tsx:warnStorageFailure` | Failures emit `console.warn(scope, err)` in non-production builds; production stays silent (no user-visible noise). Sandboxed Electron failure paths now visible during dev. |
| Q-NEW-T1 | Tooling gap: no Storybook / visual-regression for primitives | Medium | 32 | Deferred (adoption decision) | `src/components/ui/*` (11 files, 2 tests) | **Unblock condition:** product team chooses Storybook 9 vs Ladle vs Histoire; Chromatic vs Percy. Then bootstrap CSF stories per primitive. |
| Q-NEW-T2 | Tooling gap: no bundle-size budget enforced | Medium | 32 | **Closed** — *actually wired by the F10 closure on 2026-05-11* (the 2026-05-08 row was aspirational: the file still carried `hints: 'warning'` + 16 MiB caps until F10 landed) | `webpack.prod.js:performance`, `webpack.common.js:splitChunks` | `webpack.prod.js`: `hints: 'error'`, `maxAssetSize: 1 MiB`, `maxEntrypointSize: 1.5 MiB`; `assetFilter` excludes source maps, fonts, icons, monaco workers, and the React.lazy async code-split chunks (each independently / on-demand loaded — counting them double-counts cost the split removed). Effective only because F10 (#54, closed 2026-05-11) split Monaco + Cytoscape into async chunks and scoped `webpack.common.js`'s `vendors` cacheGroup to `chunks: 'initial'` — `vendors.js` dropped 12.5 MiB → ~290 KiB and the `main` entrypoint 12.8 MiB → 454 KiB, comfortably under the 1.5 MiB cap, so the build now passes with `hints: 'error'`. See `docs/PERF_GAP_ANALYSIS.md` → "Closure run 2026-05-11". |
| Q-NEW-T3 | Tooling gap: no Lighthouse / Web Vitals CI gate | Low | 16 | Deferred (CI infra) | `.gitlab-ci.yml` | **Unblock condition:** ephemeral preview URL per MR (review-app or staging). Then add `treosh/lighthouse-ci-action` style job pinned to performance ≥ 80 / a11y ≥ 90. |
| Q-NEW-T4 | Tooling gap: no a11y unit harness | Low | 16 | Deferred (test-runner adoption) | `__test_utils__/afterEnv.js` | **Unblock condition:** `jest-axe` + `@axe-core/react` added to devDependencies + a per-component coverage matrix decided. Today the manual a11y wins (skip-link, ARIA roles, focus-visible) are all hand-validated. |

### Counts after 2026-05-08 audit pass

- High: 5 (Q-NEW-1 + Q1, Q2, Q3, Q4 — all closed)
- Medium: 7 (closed: Q11, Q-NEW-2, Q-NEW-3, Q5 (2026-05-11), Q6, Q7, Q8 (2026-05-11), Q9; tooling T1/T2 open)
- Low: 9 (4 closed: Q10, Q13, Q14 deferred-CI, Q15; 5 open: Q-NEW-4 through Q-NEW-T4)

## Findings by Category

### Architecture / Maintainability (Q1, Q3, Q9, Q10)

Catch-all files, name leakage, and missing package-level docs. Mechanical fixes; the work is
mostly bookkeeping with an outsized payoff in code-review velocity.

### Correctness / Data integrity (Q4, Q6, Q7)

Q4 (`PatchUsername` non-atomic) is the only finding with a direct production-data risk in
this batch. Q6 and Q7 are observability traps — they hide failures rather than create them.

### API / Contract (Q5, Q8) — closed 2026-05-11

The typed-client boundary was leaking on both sides (raw `fetch` in TS for uploads, raw
`[]jsontext.Value` in Go for the SHOW-catalogue list responses). Both closed by making
`geode.json` the single source of truth: the upload endpoints are now `"type": "file"`
multipart routes (typed React client + genapi-emitted multipart handler), and the
user/permission list schemas are `array<User>` / `array<Permission>` with the
runtime-discovered columns projected by `userFromRow` / `permissionFromRow` (drift logged,
not dropped silently). No genapi change was needed for either — both mechanisms already
exist upstream.

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
- ~~Q3 — rename `user*` helpers (mechanical s/// + test).~~ **Closed 2026-05-10.**
- ~~Q10 — create `docs/adr/` + `internal/server/README.md` skeleton.~~ **Closed 2026-05-10.**

### Medium (1-5 days each)

- Q1 — split `util.go`.
- Q2 — extract `useApiResource` and migrate 6+ pages.
- Q4 — wrap `PatchUsername` in a transaction (incl. tests for partial-failure paths).
- Q6 — typed-error path + `errors_test.go` pinning.
- Q7 — pick audit-failure policy and apply across 8 sites.
- Q9 — extract `withConnDBAndIdent` (depends on Q3 rename — closed; helper is now `connDB`).
- Q13 — wire `golangci-lint` and burn down initial findings.
- Q14 — wire coverage gates.

### Strategic (> 5 days)

- ~~Q5 + Q8 — tighten the typed-client boundary end-to-end (genapi config additions, regenerate
  client, fix downstream callers, remove `jsontext.Value` from list responses).~~ **Closed
  2026-05-11.** Turned out neither needed a genapi change: `"type": "file"` multipart request
  schemas and `"items": {"$ref": "Schema"}` typed list items both already exist upstream. Q5:
  the upload endpoints are declared in `geode.json` as multipart routes, the hand-rolled
  `mux.HandleFunc` is gone, `internal/server/handlers_uploads.go` implements the generated
  `BackupUpload`/`MigrationUpload`, and `MigrationsPage.tsx`/`RestorePage.tsx` use
  `client.migrationUpload` / `client.backupUpload`. Q8: `UserList.users` / `PermissionList.permissions`
  are now `array<User>` / `array<Permission>`, `GetUsers`/`Permissions` project the
  runtime-discovered SHOW-catalogue columns via `userFromRow`/`permissionFromRow` (drift
  logged once per process), and `UsersPage.tsx` imports `User` from `@api`.

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

---

## Profile System Rebuild (PSR) — 2026-05-10 audit

This cohort tracks quality findings scoped strictly to the recent **profile-system rebuild**
(server CRUD + handlers, public listing, electron bridge for stored credentials, profile UI
modal/page, auth provider, public-profile fetch flow). Not in scope: anything outside the
profile feature and not touched by the rebuild.

All issues carry the `psr` label. PSR audit also produced gap-side findings (`PSR-G##`) and
performance/security cohorts in their own GAP files.

### Tooling at audit time

- geode-ui SHA: `0b73836` (`fix(ui): ConnectionSwitcher menu anchors left so it stays on-screen`).
- Working-tree mods: e2e specs (post-rebuild auth + switcher UX), `pnpm-lock.yaml`. `tsc --noEmit`, ESLint, Prettier, Jest, `go vet`, `gofmt`, `golangci-lint` all clean against the rebuild surface.
- Server coverage: `~68.7%` overall (geode-ui server) but with named gaps on the new endpoints (see Q12).

### Scoring framework (recap)

`PriorityScore = Impact (1-5) × Likelihood (1-5) × 4`. Decisions: **Fix-Now** (release
blocker) / **Fix-Soon** (next sprint) / **Fix-Backlog** / **Wont-Fix-Now** (tracked-only).

### Findings table (PSR cohort)

| ID  | Category         | Priority | Decision      | GitLab issue                                                                  | File:Line                                                                                          |
|-----|------------------|----------|---------------|-------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------|
| Q01 | api-contract     | medium   | **Closed 2026-05-10** | [#89](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/89)       | `src/api/profiles.ts:89` -- **Closed 2026-05-10**: new `WireProfile` type mirrors the server's `Profile` shape (tracks `gen/types/types.gen.go:614`); new `isWireProfile(x: unknown): x is WireProfile` narrowing guard; `fromWireProfile`'s parameter is now `unknown` and falls back to a safe all-empty `ProfileView` on any non-object input (null, undefined, array, scalar) instead of crashing on `wire.id` indirection. The `as any` cast in `listProfiles` is gone. Pinned by 3 new tests (`isWireProfile rejects non-object inputs`, `isWireProfile accepts plain objects`, `fromWireProfile returns safe default ProfileView on non-object input`) -- 15 tests in `src/api/profiles.test.ts` total, all passing. The five `as unknown as` casts (Q02 / #90) remain because they are genapi-upstream (issue #216); not in scope for this closure. |
| Q02 | api-contract (upstream) | high | **Closed `9b0a423`** (geode-ui) + genapi `55c79d2` — the `as unknown as` path-param casts in `src/api/profiles.ts` are gone | [#90](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/90); upstream [genapi#216](https://gitlab.com/devnw/apps/genapi/-/work_items/216) | `src/api/profiles.ts` `updateProfile`/`deleteProfile` now call the typed client directly. genapi `client_templates.go`/`client_react.ts.tmpl`/`client_go_rest.go.tmpl`: `expandPath`/`expandRoute` map URL path tokens to snake_case schema keys (`[["profileId","profile_id"]]`), read `payload[schemaKey]`, substitute `{token}` (still `encodeURIComponent`'d), `delete payload[schemaKey]` before sending the body. geode-ui `geode.json` `UpdateProfileReq` gains required `profile_id`; regen `gen/`. Upstream `cmd/genapi/path_params_test.go` cases added. **Note:** `createProfile`'s `as any` body cast is a *different* cast (request-body shape, not path-param) and remains — out of scope; tracked as the small follow-up below. |
| Q03 | dead-code        | low      | **Closed 2026-05-10** | [#91](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/91)       | `src/api/profiles.ts:186` (`getProfile` exported, no caller) -- **Closed 2026-05-10**: deleted the unused export. Comment block left in place pointing at the removal so a future hand re-adding the helper finds the genapi workaround pattern (cast to `{ profile_id: string }` via `as unknown`). No tests removed because no test ever exercised `getProfile`. The page rehydrates via `listProfiles()` after every mutation, so a single-row fetch is unbounded scope until a real caller appears. |
| Q04 | duplication      | high     | **Closed 2026-05-10** (release blocker) | [#93](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/93) | `electron/preload.ts:14-40` ↔ `src/types/electron.d.ts:8-34` -- canonical types now in `electron/shared/bridge-types.ts`; both files re-export from that single source. Cross-closes PSR-G07 (#84). |
| Q05 | complexity       | medium   | **Closed 2026-05-10** | [#95](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/95)       | `src/components/profiles/ProfileEditorModal.tsx:50-190` (470 LOC; FormState mirrored 5x) -- **Closed 2026-05-10**: extracted `useProfileForm(initial?)` hook (`src/components/profiles/useProfileForm.ts`, 225 LOC) returning `{state, setField, buildCreateInput, buildUpdateInput, reset}` -- single FormState shape, single `fromProfile`, single create-builder, single update-diff-builder, single `setField(key, value)` callback shared by every input. Extracted `<TLSFieldset>` component (`src/components/profiles/TLSFieldset.tsx`, 105 LOC) that owns the three PEM textareas + Browse buttons; the three near-identical `browseCAPem` / `browseClientCertPem` / `browseClientKeyPem` handlers collapsed to a single parameterised `browse(fieldKey)` driven by a `TLS_FIELDS` spec table. Modal LOC: 473 -> 248 (-48%); JSX body well under 150 LOC. Cross-closes Q06 (#96) by collapsing the three handlers. All 9 prior tests in `ProfileEditorModal.test.tsx` pass unchanged (no selector updates required). |
| Q06 | duplication      | low      | **Closed 2026-05-10 (cross-closed by Q05)** | [#96](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/96)  | `src/components/profiles/ProfileEditorModal.tsx:216-227` (3 browse handlers, only target field differs) -- **Closed 2026-05-10**: cross-closed when Q05 (#95) extracted `<TLSFieldset>`. The three near-identical handlers collapsed to one parameterised `browse(fieldKey)` driven by a `TLS_FIELDS` spec table. |
| Q07 | maintainability  | medium   | **Closed 2026-05-10** | [#98](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/98)       | `internal/server/handlers_profiles_crud.go` (whole file; `writeEndpointError` boilerplate ~20x) -- **Closed 2026-05-10**: added `writeEndpointErr(w, status, code, msg)` and three named convenience helpers (`writeStoreUnavailable`, `writeBadRequest`, `writeNotFound`) in `internal/server/errors.go`. Converted every inline `&endpointError{...}` literal in `handlers_profiles_crud.go` (15 sites in PostProfiles / GetProfileid / PatchProfileid / DeleteProfileid). The remaining `writeEndpointError(w, storeErrorToHTTP(err))` and `writeEndpointError(w, perr)` callsites stay as-is because they thread an already-constructed `*endpointError` pointer (no boilerplate to collapse). `handlers_profiles.go` and `handlers_profiles_public.go` had zero inline literals. Per E2 hand-off note, validators stay pure -- the helper does NOT do PEM or other input validation. Existing CRUD tests pass unchanged. |
| Q08 | duplication      | medium   | **Closed 2026-05-10** | [#100](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/100)     | `src/auth/AuthProvider.tsx:97-123` vs `:135-159` (`signIn` ↔ `connectMore`) -- **Closed 2026-05-10**: extracted shared `performAuth({mode, profile, username, password, savePassword})` helper; `signIn` and `connectMore` now thin wrappers around it. The mode discriminator selects (a) CSRF ordering -- parallelised for signIn (PSR-F10 / #108), serialised before conns.add for connectMore (PSR-G03 / #80); (b) active-connection promotion + latch -- only signIn promotes; (c) savePassword shape -- fire-and-forget on signIn (PSR-F10), awaited on connectMore. Added `GAP-Q08: signIn and connectMore both flow through the shared performAuth step` test that captures URL-encoded login bodies and asserts both modes hit the shared apiLogin step with their own args. All 10 AuthProvider tests pass (was 9; +1 new). Pure refactor: cross-cutting concerns F10 + G03 + G09 preserved. |
| Q09 | duplication      | low      | Fix-Backlog   | [#102](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/102)     | `src/pages/LoginPage.tsx:101-128` ↔ `src/components/layout/AddConnectionModal.tsx:27-73`            |
| Q10 | complexity       | medium   | **Closed 2026-05-10** | [#104](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/104)     | `src/pages/ProfilesPage.tsx` (280 LOC; 3 Page returns; editor modal mounted twice) -- **Closed 2026-05-10**: collapsed the four pre-refactor branches (loading / error / empty / list) into one render path. Header + Create button + setDefaultErr banner + `<ProfileEditorModal>` + `<DeleteProfileModal>` now mount unconditionally; loading/error/empty render as inline content WITHIN the table area via a `renderBody()` helper. Editor state is reducer-driven: a single discriminated `EditorState = {mode: 'closed' \| 'create' \| 'edit', target?}` replaces the prior triple of `(editorOpen, editorMode, editorProfile)` booleans/enums and removes the implicit "if mode==='edit' then editorProfile is set" invariant. Behaviour preserved: PSR-G09 (#86) `useAuth().isAdmin` JWT-roles gating, PSR-G05 (#82) `setDefaultErr` banner -- and the banner now also surfaces on a newly-empty view (a setAsDefault failure on the last-profile-deleted view used to be invisible). All 11 prior tests in `ProfilesPage.test.tsx` pass unchanged (no selector updates required). |
| Q11 | complexity       | low      | **Closed 2026-05-10 (Wont-Fix-Now)** | [#105](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/105)  | `internal/server/handlers_profiles_crud.go:24-97` (`PostProfiles`, 73 LOC, cyclomatic ~10) -- **Closed 2026-05-10** as **wont-fix-now**: cyclomatic ~10 sits at the threshold, but every branch is a uniform validation early-return (`store == nil` -> 503; `actor == ""` -> 401; decode -> 400; missing `name` -> 400; missing `dsn` -> 400; bad TLS -> 400; bad pool -> 400; store error -> mapped HTTP). Splitting them into a private validator only adds one indirection without a readability win because the function is a strict input-validation funnel into a single store call. **Re-open trigger:** cyclomatic > 12 OR a non-validation branch (auth, logging side-effect, pre-store transformation) is added. |
| Q12 | test-coverage    | high     | **Closed 2026-05-10** | [#107](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/107)     | `internal/server/handlers_profiles*.go` (`storeErrorToHTTP` 33% → **100%**, `Public` 47% → **100%**, `PatchProfileid` 64% → **86%**); 2026-05-10 -- table-driven `TestStoreErrorToHTTP` covers every `profilestore.Err*` variant + wrapped + default + nil-safe (the helper itself was hardened to 500 on nil rather than panic on `err.Error()`). `TestPublicProfiles_{EmptyStoreReturnsEmptyList,StoreErrorBubbles,StoreNil_FallbackToPool,StoreNil_NoPool_ReturnsEmpty}` cover the legacy-pool fallback + double-nil safety + List-error bubble. `TestPatchProfileid_IsDefaultPointerSemantics` (replaces the legacy `TestPatchProfileid_AlwaysEchoesIsDefault` after PSR-G02-followup #124 made `IsDefault *bool`) pins the new pointer-presence contract for `is_default` (nil = preserve, non-nil false = clear, non-nil true = set); `TestPatchProfileid_DescriptionClearViaEmptyString` pins the same for `description`. Paired with `TestPatchProfileid_{StoreDisabled,MissingPathID,StorePatchSurfaces500ToHTTP}` for the early-return + path-binding + store-error branches. Server coverage 71.9% → 72.8%. Earlier 2026-05-10 PSR-G02 closure added `TestPatchProfileid_TLSClearViaEmptyObject`, `TestPatchProfileid_TLSPreservedWhenAbsent`, `TestPatchProfileid_PoolOverridesClearViaEmptyObject` plus `TestMergeProfile_OnlyAppliesNonNilFields`. |
| Q13 | tests            | n/a      | **Wont-Fix** (correct as-is) | *(not filed; tracked here only)*                               | `src/components/profiles/ProfileEditorModal.test.tsx` (mocks the wire layer)                        |
| Q14 | docs             | medium   | **Closed 2026-05-10** | [#109](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/109)     | `src/api/electron-bridge.ts` (7 exports, zero JSDoc) -- **Closed 2026-05-10**: every export now carries a JSDoc block documenting (1) what it does, (2) the IPC channel it proxies (where applicable), (3) the web-fallback behaviour when `window.geode === undefined`, and (4) the swallow / best-effort contract. `bridge()` (private) and `ConnectionRecord` (re-export) are also documented. The blocks cross-reference the relevant security/perf gap closures (S3 #116 PEM picker FD-stat, S8 #121 sanitizer, S9 #122 forget-password follow-up, PSR-F10 fire-and-forget save). No code change. |

### Counts (PSR cohort)

- High priority: 3 (Q02 upstream-shim, Q04 release blocker, Q12 — Q12 closed 2026-05-10)
- Medium priority: 5 (Q01, Q05, Q07, Q08, Q10, Q14 closed 2026-05-10; none open)
- Low priority: 4 (Q03, Q06 closed 2026-05-10; Q09, Q11 wont-fix-now)
- Wont-fix (correct as-is): 1 (Q13)
- Total filed in geode-ui: 12 issues + 1 upstream genapi issue. Q13 not filed.

### Wont-fix rationale

- **Q11 (`PostProfiles` complexity)** — cyclomatic ~10 is at threshold but the branches are uniform validation early-returns. Splitting them out introduces indirection without a readability win. Re-open if cyclomatic > 12 or a non-validation branch is introduced. Tracked as #105.
- **Q13 (`ProfileEditorModal.test.tsx` mocks the wire layer)** — this is the **correct** unit-test isolation for a presentational/form component. The wire layer has its own tests (and Q12 is adding more). Mocking it here is by-design, not a smell. **Not filed as a GitLab issue**; recorded here for audit traceability.

### Upstream / cross-links

- **Q02 → genapi#216** ([https://gitlab.com/devnw/apps/genapi/-/work_items/216](https://gitlab.com/devnw/apps/genapi/-/work_items/216)) — root cause of the (originally 5, then 2) `as unknown as` path-param casts. **CLOSED 2026-05-12** via genapi `55c79d2` (`expandPath`/`expandRoute` snake_case path-token mapping) + geode-ui `9b0a423` (`geode.json` `UpdateProfileReq` gains `profile_id`, regen `gen/`, `src/api/profiles.ts` calls the typed client directly). The genapi `55c79d2` commit sits on genapi `main` **unpushed** (user decides on pushing). **Per repo memory: do NOT hand-edit `gen/`.** **Follow-up (small, not yet ticketed):** `createProfile`'s `as any` body-shape cast in `src/api/profiles.ts` is a *different* cast — file it under the export-surface / api-contract cleanup if a convention exists, otherwise track here.
- **Q04 ↔ PSR-G07** — same code, two framings: Q04 (#93) is the quality framing (duplication / release blocker); PSR-G07 (filed by parallel gap-sync agent) is the gap framing (single-source-of-truth requirement). Cross-link recorded in both issue bodies; once PSR-G07 issue number is known, both descriptions can be reciprocally linked.

### Roadmap

#### Quick wins (≤ 1 day each)

- **Q01** — type the wire boundary; ~30 min.
- **Q03** — delete (or wire) `getProfile`; ~15 min.
- **Q06** — collapses naturally with Q05.
- **Q14** — JSDoc the seven electron-bridge exports.

#### Release-blocker first

- **Q04** — extract shared `bridge-types` and delete the duplicate. Lands the PSR with the IPC contract single-sourced.

#### Sprint-sized

- **Q05 + Q06 + Q10** — modal + page refactor. Best as one MR (single render path on the page; hook + fieldset on the modal).
- **Q07** — `writeEndpointErr` helper + 20-site conversion.
- **Q08** — `performAuth` extraction.
- **Q09** — `usePublicProfilesWithStoredPasswords` hook.
- **Q12** — table-driven tests on `storeErrorToHTTP`, `Public`, `PatchProfileid` (esp. the always-echo-`isDefault` contract).

#### Upstream-blocked

- ~~**Q02** — waits on genapi#216, then a one-MR cast cleanup.~~ **CLOSED `9b0a423`** + genapi `55c79d2` (2026-05-12). `createProfile`'s `as any` body cast is the only `profiles.ts` cast remaining — a separate, smaller follow-up.

---

## Phase 4 — 2026-05-11 audit (HEAD `d3e5de1`)

This cohort tracks the 46 quality findings (Q1-Q46) from the 2026-05-11 Phase 3
deep-review of `geode-ui`, scored with the codepros quality-scoring framework
(`PriorityScore = Severity × Confidence × Reach`). Already-tracked findings that
the **gap-sync agent** owns (#44 lockfile, #46 golangci, #48 coverage, #90 genapi
casts, #102 login/connection dup) were **referenced not recreated**; cross-link
comments were posted to each.

### Tool results at audit time (HEAD `d3e5de1`)

| Tool                     | Result                            | Notes                                           |
|--------------------------|-----------------------------------|-------------------------------------------------|
| `tsc --noEmit`           | clean                             | electron-side coverage gated by Q25.            |
| ESLint / Prettier        | clean                             | No new violations on changed files.             |
| Jest                     | green                             | No `--coverage` threshold enforced (#48 / Q29). |
| `go vet ./...`           | clean                             | But picks up `node_modules/flatted/...` (Q31).  |
| `gofmt -l`               | clean                             |                                                 |
| `golangci-lint`          | clean (pre-push)                  | No `.golangci.yml` (#46 / Q30).                 |
| `go test -cover`         | `internal/server` 77.1% → **78.2%**; `internal/jwt` 81.0% → **82.5%**; `internal/profilestore` 80.7% → **81.0%**; `cmd/server` 65.3% → **70.7%** (all ↑ after the 2026-05-12 top-10 batch); `src/components/ops` 28% → **91.87%** (`2aaaebc`, Q27) | Q28 still raises the frontend floor; Q14/#48 owns the coverage gate. |
| `make web-build`         | green                             |                                                 |
| `.gitlab-ci.yml` audit   | gaps (Q35 needs: **FIXED `790cdcb`**; electron-tsc gate **FIXED `f444c70`**; `@latest` tool refs **FIXED `d35d3c7`**, Q32 #127) | Q33 (cache:[]) still open. New `scripts/check-ci-pins.sh` guard + `ci-pins-check` job (`d35d3c7`). |

### Phase 4 findings table — Phase 3 cohort (PriorityScore desc)

Top-priority (Score ≥ 15):

| ID  | Title                                                                  | Score | Issue                                                              | Evidence                                                                 |
|-----|------------------------------------------------------------------------|------:|--------------------------------------------------------------------|---------------------------------------------------------------------------|
| Q9  | **CLOSED `a42a792`** (2026-05-12) — `internal/server/result_codec.go`: `errWriter` first-error-latching shim; `streamQueryResult` flattened (gocognit < ~20; golangci-lint 0 issues); `writeTrailer()` helper. Tests: `result_codec_test.go`. (Landed together with Q39 #134 + PERF-2026-05-11-07 #145 in the same commit.) |    20 | [#125](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/125) | `internal/server/result_codec.go`                                         |
| Q35 | **CLOSED `790cdcb`** — `build` CI job now `needs:` typecheck/unit-tests/audit-ratchets (+ install, eslint) — can no longer ship red |    20 | [#129](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/129) | `.gitlab-ci.yml` `build:` `needs:` block                                  |
| Q36 | **CLOSED `210133e`** — `go.mod:5` now `replace geodedb.com/geode => ../geode-client-go` (relative); `make go-test`/`go-build` resolve; CI's `go mod edit -replace` still works (now redundant) | 20 | [#131](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/131) | `go.mod:5`                                                                |
| Q23 | **CLOSED `df3fd51`** (2026-05-12) — new `internal/server/errorcodes.go`: 62 `ErrCode*` constants grouped by area + `allErrorCodes`/`errorCodeSet`. ~100 literal occurrences (38 distinct codes) migrated across 17 handler/helper files — **wire values byte-identical** (verified `ErrCodeInvalidCredentials == "invalid_credentials"` etc., no drift). New `errorcodes_test.go`: dep-free `go/ast` golden test asserting every `code:`/`Code:`-position literal is an `ErrCode*` constant + no dead constants (verified it catches a planted straggler). |    15 | [#126](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/126) | `internal/server/errorcodes.go` (new)                                     |
| Q32 | **CLOSED `d35d3c7`** (2026-05-12; also closes SEC F-SUP-3 #153) — `.gitlab-ci.yml`: `genapi@v0.3.0` (verified == genapi `main` HEAD `55c79d2`, the tree `gen/` was generated against), `golangci-lint@v2.12.2`, `benchstat@v0.0.0-20260409210113-…`. `codesign-windows-ssl@~latest` left unpinned with a `# ci-pins-allow:` marker + `TODO(#127)` — **deviation**: no tagged ci-catalog release ships that component yet (pre-existing — `glab ci lint` failed on that line before this change too). New `scripts/check-ci-pins.sh` guard wired into `.pre-commit-config.yaml` + a `ci-pins-check` CI lint job (still catches *new* `@latest` regressions). |    15 | [#127](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/127) | `.gitlab-ci.yml`, `scripts/check-ci-pins.sh` (new)                        |
| Q39 | **CLOSED `a42a792`** (2026-05-12) — `internal/server/result_codec.go`: `midStreamAbort()` emits `slog.Warn` on every post-head error path (`stage`/`rows_sent`/`elapsed_ms`/`err`). Test: `result_codec_stream_test.go` +slog-capture assertion in `TestStreamQueryResult_MidStreamError`. (Same commit as Q9 #125 + PERF-2026-05-11-07 #145.) |    15 | [#134](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/134) | `internal/server/result_codec.go`                                         |
| Q41 | **CLOSED `1fea7ba`** (2026-05-12) — new `internal/server/CONVENTIONS.md` (6 sections: error-code taxonomy → `errorcodes.go`; empty-result rule + single-resource-404 split; wire-feature-missing fallback + `errWireFeatureMissing` sentinel; per-row dual-key forward-compat in `policyFromRow`/`roleFromRow`; `auditEvent*` naming + `emitAudit` best-effort + substring redaction; the `withConnDBAndIdent`/`writeEndpointError`/`badRequest` envelope helpers + the JWT→connDB→quoted-ident admin-RBAC skeleton — each `file`-cited). `README.md` pointer added; markdownlint clean. |    15 | [#136](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/136) | `internal/server/CONVENTIONS.md` (new)                                    |
| Q10 | **CLOSED `6abde32`** (2026-05-12) — `internal/jwt/revocation.go`: extracted `jtiRevoked(jti, now) bool` (preserves lazy-GC of expired entries + fail-closed non-`time.Time`→revoked) and `subjectRevokeAll(sub, iat) bool` (preserves `!iat.After(changedAt)`); `IsRevoked` flattened to two `if`s. Test: `revocation_test.go` +`TestIsRevoked_DefensiveNonTimeEntries`. `internal/jwt` cov 81.0%→82.5%. |    15 | [#144](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/144) | `internal/jwt/revocation.go`                                              |
| Q12 | **CLOSED `e510cb5`** (2026-05-12) — `internal/server/handlers_auth.go`: extracted `denyLogin(...)` (SEC-N10 constant-time path — `performDummyCompare`→`emitAudit`→`respectLoginLatencyFloor`→`writeEndpointError(401)` order + arithmetic byte-preserved; `authStart` captured at the same point), `mintAndSetAuthCookie(...) int64` (SEC-F7 cookie attrs + `expires_in>=1` clamp), `adminRolesFor(...)`. Tests: `handlers_auth_test.go` +`TestAdminRolesFor`, +`TestMintAndSetAuthCookie`; pinning tests pass unchanged. Security-reviewed: no timing-profile change between success/failure paths. |    15 | [#146](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/146) | `internal/server/handlers_auth.go`                                        |
| Q13 | **CLOSED `0d629bf`** (2026-05-12; also closes Q40 #151) — `internal/server/ws_query.go`: extracted `startCancelReader(conn, cancel, done) <-chan struct{}` (coordinator + bounded relay; selects on `<-done` so it exits on the happy path) and `streamRowsOverWS(conn, rows, cols, batcher) (int64, error)`; `Query` now `defer close(done)`s and is a thin sequencer. Test-only `onCancelReaderExit` hook; `errStreamAborted` sentinel. Tests: `ws_query_test.go` +`TestStartCancelReader_ExitsOnDone`, +`TestStartCancelReader_CancelsOnError`. Verified `-race` clean, no goroutine leak. |    15 | [#149](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/149) | `internal/server/ws_query.go`                                             |
| Q29 | Coverage gate in CI                                                    |    15 | [#48](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/48) *(REFERENCE — gap-sync)*  | (gap-sync owns)                                          |
| Q30 | `.golangci.yml` config                                                 |    15 | [#46](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/46) *(REFERENCE — gap-sync)*  | (gap-sync owns)                                          |

High-priority (Score 9-14):

| ID  | Title                                                                  | Score | Issue                                                              | Evidence                                                                 |
|-----|------------------------------------------------------------------------|------:|--------------------------------------------------------------------|---------------------------------------------------------------------------|
| Q1  | Three SHOW-list handlers duplicate body — extract listRowsAsJSONValues |    9  | [#138](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/138) | `handlers_backups.go:62-84`, `handlers_policies.go:34-56`, `handlers_roles.go:35-57` |
| Q8  | `PatchUsername` cognitive ~45 — decompose                              |    12 | [#141](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/141) | `internal/server/handlers_users.go:162`                                   |
| Q14 | `stageUpload` 94 LOC + repeated error blocks                           |    9  | [#155](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/155) | `internal/server/handlers_uploads.go:85-179`                              |
| Q15 | `profilestore/sqlite.go` `Patch` 87 LOC                                |    9  | [#157](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/157) | `internal/profilestore/sqlite.go:433-520`                                 |
| Q16 | **CLOSED `adf6b6f`** — `cmd/server/main.go` → 12-line shim; new `cmd/server/app.go` (`appConfig`/`parseFlags`/`newApp`/`(*app).serve`/`run`) + `cmd/server/profileseed.go` | 12 | [#158](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/158) | `cmd/server/main.go`, `cmd/server/app.go`, `cmd/server/profileseed.go`    |
| Q17 | `projectColumns.ts` 155 LOC dense triple-loop                          |    12 | [#162](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/162) | `src/components/results/projectColumns.ts:75-229`                         |
| Q18 | `GraphView.tsx` 1257 LOC — split hooks + sub-components                |    6  | [#164](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/164) | `src/components/results/GraphView.tsx`                                    |
| Q21 | SHOW-catalogue list handlers still use `[]jsontext.Value`              |    9  | [#166](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/166) | Backups, Policies, Roles, Migrations handlers                             |
| Q22 | **CLOSED `03b6ec1`** (2026-05-12) — new `internal/server/list_handlers_test.go`: asserts every list endpoint (`GetRoles`/`GetPolicies`/`GetBackups`/`GetUsers`/`GetMigrations`, schema lists, `Audit`) returns non-nil empty slices and renders `[]`/`{"...":[]}` not `null` — both on empty result and on an `isWireFeatureMissing` upstream. No production code changed: all handlers already satisfied the invariant (audited + verified the test fails when a regression is introduced). |    12 | [#168](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/168) | `internal/server/list_handlers_test.go` (new)                             |
| Q25 | **CLOSED `f444c70`** — `package.json` devDeps `+ electron@^42.0.1`, `+ @types/node@^22.19.19`; `package-lock.json` updated; `.gitlab-ci.yml electron-typecheck` no longer `allow_failure`; `npm run electron:tsc` exits 0 (also closes F-SUP-4 #160). **Note:** `pnpm-lock.yaml` NOT regenerated — pnpm refuses (`packageManager: npm`); dual-lockfile cleanup tracked at Q-other / GAP-017 #44. | 12 | [#170](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/170) | `.gitlab-ci.yml`, `package.json`                                          |
| Q26 | **CLOSED `adf6b6f`** — new `cmd/server/app_test.go` (6 tests: `TestRun_MissingJWTSecret_ExitsNonZero`, `TestNewApp_HappyPath` healthz=200, `TestNewApp_WiresMCPAuthVerifier`, …); `internal/profilestore.NewCipherFromEnvFunc` added. `cmd/server` coverage **4.0% → 65.3%**. | 12 | [#172](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/172) | `cmd/server/`                                                             |
| Q27 | **CLOSED `2aaaebc`** — new `BackupPage.test.tsx` (8) / `MigrationsPage.test.tsx` (9) / `RestorePage.test.tsx` (6): confirm-modal flows, error-envelope rendering in `role="alert"`, wire-feature-missing 501 banner + disabled controls, happy/empty list states. `src/components/ops` line coverage **28% → 91.87%** (Backup 92.5%, Migrations 95.3%, Restore 100%). No coverage gate added (Q14/#48 owns that — separate, still open). | 12 | [#173](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/173) | `src/components/ops/`                                                     |
| Q31 | `node_modules/flatted/.../flatted.go` picked up by `go list ./...`     |    6  | [#174](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/174) | `node_modules/flatted/golang/pkg/flatted/flatted.go`                      |
| Q34 | `deploy/Dockerfile` `npm ci` before `COPY` needs invariant header      |    4  | [#175](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/175) | `deploy/Dockerfile:27-29`                                                 |
| Q37 | `make build` re-runs `make generate` unconditionally                   |    12 | [#177](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/177) | `Makefile:59`                                                             |
| Q42 | Add `docs/adr/0001-generated-api-boundary.md`                          |    12 | [#178](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/178) | `docs/adr/` (boundary ADR missing)                                        |
| Q44 | Add `docs/RUNBOOK.md` (rotation, audit reading, retention)             |    12 | [#179](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/179) | `docs/RUNBOOK.md` missing                                                 |

Medium-priority (Score 5-8):

| ID  | Title                                                                  | Score | Issue                                                              | Evidence                                                                 |
|-----|------------------------------------------------------------------------|------:|--------------------------------------------------------------------|---------------------------------------------------------------------------|
| Q3  | Tx Commit vs Rollback duplicate body — extract finalizeTx              |    6  | [#182](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/182) | `internal/server/handlers_tx.go:205-261`                                  |
| Q7  | `AuthProvider.test.tsx` 1009 LOC — extract `mockAuthFetch`             |    6  | [#183](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/183) | `src/auth/AuthProvider.test.tsx`                                          |
| Q19 | `TableView.tsx` 605 LOC — lift hooks per Q18 pattern                   |    4  | [#184](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/184) | `src/components/results/TableView.tsx`                                    |
| Q28 | `gqlLanguage.ts` Monaco tokenizer at 33% coverage                      |    6  | [#185](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/185) | `src/language/gqlLanguage.ts`                                             |
| Q33 | `.gitlab-ci.yml` `.go_defaults cache: []` wipes Go module cache        |    6  | [#176](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/176) | `.gitlab-ci.yml:235-242`                                                  |
| Q38 | **CLOSED `ea3f681`** (2026-05-12) — `cmd/server/app.go`: `errGracefulShutdown` sentinel + configurable `shutdownBudget` field (default 5s); `serve` wraps the `Shutdown` error (not discarded); `run` logs **WARN** for the shutdown-timeout case, ERROR for fatal listener errors. Verified no `_ = httpSrv.Shutdown(...)` anywhere. Test: `app_test.go` +`TestServe_GracefulShutdownErrorPropagates`. `cmd/server` cov 65.3%→70.7%. (Same commit as SEC F-INPUT-2 #143.) | 4 | [#180](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/180) | `cmd/server/app.go`                                                       |
| Q40 | **CLOSED `0d629bf`** (2026-05-12) — fixed as part of the Q13 #149 `WSServer.Query` decomposition: `startCancelReader` selects on `<-done` and `Query` `defer close(done)`s, so the cancel-reader goroutine no longer outlives the handler. Test-only `onCancelReaderExit` hook; `ws_query_test.go` +`TestStartCancelReader_ExitsOnDone` / `TestStartCancelReader_CancelsOnError`. Verified `-race` clean, no goroutine leak. |    8  | [#151](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/151) | `internal/server/ws_query.go`                                             |

Low-priority (Score ≤ 4):

| ID  | Title                                                                  | Score | Issue                                                              | Evidence                                                                 |
|-----|------------------------------------------------------------------------|------:|--------------------------------------------------------------------|---------------------------------------------------------------------------|
| Q2  | Backups DeleteFile vs Migrations Sign duplicate body                   |    4  | [#186](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/186) | `handlers_backups.go`, `handlers_migrations.go`                           |
| Q4 + Q5 + Q6 | Tighten export surface — useProfileForm / lib/graphResult / GqlNode/RbacAction unused exports | 2+2+3 | [#187](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/187) | `src/components/profiles/useProfileForm.ts`, `src/lib/graphResult.ts`, `src/types/*` |
| Q11 | `RevocationSet.Sweep` nestif 6 — extract sweep* helpers                |    4  | [#152](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/152) | `internal/jwt/revocation.go:225-252`                                      |
| Q20 | `lib/graphResult.ts` 524 LOC — split into types/extract/labels         |    4  | [#188](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/188) | `src/lib/graphResult.ts`                                                  |
| Q24 | Admin handlers accept `name`/`policy`/`role` dual-key — document       |    4  | [#189](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/189) | `handlers_policies.go`, `handlers_roles.go`, `handlers_grants.go`         |
| Q43 | Add `internal/jwt/README.md`                                           |    4  | [#181](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/181) | `internal/jwt/`                                                           |
| Q45 | GraphView/graphResult sparse "why" comments                            |    4  | [#190](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/190) | `src/components/results/GraphView.tsx`                                    |
| Q46 | No `CHANGELOG.md` — seed from git log                                  |    3  | [#191](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/191) | repo root                                                                 |

### Deduplication map (Phase 3 → already-tracked)

| Phase 3 finding | Existing issue (gap-sync owns) | Cross-link comment |
|-----------------|---------------------------------|----|
| Q29 (coverage gates)        | [#48](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/48)  | Posted 2026-05-11 |
| Q30 (`.golangci.yml`)       | [#46](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/46)  | Posted 2026-05-11 |
| Q-genapi-shim (5 casts)     | [#90](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/90)  | Posted 2026-05-11 (cross-links Q21/#166) |
| Lockfile dup (re-confirmed) | [#44](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/44)  | Posted 2026-05-11 |
| Q-login/conn dup (re-confirmed) | [#102](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/102) | Posted 2026-05-11 |

### Findings by category (Phase 4 cohort)

#### Complexity / decomposition (Q8, Q9, Q10, Q11, Q12, Q13, Q14, Q15, Q16, Q17, Q18, Q19, Q20)

The single largest cohort — 13 findings spanning the Go server hot paths
(`streamQueryResult`, `Login`, `WSServer.Query`, `IsRevoked`, `Sweep`) and the
SPA result-view layer (`GraphView`, `TableView`, `projectColumns`,
`graphResult`). Q16 is the highest-leverage anchor: decomposing the 482-LOC
god-main into `cmd/server/app.go` unblocks Q26 (4% coverage) and Q38 (shutdown
swallow). **CLOSED `adf6b6f`** (2026-05-11 gap-closure run): Q16 + Q26 landed
together — `cmd/server/main.go` is now a 12-line shim, the logic lives in
`cmd/server/app.go` / `cmd/server/profileseed.go`, and `cmd/server` coverage went
4.0% → 65.3%. Q38 (#180) is now trivially closeable (`(*app).serve` already
returns the shutdown error).

#### Duplication (Q1, Q2, Q3, Q4-Q6, Q7)

All small. Q1 (three SHOW-list handlers) is the highest-leverage because the
same body sits in the path of Q21 (typed list responses) and Q22 (empty-result
contract) — landing Q1 first makes Q21/Q22 trivially mechanical.

#### API contract / wire stability (Q21, Q22, Q23, Q24)

Q23 (error-code taxonomy) is the keystone — once a central registry exists,
Q22 (empty-list contract) and Q24 (dual-key documentation) collapse into
CONVENTIONS.md entries.

#### Test coverage (Q26, Q27, Q28)

Three pinpointed coverage holes. ~~Q27 (`src/components/ops` 28%) is the most
urgent because those pages mutate live data~~ — **Q27 CLOSED `2aaaebc`** (2026-05-12):
`src/components/ops` 28% → **91.87%** via `BackupPage.test.tsx` (8) /
`MigrationsPage.test.tsx` (9) / `RestorePage.test.tsx` (6). Q26 CLOSED `adf6b6f`.
Q28 (`gqlLanguage.ts` Monaco tokenizer, 33%) is the remaining frontend hole.

#### CI / toolchain (Q25, Q29, Q30, Q31, Q32, Q33, Q34, Q35, Q36, Q37, Q46)

Eleven findings. EPIC-Q2 below; Q35 (build needs:) and Q32 (`@latest`) are the
release-blocker-grade items. **Closed in the 2026-05-11 gap-closure run:** Q35
(#129, `790cdcb` — `build:` now `needs:` typecheck/unit-tests/audit-ratchets) and
Q25 (#170, `f444c70` — electron-tsc is a real gate, electron in devDeps). Q32,
Q33, Q31, Q34, Q37 still open.

#### Docs / ADR / runbook (Q41, Q42, Q43, Q44, Q45)

EPIC-Q3. Q41 (`internal/server/CONVENTIONS.md`) is the anchor; the other four
cross-link into it.

#### Maintainability / observability (Q38, Q39, Q40)

Q39 (truncation log) and Q40 (cancel-reader lifetime) are the high-leverage
WS-path items; Q38 is paired with Q16 — and after `adf6b6f` (Q16 closure) Q38 is
a trivial follow-up since `(*app).serve` already returns the shutdown error.

### Roadmap (Phase 4 cohort)

#### Quick wins (≤ 1 day each)

- ~~Q9 (#125)~~ **CLOSED `a42a792`**, ~~Q39 (#134)~~ **CLOSED `a42a792`** — single-file refactors with strong test coverage already in place.
- Q1 (#138), Q3 (#182), Q2 (#186) — DRY extractions.
- Q31 (#174), Q33 (#176), Q34 (#175), Q37 (#177) — CI / Makefile micro-fixes.
- ~~Q41 (#136)~~ **CLOSED `1fea7ba`**; Q42 (#178), Q43 (#181), Q45 (#190), Q46 (#191) — pure-doc.

#### Release-blocker-grade (land before next tag)

- ~~Q32 (#127)~~ — **CLOSED `d35d3c7`** — CI tool refs pinned to immutable tags (`genapi@v0.3.0`, `golangci-lint@v2.12.2`, `benchstat@…`); `codesign-windows-ssl@~latest` carries a `# ci-pins-allow:` marker + `TODO(#127)` (no tagged ci-catalog release ships it yet); new `scripts/check-ci-pins.sh` guard + `ci-pins-check` job. Also closes SEC F-SUP-3 #153.
- ~~Q35 (#129)~~ — **CLOSED `790cdcb`** — `build:` now `needs:` typecheck/unit-tests/audit-ratchets.
- ~~Q36 (#131)~~ — **CLOSED `210133e`** — `go.mod` `replace` is now the relative `../geode-client-go` path.

#### Medium (1-5 days each)

- ~~Q23 (#126)~~ — **CLOSED `df3fd51`** — error-code registry (`errorcodes.go`, 62 constants, ~100 sites migrated, wire values byte-identical, `go/ast` golden test).
- Q8 (#141), ~~Q10 (#144)~~ **CLOSED `6abde32`**, Q11 (#152), ~~Q12 (#146)~~ **CLOSED `e510cb5`**, ~~Q13 (#149)~~ **CLOSED `0d629bf`**, Q14 (#155), Q15 (#157), Q17 (#162) — focused function decompositions.
- Q21 (#166), ~~Q22 (#168)~~ **CLOSED `03b6ec1`** — wire-shape parity sweep (Q22: pinned-by-test, no production change).
- ~~Q25 (#170)~~ — **CLOSED `f444c70`** — electron-tsc is now a real gate; electron + @types/node added to devDeps.
- ~~Q27 (#173)~~ — **CLOSED `2aaaebc`** — destructive-pages coverage 28% → 91.87% (Backup/Migrations/Restore page tests).
- Q44 (#179) — runbook.

#### Strategic (> 5 days)

- **EPIC-Q1** (`cmd/server` decomposition): ~~Q16 (#158)~~ + ~~Q26 (#172)~~ — **CLOSED `adf6b6f`** (decomposed into `cmd/server/app.go` + `profileseed.go`; coverage 4.0% → 65.3%). ~~Q38 (#180)~~ — **CLOSED `ea3f681`** (graceful-shutdown error wrapped + logged WARN; `cmd/server` cov 65.3%→70.7%). EPIC-Q1 now fully closed.
- **EPIC-Q2** (CI gating sweep): ~~Q35 (#129)~~ **CLOSED `790cdcb`**; ~~Q25 (#170)~~ **CLOSED `f444c70`**; ~~Q32 (#127)~~ **CLOSED `d35d3c7`**; Q29 + Q30 + Q33 still open. **Mostly closed** — defer remainder to gap-sync where overlapping (#46, #48).
- **EPIC-Q3**: ~~Q22~~ + ~~Q23~~ + ~~Q41~~ **all CLOSED** (`03b6ec1` / `df3fd51` / `1fea7ba`) + Q42 + Q43 + Q44 — module-conventions docs. Anchors landed; Q42/Q43/Q44 cross-link into `CONVENTIONS.md`.
- Q18 (#164) — GraphView decomposition; two-MR split.

### Phase 4 counts

- Filed in this cohort: **29 new issues** (#125, #126, #127, #129, #131, #134, #136, #138, #141, #144, #146, #149, #151, #152, #155, #157, #158, #162, #164, #166, #168, #170, #172, #173, #174, #175, #176, #177, #178, #179, #180, #181, #182, #183, #184, #185, #186, #187, #188, #189, #190, #191).
- Cross-link-only (deduped against existing): **5** (#46, #48, #90, #44, #102).
- Total Phase 3 findings triaged: 46 (Q1-Q46). Q4/Q5/Q6 consolidated under #187; remaining 43 distinct issues.
- No `won't-fix` decisions in this cohort yet — every finding has a remediation path.

### Notes on Q13/Q14 framing (gap-sync handoff)

The historic Q13 (#46 golangci) and Q14 (#48 coverage) rows above are
gap-sync-owned. The current scan re-confirms both are still open from a
Phase-4 perspective; no doc-row status change made here, deferring to
gap-sync. If a status correction lands in parallel, prefer gap-sync's
framing.

### Gap-closure run — 2026-05-12 (genapi + medium-cohort batch)

Two quality findings closed in this run (alongside 7 perf/security closures tracked
in the sibling docs):

- **Q02 (#90)** — `as unknown as` path-param casts in `src/api/profiles.ts` removed. `9b0a423` (geode-ui) + genapi `55c79d2`. See the Q02 row + the Upstream/cross-links note above. `createProfile`'s `as any` body cast remains as a small follow-up (not yet ticketed).
- **Q27 (#173)** — `src/components/ops` destructive-pages coverage 28% → 91.87%. `2aaaebc`. New `BackupPage.test.tsx` / `MigrationsPage.test.tsx` / `RestorePage.test.tsx`. No coverage gate added — Q14/#48 owns that, still open.

Both GitLab issues closed with evidence. The implementation commits sit on geode-ui
`main` **unpushed**; the genapi `55c79d2` commit sits on genapi `main` unpushed (user
decides on pushing/tagging genapi). Full report:
[`docs/gap-closure-reports/2026-05-12-genapi-and-medium-cohort-completion.md`](./gap-closure-reports/2026-05-12-genapi-and-medium-cohort-completion.md).

### Gap-closure run — 2026-05-12 (top-10 quality / perf / CI batch)

A second `/codepros:gap-close` run on 2026-05-12 landed the top-priority quality
backlog plus one perf and one security finding. Verifier returned **ACCEPT-WITH-NOTES**
— full suite green (`make go-test -race`, `make go-lint`, `make generate` clean,
`make bench-gate`, `npm test` 453/453), coverage up on every touched package
(`internal/server` 77.1→78.2%, `internal/jwt` 81.0→82.5%, `internal/profilestore`
80.7→81.0%, `cmd/server` 65.3→70.7%), no regressions. The one note (was
`genapi@v0.3.0` the exact tag `gen/` was generated against?) is **resolved**:
`git rev-parse v0.3.0^{commit}` in `~/src/devnw/go/genapi` == `55c79d2` == genapi
`main` HEAD == the working copy `gen/` was regenerated against — so the CI pin is correct.

**Quality findings closed (11 issues + 1 untracked follow-up):**

- **Q9 (#125)** — `streamQueryResult` `errWriter` shim + flatten. `a42a792`.
- **Q39 (#134)** — `streamQueryResult` `midStreamAbort()` slog.Warn (`stage`/`rows_sent`/`elapsed_ms`/`err`). `a42a792` (same commit as Q9 + PERF-2026-05-11-07 #145).
- **Q23 (#126)** — error-code taxonomy (`internal/server/errorcodes.go`, 62 constants, ~100 sites migrated wire-byte-identical, `go/ast` golden test). `df3fd51`.
- **Q41 (#136)** — `internal/server/CONVENTIONS.md` (6 sections, each `file`-cited; `README.md` pointer). `1fea7ba`.
- **Q10 (#144)** — `IsRevoked` flatten — `jtiRevoked` / `subjectRevokeAll` extracted (fail-closed semantics preserved). `6abde32`.
- **Q12 (#146)** — `Login` decomposition — `denyLogin` / `mintAndSetAuthCookie` / `adminRolesFor` (SEC-N10 constant-time + SEC-F7 cookie attrs preserved; security-reviewed). `e510cb5`.
- **Q13 (#149)** + **Q40 (#151)** — `WSServer.Query` decomposition (`startCancelReader` / `streamRowsOverWS`) + cancel-reader goroutine lifetime fix (`defer close(done)` + `select <-done`); `-race` clean, no leak. `0d629bf`.
- **Q22 (#168)** — list-endpoint empty-result / wire-feature-missing rule pinned by `internal/server/list_handlers_test.go` (no production change — all handlers already satisfied it; verified the test catches a regression). `03b6ec1`.
- **Q38 (#180)** — `cmd/server` graceful-shutdown error wrapped (`errGracefulShutdown` sentinel + `shutdownBudget` field) + logged WARN; no `_ = httpSrv.Shutdown(...)` anywhere. `ea3f681` (same commit as SEC F-INPUT-2 #143). `cmd/server` cov 65.3→70.7%.
- **Q32 (#127)** — CI tool refs pinned to immutable tags (`genapi@v0.3.0`, `golangci-lint@v2.12.2`, `benchstat@…`); `codesign-windows-ssl@~latest` carries a `# ci-pins-allow:` marker + `TODO(#127)` (**deviation** — no tagged ci-catalog release ships that component yet; pre-existing); new `scripts/check-ci-pins.sh` guard wired into `.pre-commit-config.yaml` + a `ci-pins-check` CI lint job. `d35d3c7`. (Also closes SEC F-SUP-3 #153.)
- **`createProfile` `as any` body cast (no GitLab issue)** — `src/api/profiles.ts`: `toWireCreateRequest` return type → `CreateProfileReq` (from `@api`); `as any` removed at `client.postProfiles(...)`. The other `listProfiles`/`fromWireProfile` casts (Q2/#90) deliberately left alone. `2c5895d`. Closed-no-issue follow-up; closes the loose end noted under the 2026-05-12 genapi-batch entry above.

**Follow-up (was: small, not ticketed) — DONE 2026-05-12** (errorcode-crosscheck run; commits `41ed5fa`, `312eee2`, `5598434`, `1660908`): the frontend↔server error-code coupling now has a seam plus an automated cross-check. Note: there is **no `src/lib/errors.ts`** — the real coupling lived in `src/api/capabilities.ts`, which hard-coded the literal `'wire_feature_missing'` twice. Resolution:

- new `src/api/serverErrorCodes.ts` (exports `WIRE_FEATURE_MISSING = 'wire_feature_missing'`) + `src/api/serverErrorCodes.test.ts` (`41ed5fa`);
- `src/api/capabilities.ts` branches wire-feature-missing detection off the seam constant instead of the raw literal (`312eee2`); `src/components/admin/UsersPage.test.tsx` fixtures use `WIRE_FEATURE_MISSING` instead of raw literals (`1660908`);
- new `scripts/check-error-codes.mjs` (pure `checkErrorCodes(root)` + `main()`) cross-checks the seam against `internal/server/errorcodes.go` (62 server codes) + `scripts/check-error-codes.test.mjs` (`node --test`, 4 subtests); a `check-error-codes` local pre-commit hook + an `error-codes-check` lint job in `.gitlab-ci.yml` (the CI job also runs `node --test scripts/check-error-codes.test.mjs` before the guard) wire it into the gate (`5598434`, `1660908`);
- corrected an inaccurate "the SPA keys i18n messages off it" header comment in `internal/server/errorcodes.go` (`5598434`).

Verified: `node --test scripts/check-error-codes.test.mjs` 4/4, `node scripts/check-error-codes.mjs` OK; both reviewers APPROVE (minor nits fixed in `1660908`). Resolved record in `GAP_ANALYSIS_RESOLVED.md`.

**Handoff:** the 11 implementation commits (`d35d3c7`, `2c5895d`, `a42a792`, `0d629bf`,
`e510cb5`, `6abde32`, `ea3f681`, `df3fd51`, `03b6ec1`, `1fea7ba`, `6c14368`) + the
docs-tracking commit sit on geode-ui `main` **unpushed** — the user decides on
`git push origin main`. Full report:
[`docs/gap-closure-reports/2026-05-12-top10-quality-batch-completion.md`](./gap-closure-reports/2026-05-12-top10-quality-batch-completion.md).

---

## 2026-05-13 audit cohort

This cohort tracks the new quality findings produced by the Phase 3 deep-review on
2026-05-13 against `main` (HEAD post-`c07668b`). Twelve findings are net-new
(Q47–Q53, Q-NEW-A..I, omitting Q50 which was refuted as a duplicate of GAP-S5);
three reconfirmations (Q12 #44, Q13 #46, Q14 #48) carry comment-pings only.

PriorityScore = Impact × Likelihood × Reach / Effort, each 1–5.

### Findings table (sorted PriorityScore desc)

| Q-ID | Sev | Score | Issue | File:Line | Status | Brief |
|------|-----|------:|-------|-----------|--------|-------|
| Q48 | High | 32 | [#192](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/192) | `src/components/results/GraphView.tsx` (1–396 orchestrator) | **resolved** (Bundle D) | Decomposed across 11 new modules under `src/components/results/graph/` (`useGraphPathMode`, `useFillHeight`, `useGraphElements`, `useGraphActions`, `useGraphCytoscape`, `GraphInspector`, `GraphToolbar`, `GraphSidebar`, `GraphSidebarContents`, `layouts`, `explore`, `cyHelpers`, `styled`). Orchestrator now 396 LOC (was 1982). Supersedes Q18 / #164 (1257-LOC framing). |
| Q49 | High | 24 | [#193](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/193) | `cmd/server/app.go:128-445` (`newApp` 317 LOC) | **open** | Split into `buildIssuer` / `openProfileStore` / `attachRevocation` / `mountAPI` / `buildLimiters` / `buildHTTPServer`. |
| Q47 | High | 20 | [#194](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/194) | `tsconfig.json:8` + `jest.config.cjs:9` | **resolved** (Bundle C) | `noImplicitAny:false` removed from `tsconfig.json`; ts-jest deprecation flag moved into inline tsconfig — strict mode now uniformly enforced. |
| Q52 | High | 18 | [#195](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/195) | `tsconfig.json` / `electron/tsconfig.json` / `e2e/tsconfig.json` | **resolved** (Bundle C) | Extracted `tsconfig.base.json`; web / electron / e2e configs now `extends` the shared base. |
| Q-NEW-A | Med | 15 | [#197](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/197) | `internal/server/result_codec.go:118-122` | **open** | Mid-stream abort: SPA parses truncated body as 200 OK success — emit `error` trailer or switch to NDJSON. |
| Q51 | Med | 15 | [#196](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/196) | `jest.config.cjs:9` | **resolved** (Bundle C) | Top-level `isolatedModules` removed from `ts-jest` transformer options; ts-jest v30 deprecation warning eliminated. |
| Q53 | Med | 12 | [#198](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/198) | `internal/server/handlers_capabilities.go:30,41` | **open** | Hardcoded `admin_writable={false,false,false,false}` — wire to Geode build probe or env gate. |
| Q-NEW-B | Med | 12 | [#199](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/199) | `cmd/server/app.go:282-289` | **open** | `WSServer.Config` partial duplicate of `server.Config` — drift risk on field additions. |
| Q-NEW-C | Med | 10 | [#200](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/200) | `internal/server/ws_query.go:319-330` | **open** (suspected) | Inner relay goroutine in `readMsg` bounded only by 30 s frame deadline, not by context cancel. |
| Q-NEW-D | Med | 10 | [#204](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/204) | `internal/server/ws_query.go:108-134` | **open** (suspected) | `rowBatcher.flush` stale `envelope.Rows[]` slice header — pin with `-benchmem` bench + clear before reset. |
| Q-NEW-E | Med | 10 | [#203](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/203) | `internal/server/handlers_uploads.go:113-126` | **open** | Filename collisions silently overwrite via `os.Rename`; no per-tenant quota. |
| Q-NEW-F | Med | 9 | [#207](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/207) | `internal/profilestore/sqlite.go:152` | **open** | Writer handle has no `busy_timeout` (only RO does). |
| Q-NEW-G | Low | 8 | [#208](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/208) | `internal/server/handlers_users.go:189-192` | **open** | Empty PATCH fabricates a synthetic `User` response — should 400 `empty_patch` or treat as GET. |
| Q-NEW-H | Low | 6 | [#214](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/214) | `src/pages/AdminPage.tsx:44` + `OpsPage.tsx:43` | **open** | `pathname.endsWith('/users')` is fragile — use `useMatch` or last-segment compare. |
| Q-NEW-I | Low | 6 | [#215](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/215) | `src/services/i18n/LocalizationProvider.tsx` | **open** | 49.35% line coverage; untested fallback-locale + lazy-load failure branches. |
| Q50 | — | — | (none) | `internal/profilestore/sqlite.go:569` | **refuted** | Reviewer flagged for split; justified by GAP-S5 envelope (no change). |

### Re-validations (no status change vs prior cohort)

| Q-ID | Issue | Status | Note |
|------|-------|--------|------|
| Q12 | [#44](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/44)  | **open** | Both lockfiles still present (`package-lock.json` + `pnpm-lock.yaml`). Re-validation comment added 2026-05-13. |
| Q13 | [#46](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/46)  | **open** | Still no `.golangci.yml` at repo root; pre-push hook runs default set only. Comment added 2026-05-13. |
| Q14 | [#48](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/48)  | **open** | No Jest `coverageThreshold`; no Go coverage ratchet in CI. Comment added 2026-05-13. |

### Counts (2026-05-13 cohort)

- **High**: 4 (Q47, Q48, Q49, Q52) — Q47/Q52 closed Bundle C; Q48 closed Bundle D; Q49 open.
- **Medium**: 8 (Q51, Q53, Q-NEW-A..F) — all open. Q-NEW-C and Q-NEW-D carry `confidence::suspected`.
- **Low**: 3 (Q-NEW-G, Q-NEW-H, Q-NEW-I) — all open.
- **Refuted**: 1 (Q50).
- **Re-validated open**: 3 (Q12 #44, Q13 #46, Q14 #48).
- **Total new GitLab issues filed**: 15 (#192–#200, #203, #204, #207, #208, #214, #215).

### Roadmap (2026-05-13 cohort)

#### Quick wins (≤ 1 day)

- Q47 (#194) — delete one tsconfig line + run `tsc`, move `isolatedModules` in jest config.
- Q51 (#196) — single-line jest config delete.
- Q-NEW-F (#207) — append `busy_timeout` pragma to writer DSN.
- Q-NEW-G (#208) — pick 400 or fall-through and add one test.
- Q-NEW-H (#214) — swap `endsWith` for `useMatch` (or last-segment compare).
- Q-NEW-I (#215) — three new tests in `LocalizationProvider.test.tsx`.

#### Medium (1–5 days)

- Q49 (#193) — `newApp` decomposition (preserve `cmd/server` coverage ≥ 70.7%).
- Q52 (#195) — extract `tsconfig.base.json` + `extends` (pair with Q47).
- Q-NEW-A (#197) — emit error-trailer or switch to NDJSON on `/api/v1/query`.
- Q-NEW-B (#199) — collapse `server.Config` duplication on WS surface.
- Q-NEW-C (#200) — add inner-relay goroutine leak test; tighten if it fails.
- Q-NEW-D (#204) — add `BenchmarkRowBatcher_Flush` with `-benchmem` + invariant comment.
- Q-NEW-E (#203) — collision handling + optional upload-dir quota.
- Q53 (#198) — Geode admin-DDL probe or env gate for `admin_writable`.

#### Strategic (> 5 days)

- Q48 (#192) — GraphView decomposition (≥ 6 new files, ~1400 LOC moved). Supersedes Q18 / #164.

### Verdict (2026-05-13 cohort)

Two structural cliffs (Q48 GraphView ~2k LOC, Q49 newApp 317 LOC) re-formed after
their predecessor closures (Q18 / #164 at 1257 LOC; Q16 / #158's main.go
decomposition). Together with the strict-mode defeat (Q47), they account for
the cohort's three highest-score findings. The remaining cohort items are
focused single-file fixes — the largest medium-scope item (Q-NEW-A
mid-stream-abort client visibility) needs a wire-shape decision but is
mechanically small once the contract is set.

No release-blocker-grade findings in this cohort. The newly-filed items can be
batched into the next sprint-sized closure run alongside the still-open
Q14/#48 (coverage gate) and Q13/#46 (`.golangci.yml`) items that gap-sync owns.
