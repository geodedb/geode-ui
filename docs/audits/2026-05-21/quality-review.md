# Quality Review — geode-ui

- **Date:** 2026-05-21
- **Branch:** `main` (clean at `1199648`; one user-applied diff to
  `src/pages/DashboardPage.test.tsx` closes the ESLint blocker noted in
  `quality-scan.md`).
- **Repo root:** `/data/home/benji/src/gl/gitlab.com/devnw/codepros/geode/geode-ui`
- **Scope:** Deep, evidence-based review for readability, maintainability,
  API/contract consistency, reliability enablers, and documentation —
  beyond what linters catch. **Read-only**: no source modifications.
- **Inputs:** `quality-inventory.md`, `quality-scan.md`, repo source,
  `internal/server/CONVENTIONS.md`, `docs/adr/`, `package.json`,
  `node_modules/*/package.json` (transitive-dep resolution only).

Findings are tagged `confidence::confirmed` when verified end-to-end
against source, or `confidence::suspected` when the symptom is direct
but a follow-up (profiling / contract diff / runtime check) is needed
to seal it. Severity is the reviewer's read of impact * likelihood;
the scanner already owns the "is a tool currently failing" axis.

## Summary Counts

| Category | Confirmed | Suspected | Total |
|---|---:|---:|---:|
| Readability & Maintainability | 8 | 2 | 10 |
| API & Contract Consistency | 4 | 2 | 6 |
| Reliability Enablers | 5 | 2 | 7 |
| Documentation | 4 | 1 | 5 |
| **Total** | **21** | **7** | **28** |

No new blockers beyond those `quality-scan.md` already records (4
confirmed CI-blocking failures; ESLint blocker now closed by the
user-applied diff per task brief). The reviewer recommends one
INFO->blocker promotion (Q-R-08, doc-routes self-collision is a
recurring CI breakage that will fire on every audit run until the
allow-list is widened).

---

## Readability & Maintainability

| ID | Finding | File:Line | Root Cause | Impact | Confidence |
|---|---|---|---|---|---|
| Q-R-01 | `result_codec.go` mixes 5 concerns (pool primitives, fast-marshal, errWriter, streamQueryResult/scanQueryResult, GraphSummary projection) in a single 828-LOC file with 14 funcs + 7 types. The file-level header (`PERF #217: result codec per-row JSON allocation pools.`) describes only the pooling concern; the GraphSummary projection at the tail (`GraphNode`/`GraphEdge`/`graphSummaryAccum`/`extractGraphSummary`, lines 619-828) is a logically separate module and is already separately tested. | `internal/server/result_codec.go:1,619-828` | Organic accretion of three perf passes (#217, #219, #145, #281) onto a streaming codec that also carries the graph-projection logic | Reader has to hold 5 mental models to navigate one file; future PERF passes will keep growing it. Split into `result_codec_stream.go` + `result_codec_pools.go` + `graph_summary.go` keeps the package layout flat (current convention) while letting each file declare ONE concern in its leading comment. | confidence::confirmed |
| Q-R-02 | `loginlimiter.go` (823 LOC) holds the limiter algorithm, the per-IP/per-user COW maps, the http.Handler wrapper, the multipart `peekLoginCreds` parser, the IP/XFF resolver, and the TTL janitor — six concerns. `peekLoginCreds` + `WrapLoginLimit` + `statusWriter` + `rejectLogin` (lines 407-505) are HTTP-layer code; the COW map + janitor + `trimOldest*` (lines 311-368, 583-770) is data-structure code. | `internal/server/loginlimiter.go:1,407-505,583-770` | Originated as one file per SEC-F2/N7 fix; six follow-up PRs (PERF #220, #225, S-NEW-5, S-NEW-F, GAP-N10) layered on without a split. | Same as Q-R-01 — readability tax and split-friction grows linearly with each follow-up. Recommendation: extract `loginlimiter_wrap.go` (HTTP middleware + cred peek), `loginlimiter_janitor.go` (TTL prune + cap-trim) — leaves the data-structure file at ~350 LOC. | confidence::confirmed |
| Q-R-03 | `cmd/server/app.go:newApp` is 138 LOC despite the deliberate split commentary (`see app_issuer.go for the full split map`). Lines 200-310 are a flat numbered sequence (`(1) JWT issuer`, `(2) Bootstrap profiles`, … `(8) Rate limiters`) with each step inline; `(2)`, `(3)`, `(5)`, `(8)` are pure orchestration that already delegate to other files. Steps `(2)` and `(5)` (profiles + seed-from-store) are the only ones still inline-coded and account for ~30 LOC. | `cmd/server/app.go:190-313` | `newApp` was decomposed into helpers (`buildIssuer`, `buildRateLimiters`, `registerRoutes`, `wrapMiddlewareChain`) but the bootstrap-profiles and seed-from-store steps were left inline. | The function is exactly at the "I have to scroll to read the next step" threshold. Extracting `buildProfilesAndPool(cfg) (*conn.Pool, []conn.Profile, error)` + folding the rewrap/seed/reload into `bootstrapProfileStore(cfg, pool, issuer) (...)` would land `newApp` under the comfortable 80-LOC mark; the prose at lines 184-189 already documents the intended split. | confidence::confirmed |
| Q-R-04 | `src/pages/QueryPage.tsx` (727 LOC) carries: 7 styled-components, the `streamStateToResp` converter, 15 store selectors, an rAF throttle reducer, 4 useEffect blocks doing auth/staged-statement/deep-link/history side effects, two run paths (`runSync` + `runStream`), and the JSX. The 4 useEffects (lines 215-348, 460-509) and the rAF throttle (lines 468-509) are independently testable hooks that don't reach into JSX state. | `src/pages/QueryPage.tsx:155-727` | Page-level component absorbs cross-cutting query lifecycle logic that no other page needs but two of its children could observe via hook. | Hook-extraction (`useStagedStatementInjection`, `useDeepLinkStatement`, `useStreamHistoryRecorder`, `useThrottledStreamVersion`) would (a) shrink QueryPage to ~350 LOC, (b) make each effect independently testable without rendering the whole page, (c) eliminate the `[]` mount-only effect (line 307-308) which currently swallows a lint suppression. | confidence::confirmed |
| Q-R-05 | `streamRespToResp`, `streamStateToResp`, and the rAF throttle pattern (PERF-2026-05-17-02 / #239) sit inside `QueryPage.tsx` but conceptually belong to the queryStream subsystem. The throttle is a generic "coalesce React state per animation frame" — it appears nowhere else but the comment block (lines 468-498) reads like a reusable primitive. | `src/pages/QueryPage.tsx:146-153,468-520` | Lifted into the page during the PERF #239 fix without a hook seam. | Low — but if the dashboard / ops pages later add streaming results they will copy-paste this. Lift to `src/lib/useRafThrottledVersion.ts`. | confidence::suspected |
| Q-R-06 | `magic numbers` in `TableView.tsx`: `ROW_HEIGHT_MIN`/`MAX`/`ROW_LINE_HEIGHT`/`APPROX_CHARS_PER_COLUMN`/`MIN_COLUMN_PX`/`APPROX_CHAR_PX`/`CELL_PADDING_PX`/`VIRTUAL_BODY_MIN`/`HEADER_BUDGET_PX` are all constants in this file (good) but the same kind of layout constants live in `useTableBodySize.ts` (e.g. fallback heights) and `GraphView*` (`OVERFLOW_NOTICE_PAD`, etc.). No shared `src/components/results/layoutConstants.ts` exists. The repo's `theme/` is already the sanctioned home for color tokens. | `src/components/results/TableView.tsx:56-74` | Per-component constants drifted out of `src/theme/` because they're behavioural not visual. | If a future product spec asks "compact mode = 28 px row floor", the change is multi-file. Centralising the row-height + chip-padding constants in one location is cheap; the `lint:hardcoded-styles` guard does not apply here because these are integers, not color/border literals. | confidence::suspected |
| Q-R-07 | `as unknown as` cast count: 50+ in `src/` (counted by grep). Most are legitimate — cytoscape plugin types (`spread as unknown as cytoscape.Ext`, layouts.ts:74/82/95), @lit/react ForwardRef widening, worker `self as unknown as { postMessage }`. But `src/lib/docs/index.ts:39-57` casts every markdown import (`as unknown as string`) — that's a webpack-loader contract that ought to be solved via a `markdownMock`/`*.md` type declaration once, not 6 times. | `src/lib/docs/index.ts:39-57` | Webpack raw-loader emits `string` at runtime but the TS type is `unknown` due to mock-aware tsconfig. | Each `as unknown as string` is a load-bearing assertion the type system can't check. Adding `declare module '*.md' { const content: string; export default content }` to `src/types/` removes the casts. | confidence::confirmed |
| Q-R-08 | `src/services/webawesome/components.ts` (11 wrappers, 415 LOC) repeats the same `createComponent({…}) as unknown as React.ForwardRefExoticComponent<…>` pattern with hand-typed prop intersections per wrapper. The `Input`, `Checkbox`, `Select`, `Option`, `Dialog`, `TabGroup`, `Tab`, `TabPanel`, `Dropdown`, `DropdownItem` blocks have a near-identical shape (10-30 LOC each); the only thing changing is the event map + props bag. | `src/services/webawesome/components.ts:73-403` | createComponent + @lit/react event-typing surface forces hand-written intersections; no generic wrapper helper was introduced. | A small `createWaComponent<TProps, TEvents>(tagName, elementClass, events)` helper that returns the cast `ForwardRefExoticComponent` from a single place would (a) collapse boilerplate, (b) make the `as unknown as` rationale documented in ONE spot, (c) ease future component additions. | confidence::confirmed |
| Q-R-09 | The `scanQueryResult` (564) and `streamQueryResult` (408) functions in `result_codec.go` share a row-drain loop with a near-identical body: acquireRowScratch + summary.visitRow(row) + scan + marshal. Only the output sink (HTTP body vs `[]jsontext.Value`) differs. | `internal/server/result_codec.go:408-527,564-616` | Streaming path was forked from the sync path at PERF-F3; the shared inner loop was never extracted. | A `drainRowsInto(rows, cols, sink)` helper that takes a callback (or a small interface) would let the two callers diverge only on the sink. golangci-lint's `dupl` is set at ≥200 tokens and didn't fire, but the duplication is conceptual; collapsing it removes the risk that a perf bug fixed in one half lingers in the other (already happened once during the #217 rollout). | confidence::confirmed |
| Q-R-10 | `useMetricsPolling.ts` (lines 127-129, 140) fires `tick().catch(() => {})` three times. `tick()` is doc-commented as "failures are swallowed into setError/setState inside the function itself, so awaiting would just block the effect" (line 124-126) but the empty .catch is still a paper-handle on rejections that escape the inner try (e.g. a synchronous throw from `setHistory(...)`). | `src/lib/useMetricsPolling.ts:127-140` | Defensive boilerplate kept after the inner-try-catch landed. | If a future refactor moves a throwable out of the try block, the empty catch silently consumes it. Replace with `tick().catch((err) => { console.error('[metrics] tick threw', err) })` so the unhandled path is observable. | confidence::suspected |

## API & Contract Consistency

| ID | Finding | File:Line | Root Cause | Impact | Confidence |
|---|---|---|---|---|---|
| Q-A-01 | `serverErrorCodes.ts` mirrors only 3 of the ~50 error codes in `internal/server/errorcodes.go`. The mirror's contract (per `scripts/check-error-codes.mjs`) only enforces that values in the SPA file still exist in the Go file — it does NOT enforce reverse coverage, so the SPA can silently fall behind. Codes like `EMPTY_PATCH`, `WIRE_FEATURE_MISSING`, `CONFLICT` are SPA-branchable; codes like `password_pwned`, `password_too_short`, `user_locked` are also branchable (the SPA should arguably render distinct UI for them) but aren't mirrored. | `src/api/serverErrorCodes.ts:1-31` vs. `internal/server/errorcodes.go:27-...` | Mirror was created lazily — only codes the SPA branched on at the time were captured. | Low today, but every new branchable error in the SPA pays the "what did Go call this?" tax. The check-error-codes guard is one-directional; a complementary check that the SPA-side branch-table at least contains the `auth/*`, `password/*`, and `tx_*` families would catch missing mirrors before they ship. | confidence::confirmed |
| Q-A-02 | `package.json:94` lists `vscode-languageserver-protocol@^3.17.5` as a direct runtime dep. Verified: no `src/`, `e2e/`, `electron/`, `scripts/`, or `packages/` file imports the package. `node_modules/vscode-languageclient/package.json` already pins `vscode-languageserver-protocol@3.17.5` as a transitive dep, so removing the direct entry does not affect resolution. Same applies to `@popperjs/core` (line 70) — only `packages/ui-core/storybook-static/sb-manager/globals-runtime.js` (vendored) references it; `src/services/bootstrap/Dropdown.tsx` deliberately re-implements the dropdown to avoid Popper. | `package.json:67,94` | Dependency declarations left over from earlier integration paths. | Confirms the scan's INFO. Removing both saves ~MB on `npm install` and removes the maintenance-of-pin obligation. Recommend removing `vscode-languageserver-protocol` outright (transitive resolution is byte-identical), and `@popperjs/core` if Storybook truly does not need it at runtime (verify Storybook build still passes locally). | confidence::confirmed |
| Q-A-03 | The SPA calls `client.query` (auto-generated, no AbortSignal) and works around the lack of cancellation with a monotonic `runSyncGenRef` counter (`src/pages/QueryPage.tsx:204`). This is a known genapi gap (the comment says "QUAL #289"). The same pattern likely exists for other long-running GETs. | `src/pages/QueryPage.tsx:195-228, 376-409` | Generated client does not surface `AbortSignal` on its method signatures. | Forces a stale-result discard pattern at every call site that needs cancellation. Track as a genapi follow-up; the SPA's workaround is correct today but should not be the long-term shape. Until then, codify the `runGenRef` pattern in `docs/adr/` so the next page that needs cancellation copies the exact discipline rather than re-inventing a half-baked alternative. | confidence::confirmed |
| Q-A-04 | `src/api/client.ts` uses a `COOKIE_MODE_PLACEHOLDER = '__cookie_mode_placeholder__'` string to satisfy the generated client's non-empty bearer guard, then strips the resulting `Authorization` header in `makeFetchImpl`. The placeholder leaks across all generated calls in cookie-mode; if a future server-side validator decides to log received bearer tokens, this string will appear in logs. | `src/api/client.ts:49-56,71-79` | Generated client doesn't model cookie-auth as a first-class mode. | Low (the wrapper strips the header before the fetch fires), but the discipline is fragile — a wrapper bypass (e.g. someone using `fetch` directly with the client's `bearerToken()` getter) would leak the literal. Document the contract on the constant. Track the structural fix in genapi (cookie-auth mode). | confidence::confirmed |
| Q-A-05 | The `QueryResp` contract has `columns: Array<Record<string, unknown>>` in the SPA-side stream cast (`src/pages/QueryPage.tsx:148`) but `[]jsontext.Value` on the Go side (`internal/server/result_codec.go:609`). They serialise to the same wire shape, but the type drift means the SPA can't validate the `{name, type}` columnar shape without an explicit `as`. The genapi-generated `@api` types ought to express it as `Array<ColumnDescriptor>` with `{ name: string; type: string }`. | `src/pages/QueryPage.tsx:148` vs. `internal/server/result_codec.go:619-639,609` | The QueryResp shape is hand-marshalled with `jsontext.Value` so the wire is unconstrained; the genapi schema lost the column-descriptor strictness somewhere. | Column type narrowing is then re-implemented per consumer (`TableView.columnName`, `JsonView`, `MatrixView`). Pin the column-descriptor type in `geode.json` so all three consumers consume the same shape. | confidence::suspected |
| Q-A-06 | `internal/server/handlers_uploads.go:85-178` (stageUpload) returns `(*gentypes.UploadResp, nil)` after writing its OWN response body for the error case (status 4xx/5xx via `writeEndpointError`). The genapi wrapper sees `(nil, nil)` and writes nothing further — but a future genapi version that branches on a 200 default for `(nil, nil)` would regress this. The same `(nil, nil) = "handler owns response"` convention appears in 8 places across `internal/server/handlers_*`. | `internal/server/handlers_uploads.go:85-178` | genapi wrapper contract documents `(value, nil) = 200; (nil, err) = mapped status; (nil, nil) = wrapper writes nothing` but the convention is informal. | Forward-compat risk. Document the `(nil, nil)` convention in `internal/server/CONVENTIONS.md` (it's not in there today — only "envelope helpers" at §6 is close). Add a golden test that pins the wrapper's `(nil, nil)` semantic. | confidence::confirmed |

## Reliability Enablers

| ID | Finding | File:Line | Root Cause | Impact | Confidence |
|---|---|---|---|---|---|
| Q-L-01 | Jest worker-leak warning (`A worker process has failed to exit gracefully and has been force exited`) reproduces on `npm test -- --ci`. Pre-existing per the scan; the most likely culprits are the LSP `client.test.ts` / `format.test.ts` / `websocketTransport.test.ts` cohort which mocks `vscode-ws-jsonrpc` with stubs that don't release a fake timer, or the `queryStreamWorker` tests. None of these are gated by a per-test `afterEach(() => jest.useRealTimers())`. | `src/lib/lsp/__tests__/*.test.ts` (suspected; not yet localised) | A test creates a Worker / timer / WebSocket mock and doesn't `.unref()` or clear it in `afterEach`. | Today: warning only, tests pass. Long term: as the suite grows, every test that adds a new untracked timer pushes the suite closer to a true `--detectOpenHandles` failure. `npm test -- --detectOpenHandles` will localise this in <30s. | confidence::suspected |
| Q-L-02 | `tick().catch(() => {})` in `useMetricsPolling.ts:127,129,140` swallows rejected promises silently. Same pattern in `useGraphNodeActions.ts:86` (`navigator.clipboard.writeText(id).catch(() => {})`). If `clipboard.writeText` throws synchronously (Safari permission denial) or the polling tick rethrows from the outer try, the user gets a "copy" button that silently fails. | `src/lib/useMetricsPolling.ts:127,129,140`, `src/components/results/graph/useGraphNodeActions.ts:86` | Defensive boilerplate added to satisfy lint without observability. | Low — but the `clipboard.writeText` case is user-visible. Either toast on failure or `console.warn(err)` so the failure is observable in DevTools without a regression. | confidence::confirmed |
| Q-L-03 | Tests are well-structured (no `toMatchSnapshot` in `src/` — 0 hits; 547 `toBeInTheDocument`/`toMatchObject`/`toEqual` vs. 735 `toBe`). But there are no observability assertions in the streaming-query test surface: `result_codec_test.go` pins byte-output and row counts but does NOT pin the `Server-Timing: db;dur=X.X` header or the `X-Server-Timing-Marshal` trailer that PERF-N4 / #281 promised. A regression in trailer-prefix semantics across `net/http` versions would not be caught. | `internal/server/result_codec_test.go` (file inspected; no `Server-Timing` reference) vs. `internal/server/result_codec.go:431-525` | Test added for the perf optimization but not for the observability headers shipped alongside. | Server-Timing header is a contract with the SPA's DevTools instrumentation; silent removal of `marshal;dur=` would not break a test. Add a single round-trip test that asserts both header + trailer keys are present and parse as `key;dur=<number>`. | confidence::confirmed |
| Q-L-04 | `peekLoginCreds` (`internal/server/loginlimiter.go:489-...`) silently returns `("","")` on a multipart body. The peek is documented (lines 494-499) — but the test cohort `loginlimiter_test.go` (455 LOC) does not appear to cover the multipart-body branch (`peekLoginCreds` is tested implicitly through `WrapLoginLimit` only). | `internal/server/loginlimiter.go:489-...`, `internal/server/loginlimiter_test.go` | The multipart shape was added in S-NEW-F (#317) to close a TOCTOU but the explicit branch lacks a unit test. | The S-NEW-F fix would silently regress if a future patch reorders the content-type detection. Add a unit-level test for `peekLoginCreds` with each of the three content-type branches: `application/x-www-form-urlencoded`, `multipart/form-data`, and the empty-body / wrong-content-type case. | confidence::suspected |
| Q-L-05 | `cmd/server/app.go:newApp` builds 8 cleanups via `a.cleanups = append(a.cleanups, func() { _ = pool.Close() })` (lines 222, 233). On a fatal-init failure between step (2) and step (8), the defer's `a.close()` unwinds them in append order. There is no documented LIFO/FIFO contract — and `a.close()` is invoked from BOTH the failure path (`ok = false; defer { if !ok { a.close() } }`) and the success-path shutdown. If a future cleanup needs to run AFTER a downstream cleanup (e.g. drain a goroutine before closing its pool), the discipline is implicit. | `cmd/server/app.go:222,233,253,304-312` and wherever `a.cleanups` is consumed | Append-and-iterate cleanup list without explicit order documentation. | Resource-leak risk if a future cleanup is added in the wrong order. Document the order contract in `cmd/server/app.go` (and confirm whether `a.close()` iterates forward or reverse). | confidence::confirmed |
| Q-L-06 | `LoginLimiter.NoteFail` (`internal/server/loginlimiter.go:373-385`) increments the counter under the bucket mutex but does NOT cap-check. A single attacker IP that hits a brand-new (profile, user) tuple can drive `count` upward without bound until the cap-trim path on insert fires; the eviction cap is on cardinality (entries in the map), not on counter magnitude. In practice `count` is read-only above `FailThreshold` (Allow short-circuits) so the unbounded counter is cosmetic, but an audit log emission keyed on `count` would surface the unboundedness. | `internal/server/loginlimiter.go:373-385` | The fail-counter is read-clamped, not write-clamped. | Cosmetic — but if a future audit handler reports "consecutive fails: <count>" to the operator, the value can grow to absurd numbers. Cap `count` at `FailThreshold * 2` (or whatever value the audit log meaningfully uses). | confidence::confirmed |
| Q-L-07 | `src/lib/queryStream.ts` (the streaming reducer) is mocked in 38 of the 164 Jest suites via `jest.mock('../lib/queryStream', ...)` — but the **production** worker path (`src/lib/queryStreamWorker.ts`) is mocked separately via a `moduleNameMapper` regex (`(^|/)queryStreamWorkerUrl$`). A test that mocks ONE but not the OTHER passes against the JSON path and silently bypasses the worker path. | `src/lib/queryStream.ts`, `src/lib/queryStreamWorker.ts`, `__test_utils__/queryStreamWorkerUrlMock.js` | Two mock surfaces evolved independently for the same module. | Low — but if the worker path diverges from the main-thread path semantically (e.g. NDJSON parser drift), the test suite will not catch it. Add ONE round-trip test (worker path enabled) that ingests the same bytes as the main-thread path and asserts identical reducer state. | confidence::confirmed |

## Documentation Gaps

| ID | Finding | File:Line | What's Missing | Impact | Confidence |
|---|---|---|---|---|---|
| Q-D-01 | `internal/server/CONVENTIONS.md` documents 6 invariants (error-code taxonomy, empty-result rule, wire-feature-missing fallback, dual-key, audit-event naming, envelope helpers) but does NOT cover the `(nil, nil) = "handler owns response"` convention used by `stageUpload` and 7 other handlers. The pattern is load-bearing for any upload/CSRF/login-style endpoint. | `internal/server/CONVENTIONS.md:1-133` (no §7 on handler-owns-response) | The convention exists in code; no doc. | A new handler that returns `(nil, &endpointError{...})` instead of writing inline and returning `(nil, nil)` will double-write the body. Add §7 to CONVENTIONS.md. | confidence::confirmed |
| Q-D-02 | No module-level READMEs in `src/`, `src/lib/`, `src/components/`, or `src/services/`. The repo has `internal/server/README.md` (layout map) + CONVENTIONS.md and `packages/ui-core/README.md`, but the SPA's high-level organisation (where do feature pages live? where do hooks vs. lib utilities go? what's the import direction?) is undocumented. The `lib/` directory mixes pure utilities (`adjacencyMatrix`, `cellFormat`, `passwordPolicy`) with hooks (`useMetricsPolling`, `useOverviewData`, `useQueryHistory`) — that distinction is convention, not architecture, and would be the first onboarding question for a new contributor. | `src/`, `src/lib/`, `src/components/`, `src/services/` | One `README.md` per top-level src tree explaining (a) intent, (b) import rules (e.g. lib never imports from components), (c) when to file in this tree vs. a sibling. | Onboarding friction; visible in the diversity of existing patterns. A 30-line README per tree is a one-evening task. | confidence::confirmed |
| Q-D-03 | Only 3 ADRs (`0000-record-architecture-decisions.md`, `0001-generated-api-boundary.md`, `0002-profile-store-dek-trust-model.md`) for a codebase with 95 Go files in `internal/server/` and a multi-stage build pipeline. The architectural decisions that absolutely warrant an ADR: (a) the cookie-mode vs. bearer-mode dual-auth shape (SEC-F7), (b) the WS row-batcher streaming protocol (PERF-F2 / #21), (c) the `runSync`-with-monotonic-counter cancellation convention (QUAL #289), (d) the cross-stack contract-mirror pattern (referenced as #261 in QUALITY_GAP_ANALYSIS.md). | `docs/adr/` | 4 ADRs deferred per QUALITY_GAP_ANALYSIS.md. | Architectural memory leaks into per-feature commit messages — already happened with the cookie-mode placeholder string (Q-A-04). | confidence::confirmed |
| Q-D-04 | The `TODO #122` in `src/auth/AuthProvider.tsx:293` is the only TODO in non-test source — but the comment doesn't say WHEN: "surface the Settings UI for forgetting a saved password". An issue reference (`TODO(#122):`) makes the link from comment -> tracker explicit. The codebase otherwise pins every comment to a tracker ID; this one is the outlier. | `src/auth/AuthProvider.tsx:293` | Single drift from the otherwise-uniform `(#NNN)` convention. | Trivial. Normalise to `// TODO(#122): surface the Settings UI ...`. | confidence::confirmed |
| Q-D-05 | `internal/server/result_codec.go`'s leading comment (lines 22-44) describes PERF #217's pooling concern but the file ALSO carries the GraphSummary projection (619-828) and the Server-Timing header emission (431-525, PERF-N4 / #281). A reader who only reads the file header will miss two major concerns. Once split per Q-R-01, this resolves itself; until then, expand the file header to enumerate all four concerns. | `internal/server/result_codec.go:22-44` | Header doc was last updated during the PERF #217 pass and hasn't kept up with #145 / #219 / #281. | A reviewer can plausibly mistake the file for "only the pool code"; the GraphSummary projection at the tail is easy to miss. | confidence::suspected |

---

## Verification Plan (per finding)

| ID | How to verify the fix |
|---|---|
| Q-R-01 | Split, run `go build ./...`, `go test -race ./internal/server/...`, `make go-lint`. No public symbol moves. |
| Q-R-02 | Same as Q-R-01 — package-private symbols only. |
| Q-R-03 | Same. Add a single `app_bootstrap_test.go` exercise to confirm extracted helpers fail closed on individual error injection. |
| Q-R-04 | Hook tests (`useStagedStatementInjection.test.tsx` etc.) added; QueryPage rendering test cohort still green. |
| Q-R-05 | New `src/lib/useRafThrottledVersion.test.ts`. |
| Q-R-06 | Shared `layoutConstants.ts` + lint:hardcoded-styles still green. |
| Q-R-07 | Add `src/types/markdown.d.ts`, drop the 6 casts. `tsc --noEmit` green. |
| Q-R-08 | `createWaComponent` helper + tests; `npm test` + `npm run lint` green. |
| Q-R-09 | Extracted `drainRowsInto` helper; `go test -race ./internal/server/...` green. |
| Q-R-10 | Replace `.catch(() => {})` with `.catch(err => console.warn(...))`; existing tests unchanged. |
| Q-A-01 | Two-way error-code mirror guard — extend `scripts/check-error-codes.mjs` with `--check-reverse-for-family auth password tx upload` flag (or a new script). |
| Q-A-02 | Remove from `package.json`; `npm install`; `npm run build`; `npm test`; `npm run e2e:smoke`. Compare bundle sizes pre/post. |
| Q-A-03 | genapi follow-up — emit `AbortSignal?` on every method. Until then, codify the counter pattern in an ADR. |
| Q-A-04 | Add a doc comment + a test that asserts no client request leaves the SPA with the placeholder string in headers. |
| Q-A-05 | Tighten `geode.json` columns schema; `genapi` regenerate; tests still green. |
| Q-A-06 | Add §7 to CONVENTIONS.md + a wrapper-contract test in `internal/server/handlers_uploads_test.go`. |
| Q-L-01 | `npm test -- --detectOpenHandles 2>&1 \| head -50` will print the open handle stack; fix the offending `afterEach`. |
| Q-L-02 | Replace empty `.catch` with logging variant; add a test that asserts the toast shows on `writeText` rejection. |
| Q-L-03 | Add a `httptest`-driven round-trip in `result_codec_test.go` that reads `resp.Header.Get("Server-Timing")` and matches `db;dur=<float>` after the body is drained. |
| Q-L-04 | Direct unit tests for `peekLoginCreds` covering the 3 content types. |
| Q-L-05 | Document the LIFO/FIFO contract + add a fault-injection test (each step (1)-(8) deliberately fails). |
| Q-L-06 | Cap `count` write-side; add a unit test that asserts `count` does not exceed `FailThreshold * 2` after 10k synthetic NoteFail calls. |
| Q-L-07 | New `queryStream.worker.test.ts` exercising the worker path with the same byte fixture as the main-thread test. |
| Q-D-01 | Add §7 to `CONVENTIONS.md`. |
| Q-D-02 | Add 4 READMEs (`src/`, `src/lib/`, `src/components/`, `src/services/`). |
| Q-D-03 | Add 4 ADRs per docs/QUALITY_GAP_ANALYSIS.md tracking. |
| Q-D-04 | Normalise comment; no test impact. |
| Q-D-05 | Update file header; no test impact (resolves on Q-R-01 split). |

## INFO->Blocker Promotions

| ID | Rationale |
|---|---|
| (from scan, Build/CI Hygiene §3) | The doc-routes self-collision is structurally an audit-runs-fail-CI loop. The reviewer recommends promoting it to **blocker** because every future audit emission (today's quality / perf / security / gap deliverables, and tomorrow's) will trigger the same `check-doc-routes` failure on the very evidence it cites. Either widen the allow-list (`docs/audits/**`) in `scripts/check-doc-routes.mjs` OR teach the audit format to backtick-escape removed-path tokens. The fix is a 2-line patch to the allow-list regex and a guard-test update. |

No other promotions recommended. The remaining INFO items (ts-prune candidates, unused-dep suspects, >800-LOC files) are honest "soft" findings; the >800-LOC files in particular are already cited in the repo's own QUALITY_GAP_ANALYSIS.md as tracked work.

## Notes on Tests Asserting Behaviour vs. Shape

Spot-checked tests: `result_codec_test.go`, `handlers_users_test.go`,
`AuthProvider.test.tsx`, `QueryPage.test.tsx`, `loginlimiter_test.go`,
`GraphView.interaction.test.tsx`, `passwordPolicy.contract.test.ts`.

- **Behaviour assertions dominate.** Tests use `expect(handler) returns 401`,
  `expect(rows.length).toBe(N)`, `expect(emitAudit).toHaveBeenCalledWith(...)`.
  Zero `toMatchSnapshot` calls in `src/` (verified via grep) — this is
  strongly positive.
- **Contract tests do byte-equality**: `password_policy_contract_test.go`
  and `normalize_test.go::TestNormalizeProfileName_Contract` execute the
  JSON contract vectors on the Go side and the matching
  `passwordPolicy.contract.test.ts` does the same on the TS side. Excellent.
- **Shape-only smell**: a handful of dashboard-card tests just assert
  presence (`expect(screen.queryByText('events')).toBeInTheDocument()`)
  without verifying the underlying value (e.g. `AuditEventMixCard` and
  the rendered slice counts). Acceptable for layout-only tests, but worth
  reviewing card-by-card whether a single behaviour assertion would
  better catch a future regression.

## Notes on Justification for >800-LOC Files / >100-LOC Go Functions

- **`result_codec.go` (828 LOC)** — *not justified*. Splittable per Q-R-01.
- **`loginlimiter.go` (823 LOC)** — *not justified*. Splittable per Q-R-02.
- **`QueryPage.tsx` (727 LOC)** — *partially justified*. Hook-extraction
  per Q-R-04 lands it at ~350 LOC without losing colocation.
- **`handlers_users.go` (719 LOC)** — *justified*. It is a single
  RESTful family (Users), grammar+error+audit notes are dense (44
  pre-handler comment lines), and the file maps 1:1 to `/api/v1/users*`.
  Splitting by HTTP verb would obscure the family.
- **`en.ts` (664 LOC)** — *justified*. i18n key registry; the highest-
  churn file in the repo by design.
- **`TableView.tsx` (615 LOC)** — *partially justified*. The cell/row/
  estimator logic is intrinsic to the virtualized table; the NDJSON
  exporter (lines 404-451) could move into a sibling file.
- **`ws_query.go` (534 LOC)** — *justified*. One streaming endpoint;
  the cancel-reader machinery (lines 295-380) is intrinsic.
- **`GraphViewCytoscape.tsx` (518 LOC)** — *justified*. Already
  decomposed (12 sibling `useGraph*` hooks in `./graph/`).
- **`useGraphCytoscape.ts` (503 LOC)** — *partially justified*. The
  `__buildForTest`/`__writeTierForTest` exports (lines 470, 480) are
  intentional test seams and confirm by-design.

Go functions >100 LOC:

- **`newApp` (138 LOC)** — *not justified*. Q-R-03.
- **`streamQueryResult` (124 LOC)** — *justified*. Streaming codec
  with first-error latching; collapsing further loses readability.
  Could split via Q-R-09's shared drain helper.
- **`WSServer.Query` (117 LOC)** — *justified*. Linear flow.
- **`PatchUsername` (104 LOC)** — *justified* (already cited in
  `.golangci.yml` rationale). Transactional envelope is intrinsic.
- **`stageUpload` (101 LOC)** — *partially justified*. Error envelopes
  for the 8 upload error codes are by hand; a `respondUploadError(w, status,
  code, msg)` helper would land it under 60 LOC.

`NewLspConfigWithDefaults` was flagged by the scan's heuristic as 137 LOC
but is actually 5 LOC (`internal/server/server.go:59-64`) — the heuristic
appears to have counted to the next blank-line-after-func-keyword and
overshot. **Closed-no-action.**
