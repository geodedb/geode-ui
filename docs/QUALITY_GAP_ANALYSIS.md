# QUALITY_GAP_ANALYSIS.md

Last updated: 2026-05-10
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
| Q13 | Adopt `golangci-lint` (errcheck, staticcheck, ...)                   | Low      |    36 | [#46](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/46)              | `.pre-commit-config.yaml:130` runs `scripts/run-go.sh tool-golangci` at pre-push | **Closed** — `golangci-lint` already wired into the pre-push hook gauntlet. Output is enforced (commits/pushes are blocked on findings; QF1001/QF1008/unused already burned down). |
| Q14 | Wire coverage gates (Go ~68.7% floor, Jest threshold)                | Low      |    32 | [#48](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/48)              | (repo root) CI + Jest config                                                                                      | Enforce floors; ratchet up monthly                                              |
| Q10 | Missing `docs/adr/` + `internal/server/README.md`                    | Low      |    24 | [#42](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/42)              | `docs/adr/0000-record-architecture-decisions.md` (new), `internal/server/README.md` (new)                         | **Closed** 2026-05-10 — ADR meta-record added under `docs/adr/` (Nygard convention, four-section template, supersession protocol documented); `internal/server/README.md` documents per-file layout, audit/rate-limit conventions, generated-code policy, and the `GOEXPERIMENT=jsonv2` build-env requirement. |
| Q12 | Two lockfiles committed (`package-lock.json` + `pnpm-lock.yaml`)     | Low      |    24 | [#44](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/44)              | `package-lock.json`, `pnpm-lock.yaml`                                                                              | Delete `package-lock.json`; gitignore                                            |
| Q15 | Pin Node toolchain (`.tool-versions`/`.nvmrc` + `packageManager`)    | Low      |    24 | [#49](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/49)              | `.tool-versions`, `.nvmrc`, `package.json:packageManager`                                                            | **Closed** 2026-05-08 — `.nvmrc` pinned to `22.14.0` (matching `engines.node`); `.tool-versions` adds `nodejs 22.14.0` for asdf/mise users; `package.json` declares `"packageManager": "npm@10.9.0"` so corepack picks the same client every time. |

### Counts by Severity

- High: 4 (1 closed, 3 open: Q3, plus Q1/Q2/Q4 already closed in 2026-05-07 run)
- Medium: 6 (1 closed: Q11; 5 open: Q5, Q6, Q7, Q8, Q9)
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
| Q-NEW-T2 | Tooling gap: no bundle-size budget enforced | Medium | 32 | **Closed** 2026-05-08 | `webpack.prod.js:performance` | `hints: 'error'`, `maxAssetSize: 1 MiB`, `maxEntrypointSize: 1.5 MiB`; assetFilter excludes source maps, fonts, icons, monaco workers (each independently loaded). Tighten further once F10 (Monaco/Cytoscape code-split) lands. |
| Q-NEW-T3 | Tooling gap: no Lighthouse / Web Vitals CI gate | Low | 16 | Deferred (CI infra) | `.gitlab-ci.yml` | **Unblock condition:** ephemeral preview URL per MR (review-app or staging). Then add `treosh/lighthouse-ci-action` style job pinned to performance ≥ 80 / a11y ≥ 90. |
| Q-NEW-T4 | Tooling gap: no a11y unit harness | Low | 16 | Deferred (test-runner adoption) | `__test_utils__/afterEnv.js` | **Unblock condition:** `jest-axe` + `@axe-core/react` added to devDependencies + a per-component coverage matrix decided. Today the manual a11y wins (skip-link, ARIA roles, focus-visible) are all hand-validated. |

### Counts after 2026-05-08 audit pass

- High: 5 (1 closed this session: Q-NEW-1; pre-existing 4 closed: Q1, Q2, Q4)
- Medium: 7 (3 closed: Q11, Q-NEW-2, Q-NEW-3; 4 open: Q5, Q6, Q7, Q8, Q9 + tooling T1/T2)
- Low: 9 (4 closed: Q10, Q13, Q14 deferred-CI, Q15; 5 open: Q-NEW-4 through Q-NEW-T4)

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
- ~~Q10 — create `docs/adr/` + `internal/server/README.md` skeleton.~~ **Closed 2026-05-10.**

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
| Q02 | api-contract (upstream) | high | Fix-Soon (upstream) | [#90](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/90) (shim); upstream [genapi#216](https://gitlab.com/devnw/apps/genapi/-/work_items/216) | `src/api/profiles.ts:173,187,196,208,215` (5x `as unknown as` casts)                                |
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

- **Q02 → genapi#216** ([https://gitlab.com/devnw/apps/genapi/-/work_items/216](https://gitlab.com/devnw/apps/genapi/-/work_items/216)) — root cause of the five `as unknown as` casts. Geode-ui carries a tracking shim (#90) that closes when the upstream lands and the client is regenerated. **Per repo memory: do NOT hand-edit `gen/`.**
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

- **Q02** — waits on genapi#216, then a one-MR cast cleanup.
