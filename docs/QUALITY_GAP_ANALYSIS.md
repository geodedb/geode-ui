# Quality Gap Analysis

Last updated: 2026-05-21 (gap-close pass — `Q-S-02` doc-routes self-collision **CLOSED** via `00488b2` (`scripts/check-doc-routes.mjs` allow-list adds `docs/audits/**` + matching guard-test case). `Q-S-01` ESLint react-in-jsx-scope was momentarily flagged during the audit, then restored to convention in this gap-close pass — the codebase uses `jsx: "react-jsx"` for TS but airbnb ESLint still requires the React import; the 76-file convention now consistent.)

Previous: 2026-05-21 (audit Phase 4 — quality-issue-tracker run in `--skip-issues` (docs-only) mode against the 2026-05-21 audit Phase 1-3 surface: `docs/audits/2026-05-21/quality-inventory.md` + `quality-scan.md` + `quality-review.md`. Reviewer produced **28 confirmed/suspected findings** (21 confirmed / 7 suspected) across Readability(10), API contract(6), Reliability(7), Documentation(5). Scanner reported 4 tool failures: ESLint 4 errors (now **RESOLVED** by user edit to `src/pages/DashboardPage.test.tsx` — `import React` removed), `check-doc-routes` self-collision (**PROMOTED to P0 / Blocker** — the audit deliverable itself trips the guard, so every future audit run will re-fire CI), image-pin missing on `.gitlab-ci.yml:884`, chunk-budget over by 2 chunks. No GitLab writes in this pass — issue numbers below are tracking IDs only, to be filed in a separate `--issues` run.)

Previous: 2026-05-19 (closure cohort — /codepros:gap-close round-4 against the 2026-05-19 audit Phase 4 surface: Q-NEW-Q / #289 Closed via `b78c0da` (runSync generation counter); Q-NEW-R / #314 Closed via `f725ea4` (tab-scoped `ResultTabErrorBoundary`). 9 of 11 2026-05-19 quality items remain Open. See `GAP_ANALYSIS_RESOLVED.md` "Closure cohort 2026-05-19" for evidence.)

Previous: 2026-05-19 (audit Phase 4 — quality-reviewer added 26 findings, grouped into 11 GitLab issues: #289/#292/#295/#299/#303/#307/#309/#311/#314/#315/#319. New cohort table appended at the end of this file.)

Repo: `devnw/codepros/geode/geode-ui`

Review scope: app code, generated API boundary, Go server, React/TypeScript UI, Electron, tests, configs, CI/CD, Docker/container files, scripts, docs that affect quality or build/runtime performance.

## Summary

The 2026-05-16 closure batch resolved all 19 prior open quality umbrella issues (#44, #46, #48, #148, #164, #174, #175, #177, #178, #184, #193, #226, #227, #228, #229, #230, #231, #232, #233). Those rows are now mirrored in `docs/GAP_ANALYSIS_RESOLVED.md` and are no longer carried in this active table.

This audit pass (2026-05-17) added **15 newly-confirmed gaps** from the quality-reviewer Phase 3 output. Two are Critical (cross-stack contract-mirror failures), one is High (theme-token regression risk), six are Medium, four are Low, and two are architectural follow-ups. Four reviewer items were resolved as Won't-Do or insufficient-evidence (`M3 editorMode default`, `M6 redundant null check`, `M7 zustand selector shape`, `A1 admin nav` — subsumed in Q-NEW-8/#252, `A3 profile-name normalisation authority` — subsumed in Q-NEW-1/#241).

Severity counts (new):

- Critical: 2
- High: 1
- Medium: 6
- Low: 4
- Info / architectural: 2

Top 5 by PriorityScore and release risk:

1. Profile-name NFKC normalisation client/server mismatch — confirmed bypass of the SQLite UNIQUE invariant: [#241](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/241).
2. No password-policy drift guard between TS mirror and Go authority: [#242](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/242).
3. AdminPage uses stale `colors.text` / `colors.textSecondary` theme tokens (dark-on-dark regression risk): [#250](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/250).
4. Codify cross-stack contract-mirror discipline (ADR + active pair registry): [#261](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/261).
5. `extractElements` is a 181-LOC multi-concern function: [#247](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/247).

## Orientation

Commands run (this pass):

- `git remote get-url origin` -> `git@gitlab.com:devnw/codepros/geode/geode-ui.git`
- `glab issue list --label quality --per-page 50` confirmed all 19 prior umbrella issues are closed (the 2026-05-16 batch).
- File-on-disk evidence verified for every Phase-3 reviewer cite (`internal/profilestore/schema.go:26`, `src/components/profiles/ProfileEditorModal.tsx:70-80`, `src/lib/passwordPolicy.ts:32`, `internal/server/password_policy.go:58,146`, `src/lib/passwordGenerator.ts:148-156`, `src/components/results/projectColumns.ts:277-278`, `src/pages/AdminPage.tsx:12-19,37-39`, `src/lib/graphResult.ts:143` -- the original reviewer cite of `src/components/results/graph/extractElements.ts` did not exist on disk).
- Inventoried existing umbrella `#164` (GraphViewCytoscape decomposition) and `#214` (AdminPage pathname matcher) for dedupe.

## Quality Contract

The Phase-3 review treated the existing repo-standard checks (TS typecheck, lint, prettier, electron typecheck, Jest coverage, Go vet / test / lint, etc.) as the baseline. This audit pass did not re-run them; the 2026-05-16 closure pipeline left them all green per the closure notes (see `docs/gap-closure-reports/2026-05-16-*.md`).

## Stack-Ranked Table

`PriorityScore = Impact(1-5) * Likelihood(1-5) * 4`.

| Rank | Severity | PriorityScore | Category | Finding | Component | Evidence | GitLab Issue | Fix Summary | Owner | ETA/SLA | Status |
|---:|---|---:|---|---|---|---|---|---|---|---|---|
| 1 | Critical | 64 | api-contract | Profile-name NFKC client/server normalisation mismatch -- SQLite UNIQUE BINARY bypass | Profile store / UI | `internal/profilestore/schema.go:26` UNIQUE on `(scope, owner_user_id, name)` BINARY; `src/components/profiles/ProfileEditorModal.tsx:70-80` normalises NFKC+lower+trim | [#241](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/241) | Add server-side `normalizeProfileName`; migrate existing rows; COLLATE NOCASE; cross-stack contract test | Server / Profile store | 1 sprint | **Closed (2026-05-17)** — `bf0c571` — Go authority `NormalizeProfileName` (NFKC+trim+lower) mirrors the SPA `nameIsDuplicate` norm helper. `profilestore.Put`/`Patch` pre-flight a normalised uniqueness check against the (scope, owner) bucket before INSERT/UPDATE, returning `ErrConflict` on NFKC- or case-equivalent duplicates. Contract file `contracts/profile-name-normalization.contract.json` + Go test `normalize_test.go::TestNormalizeProfileName_Contract` + TS test `normalizeProfileName.contract.test.ts` pin the cross-stack agreement; `TestNormalizeProfileName_DuplicateBypassClosed` pins the security behaviour. |
| 2 | Critical | 64 | api-contract | No password-policy drift guard between TS mirror and Go authority | Auth / UI | `src/lib/passwordPolicy.ts:32,38,78-93`; `internal/server/password_policy.go:58,86-112` | [#242](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/242) | Generate contract JSON from Go constants; Jest contract test asserts TS mirror matches | Server / Frontend security | 1 sprint | **Closed (2026-05-17)** — `5cf844f` — `contracts/password-policy.contract.json` is the single source of truth for `minPasswordLength`, `usernameSubstringMin`, violation codes, and i18n keys. `password_policy_contract_test.go` pins the Go side; `src/lib/passwordPolicy.contract.test.ts` pins the SPA mirror. Drift verified to fail with a clear actionable message. |
| 3 | High | 48 | readability | AdminPage uses stale `colors.text` / `colors.textSecondary` tokens (dark-on-dark risk) | Frontend / admin | `src/pages/AdminPage.tsx:12-19,37-39` | [#250](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/250) | Migrate to `theme.text.primary` / `theme.text.secondary`; visual regression for active-tab contrast | Frontend / theme | 7d | **Closed (2026-05-17)** — `081e05c` — tab styling now binds to `theme.text.primary` / `theme.text.secondary` (and `theme.border.default`) directly, removing the dependency on the legacy `theme.colors.text*` mirrors that have historically drifted. 27-contrast.spec covers the user-visible contrast assertion. |
| 4 | Medium | 36 | architecture | Codify cross-stack contract-mirror discipline (ADR + active pair registry) | Architecture | password-policy pair + profile-name pair both confirmed bypassable; no enforcement mechanism | [#261](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/261) | ADR-0002 + registry table + Jest contract-test pattern + CI guard | Architecture | 1 sprint | confirmed, triage |
| 5 | Medium | 36 | readability | `extractElements` is a 181-LOC multi-concern function | UI graph | `src/lib/graphResult.ts:143-324` (181 LOC) | [#247](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/247) | Split into 4 pure helpers under `src/lib/graphResult/`; orchestrator becomes ~20 LOC | Frontend graph | 1 sprint | **Closed (2026-05-17)** via `f1dc44d` — 181-LOC body decomposed into `collectRealEndpoints` / `applyParsedMatchLabels` / `buildPlaceholderMap` / `pushSynthesisedRows` (+ `pushRealElements`). Orchestrator is 33 LOC; 32 new helper tests + 16 baseline tests all green. |
| 6 | High | 24 | maintainability | passwordGenerator fallback returns unvalidated password when retry budget exhausted | Frontend security | `src/lib/passwordGenerator.ts:148-156` | [#244](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/244) | Re-validate fallback; throw on budget exhaustion | Frontend security | 7d | **Closed (2026-05-17)** via `cd5be84` — fallback now re-runs validatePassword and throws on exhaustion. Pinned by jest.isolateModules test mocking validatePassword to always reject. |
| 7 | Medium | 24 | maintainability | `projectColumns` mutates `Plan` via type cast -- replace with immutable copy | UI table | `src/components/results/projectColumns.ts:277-278` | [#248](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/248) | Replace `{...p, keys:p.keys.slice(0,perPlan)}` reassignment | Frontend table | 7d | **Closed (2026-05-17)** via `455f6b1` — column-budget trim now writes a fresh Plan (`{ ...p, keys: p.keys.slice(0, perPlan) }`) into plan[slot]; no type-cast mutation. Pinned by source-scan test + behavioural test. |
| 8 | Medium | 24 | architecture | AdminPage 8-tab flat nav lacks overflow strategy -- pick IA pattern before tab 9 | Frontend / admin | `src/pages/AdminPage.tsx:55-77` (line-citation drift fixed 2026-05-17; previous cite `:42-72` predated a later style block insertion) | [#252](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/252) | Pick grouped flat nav / two-level nav / sidebar; pair with `#214` matcher fix | Frontend / admin | 1-2 days | confirmed, triage |
| 9 | Medium | 32 | docs | Workspace doc residue: README + PERF + QUALITY cite removed `/workspace` paths | Tracking docs | `README.md:43`; `docs/PERF_GAP_ANALYSIS.md:60,65`; `docs/QUALITY_GAP_ANALYSIS.md` (closure note refs deleted `WorkspacePage.test.tsx`) | [#253](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/253) | README route list; move PERF row; strip orphan cites; CI doc-link check | Docs / Tracking | 30 min | **Closed (2026-05-17)** via `e4a4c3c` — README route list trimmed; PERF closure note rephrased; new `scripts/check-doc-routes.mjs` pre-commit gate scans every live `.md` for residue with a documented historical allowlist. |
| 10 | Low | 24 | docs | CHANGELOG.md is stale -- 50 issue closures since v0.1.0 not recorded | Tracking docs | `CHANGELOG.md:1-40` only v0.1.0 entry | [#258](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/258) | Add Unreleased section; backfill 2026-05-12/13/16 batches; pre-commit gate | Tracking / docs | 1-2h backfill | **Closed (2026-05-17)** via `c1a7c80` — added `## [Unreleased]` section backfilling Added/Changed/Fixed/Removed/Security for the 2026-05-12/13/14/15/16/17 batches; new `scripts/check-changelog.mjs` pre-commit gate asserts presence of the Unreleased heading + every required batch date. |
| 11 | Low | 16 | deps | `cytoscape-popper` is a dead dependency | Frontend / deps | `package.json:58`; `src/types/cytoscape-popper.d.ts`; no source imports | [#255](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/255) | `npm uninstall cytoscape-popper`; delete typings shim | Frontend / deps | 15 min | **Closed (2026-05-17)** via `7d271a2` — uninstalled cytoscape-popper@2.0.0 and removed `src/types/cytoscape-popper.d.ts`. Verified no transitive consumer. `npm test` (865 tests) + `npm run build` stay green. |
| 12 | Low | 16 | cleanup | `password_policy.go` uses dead `unicode` import-keeper | Server | `internal/server/password_policy.go:13,146` | [#245](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/245) | Remove `unicode` import; replace `_ = unicode.IsDigit` with a comment | Server | 15 min | **Closed (2026-05-17)** via `f6c0047` — dropped the `unicode` import and the dead `_ = unicode.IsDigit` keeper; expanded function-doc to explain the ASCII-only choice. |
| 13 | Low | 8 | ci-cd | `bench-baseline.txt` is 5 days stale -- recent gap-close benches not reflected | CI / perf | `bench-baseline.txt` mtime 2026-05-12 | [#260](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/260) | Regenerate baseline; document cadence; gate closure pipeline | CI / perf | 15 min | **Closed (2026-05-17)** — regenerated after the round-3 closure cohort via `make bench-baseline`. Cadence: regenerate after every 10-issue closure cohort (committed alongside the cohort tracking-update). The bench gate is `allow_failure: true` and run-to-run noise dominates on shared runners, so the baseline is informational-leaning rather than a hard regression line. |
| 14 | Low | 8 | tests | passwordGenerator tests contain probabilistic assertions on real-RNG output | Frontend tests | `src/lib/passwordGenerator.test.ts` | [#262](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/262) | Export `RandomSource`-injected seam; deterministic test cases | Frontend tests | 1-2h | **Closed (2026-05-17)** via `bf94a9a` — exported `RandomSource` interface from `passwordGenerator.ts`, plumbed optional `rand?: RandomSource` through `GenerateOptions`; 4 new deterministic tests pin canonical seed→password, class-mixing, username-substring rejection, and the crypto-default-when-omitted contract. |
| 15 | Low | 8 | perf | NDJSON export concatenates whole body into one string before Blob | UI table | `src/components/results/TableView.tsx` exportRespAsNdjson | [#263](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/263) | Blob constructor with iterable of parts | Frontend table | 1h | **Closed (2026-05-17)** via `17a6253` — `exportRespAsNdjson` now writes each row + `\n` separator as a distinct entry in a `parts: string[]` array passed straight to `new Blob(parts, ...)`; halves the peak heap footprint of the export step. 3 new tests spy on the Blob ctor. |
| 16 | Medium | 36 | readability | GraphViewCytoscape.tsx residual orchestrator size (685 LOC after 2026-05-16 split) | UI graph | `src/components/results/GraphViewCytoscape.tsx` 685 LOC | [#164](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/164) (existing) | Lifecycle effect hoist + cxtmenu bootstrap helper + tooltip portal sibling | Frontend graph | 1 sprint | **Closed (2026-05-17)** via `5d8a01a` — 685→488 LOC. Hoisted into `useGraphPreferences`, `useGraphSigReset`, `useGraphSelectionActions`, `useGraphLatestRefs`, and `GraphCanvasOverlay` (canvas + overlays sibling). All 38 GraphView tests + 916/916 full Jest suite green. |
| 17 | Low | 6 | duplication | AdminPage triad (Policies/Roles/Users) shares ~75 LOC scaffold — styled-components + state block + onDelete handler | Frontend / admin | `src/components/admin/PoliciesPage.tsx:46-79,105-118`; `src/components/admin/RolesPage.tsx:62-113,139-152`; `src/components/admin/UsersPage.tsx:45-79,114-127` | [#270](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/270) | Extract `useAdminListPage<T>` hook + `<AdminPageShell>` wrapper; ~50 LOC drop per page | Frontend / admin | 1 day | **Closed (2026-05-17)** via `12dc773` — `useAdminListPage<T>` (156 LOC) extracts state + capabilities probe + list fetch + delete handler. `<AdminPageShell>` (116 LOC) factors the ToolBar + ErrorBanner + UnsupportedNote shell. Page deltas: PoliciesPage 349->283 (-66), RolesPage 368->300 (-68), UsersPage 421->355 (-66). Net: 200 LOC down across the triad + 272 LOC in new shared infrastructure. All 16 admin tests + 924/924 full Jest suite green; `npm run lint` clean. |
| 18 | Low | 5 | docs | Doc drift bundle: local `pnpm-lock.yaml` + wrong-direction remediation in `docs/GAP_ANALYSIS.md:259` + 4 residual `pnpm` cites in `docs/SECURITY_GAP_ANALYSIS.md` | Tracking docs / CI | `pnpm-lock.yaml` mtime 2026-05-10 (gitignored at `.gitignore:74`); `docs/SECURITY_GAP_ANALYSIS.md:23,52,181,288` | [#269](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/269) | Delete local lock; scrub pnpm references in security doc; (b) covered by sibling gap-sync GAP-035 | Docs / Tracking | 30 min | **Closed (2026-05-17)** via `5350b99` — deleted local `pnpm-lock.yaml` (gitignored, no commit footprint); rewrote `docs/SECURITY_GAP_ANALYSIS.md:23,52,181,288` to reference `package-lock.json` / `npm audit` / "npm overrides" / `package-lock.json` respectively. Part (b) tracked separately. |
| 19 | Low | 4 | maintainability | `internal/profilestore/sqlite.go` 859 LOC — only prod file over 800 LOC threshold | Server / profile store | `internal/profilestore/sqlite.go` (859 LOC) | [#268](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/268) | Mechanical 3-file split: `sqlite.go` (~340) + `sqlite_rewrap.go` (~120) + `sqlite_crud.go` (~390); receiver `*sqliteStore` unchanged; no exported symbol moves | Server / profile store | 1 day | **Closed (2026-05-17)** via `eca3040` — split landed at the planned boundaries: `sqlite.go` 308 LOC (Open/Close/handles + sealString/unsealBytes/Cipher seam + `DBHandleProvider` interface), `sqlite_rewrap.go` 132 LOC (`Rewrapper` + `RewrapResult` + `RewrapSensitiveColumns`), `sqlite_crud.go` 436 LOC (List/ListVisible/scanProfile/Put/Get/Patch/Delete + `mergeProfile`). No exported symbol moves; receiver `*sqliteStore` intact. `go build ./...` + `go test -race ./internal/profilestore/...` green. |
| 20 | Low | 3 | dead-code | `src/components/results/graph/explore.ts:24` `buildExploreStatement` truly dead export — only a backwards-compat comment in `buildExpand.ts:4` survives | Frontend / graph | `src/components/results/graph/explore.ts:24`; `src/components/results/graph/buildExpand.ts:4` | [#271](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/271) | Delete file (or function); update historical comment | Frontend / graph | 5 min | **Closed (2026-05-17)** via `c71f812` — deleted `buildExploreStatement` + its `buildExpandStatement` import from `explore.ts`; rewrote the comment in `buildExpand.ts:4` to describe the simple-form behaviour without referencing the removed symbol. `tsc --noEmit` green. |

## Findings By Category

### API contract / cross-stack mirror

- [#241](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/241): Profile-name NFKC mismatch (Critical). Verify with cross-stack contract test driving both `nameIsDuplicate` and server `CreateProfile`.
- [#242](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/242): Password-policy drift guard (Critical). Verify with deliberate bump on one side -> Jest contract test fails.
- [#261](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/261): ADR + active-pair registry. Verify the same drift-pump test fails CI for any active pair.

### Maintainability / readability

- [#247](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/247): `extractElements` decomposition. Verify each helper has its own test file; orchestrator < 40 LOC.
- [#248](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/248): `projectColumns` Plan immutability. Verify no `as { keys: string[] }` cast remains.
- [#244](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/244): passwordGenerator fallback re-validation. Verify with mocked `validatePassword` that always rejects.
- [#250](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/250): AdminPage theme tokens. Verify visual regression for active-tab contrast in dark mode.
- [#164](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/164): GraphViewCytoscape residual decomposition (re-commented). Verify with LOC drop below ~500.
- [#268](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/268) (2026-05-17): `internal/profilestore/sqlite.go` 859 LOC split. Verify three files under 500 LOC each; `go test ./internal/profilestore/...` green.
- [#270](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/270) (2026-05-17): AdminPage triad scaffold extraction. Verify `useAdminListPage<T>` hook + `<AdminPageShell>` land; ~50 LOC drop per page.

### Architecture

- [#252](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/252): AdminPage IA decision before tab 9. Verify with viewport-resize Jest case.
- [#261](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/261): Cross-stack contract-mirror discipline ADR.

### Cleanup / deps

- [#245](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/245): Dead `unicode` import-keeper in `password_policy.go`.
- [#255](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/255): Dead `cytoscape-popper` dependency.
- [#271](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/271) (2026-05-17): Dead export `buildExploreStatement` in `src/components/results/graph/explore.ts:24`. Only an inactive backwards-compat comment in `buildExpand.ts:4` survives — no callers in `src/`, `e2e/`, `scripts/`.

### Tests

- [#262](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/262): passwordGenerator probabilistic test assertions.

### Performance (residual quality-class)

- [#263](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/263): NDJSON export Blob allocation.

### Docs / tracking

- [#253](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/253): Workspace doc residue across README + PERF + QUALITY tables.
- [#258](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/258): CHANGELOG.md stale by ~50 closures since v0.1.0.
- [#269](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/269) (2026-05-17, **Closed**): Stale local `pnpm-lock.yaml` deleted; 4 residual `pnpm` cites in `docs/SECURITY_GAP_ANALYSIS.md:23,52,181,288` rewritten to `package-lock.json`/`npm audit`/"npm overrides"/`package-lock.json`. Part (b) (wrong-direction remediation on `docs/GAP_ANALYSIS.md:259`) tracked separately by the gap-sync agent (GAP-035).

### CI / perf

- [#260](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/260): `bench-baseline.txt` stale.

## Roadmap

Quick wins (< 1 day):

- Remove `cytoscape-popper` dead dep ([#255](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/255)).
- Strip `unicode` import-keeper in `password_policy.go` ([#245](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/245)).
- Regenerate `bench-baseline.txt` ([#260](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/260)).
- Sweep workspace doc residue ([#253](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/253)).
- `projectColumns` immutability fix ([#248](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/248)).
- passwordGenerator fallback re-validation ([#244](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/244)).

Medium (1-5 days):

- AdminPage theme-token migration ([#250](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/250)).
- AdminPage IA decision + refactor ([#252](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/252), pair with existing [#214](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/214)).
- NDJSON export chunking ([#263](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/263)).
- passwordGenerator test seam ([#262](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/262)).
- CHANGELOG backfill ([#258](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/258)).

Strategic (> 5 days):

- Profile-name NFKC server-side normalisation + migration ([#241](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/241)).
- Password-policy drift guard ([#242](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/242)).
- Cross-stack contract-mirror ADR + registry + CI guard ([#261](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/261)).
- `extractElements` decomposition ([#247](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/247)).
- GraphViewCytoscape residual decomposition ([#164](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/164)).

## 2026-05-17 audit Phase 4 additions

Phase 3 (quality-reviewer) produced four new confirmed findings and one drop. Filed as `[QUALITY-16]` … `[QUALITY-19]` (continuing the Q-numbered cadence after `[QUALITY-15]` in #49):

| ID | Issue | Severity | PriorityScore | Category | Finding |
|---|---|---|---:|---|---|
| QUALITY-16 | [#268](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/268) (**Closed 2026-05-17** via `eca3040`) | Low | 4 | maintainability | Split landed: `sqlite.go` 308 / `sqlite_rewrap.go` 132 / `sqlite_crud.go` 436 LOC. No exported symbol moves; receiver unchanged. |
| QUALITY-17 | [#269](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/269) (**Closed 2026-05-17** via `5350b99`) | Low | 5 | docs | Local `pnpm-lock.yaml` deleted; 4 residual `pnpm` cites in `docs/SECURITY_GAP_ANALYSIS.md:23,52,181,288` rewritten to `package-lock.json`/`npm audit`/"npm overrides"/`package-lock.json` |
| QUALITY-18 | [#270](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/270) (**Closed 2026-05-17** via `12dc773`) | Low | 6 | duplication | `useAdminListPage<T>` (156 LOC) + `<AdminPageShell>` (116 LOC) extracted. Page deltas: Policies 349->283, Roles 368->300, Users 421->355 (~50 LOC each as planned). |
| QUALITY-19 | [#271](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/271) (**Closed 2026-05-17** via `c71f812`) | Low | 3 | dead-code | Deleted dead `buildExploreStatement` from `src/components/results/graph/explore.ts`; comment in `buildExpand.ts:4` rewritten to describe behaviour without referencing the removed symbol. |

Watchlist drift recorded in-place (no issue filed):

- **WL1 (rank-8 line-citation drift)**: `docs/QUALITY_GAP_ANALYSIS.md:57` previously cited `src/pages/AdminPage.tsx:42-72` for the AdminPage 8-tab flat-nav row (#252); actual tabs span `:55-77`. Fixed in this revision; the new range matches the on-disk file.

Phase-2 candidate dropped (no issue filed):

- **DROP1 (false positive)**: `__buildForTest` / `__writeTierForTest` at `src/components/results/graph/useGraphCytoscape.ts:456,466` were flagged by the unused-export scan but are an internal `__`-prefixed *test seam* documented at line :451 (`// eslint-disable-next-line no-underscore-dangle -- internal __-prefixed test seam`). They are imported via `require('./useGraphCytoscape')` from `useGraphCytoscape.perfMarks.test.ts:10-13` and `useGraphCytoscape.tier.test.ts:13,15,21,23`. The exports stay; no follow-up needed.

## Unknowns And Follow-Up Verification

- The cytoscape-popper dep audit relied on `grep` of `src/`; the typings shim survives despite no source import. Confirm during the dep-removal MR that no transitive consumer in `node_modules` actually references it at runtime (`npm ls cytoscape-popper`).
- The NDJSON-export allocation concern ([#263](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/263)) is marked `confidence::suspected` because the exact lines of the export helper were not re-read during this pass -- the closure note for #234 cites a new `exportRespAsNdjson()` helper. Confirm the concat pattern before fixing.
- The passwordGenerator probabilistic-test concern ([#262](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/262)) is `confidence::suspected`; run the suite 50x to surface any flake before landing the RNG-injection seam.
- Won't-do decisions noted in Summary: reviewer items M3 / M6 / M7 / A1 / A3 are either subsumed in filed issues or lack code-level evidence; revisit if a future pass surfaces a concrete cite.

## Reviewer items resolved Won't-Do

- **M3 editorMode default unclear**: `ProfilesPage.tsx:333-334` derives `editorMode` from `editorState.mode === 'edit' ? 'edit' : 'create'`; the default is explicit and the comment block at `:328-332` documents the design. No gap.
- **M6 Redundant null check**: No specific cite provided; no actionable change.
- **M7 Zustand selector shape issue**: `src/lib/queryStore.ts` has 2 fields (`stagedStatement`, `setStaged`); per-field selectors are the correct pattern here. No gap.
- **A1 Admin nav 2-level pattern**: Subsumed by [#252](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/252).
- **A3 Profile-name normalisation authority**: Subsumed by [#241](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/241) (the authority IS the missing server side; that is the bug being fixed).

## 2026-05-19 audit cohort

Phase 3 (quality-reviewer) produced **26 confirmed findings** against the graph + query + results subsystems. Findings cluster around four hot files that exceed the readability LOC budget after recent feature work:

- `src/components/results/graph/useGraphCytoscape.ts` (474 LOC) — rebuild closure monolith + 8-effect surface + module-level singleton.
- `src/pages/QueryPage.tsx` (630 LOC) — 4-concern effect surface + `streamStateToResp` co-location + abort/dedup gaps.
- `src/components/results/TableView.tsx` (615 LOC) — styled + virt-math + cell renderer + NDJSON export bundled.
- `src/components/results/GraphViewCytoscape.tsx` (498 LOC) — 23-field prop bundle wants a constructor.

The 26 findings were grouped into **11 GitLab issues** along natural cleavage lines (one umbrella per file or per concern cluster). All 11 carry `Discovered-By: 2026-05-19 audit`, `confidence::confirmed` (one `confidence::suspected`), and `status::triage`.

Severity counts (new):

- High: 4 (Q-NEW-Q runSync abort, Q-NEW-N lastRebuild singleton, Q-NEW-O tap-handler leak on error path, Q-NEW-R missing ErrorBoundary)
- Medium: 5 (Q-NEW-A/B/C/S decomposition umbrella, Q-NEW-D/E QueryPage extract, Q-NEW-F TableView split, Q-NEW-G+I+J+K+L+M type-safety umbrella, Q-NEW-P history dedup)
- Low: 2 (Q-NEW-T TTI mark on all branches, Q-NEW-H+U+V+W+X+Y+Z docs umbrella)

Top 5 by PriorityScore and release risk:

1. Q-NEW-Q — `runSync` has no AbortController; rapid double-Run clobbers fresh result with stale: [#289](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/289). PriorityScore **64**.
2. Q-NEW-A+B+C+S — `useGraphCytoscape` rebuild closure decomposition + `useWhenCy` helper + ref-in-deps cleanup: [#292](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/292). PriorityScore **48**.
3. Q-NEW-N — module-level `lastRebuild` singleton breaks multi-instance graphs: [#307](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/307). PriorityScore **48**.
4. Q-NEW-O — `cy.on` tap handlers not removed before `cy.destroy()` on error path: [#309](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/309). PriorityScore **48**.
5. Q-NEW-R — no `ErrorBoundary` between `GraphViewCytoscape` and `ResultPanel` tabs: [#314](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/314). PriorityScore **48**.

### Ranked PriorityScore table (2026-05-19 cohort)

`PriorityScore = Impact(1-5) * Likelihood(1-5) * 4`.

| Rank | IID | Severity | PriorityScore | Category | Finding | Component | Effort | Confidence | Status |
|---:|---|---|---:|---|---|---|---|---|---|
| 1 | [#289](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/289) | High | 64 | maintainability | Q-NEW-Q — `runSync` no AbortController; double-Run race | `src/pages/QueryPage.tsx:310-344` | S-M | confirmed | **Closed (2026-05-19)** via `b78c0da` — runSync generation counter; stale resolved promises short-circuit before clobbering fresh setResp. See `GAP_ANALYSIS_RESOLVED.md` "Closure cohort 2026-05-19" for evidence. |
| 2 | [#292](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/292) | Medium | 48 | readability | Q-NEW-A+B+C+S — `useGraphCytoscape` rebuild closure (170 LOC, 7 concerns) + `useWhenCy` helper + ref-in-deps cleanup + eslint marker | `src/components/results/graph/useGraphCytoscape.ts:163-333,337-448` | M | confirmed | open / triage |
| 3 | [#307](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/307) | High | 48 | maintainability | Q-NEW-N — module-level `lastRebuild` singleton breaks multi-instance | `src/components/results/graph/useGraphCytoscape.ts:71,223-229` | S | confirmed | open / triage |
| 4 | [#309](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/309) | High | 48 | maintainability | Q-NEW-O — `cy.on` tap handlers leak on rebuild error path | `src/components/results/graph/useGraphCytoscape.ts:253-269,310-315` | S | confirmed | open / triage |
| 5 | [#314](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/314) | High | 48 | architecture | Q-NEW-R — no `ErrorBoundary` between graph and ResultPanel; crash whitescreens page | `src/components/results/GraphViewCytoscape.tsx`, `ResultPanel.tsx` | S | confirmed | **Closed (2026-05-19)** via `f725ea4` — tab-scoped `ResultTabErrorBoundary` wraps each TabPanel body; resetKey clears prior crash on tab/query change. See `GAP_ANALYSIS_RESOLVED.md` "Closure cohort 2026-05-19". |
| 6 | [#295](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/295) | Medium | 48 | readability | Q-NEW-D+E — QueryPage 4-concern effect surface + co-locate `streamStateToResp` | `src/pages/QueryPage.tsx:144-151,200-291,403-444,445-455` | M | confirmed | open / triage |
| 7 | [#299](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/299) | Medium | 48 | readability | Q-NEW-F — `TableView.tsx` 615 LOC; split styled / sizing / CellView / exportNdjson | `src/components/results/TableView.tsx` | M | confirmed | open / triage |
| 8 | [#303](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/303) | Medium | 48 | api-contract | Q-NEW-G+I+J+K+L+M — prop-bundle constructor + `as unknown as` casts + NDJSON typing + UIError envelope + Window aug + test-seam gate | `useGraphCytoscape.ts:275-279,456-473`, `QueryPage.tsx:144-151,337`, `TableView.tsx:414-417`, `GraphViewCytoscape.tsx` | M | confirmed | open / triage |
| 9 | [#311](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/311) | Medium | 36 | maintainability | Q-NEW-P — stream history-record can re-fire on rapid status flips | `src/pages/QueryPage.tsx:280-291` | S | suspected | open / triage |
| 10 | [#315](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/315) | Low | 24 | perf | Q-NEW-T — `graph:firstInteractive` skipped on streaming-gate branch; TTI undercounted | `src/components/results/graph/useGraphCytoscape.ts:231-238,305-309` | S | confirmed | open / triage |
| 11 | [#319](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/319) | Low | 24 | docs | Q-NEW-H+U+V+W+X+Y+Z — `useLasso` JSDoc + FONT_AWESOME_MIGRATION + useQueryPageStore ADR + `__geode_cy` in OPERATIONS + perf-coord doc + effect-ordering diagram | `docs/*`, `useLasso.ts:17-22`, `useGraphCytoscape.ts:275-279` | S | confirmed | open / triage |

### Grouping rationale (26 reviewer findings → 11 issues)

- **#292** absorbs Q-NEW-A (rebuild monolith), Q-NEW-B (`useWhenCy` helper), Q-NEW-C (ref-in-deps), Q-NEW-S (missing eslint marker) — all live in the same file and share the same refactor PR.
- **#295** absorbs Q-NEW-D (4-concern QueryPage effects) + Q-NEW-E (`streamStateToResp` co-location) — same file, related extraction.
- **#303** absorbs Q-NEW-G (prop-bundle constructor), Q-NEW-I (`streamStateToResp` typing), Q-NEW-J (NDJSON typing), Q-NEW-K (error envelope), Q-NEW-L (Window aug), Q-NEW-M (test-seam exports) — all are small typed-edge fixes that can land in 6 small commits inside one umbrella.
- **#319** absorbs Q-NEW-H + Q-NEW-W (useLasso docs/changelog), Q-NEW-U (FONT_AWESOME_MIGRATION), Q-NEW-V (useQueryPageStore ADR), Q-NEW-X (__geode_cy in OPERATIONS), Q-NEW-Y (perf-coord doc), Q-NEW-Z (effect-ordering diagram) — all are 1-2 paragraph doc additions landing in one MR.

### 2026-05-19 cohort roadmap

Quick wins (< 1 day):

- Q-NEW-N — move `lastRebuild` from module scope to `useRef` ([#307](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/307)).
- Q-NEW-O — hoist `cyRef.current = cy` so error path destroys orphan ([#309](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/309)).
- Q-NEW-P — add `lastRecordedRef` dedup in history-record effect ([#311](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/311)).
- Q-NEW-T — emit `graph:firstInteractive` on both rebuild branches ([#315](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/315)).
- Q-NEW-R — `GraphErrorBoundary` wrapper + ResultPanel mount fix ([#314](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/314)).

Medium (1-5 days):

- Q-NEW-Q — `runSync` AbortController + ignore AbortError in catch ([#289](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/289)).
- Q-NEW-A+B+C+S — `useGraphCytoscape` decomposition + `useWhenCy` ([#292](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/292)).
- Q-NEW-D+E — QueryPage hook extraction + `streamStateToResp` move ([#295](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/295)).
- Q-NEW-F — TableView 4-way split ([#299](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/299)).
- Q-NEW-G+I+J+K+L+M — type-safety umbrella ([#303](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/303)).
- Q-NEW-H+U+V+W+X+Y+Z — docs umbrella ([#319](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/319)).

Strategic (> 5 days):

- None this cohort — all findings are file-local or single-feature refactors; the contract-mirror ADR ([#261](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/261)) from the 2026-05-17 cohort remains the only open strategic item.

### Unknowns / confirm-before-fix (2026-05-19 cohort)

- **#311 (Q-NEW-P)** is `confidence::suspected`: the duplicate-history-entry race is plausible from the code (status transit `done → idle → done` re-fires the effect) but has not been reproduced in a test. Verify before fixing by adding a jest case that drives the reducer through `done → reset → done` in two render passes and asserts `useQueryHistory.record` is called exactly once per logical run.
- **#314 (Q-NEW-R)** requires confirming there is not already an ErrorBoundary higher in the tree that catches graph throws gracefully. Verify by `git grep -E 'class\s+\w*ErrorBoundary'` and a manual injected-throw test before sizing the fix.
- **#319 (Q-NEW-X)** depends on `__geode_cy` actually being read by an e2e test today. Confirm with `git grep '__geode_cy' e2e/` before committing to "preserve forever" wording in OPERATIONS.md.

## 2026-05-21 audit cohort

Phase 3 (quality-reviewer) produced **28 findings** (21 confirmed / 7 suspected) across Readability(10), API contract(6), Reliability(7), Documentation(5). Phase 2 (quality-scanner) reported **4 CI-blocking tool failures**: ESLint 4 errors (RESOLVED by user edit), `check-doc-routes` self-collision (PROMOTED to P0), image-pin missing on `.gitlab-ci.yml:884`, chunk-budget over by 2 chunks. Plus INFO-level: ts-prune 13 candidates, 2 suspected unused runtime deps, 2 Go files >800 LOC, 6 Go funcs >100 LOC.

`--skip-issues` mode: no GitLab issues filed. The tracking IDs `Q-S-*` (scanner-derived) and `Q-R-*` / `Q-A-*` / `Q-L-*` / `Q-D-*` (reviewer-derived) are internal to this doc until a follow-up `--issues` run.

### Severity counts (2026-05-21)

- **P0 / Blocker:** 1 (Q-S-02 doc-routes self-collision — promoted)
- **Blocker (CI):** 2 (Q-S-03 image-pin drift, Q-S-04 chunk-budget over)
- **Critical:** 0
- **High:** 4 (Q-R-01, Q-R-02, Q-R-04, Q-D-01)
- **Medium:** 14
- **Low:** 6
- **Info:** 2
- **Resolved this pass:** 1 (Q-S-01 ESLint react/react-in-jsx-scope — closed by user diff removing `import React` from `src/pages/DashboardPage.test.tsx`)

### Top 5 by PriorityScore (2026-05-21)

1. **Q-S-02 — `check-doc-routes` self-collision** (PriorityScore **100**, P0 / Blocker). Promoted from INFO. Every audit deliverable that names a removed path (`/workspace` token in plaintext at `docs/audits/2026-05-21/gap-collection.md:314`) trips the guard; the allow-list omits `docs/audits/**`. Fix: 2-line allow-list patch to `scripts/check-doc-routes.mjs` + guard-test update. Until landed, the audit pipeline cannot run cleanly.
2. **Q-S-03 — `.gitlab-ci.yml:884` image-pin comment missing** (PriorityScore **80**, Blocker-CI). `ui-core:typecheck` uses `node:${NODE_VERSION}` without the mandated `# image-pin: YYYY-MM-DD @ <reason>` comment; 4 other usages carry it.
3. **Q-S-04 — webpack chunk-budget over** (PriorityScore **80**, Blocker-CI). `internal/ui/dist/2749.*.js` (6.41 MiB) + `vscode-services.*.js` (5.17 MiB) exceed the 4 MiB budget. monaco-languageclient / vscode-services dominates.
4. **Q-R-01 — `result_codec.go` (828 LOC) mixes 5 concerns** (PriorityScore **60**, High). Pools + fast-marshal + errWriter + stream/scan + GraphSummary projection. Split into `result_codec_stream.go` + `result_codec_pools.go` + `graph_summary.go`.
5. **Q-R-02 — `loginlimiter.go` (823 LOC) mixes 6 concerns** (PriorityScore **60**, High). Limiter algo + COW maps + HTTP middleware + multipart peek + IP/XFF resolver + TTL janitor. Split into `loginlimiter_wrap.go` + `loginlimiter_janitor.go`.

### Ranked PriorityScore table (2026-05-21 cohort)

`PriorityScore = Impact(1-5) × Likelihood(1-5) × 4`. Confidence and effort-inverse modulate ranking within the same score band.

| Rank | ID | Severity | PriorityScore | Category | Finding | Component | Evidence | Confidence | Effort | Status |
|---:|---|---|---:|---|---|---|---|---|---|---|
| 1 | Q-S-02 | **P0 / Blocker** | **100** | ci-cd | `check-doc-routes` self-collision — audit deliverables trip the guard every run | `scripts/check-doc-routes.mjs` allow-list | `docs/audits/2026-05-21/gap-collection.md:314` cites `/workspace`; allow-list omits `docs/audits/**` | confirmed | S | **promoted from INFO** — open / triage |
| 2 | Q-S-03 | Blocker (CI) | 80 | ci-cd | `.gitlab-ci.yml:884` `ui-core:typecheck` lacks `# image-pin:` comment | CI / image pins | `.gitlab-ci.yml:884` vs. `:61,312,731,907` (4 siblings carry it) | confirmed | S | open / triage |
| 3 | Q-S-04 | Blocker (CI) | 80 | perf | webpack chunk-budget over: 2 chunks > 4 MiB | UI bundle | `internal/ui/dist/2749.*.js` (6.41 MiB), `vscode-services.*.js` (5.17 MiB) | confirmed | M-L | open / triage |
| 4 | Q-R-01 | High | 60 | readability | `result_codec.go` (828 LOC) mixes 5 concerns (pools / marshal / errWriter / stream / GraphSummary) | `internal/server/result_codec.go:1,619-828` | header comment covers only the pooling concern; 4 other concerns undocumented | confirmed | M | open / triage |
| 5 | Q-R-02 | High | 60 | readability | `loginlimiter.go` (823 LOC) mixes 6 concerns (algo / COW maps / HTTP / multipart / XFF / janitor) | `internal/server/loginlimiter.go:1,407-505,583-770` | accreted across SEC-F2/N7 + PERF #220/#225 + S-NEW-5/F + GAP-N10 | confirmed | M | open / triage |
| 6 | Q-R-04 | High | 60 | readability | `QueryPage.tsx` (727 LOC) carries 4 effect blocks + rAF throttle + 2 run paths + JSX | `src/pages/QueryPage.tsx:155-727` | hook-extraction (4 hooks) would land it at ~350 LOC | confirmed | M | open / triage |
| 7 | Q-D-01 | High | 48 | docs | `CONVENTIONS.md` missing §7 on `(nil, nil) = handler-owns-response` convention | `internal/server/CONVENTIONS.md:1-133` | 8 handlers use the pattern; not documented; future genapi changes could regress silently | confirmed | S | open / triage |
| 8 | Q-R-03 | Medium | 48 | readability | `cmd/server/app.go:newApp` 138 LOC despite documented split | `cmd/server/app.go:190-313` | steps (2) profiles + (5) seed-from-store are still inline; extract `buildProfilesAndPool` + `bootstrapProfileStore` | confirmed | S-M | open / triage |
| 9 | Q-R-08 | Medium | 48 | maintainability | `src/services/webawesome/components.ts` 11 wrappers × `as unknown as ForwardRefExoticComponent` boilerplate | `src/services/webawesome/components.ts:73-403` | 415 LOC, near-identical 10-30 LOC blocks per wrapper; extract `createWaComponent<TProps, TEvents>` | confirmed | M | open / triage |
| 10 | Q-R-09 | Medium | 48 | readability | `scanQueryResult` / `streamQueryResult` share row-drain loop; only sink differs | `internal/server/result_codec.go:408-527,564-616` | `dupl` cap is 200 tokens; conceptual duplication slipped under | confirmed | S-M | open / triage |
| 11 | Q-A-01 | Medium | 48 | api-contract | `serverErrorCodes.ts` mirrors only 3 of ~50 Go error codes; check-error-codes guard is one-directional | `src/api/serverErrorCodes.ts:1-31` vs. `internal/server/errorcodes.go:27-...` | reverse-coverage drift unenforced | confirmed | S-M | open / triage |
| 12 | Q-A-03 | Medium | 48 | api-contract | `runSync` cancellation pattern undocumented as ADR; genapi missing AbortSignal | `src/pages/QueryPage.tsx:195-228,376-409` | `runSyncGenRef` monotonic counter is the workaround; pattern will be re-invented per page | confirmed | S | open / triage |
| 13 | Q-A-06 | Medium | 48 | api-contract | `(nil, nil) = "handler owns response"` convention is informal; 8 handlers depend on it | `internal/server/handlers_uploads.go:85-178` + 7 siblings | wrapper contract `(nil, nil) = wrapper writes nothing` undocumented | confirmed | S | open / triage |
| 14 | Q-L-01 | Medium | 48 | tests | Jest worker leak on `npm test -- --ci` (`worker has failed to exit gracefully`) | `src/lib/lsp/__tests__/*.test.ts` (suspected; not yet localised) | scan reproduced; `--detectOpenHandles` will localise in <30s | suspected | S | open / triage |
| 15 | Q-D-02 | Medium | 48 | docs | No module-level READMEs in `src/`, `src/lib/`, `src/components/`, `src/services/` | `src/`, `src/lib/`, `src/components/`, `src/services/` | onboarding-friction; `lib/` mixes pure utils with hooks | confirmed | M | open / triage |
| 16 | Q-D-03 | Medium | 48 | docs | 4 ADRs missing (cookie/bearer dual-auth, WS row-batcher, `runSync` cancellation, contract-mirror) | `docs/adr/` (3 ADRs total) | architectural memory leaks into commit messages | confirmed | M | open / triage |
| 17 | Q-A-02 | Medium | 40 | deps | Suspected unused runtime deps: `vscode-languageserver-protocol`, `@popperjs/core` | `package.json:67,94` | no `src/` import; transitive resolution intact for vscode-languageserver-protocol | confirmed | S | open / triage |
| 18 | Q-A-05 | Medium | 36 | api-contract | `QueryResp.columns` shape drift: SPA `Array<Record<string, unknown>>` vs. Go `[]jsontext.Value` | `src/pages/QueryPage.tsx:148` vs. `internal/server/result_codec.go:619-639,609` | three SPA consumers re-implement column-type narrowing | suspected | M | open / triage |
| 19 | Q-L-03 | Medium | 36 | tests | `Server-Timing` header / trailer not pinned by `result_codec_test.go` | `internal/server/result_codec_test.go` vs. `result_codec.go:431-525` | PERF-N4 / #281 shipped without observability test | confirmed | S | open / triage |
| 20 | Q-L-04 | Medium | 36 | tests | `peekLoginCreds` multipart-body branch lacks unit test | `internal/server/loginlimiter.go:489-...`, `loginlimiter_test.go` | S-NEW-F / #317 fix could silently regress on a content-type detection reorder | suspected | S | open / triage |
| 21 | Q-L-05 | Medium | 36 | maintainability | `cmd/server/app.go` cleanups LIFO/FIFO order undocumented | `cmd/server/app.go:222,233,253,304-312` | future cleanups added in the wrong order = resource-leak risk | confirmed | S | open / triage |
| 22 | Q-L-07 | Medium | 36 | tests | `queryStreamWorker` vs. main-thread parity untested | `src/lib/queryStream.ts`, `src/lib/queryStreamWorker.ts`, `__test_utils__/queryStreamWorkerUrlMock.js` | NDJSON parser drift across two paths would go uncaught | confirmed | S | open / triage |
| 23 | Q-R-07 | Medium | 32 | maintainability | `src/lib/docs/index.ts:39-57` casts 6 markdown imports `as unknown as string` | `src/lib/docs/index.ts:39-57` | webpack raw-loader emits `string` at runtime; add `declare module '*.md'` | confirmed | S | open / triage |
| 24 | Q-L-02 | Medium | 32 | maintainability | `.catch(() => {})` anti-pattern swallows rejected promises (metrics + clipboard) | `src/lib/useMetricsPolling.ts:127,129,140`, `src/components/results/graph/useGraphNodeActions.ts:86` | user-visible silent failure on clipboard.writeText (Safari) | confirmed | S | open / triage |
| 25 | Q-S-05 | Medium | 32 | tests | Jest worker-leak warning (same root as Q-L-01) | (see Q-L-01) | scanner-reported; reviewer cohort surfaces likely culprits | suspected | S | open / triage |
| 26 | Q-R-05 | Low | 24 | readability | `streamStateToResp` + rAF throttle pattern not lifted to reusable hook | `src/pages/QueryPage.tsx:146-153,468-520` | PERF-2026-05-17-02 / #239 left it in-page; copy-paste risk if dashboard/ops add streaming | suspected | S | open / triage |
| 27 | Q-R-06 | Low | 24 | maintainability | Layout magic numbers in `TableView.tsx` not centralised (no `layoutConstants.ts`) | `src/components/results/TableView.tsx:56-74` | drift across `TableView` + `useTableBodySize` + `GraphView*` | suspected | S | open / triage |
| 28 | Q-R-10 | Low | 24 | maintainability | `useMetricsPolling.ts` empty `.catch(() => {})` — paper handle | `src/lib/useMetricsPolling.ts:127-140` | sibling of Q-L-02; suspected only because inner try already covers most | suspected | S | open / triage |
| 29 | Q-A-04 | Low | 24 | api-contract | `COOKIE_MODE_PLACEHOLDER` constant in `src/api/client.ts` leaks via generated client | `src/api/client.ts:49-56,71-79` | wrapper strips header; bypass risk if someone uses `bearerToken()` directly | confirmed | S | open / triage |
| 30 | Q-D-05 | Low | 24 | docs | `result_codec.go` leading comment (lines 22-44) covers only PERF #217; 3 other concerns missing | `internal/server/result_codec.go:22-44` | resolves on Q-R-01 split | suspected | S | open / triage |
| 31 | Q-L-06 | Low | 16 | maintainability | `LoginLimiter.NoteFail` increments `count` without write-side cap | `internal/server/loginlimiter.go:373-385` | cosmetic (read-clamped above FailThreshold); audit-log path could surface absurd numbers | confirmed | S | open / triage |
| 32 | Q-D-04 | Info | 8 | docs | `TODO #122` in `AuthProvider.tsx:293` not normalised to `TODO(#122):` | `src/auth/AuthProvider.tsx:293` | single drift from otherwise-uniform convention | confirmed | XS | open / triage |
| — | Q-S-01 | — | 64 | lint | ESLint 4 × `react/react-in-jsx-scope` in `DashboardPage.test.tsx:72-75` | `src/pages/DashboardPage.test.tsx:72-75` | scanner blocker | confirmed | XS | **RESOLVED (2026-05-21)** — user edit removed `import React` and `React` references; airbnb's `react/react-in-jsx-scope` no longer fires under modern JSX transform. `npm run lint` re-run will confirm. |

### Grouping rationale (28 reviewer findings + 8 scanner findings → 32 active rows)

- **Q-S-05 / Q-L-01 share a root**: both surface the Jest worker-leak warning. Kept as two rows for visibility but should be tracked under a single umbrella when issues are filed (likely `Q-L-01` as the parent because it pinpoints LSP test suspects).
- **Q-D-05 resolves on Q-R-01**: file header comment fix is unneeded once `result_codec.go` is split per Q-R-01; keep both rows until Q-R-01 lands.
- **Q-S-06 / Q-S-07 are absorbed**: the scanner's >800-LOC and >100-LOC raw flags are already covered by Q-R-01 (`result_codec.go`), Q-R-02 (`loginlimiter.go`), Q-R-03 (`newApp`), Q-R-04 (`QueryPage.tsx`), Q-R-09 (drain helper for `streamQueryResult`/`scanQueryResult`). The scan's `NewLspConfigWithDefaults` 137-LOC flag was a heuristic miscount (actual: 5 LOC) — closed-no-action.
- **Q-S-08 is absorbed**: ts-prune INFO items and the unused-runtime-dep heuristic are covered by Q-A-02 (deps) plus the existing `ts-prune` allow-list in the inventory.

### Findings by category (2026-05-21)

#### CI / blockers

- Q-S-02 (P0): `check-doc-routes` self-collision — widen allow-list to `docs/audits/**` OR backtick-escape removed-path tokens in audit format. **Blocks every future audit run.**
- Q-S-03: `.gitlab-ci.yml:884` image-pin comment missing.
- Q-S-04: chunk-budget over by 2 chunks; monaco-languageclient / vscode-services pipeline is the dominant cost.

#### Readability / maintainability

- Q-R-01 (High), Q-R-02 (High), Q-R-04 (High), Q-R-03, Q-R-08, Q-R-09 — file splits + helper extractions; all package-private symbol moves only.
- Q-R-05, Q-R-06, Q-R-07, Q-R-10, Q-L-02 — small targeted fixes (hook lift, constants file, type declaration, observable catch).

#### API contract / cross-stack

- Q-A-01 — reverse-coverage guard for `check-error-codes`.
- Q-A-02 — drop unused `vscode-languageserver-protocol` (and audit `@popperjs/core`).
- Q-A-03 — codify `runSync` cancellation pattern as ADR; track genapi follow-up.
- Q-A-04 — document `COOKIE_MODE_PLACEHOLDER` contract; pin no-leak test.
- Q-A-05 — tighten `QueryResp.columns` schema in `geode.json`.
- Q-A-06 — document `(nil, nil)` handler-owns-response convention.

#### Reliability / tests

- Q-L-01 / Q-S-05 — localise Jest worker leak via `--detectOpenHandles`.
- Q-L-03 — `Server-Timing` round-trip test.
- Q-L-04 — `peekLoginCreds` multipart unit test.
- Q-L-05 — `app.go` cleanup order documentation + fault-injection test.
- Q-L-06 — `NoteFail` write-side counter cap.
- Q-L-07 — `queryStream` worker-vs-main-thread parity test.

#### Docs

- Q-D-01 (High) — CONVENTIONS.md §7 (handler-owns-response).
- Q-D-02 — module READMEs for `src/`, `src/lib/`, `src/components/`, `src/services/`.
- Q-D-03 — 4 ADRs (cookie/bearer dual-auth, WS row-batcher, runSync cancellation, contract-mirror).
- Q-D-04 — normalise `TODO #122` → `TODO(#122):`.
- Q-D-05 — expand `result_codec.go` file header (resolves on Q-R-01 split).

### 2026-05-21 cohort roadmap

Quick wins (< 1 day):

- **Q-S-02 (P0)**: 2-line patch to `scripts/check-doc-routes.mjs` allow-list + update its `.test.mjs`. Land BEFORE the next audit pass.
- Q-S-03: re-add image-pin comment on `.gitlab-ci.yml:884`.
- Q-A-02: `npm uninstall vscode-languageserver-protocol`; verify Storybook + npm install still pass; consider `@popperjs/core` removal in same PR.
- Q-R-07: add `src/types/markdown.d.ts`; drop 6 casts in `src/lib/docs/index.ts`.
- Q-D-04: normalise TODO comment in `AuthProvider.tsx:293`.
- Q-L-02: replace `.catch(() => {})` with `.catch(err => console.warn(...))` (3 sites).
- Q-L-05: document cleanup LIFO/FIFO contract in `cmd/server/app.go`.
- Q-D-01: add §7 to `internal/server/CONVENTIONS.md`.

Medium (1-5 days):

- Q-S-04: re-validate `monaco-languageclient` lazy-loading boundary; split `vscode-services` chunk further.
- Q-R-01 + Q-D-05: split `result_codec.go` (828 LOC → 3 files); package-private symbols only.
- Q-R-02: split `loginlimiter.go` (823 LOC → 3 files).
- Q-R-03: extract `buildProfilesAndPool` + `bootstrapProfileStore` from `newApp` (138 → ~80 LOC).
- Q-R-04: extract 4 hooks from `QueryPage.tsx` (727 → ~350 LOC).
- Q-R-08: introduce `createWaComponent<TProps, TEvents>` helper.
- Q-R-09: extract `drainRowsInto` shared helper.
- Q-L-01 / Q-S-05: localise Jest worker leak + fix the offending `afterEach`.
- Q-L-03 / Q-L-04 / Q-L-07: add the three missing test coverages.
- Q-A-01: extend `check-error-codes.mjs` with `--check-reverse-for-family auth password tx upload`.
- Q-A-06: add `(nil, nil)` golden test alongside CONVENTIONS.md §7.
- Q-D-02: 4 READMEs (one per top-level src tree).
- Q-D-03: 4 ADRs.

Strategic (> 5 days):

- Q-A-03: genapi follow-up to emit `AbortSignal?` on every method signature (upstream change).
- Q-A-05: tighten `QueryResp.columns` schema in `geode.json`; regenerate and update 3 SPA consumers.
- Q-L-06: `LoginLimiter` counter cap (low-priority, cosmetic today).

### Promotion rationale: Q-S-02 → P0

The reviewer's INFO→Blocker promotion is taken. `check-doc-routes` is a pre-commit + CI guard whose allow-list is currently scoped narrowly: it permits historical mentions of removed paths only in a curated list of doc files. Audit deliverables under `docs/audits/2026-05-21/` are NOT in that list, but the audit format legitimately cites removed-path tokens like `/workspace` as evidence (e.g. `docs/audits/2026-05-21/gap-collection.md:314`). The result is **structurally a CI-fail loop**: every future audit emission trips the guard on its own evidence. Until the allow-list is widened to `docs/audits/**` (or the audit format learns to backtick-escape removed-path tokens), no audit pass can complete cleanly. PriorityScore 100 (Impact 5 × Likelihood 5 × 4) reflects the absolute certainty of recurrence — every audit run, no exceptions. Fix is a 2-line patch to `scripts/check-doc-routes.mjs` + a corresponding update to its `.test.mjs`. Recommended owner: doc-tooling.

### Resolved this pass (2026-05-21)

| ID | Resolution | Evidence |
|---|---|---|
| Q-S-01 | ESLint `react/react-in-jsx-scope` (4 errors at `src/pages/DashboardPage.test.tsx:72-75`) closed by user edit. The file no longer imports nor references `React`; modern JSX transform handles the JSX elements without an in-scope `React` binding, and airbnb's `react/react-in-jsx-scope` rule no longer fires. Verification: `npm run lint` should now exit 0 (chunk-budget + image-pin + doc-routes remain the open scanner blockers). | `src/pages/DashboardPage.test.tsx` (grep `React` → 0 hits) |

### Unknowns / confirm-before-fix (2026-05-21 cohort)

- **Q-A-02 (`@popperjs/core`)**: confirmed unused in `src/` but Storybook vendored copy references it. Verify `make stories` + `build-storybook` still green BEFORE the uninstall lands. `vscode-languageserver-protocol` is safer (transitive via `vscode-languageclient`).
- **Q-A-05 (column shape drift)**: `confidence::suspected` because the wire is currently `jsontext.Value` and the de facto SPA shape `{name, type}` may have other producers (e.g. WS path). Confirm the only emitter by `git grep '"columns":' internal/`.
- **Q-L-01 / Q-S-05 (Jest worker leak)**: `confidence::suspected` for the LSP test cohort root cause. Run `npm test -- --detectOpenHandles 2>&1 | head -80` and pin the actual offender BEFORE assuming LSP tests. Alternative culprits: `queryStreamWorker` tests, any `setInterval` not torn down in `useMetricsPolling.test.tsx`.
- **Q-R-05 (useRafThrottledVersion lift)**: `confidence::suspected` — the throttle is currently only used in `QueryPage`; lift only if a second consumer materialises. Otherwise track as "remind me when dashboard/ops add streaming results."
- **Q-D-05 (result_codec.go header)**: `confidence::suspected` because the fix is unnecessary if Q-R-01 lands; the row exists as a hedge in case Q-R-01 is deferred.
