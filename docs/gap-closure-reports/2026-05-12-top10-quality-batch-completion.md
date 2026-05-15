# Gap Closure Completion Report -- 2026-05-12 (top-10 quality / perf / CI batch)

- **Repository:** `devnw/codepros/geode/geode-ui`
- **Branch:** `main` (11 implementation commits + 1 docs-tracking commit, **unpushed** -- 12 commits ahead of `origin/main`)
- **Companion repo:** none this run (no genapi change)
- **Platform:** GitLab (`glab` as `benjiv`)
- **Verifier:** **ACCEPT-WITH-NOTES** -- full suite green (`make go-test -race`, `make go-lint`, `make generate` clean, `npm test` 453/453, `make bench-gate`); coverage up on every targeted package; no regressions. The one note (was `genapi@v0.3.0` the exact tag `gen/` was generated against?) is **resolved**: `git rev-parse v0.3.0^{commit}` in `~/src/devnw/go/genapi` == `55c79d2` == genapi `main` HEAD == the working copy `gen/` was regenerated against -- so the CI pin is correct; no follow-up there.
- **Run window:** 2026-05-12 `/codepros:gap-close` (second run of the day) -- landed the top-priority quality backlog (`Q9`/`Q39` streamQueryResult cleanup, `Q23` error-code taxonomy, `Q41` CONVENTIONS.md, `Q10` IsRevoked flatten, `Q12` Login decomposition, `Q13`/`Q40` WSServer.Query decomposition + cancel-reader lifetime, `Q22` list-endpoint empty-result rule, `Q38` graceful-shutdown error propagation, `Q32` CI tool-ref pinning) plus one perf quick-win (`PERF-2026-05-11-07` per-row `MarshalWrite`) and one security item (`F-INPUT-2` ciphertext truth-table). `F-SUP-3` was subsumed by `Q32`.
- **Companion docs:** [QUALITY_GAP_ANALYSIS.md](../QUALITY_GAP_ANALYSIS.md), [PERF_GAP_ANALYSIS.md](../PERF_GAP_ANALYSIS.md), [SECURITY_GAP_ANALYSIS.md](../SECURITY_GAP_ANALYSIS.md), [GAP_ANALYSIS.md](../GAP_ANALYSIS.md), [GAP_ANALYSIS_RESOLVED.md](../GAP_ANALYSIS_RESOLVED.md); prior runs: [2026-05-12-genapi-and-medium-cohort-completion.md](./2026-05-12-genapi-and-medium-cohort-completion.md), [2026-05-11-audit-cohort-completion.md](./2026-05-11-audit-cohort-completion.md), [2026-05-11-followup-completion.md](./2026-05-11-followup-completion.md), [2026-05-11-completion.md](./2026-05-11-completion.md), [2026-05-10-completion.md](./2026-05-10-completion.md)

## Summary

| Metric | Value |
|---|---|
| GitLab issues closed | **14** -- #125, #126, #127, #134, #136, #143, #144, #146, #149, #151, #153, #168, #180 (#127 + #153 by the same commit) |
| GitLab issues commented (cross-reference, not closed) | **1** -- #48 (coverage gate; touched packages all went up: `internal/server` 78.2%, `cmd/server` 70.7%, `internal/jwt` 82.5%, `internal/profilestore` 81.0%) |
| Closed-no-issue follow-ups | **1** -- `createProfile`'s `as any` request-body cast in `src/api/profiles.ts` removed (`2c5895d`) |
| geode-ui implementation commits | **11** on `main`, unpushed: `d35d3c7` (#127/#153), `2c5895d` (no-issue follow-up), `a42a792` (#125/#134/#145), `0d629bf` (#149/#151), `e510cb5` (#146), `6abde32` (#144), `ea3f681` (#143/#180), `df3fd51` (#126), `03b6ec1` (#168), `1fea7ba` (#136), `6c14368` (bench-baseline refresh) + **1** docs-tracking commit (this report + the 5 `*GAP_ANALYSIS*.md` updates) |
| Build / test status | GREEN (verifier ACCEPT-WITH-NOTES; the note resolved) |
| Pushed? | **No** -- the 12 geode-ui commits sit on `main` ahead of `origin/main`; the user decides on `git push origin main` |

## GAP_ANALYSIS status

| File | Closed (this run) | Commented-open | Remaining open (cohort) | Notes |
|---|---|---|---|---|
| `QUALITY_GAP_ANALYSIS.md` (Phase 4 cohort) | 11 -- Q9 #125, Q39 #134, Q23 #126, Q41 #136, Q10 #144, Q12 #146, Q13 #149, Q40 #151, Q22 #168, Q38 #180, Q32 #127 | 0 | the remaining Phase-4 backlog (#138, #141, #152, #155, #157, #162, #164, #166, #174–#191, plus gap-sync-owned #46/#48) | Phase 4 top-priority block now substantially cleared; EPIC-Q1 (`cmd/server`) fully closed; EPIC-Q2 (CI gating) mostly closed; EPIC-Q3 anchors (Q22/Q23/Q41) all landed |
| `PERF_GAP_ANALYSIS.md` (Audit-2026-05-11 cohort) | 1 -- PERF-2026-05-11-07 #145 | 0 | #139 (in-repo P2), #165 (in-repo P3), #163/#167/#169/#171 (upstream-genapi P3s) | #159 stays Open (blocked on product; documented in `docs/ARCHITECTURE.md`) |
| `SECURITY_GAP_ANALYSIS.md` (Audit-2026-05-11 cohort) | 2 -- F-SUP-3 #153, F-INPUT-2 #143 | 0 | F-SUP-2 #72 (dev-only serialize-javascript), F-SUP-5 #161 (doc placeholder) | the codesign-windows-ssl pin remains pending an upstream ci-catalog release -- carried forward via the `# ci-pins-allow:` marker + #127's `TODO`, not a security issue |
| `GAP_ANALYSIS.md` | 0 with a `GAP-NNN` ID (all 13 issues tracked by domain ID) | 0 | unchanged backlog | added a "Gap-closure run -- 2026-05-12 (top-10 quality/perf/CI batch)" subsection |
| `GAP_ANALYSIS_RESOLVED.md` | +13 resolved entries appended (11 quality, 1 perf, 1 security) + the no-issue follow-up + the index line | -- | -- | -- |

**Overall:** 14 issues closed (13 distinct findings + #153 subsumed by #127), 1 no-issue follow-up closed, 0 blocked-without-path, 0 won't-do, 0 deferred this run. The only deferred-on-product item (#159) was already deferred in the prior 2026-05-12 run and is unchanged.

## Closed items

| GitLab # | Domain / ID | Title | Commit(s) | Evidence |
|---|---|---|---|---|
| #125 | Quality / Q9 | `streamQueryResult` cognitive 38 -- extract `errWriter` shim | `a42a792` | `internal/server/result_codec.go`: `errWriter` first-error-latching shim; `streamQueryResult` flattened (gocognit < ~20; golangci-lint 0 issues); `writeTrailer()` helper. Tests: `result_codec_test.go`. |
| #134 | Quality / Q39 | `streamQueryResult` mid-stream truncation logs no rows_sent/elapsed_ms | `a42a792` | `internal/server/result_codec.go`: `midStreamAbort()` emits `slog.Warn` on every post-head error path (`stage`/`rows_sent`/`elapsed_ms`/`err`). Test: `result_codec_stream_test.go` +slog-capture assertion in `TestStreamQueryResult_MidStreamError`. (Same commit as #125 + #145.) |
| #145 | Perf / PERF-2026-05-11-07 | per-row `json.Marshal` allocates fresh `[]byte` -- use `MarshalWrite` | `a42a792` (+ `6c14368` baseline refresh) | `internal/server/result_codec.go`: per-row `json.MarshalWrite(bw, row)` (one `[]byte`/row removed -- 256-row box 3646→3389 allocs/op, 183648→147212 B/op). Tests: `BenchmarkStreamQueryResult_PerRowAlloc`. `scripts/bench-gate.sh` skips the `geomean` row in its check; `bench-baseline.txt` regenerated (`-count=6`) in `6c14368`. |
| #126 | Quality / Q23 | Centralise error-code taxonomy (`internal/server/errorcodes.go`) | `df3fd51` | new `internal/server/errorcodes.go`: 62 `ErrCode*` constants grouped by area + `allErrorCodes`/`errorCodeSet`. ~100 literal occurrences (38 distinct codes) migrated across 17 handler/helper files -- **wire values byte-identical** (verified `ErrCodeInvalidCredentials == "invalid_credentials"` etc., no drift). new `errorcodes_test.go`: dep-free `go/ast` golden test asserting every `code:`/`Code:`-position literal is an `ErrCode*` constant + no dead constants (verified it catches a planted straggler). |
| #136 | Quality / Q41 | Add `internal/server/CONVENTIONS.md` (invariants index) | `1fea7ba` | new `internal/server/CONVENTIONS.md` (6 `file`-cited sections: error-code taxonomy → `errorcodes.go`; empty-result rule + the single-resource-404 split; wire-feature-missing fallback + `errWireFeatureMissing` sentinel; per-row dual-key forward-compat in `policyFromRow`/`roleFromRow`; `auditEvent*` naming + `emitAudit` best-effort + substring redaction; the `withConnDBAndIdent`/`writeEndpointError`/`badRequest` envelope helpers + the JWT→connDB→quoted-ident admin-RBAC skeleton). `README.md` pointer added; markdownlint clean. |
| #144 | Quality / Q10 | `IsRevoked` nestif 7 on every-request hot path | `6abde32` | `internal/jwt/revocation.go`: extracted `jtiRevoked(jti, now) bool` (preserves lazy-GC of expired entries + fail-closed non-`time.Time`→revoked) and `subjectRevokeAll(sub, iat) bool` (preserves `!iat.After(changedAt)`); `IsRevoked` flattened to two `if`s. Test: `revocation_test.go` +`TestIsRevoked_DefensiveNonTimeEntries`. `internal/jwt` cov 81.0% → 82.5%. |
| #146 | Quality / Q12 | `Login` handler 123 LOC, cognitive ~30 -- decompose | `e510cb5` | `internal/server/handlers_auth.go`: extracted `denyLogin(...)` (SEC-N10 constant-time path -- `performDummyCompare`→`emitAudit`→`respectLoginLatencyFloor`→`writeEndpointError(401)` order + arithmetic byte-preserved; `authStart` captured at the same point), `mintAndSetAuthCookie(...) int64` (SEC-F7 cookie attrs + `expires_in>=1` clamp), `adminRolesFor(...)`. Tests: `handlers_auth_test.go` +`TestAdminRolesFor`, +`TestMintAndSetAuthCookie`; pinning tests pass unchanged. Security-reviewed: no timing-profile change between success/failure paths. |
| #149 | Quality / Q13 | `WSServer.Query` 110 LOC -- extract reader+streamer | `0d629bf` | `internal/server/ws_query.go`: extracted `startCancelReader(conn, cancel, done) <-chan struct{}` (coordinator + bounded relay; selects on `<-done` so it exits on the happy path) and `streamRowsOverWS(conn, rows, cols, batcher) (int64, error)`; `Query` now `defer close(done)`s and is a thin sequencer. Test-only `onCancelReaderExit` hook; `errStreamAborted` sentinel. Tests: `ws_query_test.go` +`TestStartCancelReader_ExitsOnDone`, +`TestStartCancelReader_CancelsOnError`. `-race` clean, no goroutine leak. |
| #151 | Quality / Q40 | `WSServer.Query` cancel-reader goroutine outlives handler | `0d629bf` | fixed as part of the #149 decomposition: `startCancelReader` selects on `<-done` and `Query` `defer close(done)`s, so the cancel-reader goroutine no longer outlives the handler. Tests as for #149; `-race` clean, no leak. |
| #168 | Quality / Q22 | Empty-result handling inconsistent across list handlers | `03b6ec1` | new `internal/server/list_handlers_test.go`: asserts every list endpoint (`GetRoles`/`GetPolicies`/`GetBackups`/`GetUsers`/`GetMigrations`, schema lists, `Audit`) returns non-nil empty slices and renders `[]`/`{"...":[]}` not `null` -- both on empty result and on an `isWireFeatureMissing` upstream. **No production code changed:** all handlers already satisfied the invariant (audited + verified the test fails when a regression is introduced). |
| #180 | Quality / Q38 | `cmd/server` shutdown error swallowed silently | `ea3f681` | `cmd/server/app.go`: `errGracefulShutdown` sentinel + configurable `shutdownBudget` field (default 5s); `serve` wraps the `Shutdown` error (not discarded); `run` logs **WARN** for the shutdown-timeout case, ERROR for fatal listener errors. Verified no `_ = httpSrv.Shutdown(...)` anywhere. Test: `app_test.go` +`TestServe_GracefulShutdownErrorPropagates`. `cmd/server` cov 65.3% → 70.7%. (Same commit as F-INPUT-2 #143.) |
| #143 | Security / F-INPUT-2 | `unsealBytes` silently passes ciphertext when cipher unconfigured | `ea3f681` | `internal/profilestore/sqlite.go`: `unsealBytes`'s `cipher == nil` branch now `if IsCiphertext(raw) { return "", fmt.Errorf("profilestore: ciphertext present but no cipher configured") }`; plaintext + empty pass through unchanged; the 4 sensitive-column reads still work; the prior #150 `dbRO` path unaffected. Test: `sqlite_test.go` +`TestUnsealBytes_FailsLoudWithoutCipher`. `internal/profilestore` cov 80.7% → 81.0%. Defense-in-depth -- production still fail-fasts on a missing `GEODE_PROFILESTORE_KEY` at store construction. |
| #127 | Quality / Q32 | CI installs tools with `@latest`/`@~latest` -- pin | `d35d3c7` | `.gitlab-ci.yml`: `genapi@v0.3.0` (verified == genapi `main` HEAD `55c79d2`, the tree `gen/` was generated against), `golangci-lint@v2.12.2`, `benchstat@v0.0.0-20260409210113-…`. `codesign-windows-ssl@~latest` left unpinned with a `# ci-pins-allow:` marker + `TODO(#127)` -- see deviation below. New `scripts/check-ci-pins.sh` guard wired into `.pre-commit-config.yaml` + a `ci-pins-check` CI lint job. |
| #153 | Security / F-SUP-3 | CI components pinned to floating refs | `d35d3c7` | Subsumed by #127 -- 3 of the 4 floats pinned to immutable tags; the 4th (`codesign-windows-ssl`) carries the `# ci-pins-allow:` marker + `TODO(#127)` so the new `scripts/check-ci-pins.sh` guard still catches *new* `@latest` regressions. Decision: **closed #153** since the substantive ref-pinning work is done; the remaining codesign-pin follow-up is tracked under #127's TODO + the in-file marker (no value in keeping #153 open for one line that's blocked on an upstream catalog release). |
| -- | Quality (api-contract) / no issue | `createProfile`'s `as any` request-body cast | `2c5895d` | `src/api/profiles.ts`: `toWireCreateRequest` return type → `CreateProfileReq` (imported from `@api`); `as any` removed at `client.postProfiles(...)`. The other `listProfiles`/`fromWireProfile` casts (tracked under Q2/#90) deliberately left alone. No GitLab issue exists for this -- closed-no-issue follow-up; it closes the loose end noted in the 2026-05-12 genapi-batch report. |

## Won't Do items

None this run.

## Blocked / deferred items

None new this run. (#159 / PERF-2026-05-11-12 -- `/api/v1/query rateLimit=200` vs ~2000-rps target -- remains deferred on a product decision from the prior 2026-05-12 run; documented in `docs/ARCHITECTURE.md`; not in scope here.)

## Deviation -- `codesign-windows-ssl` ci-catalog ref

`Q32` / `F-SUP-3` asked for *all* floating CI refs to be pinned to immutable tags. Three of the four (`genapi`, `golangci-lint`, `benchstat`) were pinned. The fourth -- the `codesign-windows-ssl` ci-catalog component referenced at `.gitlab-ci.yml:24` -- could **not** be pinned because no tagged ci-catalog release ships that component yet (it exists only on the catalog's `main`). This is pre-existing: `glab ci lint` failed on that line before this change too. Mitigation:

- the ref carries an explicit `# ci-pins-allow: codesign-windows-ssl awaiting tagged ci-catalog release -- see #127` marker plus a `TODO(#127)` comment;
- the new `scripts/check-ci-pins.sh` guard treats `# ci-pins-allow:`-marked lines as a known exception, so it still fails on *new* unmarked `@latest`/`@~latest` refs;
- the codesign-pin follow-up is tracked via the marker + #127's TODO (rather than re-filing a separate issue).

When the ci-catalog tags a release that includes `codesign-windows-ssl`, bump the ref and delete the marker line; the guard then enforces it like the others.

## Tests executed (verifier-reported)

| Command | Result |
|---|---|
| `make go-test` (`-race`) | PASS (full suite green, no regressions) |
| `make go-lint` | PASS (golangci-lint 0 issues on touched files) |
| `make generate` | PASS (clean -- `gen/` matches genapi `v0.3.0` == `main` HEAD `55c79d2`) |
| `npm test` | PASS (453/453) |
| `make bench-gate` | PASS (no >10% regression vs the refreshed `bench-baseline.txt`) |

Coverage deltas (all up): `internal/server` 77.1% → **78.2%**; `internal/jwt` 81.0% → **82.5%**; `internal/profilestore` 80.7% → **81.0%**; `cmd/server` 65.3% → **70.7%**.

## Security notes

- **F-INPUT-2 (#143)** -- `unsealBytes` now fails loud (`fmt.Errorf("profilestore: ciphertext present but no cipher configured")`) when `cipher == nil && IsCiphertext(raw)`; plaintext + empty values still pass through. This is defense-in-depth: production still fail-fasts on a missing `GEODE_PROFILESTORE_KEY` at store construction, so the new branch is a belt-and-braces guard for the `cipher == nil` truth-table corner that S5 (#118) left open. Pinned by `TestUnsealBytes_FailsLoudWithoutCipher`.
- **F-SUP-3 (#153)** -- 3/4 floating CI refs pinned to immutable tags (`genapi@v0.3.0`, `golangci-lint@v2.12.2`, `benchstat@…`), shrinking the upstream-takeover surface. The 4th (`codesign-windows-ssl`) is the documented deviation above. The new `scripts/check-ci-pins.sh` guard + `ci-pins-check` job prevent regressions.
- **Q12 (#146)** -- the `Login` decomposition was security-reviewed: the SEC-N10 constant-time failure path (`denyLogin`) preserves the `performDummyCompare`→`emitAudit`→`respectLoginLatencyFloor`→`writeEndpointError(401)` order and the latency-floor arithmetic byte-for-byte; `authStart` is captured at the same point; the success path is unchanged. No timing-profile change between success and failure. SEC-F7 cookie attributes (and the `expires_in>=1` clamp) are preserved in `mintAndSetAuthCookie`.
- **Q10 (#144)** -- the `IsRevoked` flatten preserves the fail-closed semantics (a non-`time.Time` entry is treated as revoked; expired entries are lazily GC'd) -- pinned by `TestIsRevoked_DefensiveNonTimeEntries`.
- No production credentials leaked; no active RCE path identified.

## Remaining blockers

None. The only deferred-on-product item (#159) was deferred in the prior run and is intentional.

## Follow-up notes

- **`src/lib/errors.ts` ↔ `internal/server/errorcodes.go` cross-check** -- the frontend error-code strings and the new server-side `ErrCode*` constants are not cross-checked by any automated test. A tiny `go/ast` ↔ TS-string consistency check would close that gap; recorded here and in `QUALITY_GAP_ANALYSIS.md`. Not ticketed (no convention exists yet).
- **`createProfile` `as any` follow-up** -- closed this run (`2c5895d`); was the loose end from the 2026-05-12 genapi batch (Q02/#90 closed the path-param casts; this was the separate request-body cast).
- **`codesign-windows-ssl` pin** -- pending an upstream ci-catalog tagged release (see Deviation above).

## Platform issues updated

| GitLab # | Action |
|---|---|
| #125 | commented (closure evidence) + closed |
| #126 | commented + closed |
| #127 | commented + closed |
| #134 | commented + closed |
| #136 | commented + closed |
| #143 | commented + closed |
| #144 | commented + closed |
| #146 | commented + closed |
| #149 | commented + closed |
| #151 | commented + closed |
| #153 | commented (3/4 floats pinned; codesign pin pending an upstream catalog tag -- tracked via the `# ci-pins-allow:` marker + #127's TODO) + closed |
| #168 | commented + closed |
| #180 | commented + closed |
| #48 | commented (coverage gate stays open; the touched packages all went up) -- NOT closed |

## Handoff

**12 geode-ui commits (11 implementation + 1 docs-tracking) sit on `main` unpushed; the user decides on `git push origin main`.** No genapi change in this run -- the `genapi@v0.3.0` CI pin matches the existing genapi `main` HEAD (`55c79d2`) that `gen/` was already generated against, so there is no companion-repo push to coordinate. The only carried-forward follow-ups are the `codesign-windows-ssl` ci-catalog pin (blocked on an upstream tagged release; tracked via the in-file marker + #127's TODO) and the optional `src/lib/errors.ts` ↔ `errorcodes.go` cross-check (not ticketed). #159 stays deferred on a product decision.
