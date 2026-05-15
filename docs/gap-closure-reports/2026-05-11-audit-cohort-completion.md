# Gap Closure Completion Report -- 2026-05-11 (audit-cohort batch)

- **Repository:** `devnw/codepros/geode/geode-ui`
- **Branch:** `main` (10 implementation commits + 1 docs-tracking commit, **unpushed**)
- **Platform:** GitLab (`glab` as `benjiv`)
- **Verifier:** ACCEPTED -- full Go + frontend suites green, `cmd/server` coverage 4.0% → 65.3%, frontend 415 → 426 tests, `govulncheck ./...` clean, no regressions
- **Run window:** 2026-05-11 `/codepros:gap-close` run against the 2026-05-11 audit cohort (security F-AUTH-*/F-INPUT-*/F-SUP-*, PERF-2026-05-11-*, quality Q*)
- **Companion docs:** [SECURITY_GAP_ANALYSIS.md](../SECURITY_GAP_ANALYSIS.md), [PERF_GAP_ANALYSIS.md](../PERF_GAP_ANALYSIS.md), [QUALITY_GAP_ANALYSIS.md](../QUALITY_GAP_ANALYSIS.md), [GAP_ANALYSIS.md](../GAP_ANALYSIS.md), [GAP_ANALYSIS_RESOLVED.md](../GAP_ANALYSIS_RESOLVED.md#2026-05-11-closure-run----audit-cohort-batch-12-closed--3-deferred-upstream-10-geode-ui-commits--1-sibling-repo-commit); prior runs: [2026-05-11-completion.md](./2026-05-11-completion.md), [2026-05-11-followup-completion.md](./2026-05-11-followup-completion.md), [2026-05-10-completion.md](./2026-05-10-completion.md)

## Summary

| Metric | Value |
|---|---|
| Findings closed in-repo | **12** (F-SUP-1, F-INPUT-1, F-SUP-4; PERF-2026-05-11-01/02/04/08; Q35, Q36, Q25, Q16, Q26) |
| GitLab issues closed | **12** -- #148, #131, #129, #140, #128, #130, #137, #147, #170, #160, #158, #172 |
| Findings mitigated-but-open | **1** -- F-AUTH-1 (#132): in-repo mitigation `c46e77e`, full fix tracked upstream genapi |
| Findings deferred-to-upstream-genapi (stay open) | **2** -- F5/PERF-2026-05-11-03 (#133), F-AUTH-2 (#135) |
| Follow-up made trivial | **1** -- Q38 (#180): `(*app).serve` already returns the shutdown error after `adf6b6f` |
| geode-ui implementation commits | **9** on `main` (`d464fe6`, `210133e`, `790cdcb`, `454d0ba`, `c4ef58c`, `c46e77e`, `4698645`, `f444c70`, `adf6b6f`) + **1** docs-tracking commit (this report + the 5 `*GAP_ANALYSIS*.md` updates) |
| Sibling-repo commit | `a7d63f3` in `../geode-client-go` on branch `codex/client-parity-sync` -- separate PR/merge there still **pending** |
| Build / test status | GREEN (verifier ACCEPTED) |
| Pushed? | **No** -- the user pushes; the sibling-repo merge is also outstanding |

## GAP_ANALYSIS status

These findings are tracked in the domain docs (`SECURITY_GAP_ANALYSIS.md`, `PERF_GAP_ANALYSIS.md`, `QUALITY_GAP_ANALYSIS.md`), not by `GAP-NNN` ID in `GAP_ANALYSIS.md`. The one crossover in `GAP_ANALYSIS.md` is `GAP-009` (electron CI job), hardened by `f444c70`.

| File | Closed | Mitigated-open | Deferred-open | Remaining open (this cohort) | Cohort total |
|---|---|---|---|---|---|
| `SECURITY_GAP_ANALYSIS.md` (Audit-2026-05-11 cohort) | 3 (F-SUP-1 #148, F-INPUT-1 #140, F-SUP-4 #160) | 1 (F-AUTH-1 #132) | 1 (F-AUTH-2 #135) | 4 (F-SUP-2 #72, F-SUP-3 #153, F-INPUT-2 #143, F-SUP-5 #161) | 9 |
| `PERF_GAP_ANALYSIS.md` (Audit-2026-05-11 cohort) | 4 (#128, #130, #137, #147) | 0 | 1 (#133) | 12 (#139, #142, #145, #150, #154, #156, #159, #163, #165, #167, #169, #171) | 17 |
| `QUALITY_GAP_ANALYSIS.md` (Phase-3/4 cohort, top-priority subset) | 5 (Q35 #129, Q36 #131, Q25 #170, Q16 #158, Q26 #172) | 0 | 0 | rest of the 46-finding cohort untouched (Q38 #180 now trivial) | 46 |
| `GAP_ANALYSIS.md` | 0 new (GAP-009 hardened) | 0 | 0 | GAP-002..005, 011, 012, 013..022 unchanged | 7 open GAP-NNN + 10 Bucket-A |

**Overall (this cohort):** 12 closed, 1 mitigated-open, 2 deferred-open.

## Closed items

| Finding | GitLab | Commit | Evidence |
|---|---|---|---|
| F-SUP-1 -- Go toolchain go1.26.2 → go1.26.3 | #148 | `d464fe6` (+ `a7d63f3` in `../geode-client-go` branch `codex/client-parity-sync`) | All 5 repo refs (`Makefile:3`, `scripts/run-go.sh:9`, `scripts/check-go-mod-tidy.sh:10`, `.gitlab-ci.yml:242`, `deploy/Dockerfile:45`) now `go1.26.3`; sibling `go.mod` `toolchain go1.26.3`; `govulncheck ./...` → "No vulnerabilities found" (GO-2026-4980/4982/4918/4971 no longer CALLED). Release-blocker cleared. |
| Q36 -- `go.mod` relative `replace ../geode-client-go` | #131 | `210133e` | `go.mod:5` `replace geodedb.com/geode => ../geode-client-go`; `make go-test`/`go-build` resolve; CI's `go mod edit -replace` still works (now redundant). |
| Q35 -- CI `build:` `needs:` | #129 | `790cdcb` | `.gitlab-ci.yml` `build:` `needs:` includes `typecheck, unit-tests, audit-ratchets` (+ `install, eslint`) -- build can no longer ship while those jobs are red. |
| F-INPUT-1 -- `quoteString` backslash escape | #140 | `454d0ba` | `internal/server/quoting.go:78-79` escapes `\`→`\\` before `'`→`''` (matches `../geode-client-go/conn.go:849-861 gqlStringEscaper`); control chars still rejected. Tests: `quoting_test.go:149-181 TestQuoteString_BackslashEscape` (9 cases). |
| F1 / PERF-2026-05-11-01 -- server-side schema-discovery cache | #128 | `c4ef58c` | New `internal/server/schema_cache.go` (120s TTL, `singleflight`, key `{profile,graph,kind}`); `handlers_schema.go` Labels/EdgeTypes route through it; invalidate-all on profile create/update/delete (`handlers_profiles_crud.go:85,160,196`). Tests: `handlers_schema_cache_test.go` (6 cache tests + `BenchmarkLabels`/`BenchmarkEdgeTypes`). Renderer cache #154 NOT in scope (still open). |
| PERF-2026-05-11-02 -- `streamStateToResp` identity churn | #130 | `4698645` | `QueryPage.tsx:313 streamStateToResp` wrapped in `useMemo`. Tests: `QueryPage.streamMemo.test.tsx`. |
| PERF-2026-05-11-04 -- WS row demux defeats batching | #137 | `4698645` | `queryStream.ts:82-83` dispatches one `rowBatch` action/frame; `queryStreamReducer.ts:89` `rowBatch` case (one `rowsVersion` bump/frame). Tests: updated `queryStream.test.ts`, `queryStreamReducer.test.ts` cases. |
| PERF-2026-05-11-08 -- `JsonView` re-stringifies per render | #147 | `4698645` | `JsonView.tsx:33,37` `React.memo` + `useMemo(JSON.stringify)`. Tests: new `JsonView.test.tsx`. Frontend 415→426 tests. |
| Q25 / F-SUP-4 -- electron-tsc real CI gate | #170, #160 | `f444c70` | `package.json` devDeps `+ electron@^42.0.1`, `+ @types/node@^22.19.19`; `package-lock.json` updated; `.gitlab-ci.yml electron-typecheck` no longer `allow_failure`; `npm run electron:tsc` exits 0. Also hardens `GAP-009`. `pnpm-lock.yaml` NOT regenerated (`packageManager: npm`); dual-lockfile cleanup tracked at `GAP-017`/#44. |
| Q16 / Q26 -- decompose god-main + bootstrap tests | #158, #172 | `adf6b6f` | `cmd/server/main.go` → 12-line shim; new `cmd/server/app.go` (`appConfig`/`parseFlags`/`newApp`/`(*app).serve`/`run`) + `cmd/server/profileseed.go`; new `cmd/server/app_test.go` (6 tests incl. `TestRun_MissingJWTSecret_ExitsNonZero`, `TestNewApp_HappyPath` healthz=200, `TestNewApp_WiresMCPAuthVerifier`); `internal/profilestore.NewCipherFromEnvFunc` added. `cmd/server` coverage **4.0%→65.3%**. Q38 (#180) now trivial. |

## Won't Do items

None this run. (`PERF-2026-05-11-12`/#159 stays blocked-on-product; not reclassified.)

## Blocked / deferred items

| Finding | GitLab | Status | Blocker | Unblock steps |
|---|---|---|---|---|
| F-AUTH-1 (full fix) | #132 | Mitigated in-repo `c46e77e`; **stays OPEN** | Authoritative fix needs genapi to thread `context.Context` through `MCPServerInterface.Query`/`mcpx.Tool`/`mcpx.SetAuthVerifier`; the per-goroutine ctx stash is a workaround | (1) file the genapi issue; (2) `make generate` in geode-ui; (3) replace the `mcpQueryContext()` shim with the natively-threaded ctx; (4) keep `internal/server/mcp_profile_test.go` green; (5) close #132 |
| F5 / PERF-2026-05-11-03 | #133 | **Open (upstream genapi)** -- label `upstream::genapi` present | Fix lives in `~/src/devnw/go/genapi/obsx`; geode-ui code is generated | combine JSON+newline into one `Write`; `bufio.Writer` on stdout; skip `RedactSensitiveKeys` clone when no sensitive keys; pool the per-call map; add `BenchmarkLogAudit`; cut a genapi release; `make generate` in geode-ui; cross-link the genapi tracker; close #133 |
| F-AUTH-2 | #135 | **Open (upstream genapi)** -- label `upstream::genapi` present | Per-tool `required_roles` table in the MCP template; needs F-AUTH-1's verified context first | land #132's upstream context-threading → add `required_roles` emission to the MCP template → `make generate` in geode-ui → add per-tool-role tests → close #135 |
| Q38 | #180 | Open (trivial follow-up) | none -- `(*app).serve` already returns the shutdown error after `adf6b6f` | log/propagate the shutdown error from `run`; close #180 |

## Tests executed (by the implementers / verifier; re-confirmed ACCEPTED)

| Command | Result |
|---|---|
| `make go-test` (full Go suite, `GOEXPERIMENT=jsonv2`) | PASS |
| `go test -cover ./cmd/server/...` | PASS -- coverage 65.3% (was 4.0%) |
| `govulncheck ./...` | PASS -- "No vulnerabilities found" |
| Frontend Jest suite | PASS -- 426 tests (was 415) |
| `npm run electron:tsc` | PASS -- exit 0 |
| ESLint / Prettier / `go vet` / `gofmt -l` | PASS (clean on changed files) |

(The verifier ACCEPTED the full run; no test was re-run as part of this reporting/close-out step.)

## Security notes

- **F-SUP-1 (#148)** -- the `go1.26.3` bump retires 4 CALLED stdlib CVEs (HTML escaper bypass ×2, HTTP/2 SETTINGS infinite loop, `net.Dial` NUL panic); `govulncheck` is now clean. The sibling-repo half (`a7d63f3`) is on branch `codex/client-parity-sync` -- it must merge before `geode-client-go`'s `main` is clean.
- **F-INPUT-1 (#140)** -- the backslash-escape fix closes a divergence from the authoritative GQL escaper; control characters are still rejected outright (stricter than authoritative), so no widening of the accepted-input surface.
- **F-AUTH-1 (#132)** -- the in-repo mitigation (`c46e77e`) closes the cross-profile-data-access primitive over HTTP transports (the only transport that carries a JWT) and fails safe to "default" for non-HTTP transports; pinned by `TestMCPQuery_CrossProfileIsolation`. The full fix is tracked upstream; #132 stays open.
- **No new findings, no credential rotation required.** The remaining cohort security items (#72, #153, #143, #161) are out of scope for this run and stay open.

## Remaining blockers

- **`../geode-client-go` sibling-repo merge** -- `a7d63f3` (the `go1.26.3` bump there) is on branch `codex/client-parity-sync`, not `main`. A separate PR/merge in that repo is still outstanding. Next step: open/merge that PR so both repos are in lockstep.
- **Upstream genapi** -- F-AUTH-1 full fix (#132), F5/#133, F-AUTH-2 (#135) all need genapi changes; geode-ui regenerates once via `make generate` after each. The genapi trackers are pending; file them and back-link into `SECURITY_GAP_ANALYSIS.md` / `PERF_GAP_ANALYSIS.md`.

## Platform issues updated

| Finding | Issue | Action |
|---|---|---|
| F-SUP-1 | #148 | closed (commented `d464fe6`) |
| Q36 | #131 | closed (commented `210133e`) |
| Q35 | #129 | closed (commented `790cdcb`) |
| F-INPUT-1 | #140 | closed (commented `454d0ba`) |
| PERF-2026-05-11-01 | #128 | closed (commented `c4ef58c`) |
| PERF-2026-05-11-02 | #130 | closed (commented `4698645`) |
| PERF-2026-05-11-04 | #137 | closed (commented `4698645`) |
| PERF-2026-05-11-08 | #147 | closed (commented `4698645`) |
| Q25 | #170 | closed (commented `f444c70`) |
| F-SUP-4 | #160 | closed (commented `f444c70`) |
| Q16 | #158 | closed (commented `adf6b6f`) |
| Q26 | #172 | closed (commented `adf6b6f`) |
| F-AUTH-1 (full fix) | #132 | commented (mitigated `c46e77e`; stays open pending upstream genapi) |
| F5 / PERF-2026-05-11-03 | #133 | commented (deferred upstream genapi; `upstream::genapi` label present) |
| F-AUTH-2 | #135 | commented (deferred upstream genapi; `upstream::genapi` label present) |
| Q38 | #180 | commented (now a trivial follow-up after `adf6b6f`) |

## Docs files updated this run

- `docs/SECURITY_GAP_ANALYSIS.md` -- F-SUP-1/#148, F-INPUT-1/#140, F-SUP-4/#160 marked Closed with SHAs; F-AUTH-1/#132 marked Mitigated-in-repo (full fix upstream-pending); F-AUTH-2/#135 marked Open (upstream genapi) with steps; release-blocker section + verdict + immediate-actions updated; upstream-genapi follow-ups expanded with unblock steps.
- `docs/PERF_GAP_ANALYSIS.md` -- PERF-2026-05-11-01/02/04/08 marked Closed with SHAs; single-render-storm bundle marked closed in `4698645`; schema-explorer-story bundle server-half closed (`c4ef58c`), renderer-half (#154) noted still open; #133 stays Open (upstream genapi) with unblock steps; summary-by-severity + top-5-risks updated.
- `docs/QUALITY_GAP_ANALYSIS.md` -- Q35/#129, Q36/#131, Q25/#170, Q16/#158, Q26/#172 marked Closed with SHAs + the new `cmd/server` coverage number; EPIC-Q1 marked closed (Q16+Q26), EPIC-Q2 marked partial; Q38/#180 noted now-trivial; tool-results table + category narratives + roadmap updated.
- `docs/GAP_ANALYSIS.md` -- GAP-009 note hardened (`f444c70`); new "Gap-closure run 2026-05-11 (audit-cohort)" section appended cross-referencing this report.
- `docs/GAP_ANALYSIS_RESOLVED.md` -- new "2026-05-11 closure run -- audit-cohort batch" section with per-finding resolution + evidence + the deferred-upstream block.
- `docs/gap-closure-reports/2026-05-11-audit-cohort-completion.md` -- this report (new).

## Verification

- `git status` -- clean tree after the docs-tracking commit (verified post-commit).
- 12 GitLab issues confirmed closed (#148, #131, #129, #140, #128, #130, #137, #147, #170, #160, #158, #172).
- #132, #133, #135 confirmed commented-but-open; #133 and #135 carry `upstream::genapi`; #132 also already carried it.
- No gap item in any `*GAP_ANALYSIS.md` file is left unaddressed or silently skipped -- every cohort item is either Closed with a SHA, Mitigated-open with an unblock path, or Open with documented next steps.
