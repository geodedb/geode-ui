# Quality Gap Analysis

Last updated: 2026-05-17 (audit Phase 4 — quality)

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
| 5 | Medium | 36 | readability | `extractElements` is a 181-LOC multi-concern function | UI graph | `src/lib/graphResult.ts:143-324` (181 LOC) | [#247](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/247) | Split into 4 pure helpers under `src/lib/graphResult/`; orchestrator becomes ~20 LOC | Frontend graph | 1 sprint | confirmed, triage |
| 6 | High | 24 | maintainability | passwordGenerator fallback returns unvalidated password when retry budget exhausted | Frontend security | `src/lib/passwordGenerator.ts:148-156` | [#244](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/244) | Re-validate fallback; throw on budget exhaustion | Frontend security | 7d | **Closed (2026-05-17)** via `cd5be84` — fallback now re-runs validatePassword and throws on exhaustion. Pinned by jest.isolateModules test mocking validatePassword to always reject. |
| 7 | Medium | 24 | maintainability | `projectColumns` mutates `Plan` via type cast -- replace with immutable copy | UI table | `src/components/results/projectColumns.ts:277-278` | [#248](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/248) | Replace `{...p, keys:p.keys.slice(0,perPlan)}` reassignment | Frontend table | 7d | **Closed (2026-05-17)** via `455f6b1` — column-budget trim now writes a fresh Plan (`{ ...p, keys: p.keys.slice(0, perPlan) }`) into plan[slot]; no type-cast mutation. Pinned by source-scan test + behavioural test. |
| 8 | Medium | 24 | architecture | AdminPage 8-tab flat nav lacks overflow strategy -- pick IA pattern before tab 9 | Frontend / admin | `src/pages/AdminPage.tsx:42-72` | [#252](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/252) | Pick grouped flat nav / two-level nav / sidebar; pair with `#214` matcher fix | Frontend / admin | 1-2 days | confirmed, triage |
| 9 | Medium | 32 | docs | Workspace doc residue: README + PERF + QUALITY cite removed `/workspace` paths | Tracking docs | `README.md:43`; `docs/PERF_GAP_ANALYSIS.md:60,65`; `docs/QUALITY_GAP_ANALYSIS.md` (closure note refs deleted `WorkspacePage.test.tsx`) | [#253](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/253) | README route list; move PERF row; strip orphan cites; CI doc-link check | Docs / Tracking | 30 min | confirmed, triage |
| 10 | Low | 24 | docs | CHANGELOG.md is stale -- 50 issue closures since v0.1.0 not recorded | Tracking docs | `CHANGELOG.md:1-40` only v0.1.0 entry | [#258](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/258) | Add Unreleased section; backfill 2026-05-12/13/16 batches; pre-commit gate | Tracking / docs | 1-2h backfill | confirmed, triage |
| 11 | Low | 16 | deps | `cytoscape-popper` is a dead dependency | Frontend / deps | `package.json:58`; `src/types/cytoscape-popper.d.ts`; no source imports | [#255](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/255) | `npm uninstall cytoscape-popper`; delete typings shim | Frontend / deps | 15 min | **Closed (2026-05-17)** via `7d271a2` — uninstalled cytoscape-popper@2.0.0 and removed `src/types/cytoscape-popper.d.ts`. Verified no transitive consumer. `npm test` (865 tests) + `npm run build` stay green. |
| 12 | Low | 16 | cleanup | `password_policy.go` uses dead `unicode` import-keeper | Server | `internal/server/password_policy.go:13,146` | [#245](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/245) | Remove `unicode` import; replace `_ = unicode.IsDigit` with a comment | Server | 15 min | **Closed (2026-05-17)** via `f6c0047` — dropped the `unicode` import and the dead `_ = unicode.IsDigit` keeper; expanded function-doc to explain the ASCII-only choice. |
| 13 | Low | 8 | ci-cd | `bench-baseline.txt` is 5 days stale -- recent gap-close benches not reflected | CI / perf | `bench-baseline.txt` mtime 2026-05-12 | [#260](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/260) | Regenerate baseline; document cadence; gate closure pipeline | CI / perf | 15 min | **Closed (2026-05-17)** — regenerated after the round-3 closure cohort via `make bench-baseline`. Cadence: regenerate after every 10-issue closure cohort (committed alongside the cohort tracking-update). The bench gate is `allow_failure: true` and run-to-run noise dominates on shared runners, so the baseline is informational-leaning rather than a hard regression line. |
| 14 | Low | 8 | tests | passwordGenerator tests contain probabilistic assertions on real-RNG output | Frontend tests | `src/lib/passwordGenerator.test.ts` | [#262](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/262) | Export `RandomSource`-injected seam; deterministic test cases | Frontend tests | 1-2h | suspected, triage |
| 15 | Low | 8 | perf | NDJSON export concatenates whole body into one string before Blob | UI table | `src/components/results/TableView.tsx` exportRespAsNdjson | [#263](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/263) | Blob constructor with iterable of parts | Frontend table | 1h | suspected, triage |
| 16 | Medium | 36 | readability | GraphViewCytoscape.tsx residual orchestrator size (685 LOC after 2026-05-16 split) | UI graph | `src/components/results/GraphViewCytoscape.tsx` 685 LOC | [#164](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/164) (existing) | Lifecycle effect hoist + cxtmenu bootstrap helper + tooltip portal sibling | Frontend graph | 1 sprint | re-commented 2026-05-17 |

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

### Architecture

- [#252](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/252): AdminPage IA decision before tab 9. Verify with viewport-resize Jest case.
- [#261](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/261): Cross-stack contract-mirror discipline ADR.

### Cleanup / deps

- [#245](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/245): Dead `unicode` import-keeper in `password_policy.go`.
- [#255](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/255): Dead `cytoscape-popper` dependency.

### Tests

- [#262](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/262): passwordGenerator probabilistic test assertions.

### Performance (residual quality-class)

- [#263](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/263): NDJSON export Blob allocation.

### Docs / tracking

- [#253](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/253): Workspace doc residue across README + PERF + QUALITY tables.
- [#258](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/258): CHANGELOG.md stale by ~50 closures since v0.1.0.

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
