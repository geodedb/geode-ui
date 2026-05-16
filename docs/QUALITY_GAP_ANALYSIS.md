# Quality Gap Analysis

Last updated: 2026-05-15

Repo: `devnw/codepros/geode/geode-ui`

Review scope: app code, generated API boundary, Go server, React/TypeScript UI, Electron, tests, configs, CI/CD, Docker/container files, scripts, docs that affect quality or build/runtime performance.

## Summary

Current pass tracked 19 actionable quality/performance root causes. New issues were created for newly-confirmed gaps, and existing umbrella issues were reopened, retitled, labeled, or commented where the current evidence changed.

Severity counts:

- High: 3
- Medium: 13
- Low: 3

Top 5 by PriorityScore and release risk:

1. Go toolchain drift can still route release/docs paths through Go 1.26.2: [#148](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/148).
2. GitLab build/pages artifacts point at `dist/`, but webpack emits `internal/ui/dist`: [#226](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/226).
3. `cmd/server/app.go:newApp` is still a 347 LOC composition function: [#193](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/193).
4. npm is canonical, but pnpm scripts/docs still break Electron builds: [#44](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/44).
5. Jest passes with React `act(...)` warnings and a forced worker-exit warning: [#227](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/227).

## Orientation

Commands run:

- `git rev-parse --show-toplevel` -> `/data/home/benji/src/gl/gitlab.com/devnw/codepros/geode/geode-ui`
- `git status --porcelain` showed pre-existing modified/untracked files outside this review, including `docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json`, `e2e/specs/29-extension-noise.spec.ts`, `.scratch/`, and several `docs/superpowers/plans/*` files.
- `git remote -v` -> `git@gitlab.com:devnw/codepros/geode/geode-ui.git`
- `git ls-files | wc -l` -> 691 tracked files.

Inventory:

- Languages/frameworks: Go 1.26 with `GOEXPERIMENT=jsonv2`, React 18, TypeScript, Webpack 5, Jest, Playwright, Electron.
- API contract: `geode.json` is the source of truth; generated Go/TS outputs live under `gen/`, including `gen/client/react`.
- Main entrypoints: `cmd/server`, `internal/server`, `internal/ui`, `src/index.tsx`, Electron under `electron/`.
- Deploy/build surfaces: `.gitlab-ci.yml`, `Makefile`, `deploy/Dockerfile*`, `deploy/playwright/Dockerfile.playwright`, `docker-compose.test.yml`, `.goreleaser.yaml`, scripts under `scripts/`.
- High-churn/risk areas from recent history and file size: graph rendering, i18n, `cmd/server`, `QueryPage`, `geode.json`, generated client/server API, CI pipeline, profile store/server handlers.

## Quality Contract

Detected repo-standard checks:

| Area | Command | Result |
|---|---|---|
| TS typecheck | `npm run test:ts` | PASS |
| ESLint | `npm run lint` | PASS |
| Prettier | `npm run prettier:check` | PASS |
| Electron typecheck | `npm run electron:tsc` | PASS |
| Web build | `npm run build` | PASS with two Css Minimizer warnings |
| Jest coverage run | `npm test -- --ci --coverage` | PASS, but emitted React `act(...)` warnings and a forced worker-exit warning |
| UI ratchets | `lint:hardcoded-styles`, `lint:contrast`, `verify:translations`, `detect:hardcoded-strings`, `check:html-renderers` | PASS |
| Go format | `scripts/check-gofmt.sh` | PASS |
| Go vet | `GOEXPERIMENT=jsonv2 GOTOOLCHAIN=go1.26.3 go vet ./...` | PASS |
| Go tests | `make go-test` | PASS |
| Go lint | `make go-lint` | FAIL locally because `golangci-lint` is missing and no repo config exists |
| E2E TS | `npx tsc --project e2e/tsconfig.json --noEmit` | PASS manually, not wired into CI |
| Electron build script | `npm run electron:build` | FAIL because script still invokes `pnpm` |

Checks not run: full Playwright e2e stack, Docker image builds, and a live GitLab pipeline. Those should be used to verify CI/container remediation after changes.

## Stack-Ranked Table

`PriorityScore = Impact(1-5) * Likelihood(1-5) * 4`.

| Rank | Severity | PriorityScore | Category | Finding | Component | Evidence | GitLab Issue | Fix Summary | Owner | ETA/SLA | Status |
|---:|---|---:|---|---|---|---|---|---|---|---|---|
| 1 | High | 48 | deps | Go toolchain pins still drift after the 1.26.3 CVE fix | Go/release | `go.mod:3` `go 1.26.2`; `.goreleaser.yaml:40` `GOTOOLCHAIN=go1.26.2`; README `17` says Go 1.26.2 while `Makefile:3` and CI use 1.26.3 | [#148](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/148) | Align all Go version declarations and add a stale-pin grep guard | Platform/server | 7d | Reopened/commented |
| 2 | High | 48 | ci-cd | CI artifacts and Pages use the wrong build output path | CI/Web build | `webpack.common.js:123` `internal/ui/dist`; `.gitlab-ci.yml:248` `dist/`; `.gitlab-ci.yml:264` `mv dist public` | [#226](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/226) | Publish `internal/ui/dist` or intentionally copy to root `dist` | CI/frontend | 7d | Created |
| 3 | High | 48 | maintainability/readability | `newApp` remains a large composition god-function | Go server | `cmd/server/app.go:151-497` spans about 347 LOC; registers API at `:267`, WS/MCP/LSP at `:310-332`, CSRF at `:441` | [#193](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/193) | Split issuer/store/routes/limiters/server helpers with direct tests | Server | 1 sprint | Updated/commented |
| 4 | Medium | 48 | deps | npm is canonical, but pnpm scripts/docs remain | Frontend/Electron/docs | `package.json:32-33` uses `pnpm`; `package.json:39` declares `npm@10.9.0`; `.gitlab-ci.yml:159` docs comment still says pnpm | [#44](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/44) | Replace pnpm invocations, update docs, optionally add a guard | Frontend/tooling | 7d | Retitled/commented |
| 5 | Medium | 48 | tests | Jest accepts React `act(...)` warnings and open-handle leaks | UI tests | `__test_utils__/afterEnv.js:1-7` has no console-warning gate; warnings cite `useApiResource.ts:64-70`, `usePane.ts:85-87`, `LoginPage.tsx:90-100` | [#227](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/227) | Fix async tests, add fail-on-unexpected React warnings, run open-handle diagnostics | Frontend tests | 1 sprint | Created |
| 6 | Medium | 48 | maintainability/readability | Graph renderer complexity migrated into `GraphViewCytoscape.tsx` | UI graph | `GraphView.tsx` is 29 LOC, but `GraphViewCytoscape.tsx` is 813 LOC and `GraphView.test.tsx` is 1594 LOC | [#164](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/164) | Retarget decomposition to Cytoscape renderer and split graph tests | Frontend graph | 1 sprint | Retitled/commented |
| 7 | Medium | 36 | ci-cd | `go list ./...` still traverses `node_modules/flatted` | Go/tooling | `GOEXPERIMENT=jsonv2 GOTOOLCHAIN=go1.26.3 go list ./...` returns `geodedb.com/geode-ui/node_modules/flatted/golang/pkg/flatted` | [#174](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/174) | Stop Go package discovery from walking npm dependencies | Tooling | 1 sprint | Commented |
| 8 | Medium | 36 | tests | Fast TS gates exclude e2e specs and support scripts | E2E/scripts | `package.json:16` lints only `src/`; `package.json:23` formats only `src`; `tsconfig.json:28-31` excludes `e2e`; `.gitlab-ci.yml:123` only runs `npm run lint` | [#228](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/228) | Add e2e/support script typecheck and lint jobs | Frontend tests | 1 sprint | Created |
| 9 | Medium | 36 | perf/ci-cd | CI rebuilds the webpack bundle inside `go:test` | CI performance | `.gitlab-ci.yml:245` runs `npm run build`; `.gitlab-ci.yml:329-331` repeats `npm ci`, `npm run build`, then Go tests; `internal/ui/embed.go:15` embeds `dist` | [#229](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/229) | Reuse a canonical SPA artifact or split Go embed fixture | CI/platform | 1 sprint | Created |
| 10 | Medium | 36 | api-contract | Profile API adapter duplicates generated `Profile` contract | API/client | `src/api/profiles.ts:86-100` hand-writes `WireProfile`; `:245-252` casts `r.profiles` to `unknown[]`; generated `ProfileList` exists at `gen/client/react/client.ts:251-267` | [#231](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/231) | Use generated types directly, retain only narrow legacy normalization | API/frontend | 1 sprint | Created |
| 11 | Medium | 36 | maintainability | Go lint target lacks pinned bootstrap/config | Go/tooling | no `.golangci*` files; `Makefile:26-27` runs `golangci-lint`; local `make go-lint` fails with command not found | [#46](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/46) | Commit config and pinned install/bootstrap path | Server/tooling | 1 sprint | Commented |
| 12 | Medium | 32 | deps/ci-cd | CI/container images mostly use mutable tags | Containers/CI | `.gitlab-ci.yml:677` `release-cli:latest`; `deploy/Dockerfile:25` `node:22-alpine`; `:44` `golang:1.26-alpine`; `:63` `alpine:3.20` | [#233](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/233) | Pin runtime/release images by digest and add an image-pin guard | Platform/release | 1 sprint | Created |
| 13 | Medium | 32 | tests | Coverage is measured but not enforced | Test policy | `jest.config.cjs:1-58` has no `coverageThreshold`; `make go-test` reports package coverage but no floor | [#48](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/48) | Add ratcheting Jest and Go coverage thresholds | Test owners | 1 sprint | Commented |
| 14 | Medium | 32 | ci-cd | Go CI cache is disabled | CI performance | `.gitlab-ci.yml:282-289` `.go_defaults` sets `cache: []` | [#175](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/175) | Cache `GOMODCACHE` keyed on `go.sum` | CI/platform | 1 sprint | Commented |
| 15 | Medium | 32 | perf | `make build` reruns code generation unconditionally | Local build | `Makefile:15-17` always runs `genapi generate` and `go mod tidy`; `Makefile:98` `build: generate go-build` | [#177](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/177) | Add stale-detect sentinel or separate clean CI build target | Tooling | 1 sprint | Commented |
| 16 | Medium | 32 | docs/api-contract | Generated API boundary lacks a focused ADR | Docs/API | only `docs/adr/0000-record-architecture-decisions.md` exists; API rules are scattered across `README.md`, `internal/server/README.md`, and architecture docs | [#178](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/178) | Add ADR with source-of-truth, genapi, local adapter exception policy | Architecture | 1 sprint | Commented |
| 17 | Low | 24 | deps/ci-cd | `bench-gate.sh` installs `benchstat@latest` outside pin guard | Scripts/perf | `scripts/bench-gate.sh:68-69` installs `benchstat@latest`; `scripts/check-ci-pins.sh:16-33` scans only `.gitlab-ci.yml` | [#230](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/230) | Pin fallback tool install or require preinstalled tool; broaden guard | CI/tooling | 30d | Created |
| 18 | Low | 24 | ci-cd | Production webpack build emits Css Minimizer warnings | Web build | `npm run build` reports `postcss-calc` warnings from `@awesome.me/webawesome` CSS; `webpack.common.js:126` sets `stats: { warnings: false }` | [#232](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/232) | Resolve/allowlist upstream warning and make new warnings visible | Frontend build | 30d | Created |
| 19 | Low | 24 | maintainability/readability | `TableView.tsx` remains a large multi-concern component | UI table | `src/components/results/TableView.tsx` is 605 LOC | [#184](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/184) | Split table hooks/components and isolate tests | Frontend table | 30d | Commented |

## Findings By Category

### CI/CD And Build Performance

- [#226](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/226): Fix artifact path drift between webpack and GitLab Pages. Verify with `npm run build`, artifact inspection, and a GitLab pipeline.
- [#229](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/229): Remove duplicate webpack rebuilds from `go:test`. Verify with before/after pipeline timings.
- [#175](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/175): Add Go module cache. Verify by comparing consecutive CI runs.
- [#232](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/232): Make production webpack warnings actionable. Verify `npm run build` emits zero unexpected warnings.

### Dependencies, Toolchains, Containers

- [#148](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/148): Align all Go toolchain declarations on the patched release version. Verify stale `go1.26.2` greps return none.
- [#44](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/44): Finish npm-canonical migration. Verify `npm run electron:build` and `rg -n "pnpm"` on active docs/configs.
- [#233](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/233): Pin container/CI image inputs. Verify no `:latest` release path and documented digest policy.
- [#230](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/230): Pin `benchstat` fallback installs. Verify the pin guard catches `@latest` in scripts.

### Tests And Quality Gates

- [#227](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/227): Eliminate React test warnings and open handles. Verify with `npm test -- --ci --coverage` and a targeted `--detectOpenHandles` run.
- [#228](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/228): Add fast gates for e2e TypeScript/support code. Verify `npx tsc --project e2e/tsconfig.json --noEmit` is in CI.
- [#48](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/48): Add coverage ratchets. Verify thresholds fail on deliberate coverage erosion.
- [#46](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/46): Make Go lint reproducible. Verify `make go-lint` works on a fresh checkout.

### API Contract And Architecture

- [#231](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/231): Retire duplicated profile DTO shape. Verify `npm run test:ts` catches generated profile contract drift.
- [#178](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/178): Add the generated API boundary ADR. Verify contributors can find the `geode.json -> genapi -> gen/` rules in one canonical doc.
- [#174](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/174): Keep Go package discovery out of npm dependency trees. Verify `go list ./...` has no `node_modules` packages.

### Maintainability And Readability

- [#193](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/193): Split `newApp` into focused helpers. Verify `cmd/server` coverage stays at or above the current floor and `newApp` drops under the target LOC.
- [#164](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/164): Finish graph renderer decomposition. Verify graph tests stay green and files split by lifecycle/layout/interaction concerns.
- [#184](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/184): Split table rendering concerns. Verify `TableView.tsx` drops below the agreed LOC threshold with stable tests.
- [#177](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/177): Add build stale-detect. Verify warm `make build` does not regenerate when `geode.json` is unchanged.

## Roadmap

Quick wins:

- Fix `.gitlab-ci.yml` artifact path for [#226](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/226).
- Replace `pnpm` in `package.json` Electron scripts for [#44](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/44).
- Pin `benchstat` fallback install or remove auto-install for [#230](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/230).
- Add an e2e typecheck script and wire it to CI for [#228](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/228).

Medium:

- Align Go toolchain references and add a stale-pin guard for [#148](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/148).
- Make Jest fail on unexpected React warnings after fixing the known warning sites for [#227](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/227).
- Reuse the frontend build artifact in Go jobs and add Go module caching for [#229](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/229) and [#175](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/175).
- Remove the profile API `unknown[]` cast for [#231](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/231).

Strategic:

- Decompose server app construction and graph/table renderer surfaces: [#193](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/193), [#164](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/164), [#184](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/184).
- Standardize reproducibility policy across Go, npm, Docker images, CI images, and generated API contracts: [#148](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/148), [#233](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/233), [#178](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/178).
- Ratchet quality gates so current green builds stay green without hiding warnings: [#46](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/46), [#48](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/48), [#227](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/227), [#232](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/232).

## Unknowns And Follow-Up Verification

- Full Playwright e2e was not run in this pass. Run `npm run e2e` or the CI e2e job after changes touching e2e gates, Electron packaging, graph/table layout, or Docker images.
- Docker image builds were not run. Run the relevant `docker build` or GitLab Docker jobs after digest pinning or build-output path changes.
- The CI artifact path issue is confirmed locally by build output paths, but the final proof is a GitLab pipeline where `build` uploads the intended artifact and `pages` consumes it.
- Open-handle root cause in Jest is confirmed by Jest output, but the exact leaked handle needs a targeted `npm test -- --ci --detectOpenHandles --runInBand` investigation.
