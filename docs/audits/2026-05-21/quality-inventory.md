# Quality Inventory — geode-ui

- **Date:** 2026-05-21
- **Branch:** `main` (clean tree at `1199648`)
- **Repo root:** `/data/home/benji/src/gl/gitlab.com/devnw/codepros/geode/geode-ui`
- **Platform:** GitLab (`git@gitlab.com:devnw/codepros/geode/geode-ui.git`)
- **Scope:** Read-only foundation pass for downstream quality-scanner / quality-reviewer agents. No tools were executed.

## Repo Inventory

**Languages**

- **Go 1.26.3** (toolchain pinned via `.tool-versions`, `go.mod`, `Makefile:GOTOOLCHAIN`, and `scripts/check-go-toolchain.sh`).
  - Experimental `GOEXPERIMENT=jsonv2` set in `Makefile:2`.
  - Internal replace: `geodedb.com/geode => ../geode-client-go` (`go.mod:5`).
- **TypeScript ~5.8** with React 18.2 (`package.json`, `tsconfig.json`, `tsconfig.base.json`).
  - `strict`, `noUncheckedIndexedAccess`, `isolatedModules`, `forceConsistentCasingInFileNames` all on (`tsconfig.base.json`).
  - Path aliases: `@/*` -> `src/*`, `@api` / `@api/*` -> `gen/client/react/*`.
- **Node 22.14.0** required (`package.json:engines`, `.nvmrc`, `.tool-versions`).
- **Shell / bash** scripts in `scripts/` (`shellcheck` enforced via pre-commit).

**Frameworks & key libraries**

- **Frontend SPA:** React 18.2 + react-router-dom 7, Zustand 5, react-i18next 17, Bootstrap 5.3, styled-components 6.1, Web Awesome 3.7, Monaco editor + `monaco-languageclient`, Cytoscape (+ multiple cytoscape plugins), Reagraph, Recharts 2.15, DOMPurify.
- **Backend (Go):** stdlib HTTP server (`internal/server/`, `cmd/server/`), `golang-jwt/jwt/v5`, `lestrrat-go/jwx`, OpenTelemetry (`go.opentelemetry.io/otel*` v1.43), `modernc.org/sqlite` (CGO-free), `gopkg.in/natefinch/lumberjack.v2`.
- **Desktop:** Electron 42 (`electron/`, `electron-builder.yml`, `internal/ui/electron-dist/`).
- **E2E:** Playwright 1.59 (`@playwright/test`), three projects: `chromium`, `mobile-chrome` (Pixel 7), `tablet-chrome` (`e2e/playwright.config.ts`).
- **Code-gen:** `genapi` produces `gen/api/`, `gen/client/react/`, `gen/cmd/server/spec.json` from `geode.json`; stale-detect sentinel at `scripts/generate-if-stale.sh`.

**Package managers**

- `npm@10.9.0` with npm workspaces (`packages/*` -> `@geodedb/ui-core`).
- Go modules (`go.mod` / `go.sum`).

**Entrypoints**

- Go server: `cmd/server/main.go` (+ `app.go`, `app_csrf.go`, `app_issuer.go`, `app_limiters.go`, `app_routes.go`, `pprof.go`, `profileseed.go`).
- Aux Go binary: `cmd/mint-token-smoke/main.go`.
- SPA: `src/index.tsx` / `src/App.tsx`, webpack bundles in `webpack.{common,dev,prod}.js`.
- Electron main: `internal/ui/electron-dist/main.js` (compiled from `electron/`).
- Embedded UI assets served by Go: `internal/ui/`.

## Source tree boundaries

| Tree | Purpose |
|---|---|
| `cmd/server/` | Go HTTP server entrypoint, route wiring, CSRF, JWT issuer, rate-limiters, pprof. |
| `cmd/mint-token-smoke/` | Small Go binary for token issuance smoke. |
| `internal/server/` | HTTP handlers (`handlers_*.go`), auth, audit, errors, error-codes, CSRF, normalisation. 95 `.go` files (55 are `_test.go`). |
| `internal/jwt/`, `internal/conn/`, `internal/profilestore/`, `internal/ui/` | JWT helpers, Geode-client conn pool, encrypted profile store, embedded SPA assets. |
| `gen/api/`, `gen/client/react/`, `gen/cmd/server/` | genapi output (Go handlers stubs + React client + OpenAPI spec). Excluded from many linters via `path: ^gen/`. |
| `contracts/` | Cross-stack JSON contracts (`password-policy.contract.json`, `profile-name-normalization.contract.json`) consumed by Go + TS tests. |
| `src/` | React SPA. Subtrees: `api/`, `auth/`, `components/{admin,brand,dashboard,editor,layout,ops,profiles,results,schema}`, `hooks/`, `lib/`, `pages/`, `services/{bootstrap,i18n,webawesome}`, `test-utils/`, `types/`. |
| `packages/ui-core/` | Workspace `@geodedb/ui-core` — reusable theme/primitives, Storybook 8, tsup library build. |
| `e2e/` | Playwright specs (`specs/01-*.spec.ts` ... `37-dashboard-metrics.spec.ts`), `electron-specs/`, fixtures, helpers, separate `electron.config.ts`. |
| `electron/` | Electron main + preload TS sources, separate `tsconfig.json`. |
| `__tests__/` | Top-level Jest suites covering `App`, electron cache/safety/server-url/typecheck-gate, IPC guards, secure-store, webpack-common warnings + prod source-maps. |
| `__test_utils__/` | Jest setup, polyfills, mocks (style, file, markdown, worker-URL stubs). |
| `scripts/` | Custom linting/check scripts (mostly `.mjs`); each has a sibling `.test.mjs` self-test. Includes `bench-gate.sh` / `.ts`, `check-*` guards, install/install-tools, `precompress-dist.mjs`. |
| `deploy/` | Dockerfiles (runtime + alpine + release), `docker-compose.test.yml`, `docker-compose.example.yml`, RELEASE.md, geode helper. |
| `docs/` | ADRs (`adr/0000-0002`), GAP analyses (QUALITY/PERF/SECURITY/global + RESOLVED), gap-closure-reports, performance, gql-spec, upstream-issues. |

## Quality Tooling

| Category | Tool | Config | Command |
|---|---|---|---|
| TS lint | ESLint 8 (airbnb + airbnb-typescript + `@typescript-eslint`, `import`, `react`) | `.eslintrc.json`, `.eslintignore` | `npm run lint` (`eslint src/ --ext .ts,.tsx --max-warnings=0`) |
| TS format | Prettier 3 (semi=false, singleQuote, printWidth=80) | `.prettierrc.json` | `npm run prettier:check` / `:fix` |
| TS typecheck | `tsc --noEmit` over root, `e2e/`, `scripts/`, `electron/` | `tsconfig.json`, `tsconfig.base.json`, `e2e/tsconfig.json`, `scripts/tsconfig.json`, `electron/tsconfig.json`, `packages/ui-core/tsconfig.json` | `npm run test:ts` (delegates to `e2e:tsc`, `scripts:tsc`); `electron:tsc` separate |
| Unit tests (TS) | Jest 29 + ts-jest 29 + babel-jest (for ESM deps), jsdom env | `jest.config.cjs`, `__test_utils__/{afterEnv,polyfills}.js`, `babel.config.cjs` | `npm test` |
| Coverage gate (TS) | Jest `coverageThreshold` ratchet: statements 79 / branches 66 / functions 74 / lines 81 | `jest.config.cjs:90-97` | `npm test -- --coverage` |
| E2E | Playwright 1.59 (chromium + mobile-chrome + tablet-chrome) | `e2e/playwright.config.ts`, `e2e/electron.config.ts` | `npm run e2e`, `e2e:electron`, `e2e:smoke` |
| Go lint | golangci-lint v2 (errcheck, govet, ineffassign, staticcheck, unused, gocognit, gocyclo, nestif, dupl, revive) | `.golangci.yml` | `make go-lint` |
| Go format | `gofmt -s -w` + `goimports` | (n/a) | `make go-fmt`, pre-commit `gofmt-check` |
| Go vet | `go vet ./...` | (n/a) | pre-commit `go-vet`, `make go-test` |
| Go tests | `go test -race -cover -failfast` against `./cmd/... ./gen/... ./internal/...` | `Makefile:GO_PKGS`, `_test.go` files | `make go-test` |
| Go coverage gate | `scripts/check-go-coverage.sh` (committed floor) | script | `make go-cover` |
| Go bench gate | `scripts/bench-gate.sh` vs `bench-baseline.txt` (10% threshold default) | script | `make bench-gate` / `bench-baseline` |
| Markdown lint | markdownlint-cli v0.43 | `.markdownlint.json`, `.markdownlintignore` | pre-commit `markdownlint` |
| YAML format | `pretty-format-yaml` | (n/a) | pre-commit |
| Shell lint | shellcheck (severity=error) | (n/a) | pre-commit `shellcheck` |
| Makefile lint | checkmake 0.2.2 | (n/a) | pre-commit `checkmake` |
| Secrets | gitleaks (`.gitleaks.toml`) + detect-secrets v1.5 baseline | `.gitleaks.toml`, `.secrets.baseline` | pre-commit `detect-secrets`; CI `security-gitleaks` |
| Commit policy | commitizen (conventional commits) | `.cz.yaml` | pre-commit `commitizen` / `commitizen-branch` (pre-push) |
| Bundle budget | `scripts/check-chunk-budget.mjs` | script + `package.json` script | CI job `chunk-budget` |
| Cross-stack contracts | JSON contracts + Go + TS contract tests | `contracts/*.contract.json`, `*_test.go`, `*.contract.test.ts` | covered by `npm test` + `go test` |
| Theme/style guards | `check-hardcoded-styles.mjs`, `check-contrast.mjs` | scripts | pre-commit + `npm run lint:hardcoded-styles` / `lint:contrast` |
| i18n guards | `validate-translations.mjs`, `detect-hardcoded-strings.mjs`, `check-html-renderers.mjs`, `check-no-mac-glyphs.mjs` | scripts | pre-commit |
| Doc guards | `check-doc-routes.mjs`, `check-changelog.mjs`, `check-security-md.mjs` | scripts | pre-commit |
| Compose / supply chain | `check-compose-secrets.mjs`, `check-ci-pins.sh`, `check-image-pins.sh`, `check-error-codes.mjs`, `check-go-toolchain.sh`, `check-go-mod-tidy.sh`, `check-gofmt.sh`, `check-generate.sh` | scripts | pre-commit (mix of pre-commit / pre-push stages) |
| Storybook | Storybook 8 (`@geodedb/ui-core`) | `packages/ui-core/.storybook` | `make stories`, CI `build-storybook` |
| Release | goreleaser (`v2.13.3` via CI), electron-builder | `.goreleaser.yaml`, `electron-builder.yml` | `goreleaser:snapshot` / `goreleaser:release` CI jobs |
| CI | GitLab CI with shared `ci-catalog@v1.7.1` components (sast, dependency-scanning, secrets, gitleaks, sbom-{generate,scan}, release-semantic) | `.gitlab-ci.yml` | per-stage jobs |

CI stages (`.gitlab-ci.yml:77-86`): `install -> lint -> test -> build -> pages -> security -> sbom -> release -> publish`.
Notable CI jobs: `typecheck`, `eslint`, `prettier` (allow_failure), `audit-ratchets`, `electron-typecheck`, `ci-pins-check`, `image-pins-check`, `error-codes-check`, `unit-tests`, `build`, `chunk-budget`, `pages`, `go:lint`, `go:generate-verify`, `go:test`, `bench-gate`, `docker:build`, `e2e:playwright`, `goreleaser:snapshot|release`, `electron:{linux,mac,win}`, `release:publish`, `ui-core:typecheck`, `build-storybook`.

## Test layout

- **Jest (TS):** 155 `*.test.ts(x)` files under `src/` + top-level `__tests__/` + a handful of `scripts/*.test.mjs`. Roots in `jest.config.cjs:3` are `__tests__` and `src`. Co-located with components (e.g. `src/pages/QueryPage.test.tsx`, `src/components/dashboard/Card.test.tsx`, `src/lib/queryStreamReducer.test.ts`). Project task note says ~993 Jest tests across the suite; coverage floor recorded in-file as 80.32 stmt / 67.80 br / 75.60 fn / 82.48 line on the last refresh (2026-05-16).
- **Go tests:** 70 `_test.go` files, table-driven, co-located with sources. Dense in `internal/server/` (55 `_test.go` next to 40 source files — a near 1:1 mapping). Includes contract tests (`password_policy_contract_test.go`, `normalize_test.go::TestNormalizeProfileName_Contract`), bench baselines (`handlers_profiles_bench_baseline_test.go`), drift/regression tests (`handlers_users_drift_test.go`, `geode_v0_5_15_compat_test.go`), and `errorcodes_test.go` (AST walk asserting no literal error codes leak past `ErrCode*` constants).
- **Playwright E2E:** 38 specs in `e2e/specs/01-...37-*.spec.ts` plus `e2e/electron-specs/`. Three viewports (chromium, mobile-chrome Pixel 7, tablet-chrome iPad-sized), `retries: 2`, `workers: 2`, GitHub reporter in CI.
- **Test mocks / helpers:** `__test_utils__/` (afterEnv, polyfills, styleMock, fileMock, markdownMock, layoutWorkerUrlMock, queryStreamWorkerUrlMock); `src/test-utils/`; `e2e/fixtures.ts`, `e2e/helpers/`.
- **Script self-tests:** Every `scripts/check-*.mjs` ships with `scripts/check-*.test.mjs`.

## Source-of-truth & contract surfaces

- **OpenAPI / wire spec:** `geode.json` -> generated `gen/cmd/server/spec.json` (genapi). Stale-detect at `scripts/generate-if-stale.sh`; CI verifies via `go:generate-verify` and pre-commit `generate-verify`.
- **Generated Go + React clients:** `gen/api/handlers_gen.go`, `gen/client/react/client.ts`. Path-aliased as `@api`. Linters exclude `^gen/` (`.golangci.yml`).
- **Cross-stack contracts:** `contracts/password-policy.contract.json` (Go `internal/server/password_policy.go` + TS `src/lib/passwordPolicy.ts`); `contracts/profile-name-normalization.contract.json` (Go `internal/profilestore/normalize.go` + TS `src/components/profiles/ProfileEditorModal.tsx`). Drift on either side fails its language's contract test; vector edits fail both sides.
- **Error-code seam:** `internal/server/errorcodes.go` <-> `src/api/serverErrorCodes.ts`, gated by `scripts/check-error-codes.mjs` (pre-commit) and `errorcodes_test.go` (AST walk).
- **i18n keys:** `src/services/i18n/locales/en.ts` (canonical); `validate-translations.mjs` checks all required locales; `detect-hardcoded-strings.mjs` is the runtime guard.
- **Theme tokens:** `src/theme/` is the only sanctioned home for hex/`rgb()`/`hsl()` literals (enforced by `scripts/check-hardcoded-styles.mjs`); `scripts/check-contrast.mjs` enforces WCAG AA.

## High-churn areas (last 3 months, top 10)

From `git log --format=format: --name-only --since='3 months ago' | sort | uniq -c | sort -rn`:

| Commits | Path |
|---:|---|
| 86 | `src/services/i18n/locales/en.ts` |
| 70 | `docs/PERF_GAP_ANALYSIS.md` |
| 67 | `docs/QUALITY_GAP_ANALYSIS.md` |
| 63 | `docs/SECURITY_GAP_ANALYSIS.md` |
| 55 | `src/components/results/GraphView.tsx` |
| 46 | `package.json` |
| 44 | `docs/GAP_ANALYSIS.md` |
| 38 | `src/pages/QueryPage.tsx` |
| 32 | `package-lock.json` |
| 30 | `src/components/results/GraphView.test.tsx` |

Additional notable hot spots: `.gitlab-ci.yml` (29), `cmd/server/main.go` (29), `geode.json` (24), `gen/cmd/server/spec.json` (24), `e2e/helpers/selectors.ts` (24), `src/App.tsx` (23), `gen/api/handlers_gen.go` (23), `src/components/layout/Shell.tsx` (22), `src/components/results/TableView.tsx` (21), `gen/client/react/client.ts` (21).

## High-risk areas (review attention)

- **`src/components/results/` (graph stack)** — GraphView, GraphViewCytoscape, GraphViewReagraph, projectColumns, propFormat, cytoscapeStyle. Multiple recent perf-gap fixes, A/B harness, and the open #247 / #214 / #252 admin nav threads anchor here. `extractElements` history in `src/lib/graphResult.ts` (181 LOC pre-decomposition) cited as recent decomposition target.
- **`internal/server/handlers_*`** — 95 Go files; auth, audit, CSRF, error envelopes, RBAC list/single split, wire-feature-missing fallback, rate-limiter logic. Conventions documented in `internal/server/CONVENTIONS.md` (5+ explicit invariants).
- **`cmd/server/app_*.go`** — bootstrap wiring (routes, CSRF, JWT issuer, rate-limit budgets). High blast radius for any policy change.
- **`src/lib/queryStream*`** — streaming reducer, worker-backed parser, fallback to main-thread parse. Mocked in Jest via `(^|/)queryStreamWorkerUrl$` map.
- **Contract pairs (password-policy, profile-name)** — explicitly authoritative on the Go side; SPA mirror is what users see first.
- **i18n / hardcoded-strings** — strict mode active for hardcoded-strings; missing translations are gated; `en.ts` is the highest-churn file in the repo.
- **Generated boundary (`gen/`)** — excluded from most linters; correctness rides on `genapi` + `go:generate-verify` CI job + sentinel hash.

## Notable structural observations

- The repo runs **two coverage ratchets in parallel** (Jest floor + Go coverage script). Both must move forward together for honest reporting.
- **Layered pre-commit / pre-push pipeline** (`.pre-commit-config.yaml`): fast formatters on pre-commit (gofmt, eslint, prettier, theme/i18n/doc guards, secrets, shellcheck, markdownlint), heavy verification on pre-push (golangci-lint, ts-typecheck, go test -race, jest, generate-verify, webpack prod build, go build). CI re-runs everything because the local hooks are `skip`-listed in the `ci:` block.
- **Strict CI supply-chain pinning** — `check-ci-pins.sh` + `check-image-pins.sh` + `check-go-toolchain.sh` block any `@latest`/`@~latest` (one explicit allowlist for `codesign-windows-ssl@~latest` pending tagged catalog release).
- **`ui-core` workspace** is a published-style internal package (tsup build, Storybook 8, separate `typecheck` test job in CI). It has its own `jest.config.cjs`, `babel.config.cjs`, `jest.setup.ts`. Note: `package.json:engines` requires Node `>=20` while the root requires Node `>=22.14.0` — minor drift to flag.
- **Pre-existing GAP tracking** — `docs/QUALITY_GAP_ANALYSIS.md` (active, last updated 2026-05-19), `docs/GAP_ANALYSIS.md`, `docs/GAP_ANALYSIS_RESOLVED.md`, `docs/PERF_GAP_ANALYSIS.md`, `docs/SECURITY_GAP_ANALYSIS.md`, `docs/gap-closure-reports/` (per-batch closure evidence). The active Quality file lists 9 open items as of 2026-05-19 with PriorityScore = Impact * Likelihood * 4.
- **3 ADRs:** `0000-record-architecture-decisions.md`, `0001-generated-api-boundary.md`, `0002-profile-store-dek-trust-model.md`. ADR-0002 (profile-store DEK trust model) and #261 (cross-stack contract-mirror ADR) are referenced in QUALITY_GAP_ANALYSIS.md as the architectural follow-ups.
- **golangci-lint relaxations** are documented in `.golangci.yml` (gocognit/gocyclo raised, dupl threshold raised, revive trimmed to a curated subset) with explicit "ratchet down" notes.
- **Bench tooling** spans Go bench-gate (`scripts/bench-gate.sh` + `bench-baseline.txt`) and a Playwright-driven graph A/B harness (`make bench-graph`).

## Missing tooling / structural gaps to keep in mind

- No top-level `eslint.config.*` flat config — still on legacy `.eslintrc.json` with airbnb. ESLint 8 is supported but EOL; upgrade path is a known follow-up (no explicit issue yet, but worth flagging for the reviewer).
- Prettier covers only `src/**/*.{ts,tsx,json,css}` (`package.json:40-41`); markdown / yaml / scripts not run through prettier (intentional — they have their own tools).
- `e2e/` lacks a coverage gate; perf-smoke is manual / scheduled only.
- ui-core's Node engine constraint (`>=20`) lags the root (`>=22.14.0`).
- Pre-commit secrets/audit checks are skipped on CI by design (`.pre-commit-config.yaml:332-353`); CI relies on `security-secrets`, `security-gitleaks`, `security-sast`, `security-dependency-scanning` components instead.
- `goreleaser` is pinned to `v2.13.3` while goreleaser config (`.goreleaser.yaml`) is 15 KB — worth a separate goreleaser-spec audit but out of scope here.

## Inputs the scanner / reviewer should ingest next

1. `docs/QUALITY_GAP_ANALYSIS.md` (open items as of 2026-05-19) + `docs/GAP_ANALYSIS_RESOLVED.md` (do not re-open closed cohort rows).
2. `docs/adr/` (3 ADRs) — esp. ADR-0001 (generated API boundary) and ADR-0002 (profile-store DEK).
3. `internal/server/CONVENTIONS.md` — error-code taxonomy, empty-result rule, wire-feature-missing fallback, dual-key forward-compat, audit-event naming. Violations of these are first-class quality findings.
4. `.golangci.yml` settings — when a finding overlaps a relaxed linter cap, the relaxation rationale is in the file's leading comment.
5. `jest.config.cjs:90-97` — current coverage floor for Jest; any regression below it is a hard CI failure.
6. `contracts/*.contract.json` — the two cross-stack contracts that must be held to byte-equal Go + TS behaviour.
