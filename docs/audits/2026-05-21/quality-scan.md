# Quality Scan — geode-ui

- **Date:** 2026-05-21
- **Branch:** `main` (clean tree at `1199648`)
- **Repo root:** `/data/home/benji/src/gl/gitlab.com/devnw/codepros/geode/geode-ui`
- **Scope:** Automated quality checks only. Lint, format, typecheck, vet, tests, coverage gates, custom guards, dead-code, duplication / complexity surrogates. No source modifications.
- **Inputs:** `docs/audits/2026-05-21/quality-inventory.md`, `.golangci.yml`, `jest.config.cjs`, `Makefile`, `package.json` scripts, repo `scripts/check-*`.
- **Toolchain pinned:** Go 1.26.3 (`GOEXPERIMENT=jsonv2`), Node 22.14.0, golangci-lint v2.12.2, ESLint 8, Prettier 3, Jest 29, ts-prune 0.10.x (npx).

## Per-tool run log

| Tool | Command | Exit | Status | Findings |
|---|---|---:|---|---:|
| ESLint (TS) | `npm run lint` | 1 | **FAIL** | 4 errors |
| Prettier | `npm run prettier:check` | 0 | PASS | 0 |
| TypeScript typecheck (root + e2e + scripts) | `npm run test:ts` | 0 | PASS | 0 |
| Electron tsc | (`npm run electron:tsc` — covered by `test:ts` siblings; not re-run, no drift expected) | n/a | SKIPPED | n/a |
| `go vet` | `go vet ./cmd/... ./gen/... ./internal/...` | 0 | PASS | 0 |
| `golangci-lint v2` | `make go-lint` | 0 | PASS | 0 |
| `gofmt -s` (workspace) | `scripts/check-gofmt.sh` | 0 | PASS | 0 (10 generated files under `gen/` need re-format but are excluded by policy) |
| `goimports` | `goimports -l ./cmd ./internal ./gen` | 0 | PASS for owned trees | 10 generated files (`gen/...`) — see Generated-code note |
| `go mod tidy` drift | `scripts/check-go-mod-tidy.sh` | 0 | PASS | 0 |
| Go toolchain pin | `scripts/check-go-toolchain.sh` | 0 | PASS | 0 |
| `generate-if-stale` | `scripts/check-generate.sh` | 0 | PASS | 0 (sentinel matches `geode.json`) |
| Go tests (no race, fast pass) | `go test -count=1 -timeout=180s ./cmd/... ./gen/... ./internal/...` | 0 | PASS | 1109+ Go test functions; all `ok` |
| Go coverage ratchet | `make go-cover` | 0 | PASS | total **80.0 %** ≥ floor 79 % |
| Jest (unit) | `npm test -- --ci` | 0 | PASS | 164 suites / **1109 tests** pass; 1 worker-leak warning |
| Jest coverage | `npm test -- --coverage --ci` | 0 | PASS | All files **81.7 / 69.25 / 77.23 / 83.93** (stmt/br/fn/line) ≥ floor 79 / 66 / 74 / 81 |
| Hardcoded styles | `npm run lint:hardcoded-styles` | 0 | PASS | 0 |
| WCAG contrast | `npm run lint:contrast` | 0 | PASS | 0 (14 pairs ≥ AA) |
| i18n translations | `npm run verify:translations` | 0 | PASS | 0 missing, 0 orphan |
| Hardcoded user strings | `npm run detect:hardcoded-strings -- --strict` | 0 | PASS | 0 |
| HTML renderers | `npm run check:html-renderers` | 0 | PASS | 0 |
| Doc routes | `npm run check:doc-routes` | 1 | **FAIL** | 1 (self-referential — audit deliverable) |
| Changelog | `npm run check:changelog` | 0 | PASS | 0 |
| Security MD | `npm run check:security-md` | 0 | PASS | 0 |
| Compose secrets | `npm run check:compose-secrets` | 0 | PASS | 0 |
| Mac glyphs | `npm run check:no-mac-glyphs` | 0 | PASS | 0 |
| Chunk budget (webpack output) | `npm run check:chunk-budget` | 1 | **FAIL** | 2 chunks over 4 MiB budget |
| CI pins | `scripts/check-ci-pins.sh` | 0 | PASS | 0 |
| Image pins | `scripts/check-image-pins.sh` | 1 | **FAIL** | 1 image without pin comment |
| Error-code seam | `npm run check:error-codes` | 0 | PASS | 0 |
| `ts-prune` (unused exports) | `npx ts-prune` | 0 | INFO | 13 candidates in owned src (≈80 in `gen/` excluded by policy) |
| Dep heuristic (`@/`-aware grep) | `node /tmp/qs/dep-check.mjs` | 0 | INFO | 1 suspected unused runtime dep (`vscode-languageserver-protocol`); rest are loaded by side-effect/lazy chunks |
| `npx knip` | unavailable (would need install) | n/a | SKIPPED | n/a |
| `npx jscpd` | unavailable (would need install) | n/a | SKIPPED | n/a |
| `npx madge` (cycles) | unavailable (would need install) | n/a | SKIPPED | n/a |
| `npx depcheck` | unavailable (would need install) | n/a | SKIPPED | n/a |

Generated-code note: `gofmt -s -l .` (root scan) reports 10 files under `gen/`. The pre-commit gate `scripts/check-gofmt.sh` deliberately excludes `^gen/` and `^node_modules/`, so owned Go code is clean. The 10 stale files are inside genapi output and only get rewritten when `geode.json` changes; this is consistent with the inventory.

## Lint / Typecheck / Format

| Finding | File:Line | Tool | Severity | Confidence |
|---|---|---|---|---|
| 4 × `react/react-in-jsx-scope`: JSX (`<MemoryRouter>`, `<LocalizationProvider>`, `<ThemeProvider>`, `<DashboardPage />`) used without an explicit `React` import. Blocks `npm run lint` (max-warnings=0). | `src/pages/DashboardPage.test.tsx:72,73,74,75` | ESLint | error (blocks CI `eslint` job) | confidence::confirmed |
| Image `node:${NODE_VERSION}` for `ui-core:typecheck` lacks the mandated `# image-pin: YYYY-MM-DD @ <reason>` comment immediately above the `image:` line. Other `node:${NODE_VERSION}` usages (lines 61, 312, 731, 907) carry the comment; this one (line 884) does not. Blocks `image-pins-check`. | `.gitlab-ci.yml:884` | `scripts/check-image-pins.sh` | error (blocks CI `image-pins-check`) | confidence::confirmed |
| `check-doc-routes` fails because today's audit-inventory cites the historical `/workspace` token in plaintext. The check's allow-list does not include `docs/audits/**`, so any audit-trail that names the removed path round-trips into a CI failure. | `docs/audits/2026-05-21/gap-collection.md:314` (via `scripts/check-doc-routes.mjs` allow-list `.golangci.yml`-style regex) | `npm run check:doc-routes` | error (will block `pre-commit` / CI guard when run) | confidence::confirmed |

## Duplication & Complexity

ESLint, golangci-lint (including `dupl` / `gocognit` / `gocyclo` / `nestif` / `revive`) and `go vet` all returned zero issues against the configured thresholds (`.golangci.yml`: gocognit≤50, gocyclo≤30, nestif≤6, dupl≥200 tokens, test files exempted from dupl/gocyclo/gocognit/nestif/revive). The findings below are surrogate metrics from raw LOC + function-length passes; none is a confirmed quality breach until cross-checked with the relaxed-cap rationales in `.golangci.yml`.

| Finding | File:Line | Metric | Confidence |
|---|---|---|---|
| Largest non-test Go file (>800 LOC) | `internal/server/result_codec.go:1` | 828 LOC | confidence::confirmed |
| Second non-test Go file >800 LOC | `internal/server/loginlimiter.go:1` | 823 LOC | confidence::confirmed |
| Largest non-test TSX (>700 LOC) | `src/pages/QueryPage.tsx:1` | 727 LOC | confidence::confirmed |
| Other source files in the 500–800 LOC band (10 total) | `internal/server/handlers_users.go` (719), `src/services/i18n/locales/en.ts` (664), `src/components/results/TableView.tsx` (615), `internal/server/ws_query.go` (534), `src/components/results/GraphViewCytoscape.tsx` (518), `src/components/results/graph/useGraphCytoscape.ts` (503) | LOC (no linter cap triggered) | confidence::confirmed |
| Longest Go function exceeds 50 LOC (planner heuristic) — `newApp` | `cmd/server/app.go:190` | 138 LOC | confidence::confirmed |
| `NewLspConfigWithDefaults` | `internal/server/server.go:59` | 137 LOC | confidence::confirmed |
| `streamQueryResult` | `internal/server/result_codec.go:408` | 124 LOC | confidence::confirmed |
| `(*WSServer).Query` | `internal/server/ws_query.go:213` | 117 LOC | confidence::confirmed |
| `(*GraphServer).PatchUsername` (explicitly cited in `.golangci.yml` rationale as one of the legitimately-complex state machines justifying the gocognit cap of 50) | `internal/server/handlers_users.go:257` | 104 LOC | confidence::suspected — accepted by golangci-lint; flagged only as a planner-heuristic >50-LOC function |
| `(*GraphServer).stageUpload` | `internal/server/handlers_uploads.go:85` | 101 LOC | confidence::confirmed |
| 24+ space indentation occurrences (≈6+ levels, JSX-attribute heavy) — concentrated in `src/components/ops/BackupPage.tsx:159-178`, `src/components/results/graph/GraphSidebarContents.tsx:192-213`, `src/pages/DocsPage.tsx:136-138` | 64 occurrences | indentation depth proxy (JSX attribute formatting, not control-flow nesting) | confidence::suspected — proxy only |
| No `jscpd` / `madge` / `knip` available; copy-paste and circular-dep detection deferred (would require installing those CLIs locally; out of scope under no-tool-install constraint) | (repo-wide) | tooling gap | confidence::confirmed |

## Dead Code

| Finding | File:Line | Type | Confidence |
|---|---|---|---|
| `RbacAction` exported and unused outside its module | `src/lib/rbacVocab.ts:49` | unused exported type | confidence::suspected — ts-prune is heuristic; may be referenced via type re-exports |
| `RbacResource` exported and unused outside its module | `src/lib/rbacVocab.ts:50` | unused exported type | confidence::suspected |
| `ThemeVariant` exported and unused outside the `.d.ts` module | `src/types/electron.d.ts:16` | unused exported type | confidence::suspected |
| 8 re-exports in the i18n barrel are unused at the import site (`i18n`, `I18N_STORAGE_KEY`, `useLocalization`, `useAppTranslation`, `SUPPORTED_LANGUAGES`, `LanguageDescriptor`, `SupportedLanguage`, `Translations`) | `src/services/i18n/index.ts:1-11` | unused barrel re-exports | confidence::suspected — barrel may be the documented public surface |
| `__buildForTest`, `__writeTierForTest` exported solely for tests | `src/components/results/graph/useGraphCytoscape.ts:470,480` | test-only export hooks (intentional pattern) | confidence::confirmed — naming convention indicates by-design |
| `vscode-languageserver-protocol` is declared in `package.json:94` but not imported anywhere in `src/`, `e2e/`, `electron/`, `packages/`, `scripts/` (only matched via Jest mocks of `vscode-ws-jsonrpc`). Likely a transitive peer of `monaco-languageclient`, but the direct declaration is unused. | `package.json:94` | suspected unused runtime dependency | confidence::suspected — may be needed for monaco-languageclient peer resolution |
| `@popperjs/core` declared in `package.json:67` but only referenced inside `packages/ui-core/storybook-static/sb-manager/globals-runtime.js` (vendored). Bootstrap-JS path is *not* imported (`src/services/bootstrap/Dropdown.tsx` re-implements the dropdown to avoid Popper). | `package.json:67` | suspected unused runtime dependency | confidence::suspected — kept for future re-introduction of Bootstrap JS / Webawesome dropdown? |
| Only 1 in-source `TODO`/`FIXME`/`XXX`/`HACK` comment outside tests | `src/auth/AuthProvider.tsx:293` (`TODO #122: surface the Settings UI`) | tracked TODO | confidence::confirmed |
| Go: `unused` linter (part of `staticcheck`) reports 0 issues across `./cmd/... ./gen/... ./internal/...` | (repo-wide) | no Go dead code detected | confidence::confirmed |
| `knip` / `depcheck` would give a confirmed dead-code list — both unavailable in this environment | (n/a) | tooling gap | confidence::confirmed |

## Performance Hotspots (static surrogate)

These are heuristic flags from grep + LOC analysis, not profiled. The repo has a separate `perf-context.md` + `bench-gate.sh` + Playwright graph-bench harness that is the authoritative perf surface.

| Finding | File:Line | Category | Impact | Confidence |
|---|---|---|---|---|
| 2 webpack chunks exceed the 4 MiB chunk budget — `2749.2ace578d71c54074e829.js` (6.41 MiB) and `vscode-services.51806740644f0a8803a6.js` (5.17 MiB). 3 more chunks are 700+ KiB. | `internal/ui/dist/*.js` (output of `npm run build`) | bundle size / first-load latency | high (blocks CI `chunk-budget` job and is user-visible on cold load) | confidence::confirmed |
| 116 `for ... range` / `for i := 0` loops across `cmd/` + `internal/` Go code; no static N+1 SQL pattern detected by grep against ORM / `db.Query`-in-loop signatures. `internal/profilestore/sqlite_crud.go:288 (*sqliteStore).Patch` is 98 LOC and a known multi-statement hotspot but uses an explicit `tx` — no N+1 violation visible. | (repo-wide) | DB loops | low (manual inspection negative; reviewers should still spot-check) | confidence::suspected |
| 9 raw `go func` / `go <ident>` goroutine launches in non-test Go code. Volume is low; no static leak signal (each cited site is matched by a tracking `WaitGroup` or `Pool.Close` in the surrounding file). | `internal/conn/pool.go`, `internal/server/*` (heuristic count) | concurrency | low | confidence::suspected |
| 21 `console.{log,warn,error,debug}` call-sites in `src/` (excluding tests). All inspected sites are intentional: ErrorBoundary surfaces, `[lsp]` debug behind a comment, `[geode-ui] bootstrap failed:` (FatalBootstrapError contract), perfMarks gated on `NODE_ENV !== 'production'`, and `src/pages/dev/GraphBenchPage.tsx:126,138` which the Playwright bench parses. | (see above) | log noise | low | confidence::confirmed |
| `monaco-languageclient` + `vscode-services` chunk dominates the bundle budget overrun. Lazy-loading boundary should be re-validated alongside `2749.*.js`. | `src/components/editor/GqlEditor.tsx:15` (`import '../../monaco-bootstrap'`) → `monaco-languageclient` pipeline | code-splitting boundary | high (paired with chunk-budget failure above) | confidence::suspected |

## Build / CI Hygiene

| Finding | File:Line | Category | Impact | Confidence |
|---|---|---|---|---|
| `ui-core:typecheck` job missing the standard image-pin comment, breaking parity with the 4 other `node:${NODE_VERSION}` images in `.gitlab-ci.yml`. Drift detected by `scripts/check-image-pins.sh`. | `.gitlab-ci.yml:884` | CI policy drift | medium (CI `image-pins-check` job fails) | confidence::confirmed |
| Webpack chunk-budget guard fails on the current `internal/ui/dist/` artefact set. Either chunk-budget must be raised after a deliberate measurement (see `scripts/check-chunk-budget.mjs` failure text) or `monaco-languageclient` / vscode-services has to be split further. | `internal/ui/dist/2749.*.js`, `vscode-services.*.js`, `6246.*.js` | bundle budget | high (`chunk-budget` CI job fails) | confidence::confirmed |
| Audit deliverables under `docs/audits/2026-05-21/` are not in the `check-doc-routes` allow-list. As soon as a planner / audit trail cites a removed path string, the guard re-fires on its own evidence. Either `docs/audits/**` should join the allow-list or the audit format must paraphrase removed paths. | `scripts/check-doc-routes.mjs` allow-list vs. `docs/audits/2026-05-21/gap-collection.md:314` | guard self-collision | medium (any doc-routes pre-commit run on audit artefacts will fail) | confidence::confirmed |
| Generated Go files in `gen/` are not run through `gofmt -s` post-emit. By policy they are excluded from `scripts/check-gofmt.sh`, so 10 files perpetually fail a root-level `gofmt -l .` but pass CI. Worth a one-line `gofmt -s -w gen/` step in the genapi template if/when generated artefacts ever ship outside the guard. | `gen/api/handlers_gen.go`, `gen/api/generated_behavior_test.go`, `gen/client/rest.gen.go`, `gen/client/ws.gen.go`, `gen/cmd/server/main.go`, `gen/mcp/tools.gen.go`, `gen/pkg/wsx/ws.go`, `gen/types/types.gen.go`, `gen/ws/generated_behavior_test.go`, `gen/ws/ws_handlers.gen.go` | generator hygiene | low | confidence::confirmed |
| 1 Jest worker leaked at the end of `npm test -- --ci` (`A worker process has failed to exit gracefully and has been force exited`). Tests still pass — exit code is 0 — but the warning indicates a test that does not `.unref()` an active timer or fails to tear down a fake worker. Reproduced on both `--ci` and `--ci --coverage` runs. Run `npm test -- --detectOpenHandles` to localise. | (likely WS/LSP or queryStreamWorker test — not pinpointed) | test hygiene | low (does not gate CI but masks real leaks long-term) | confidence::suspected |
| `ui-core` declares `engines.node >=20` while the root requires `>=22.14.0` (called out in the inventory). Not blocked by any of today's checks, surfaced here for completeness. | `packages/ui-core/package.json` vs. `package.json:62` | engine drift | low | confidence::confirmed |

## Coverage gates (snapshot)

| Suite | Stmt | Branch | Func | Line | Floor (stmt/br/fn/line) | Margin |
|---|---:|---:|---:|---:|---|---|
| Jest (All files) | 81.70 | 69.25 | 77.23 | 83.93 | 79 / 66 / 74 / 81 | +2.70 / +3.25 / +3.23 / +2.93 |
| Go coverage ratchet (`make go-cover`) | 80.0 % total | — | — | — | 79 % | +1.0 |

Both ratchets remain above their committed floors. Jest branch coverage (69.25 %) is the closest to its floor (66 %); a deliberate branch pass would give that line the most headroom for future ratchet bumps. The 5 lowest-covered owned files in the Jest report are `src/pages/LoginPage.tsx` (60.49 stmt), `src/services/bootstrap/Dropdown.tsx` (65.71 stmt), `src/services/i18n/LocalizationProvider.tsx` (50 stmt), `src/lib/lsp/client.ts` (75 stmt), and `src/pages/QueryPage.tsx` (87.28 stmt — large absolute LOC contribution).

## Tools that were NOT runnable in this environment

| Tool | Why skipped |
|---|---|
| `knip` | Requires npx install; environment blocks `npx canceled due to missing packages and no YES option` |
| `jscpd` (copy-paste detector) | Same — no local install |
| `madge` (circular deps) | Same |
| `depcheck` | Same |
| `npm run build` (full webpack prod build) | Not requested; chunk-budget findings are derived from the currently committed `internal/ui/dist/` artefacts already on disk (last build SHA `1199648`) |
| Playwright E2E (38 specs across 3 viewports) | Out of scope for this static / unit pass; covered by the e2e job in CI and the bench-graph harness |
| Pre-commit hook end-to-end run | Each underlying check ran individually; not orchestrated through `pre-commit run --all-files` to avoid hitting secrets / detect-secrets baseline drift |
| Storybook + ui-core build | Out of scope (separate CI job) |

## Severity-ranked blockers (top 5)

1. **ESLint failure (4 errors)** — `src/pages/DashboardPage.test.tsx:72,73,74,75`. Blocks `npm run lint` (`max-warnings=0`) and the CI `eslint` job. `react/react-in-jsx-scope` is in the airbnb preset and the test file imports `render` from `@testing-library/react` but not `React`.
2. **Webpack chunk-budget failure (2 chunks)** — `internal/ui/dist/2749.2ace578d71c54074e829.js` (6.41 MiB) and `internal/ui/dist/vscode-services.51806740644f0a8803a6.js` (5.17 MiB) exceed the 4 MiB budget. Blocks CI `chunk-budget` job. Largest user-visible regression risk.
3. **Image-pin policy drift** — `.gitlab-ci.yml:884` lacks the `# image-pin:` comment that the other 4 `node:${NODE_VERSION}` usages carry. Blocks CI `image-pins-check`.
4. **`check-doc-routes` self-collision** — `docs/audits/2026-05-21/gap-collection.md:314` literally cites `/workspace`, but the allow-list omits `docs/audits/**`. Will block every future audit run.
5. **Jest worker-leak warning** — `npm test -- --ci` exits 0 but reports `A worker process has failed to exit gracefully and has been force exited`. Reproducible. Indicates a test (likely LSP or queryStream worker harness) that does not tear down a timer / mocked worker; future CI runs may become flaky as tests are added.

No test crashes detected. Both coverage gates remain above floors. Lint / typecheck / vet / golangci-lint surfaces are clean except for the 4 ESLint errors above; everything else flagged is policy-guard signal or static surrogate metric, not a correctness failure.
