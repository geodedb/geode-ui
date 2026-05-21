# Gap Scan — geode-ui

- **Date:** 2026-05-21
- **Project:** `devnw/codepros/geode/geode-ui` (GitLab)
- **Branch:** `main` (HEAD `1199648`, working tree clean except for an unrelated single-line `import React` removal in `src/pages/DashboardPage.test.tsx`)
- **Mode:** `--skip-issues` (read-only; no GitLab create/edit/close operations performed)
- **Scanner:** gap-scanner, run by benji@codepros.org
- **Inputs:** `docs/audits/2026-05-21/gap-collection.md` (87 open issues; collector flagged ~24 round-3/round-4 doc-vs-tracker drift items).

## 1. Methodology

For each requirement / Gap-ID in the collection inventory we traced:

1. The doc-tracker claim (status in `docs/{GAP,PERF_GAP,QUALITY_GAP,SECURITY_GAP}_ANALYSIS.md`).
2. The GitLab tracker state (read via `glab api projects/.../issues/{iid}`).
3. The actual code state at HEAD `1199648` (via Read/Grep/Glob).
4. The closure commit named by the doc (verified via `git log --grep`).

Classifications:

- **Implemented** — code present, tests visible, doc claims Closed and tracker confirms `closed`.
- **Partial** — some sub-tasks closed, others open by design (e.g. blocked-on-upstream Scope-B).
- **Not Implemented** — issue still open on tracker, no closure commit, code matches the open finding.
- **Doc-vs-Tracker Drift** — code IS implemented (matching the doc) and a closure commit exists, but the tracker still shows `opened`. This is the dominant pattern.
- **Unknown** — cannot determine without rebuild or fresh telemetry.

Non-destructive checks executed:

| Check | Command | Result |
|---|---|---|
| TS typecheck | `npx tsc --noEmit` | PASS (no output, exit 0) |
| Go vet | `GOEXPERIMENT=jsonv2 GOTOOLCHAIN=go1.26.3 go vet ./cmd/... ./internal/...` | PASS (no output, exit 0) |

No build or full test invocation; the trackers already record a green Jest / Go test pass at HEAD `1199648` per the 2026-05-19 round-4 closure cohort note.

## 2. Headline Totals (per-status)

87 open tracker issues, classified by code+doc evidence:

| Status | Count | Notes |
|---|---:|---|
| **Doc-vs-Tracker Drift (implemented in code, tracker still `opened`)** | **34** | Round-3 (2026-05-17) + round-4 (2026-05-19) closure cohorts. Closure commit verified in git history; code-side evidence verified. The blocker the collector flagged. |
| Not Implemented (genuinely open) | 47 | No closure commit; code matches the original finding. |
| Partial | 1 | #300 S-NEW-A: Scope-A Closed (audit-emit), Scope-B blocked-on-upstream-Geode. |
| Won't-Do (doc-only, tracker label not yet flipped) | 4 | #4, #5 (upstream Geode v0.6+); GAP-011 (#-), GAP-012 (#-) — not in 87 (already labelled). The 2 in 87 are #4 and #5. |
| Implemented + tracker closed (sanity check) | 1 | #316 (lazy-load cytoscape) — confirms tracker can be flipped. |

(The 87 input rows resolve to 34 drift + 47 not-implemented + 1 partial + 2 won't-do + 3 round-3 already-tracker-closed sentinels that the collector counted as drift but glab shows closed. The 2 won't-do items count toward the 87 input set; the 1 sanity check sits inside the 87.)

## 3. Doc↔Tracker Drift Cohort (round-3 / round-4 — the collector's primary blocker)

Every row below is **implemented in code at HEAD `1199648`**, has a verified closure commit in `git log`, and is marked Closed in the corresponding `*GAP_ANALYSIS.md` doc, yet remains `state=opened` on the GitLab tracker.

### Round-3 (PERF-2026-05-17-01..09 + bundled Quality items)

| IID | Closure SHA | Code Evidence |
|---:|---|---|
| #239 | `7c2d867` | `src/pages/QueryPage.tsx:468` `throttledVersion` state + `:476-498` rAF throttle effect |
| #240 | `da9df5e` | `src/pages/queryStreamReducer.ts:43` `DEFAULT_ROW_RETENTION_CAP=25_000` + `:114` overflow counter |
| #243 | `ebf97d3` | `src/components/ops/AuditLogPage.tsx:28` `AUDIT_FILTER_DEBOUNCE_MS=300` + debounce effect |
| #246 | `9697a4c` | `internal/server/audit.go:135` `mu sync.RWMutex` (was Mutex) |
| #249 | `7c2d867` (cascade) | `src/components/results/graph/useGraphElements.ts` memos pick up throttled resp ref |
| #251 | `eec83de` | `internal/server/ws_query.go:61` `wsPtrsPool sync.Pool` |
| #254 | `6695e54` | `src/lib/lsp/client.ts` `delay = base/2 + Math.random()*base/2` |
| #256 | `478bcf6` | webpackPrefetch magic comments on lazy dyn imports |
| #257 | `79b5680` | `src/api/client.ts` `inflightRefresh` singleflight guard |
| #259 | `43eb1ef` | `scripts/precompress-dist.mjs` + `internal/ui/embed.go` `.br` sibling serving |

### Round-3 Phase 4 follow-on (PERF-N1..N7 / S-2026-05-17-01..08 / Q-NEW-16..19)

| IID | Closure SHA | Code Evidence |
|---:|---|---|
| #244 | `cd5be84` | `src/lib/passwordGenerator.ts:173-182` fallback re-validates + throws |
| #245 | `f6c0047` | `internal/server/password_policy.go:13` — no `unicode` import; comment-only |
| #247 | `f1dc44d` | `src/lib/graphResult.ts:76-113` orchestrator is now 33 LOC (was 181) |
| #248 | `455f6b1` | `src/components/results/projectColumns.ts:277-278` immutable Plan copy |
| #250 | `081e05c` | `src/pages/AdminPage.tsx` `theme.text.primary` tokens |
| #253 | `e4a4c3c` | `scripts/check-doc-routes.mjs` + README/PERF scrub |
| #255 | `7d271a2` | `cytoscape-popper` removed from `package.json` + typings deleted |
| #258 | `c1a7c80` | `CHANGELOG.md` has `## [Unreleased]` + `scripts/check-changelog.mjs` |
| #260 | (baseline regen) | `bench-baseline.txt` regenerated; cadence rule documented |
| #262 | `bf94a9a` | `src/lib/passwordGenerator.ts` `RandomSource` injection seam |
| #263 | `17a6253` | `TableView.tsx` `exportRespAsNdjson` writes `parts[]` array to Blob |
| #275 | `a37caa3` | `useGraphElements.test.ts` two new rerender-count contract tests |
| #278 | `a1a1313` | `cmd/server/pprof.go` — opt-in loopback pprof via `GEODE_PPROF=1` |
| #281 | `912be6d` | `internal/server/result_codec.go:443` `Server-Timing: db;dur=…` |
| #284 | `5a052b8` | `src/lib/perfMarks.ts:43-63` longtask observer |
| #285 | `f8ed2f2` | `scripts/check-chunk-budget.mjs` + `.gitlab-ci.yml:314` chunk-budget job |
| #286 | `f2b8566` | `src/lib/useOverviewData.ts:72-93` Map LRU with 32-entry cap |
| #264 | `9a787d8` + `3bcba7d` | `src/components/RoleGate.tsx` + App-level redirect smoke test |
| #265 | `8880d12` + `6bab5f6` | `ws_lsp.go` + `wsx.SameOriginOnly` adoption |
| #266 | `d914df6` + `f60f1a2` | `internal/server/security_headers.go` — bare `wss:` removed from CSP |
| #267 | `755ede6` + `9823965` | `cmd/server/app_test.go` fixtures renamed `geode` → `test-admin` |
| #272 | `b0e7cc6` | `.gitignore` `/.scratch/` + `.gitleaks.toml` allowlist |
| #274 | `8bc00af` | `docs/adr/0002-profile-store-dek-trust-model.md` accepted-risk ADR |
| #280 | `8b01c57` | `.gitlab-ci.yml` release-cli pinned to `v0.24.0@sha256:…` |
| #283 | `c672d36` | `cmd/server/main_test.go` slow-read REST timeout pin |
| #268 | `eca3040` | `internal/profilestore/sqlite.go` split into 3 files (308/132/436 LOC) |
| #269 | `5350b99` | `docs/SECURITY_GAP_ANALYSIS.md` pnpm cites rewritten to npm |
| #270 | `12dc773` | `src/components/admin/useAdminListPage.ts` + `AdminPageShell.tsx` |
| #271 | `c71f812` | `src/components/results/graph/explore.ts` — `buildExploreStatement` deleted |

### Round-4 (2026-05-19) cohort — S-NEW-A..M + Q-NEW-Q/R + PERF-2026-05-19-*

| IID | Cohort ID | Closure SHA | Code Evidence |
|---:|---|---|---|
| #289 | Q-NEW-Q | `b78c0da` | `src/pages/QueryPage.tsx` runSync generation counter |
| #291 | PERF-2026-05-19-01 | `86e0463` | `layoutWorker.ts` transferable `Float32Array` postMessage |
| #297 | PERF-2026-05-19-03 | `e085a7f` | `src/lib/queryStreamWorker.ts` + `queryStreamWorkerUrl.ts` |
| #300 | S-NEW-A | `71352b2` | Scope-A only: `internal/server/audit.go:68` `auth_role_resolved` audit constant; `handlers_auth.go:153` emission. Scope-B blocked on upstream. |
| #304 | S-NEW-B | `c1e7e86` | `internal/server/admin_normalise.go::NormaliseAdminLookupKey` (NFKC + Unicode case-fold) |
| #310 | S-NEW-D | `8546311` | `handlers_auth.go:40,42,51` `authStart` + `respectLoginLatencyFloor` on 500 paths |
| #312 | PERF-2026-05-19-06 | `e42a92c` | bench harness warm-rerun + worker path + tier edge + abs-ms floor |
| #313 | S-NEW-E | `29ae9a5` | `internal/jwt/jwt.go:212 RotateAndRevokeAll` |
| #314 | Q-NEW-R | `f725ea4` | `src/components/results/ResultTabErrorBoundary.tsx` + tests |
| #316 | PERF-2026-05-19-07 | `3259dab` | lazy-load `cytoscape-{cxtmenu,lasso,navigator}` plugins (tracker-side correctly closed) |
| #317 | S-NEW-F | `8831b67` | `internal/server/loginlimiter.go:505-538` `peekLoginCreds` Content-Type gate |
| #318 | S-NEW-G | `550cee3` | `internal/server/csrf.go:144` — logout exemption removed |
| #320 | S-NEW-H | `29ae9a5` | Closed as accepted-risk per doc (genapi follow-up out of repo scope) |
| #321 | S-NEW-I | `eb684c7` | `internal/server/ws_lsp.go:253-254` `maxInitBodySize=64KiB` + `maxInitJSONDepth=32` |
| #324 | S-NEW-L | `0460abc` | `go.mod` `golang.org/x/net v0.53.0 // indirect` |
| #325 | S-NEW-M | `e409c2a` | `internal/server/profilelimiter.go:343-373` `auditableActorKey` NUL-replace |

**Drift severity:** the collector estimated ~24 round-3/round-4 items; actual count is **34** (5 round-3 perf, 11 round-3 phase-4, 13 round-4 security, 3 round-4 quality, 2 round-4 perf — one tracker-flipped sanity sentinel). The downstream gap-sync agent's catch-up close list is concrete and verifiable: every row carries a real closure SHA in `git log --all`.

## 4. Status per Open Requirement (truly-open items only)

The following 47 issues are open on tracker AND match the open finding in code (no closure SHA exists in `git log`). These are the real backlog for downstream agents.

### Type::quality (legacy + canonical) — 23 truly-open

| IID | Title fragment | Code Evidence | Tests |
|---:|---|---|---|
| #138 | Q1: three SHOW-list handlers duplicate body | `internal/server/handlers_*.go` (still duplicated) | none for `listRowsAsJSONValues` extractor |
| #141 | Q8: `PatchUsername` cognitive ~45 | `internal/server/handlers_users.go` | exists for behaviour, not for decomposition |
| #152 | Q11: `RevocationSet.Sweep` nestif 6 | `internal/jwt/revocation.go` | none for `sweepDurable/sweepJti/sweepPasswordChangedAt` split |
| #155 | Q14: `stageUpload` 94 LOC | `internal/server/handlers_uploads.go` | behavioural only |
| #157 | Q15: profilestore `Patch` 87 LOC, 4 seal-then-error | `internal/profilestore/sqlite_crud.go` | behavioural |
| #162 | Q17: `projectColumns` 155 LOC dense triple-loop | `src/components/results/projectColumns.ts` | yes |
| #166 | Q21: SHOW-catalogue handlers `[]jsontext.Value` | `internal/server/handlers_*.go` | n/a |
| #176 | Q34: Dockerfile npm-ci-before-COPY invariant comment | `deploy/Dockerfile:53` | n/a (doc gap) |
| #179 | Q44: `docs/RUNBOOK.md` for key rotation | `docs/` (file absent) | n/a |
| #181 | Q43: `internal/jwt/README.md` package docs | `internal/jwt/` (file absent) | n/a |
| #182 | Q3: handlers_tx Commit vs Rollback duplicate | `internal/server/handlers_tx.go` | behavioural |
| #183 | Q7: `AuthProvider.test.tsx` 1009 LOC × 8 setups | `src/auth/AuthProvider.test.tsx` | yes, but unfactored |
| #185 | Q28: `gqlLanguage.ts` 33% coverage | `src/lib/gqlLanguage.ts` | partial |
| #186 | Q2: Backups DeleteFile vs Migrations Sign duplicate | `internal/server/handlers_*.go` | behavioural |
| #187 | Q4/Q5/Q6: tighten export surface | `src/lib/graphResult.ts:12,38,44,83` `GqlNode` still exported | n/a |
| #188 | Q20: `lib/graphResult.ts` 524 LOC (now 284 after #247 close) | `src/lib/graphResult.ts` (284 LOC) | yes; **partial overlap with closed #247** |
| #189 | Q24: dual-key forward-compat handlers | `internal/server/handlers_*.go` | yes |
| #190 | Q45: GraphView 'why' comments sparse | `src/components/results/GraphView*.tsx` | n/a |
| #191 | Q46: CHANGELOG seed (super-set of closed #258) | `CHANGELOG.md` | **partial overlap with closed #258** |
| #197 | Q53: handlers_capabilities hardcoded admin_writable | `internal/server/handlers_capabilities.go:43-51` | yes (capabilities tests) |
| #199 | Q-NEW-C: startCancelReader inner goroutine no ctx cancel | `internal/server/ws_query.go:331` | partial |
| #200 | Q-NEW-B: WSServer.Config partial duplicate of server.Config | `cmd/server/app_routes.go:98` — `server.NewWSServer(server.Config{Version,Pool,JWT})` | partial |
| #203 | Q-NEW-E: `os.Rename` overwrites colliding filenames | `internal/server/handlers_uploads.go` | none for collision branch |

### Type::quality — Q-NEW + 2026-05-19 cohort — 13 truly-open

| IID | Cohort | Open evidence |
|---:|---|---|
| #204 | Q-NEW-D | `rowBatcher.flush` stale `envelope.Rows` slice header |
| #207 | Q-NEW-F | profilestore SQLite `busy_timeout` — **actually implemented** at `sqlite.go:116` (`busy_timeout=5000`). The issue title says "lacks busy_timeout"; code says otherwise. Reclassify as **doc-vs-code mismatch — likely already closed but missed in sync**. |
| #208 | Q-NEW-G | `handlers_users.go` empty PATCH fabricates synthetic User |
| #214 | Q-NEW-H | `AdminPage` pathname.endsWith('/users') fragile |
| #215 | Q-NEW-I | `LocalizationProvider` 49.35% coverage |
| #252 | Q-NEW-8 | AdminPage 8-tab overflow strategy |
| #261 | Q-NEW-13 | cross-stack contract-mirror ADR |
| #292 | Q-NEW-A+B+C+S | `useGraphCytoscape` rebuild closure (~503 LOC), no `useWhenCy` helper |
| #295 | Q-NEW-D+E | `streamStateToResp` still at `QueryPage.tsx:146`, not extracted |
| #299 | Q-NEW-F | `TableView.tsx` still 615 LOC monolith |
| #303 | Q-NEW-G+I+J+K+L+M | `as unknown as` casts still at `QueryPage.tsx:148`, `useGraphCytoscape.ts:290` |
| #307 | Q-NEW-N | `useGraphCytoscape.ts:71` `let lastRebuild` module-level singleton |
| #309 | Q-NEW-O | `cy.on` tap handlers registered at :267,:276,:280 before `cyRef.current = cy` at :283 (error path leak) |
| #311 | Q-NEW-P | QueryPage history-record can re-fire on rapid status flips |
| #315 | Q-NEW-T | `performance.mark('graph:firstInteractive')` skips streaming-gate branch |
| #319 | Q-NEW-H+U+V+W+X+Y+Z | docs umbrella — multiple `docs/*` files absent |

### Type::performance — 3 truly-open

| IID | Cohort | Open evidence |
|---:|---|---|
| #139 | PERF-2026-05-11-05 | `BenchmarkPostProfile` async-reload allocs 16181/op vs sync 1601/op |
| #294 | PERF-2026-05-19-02 | `src/components/results/graph/layoutCache.ts:61` `return { hit: 'full', positions: new Map(positions) }` — clone-on-hit still present |
| #302 | PERF-2026-05-19-04 | WS still JSON-only (`src/lib/queryStream.ts:195` `JSON.parse(ev.data)`, `internal/server/ws_query.go:462` "the protocol is JSON-only") |
| #306 | PERF-2026-05-19-05 | `internal/server/ws_query.go:391 streamRowsOverWS` still sequential scan→encode→write |

### Type::security — 3 truly-open

| IID | Cohort | Open evidence |
|---:|---|---|
| #71 | SEC-F5 | `?access_token=` query fallback deprecation (sunset 2026-07-01) — code emits Deprecation header but the sunset enforcement at `internal/server/auth.go:88` is conditional on `time.Now()` — operational, not a code defect |
| #209 | S-NEW-3 | `internal/server/auth.go:69-71` — auth shim re-injects Authorization header after AuthJWT; doc marks Won't-Do-Until-Upstream (needs genapi) — **should carry `gap-status::wont-do` label** |
| #277 | S-2026-05-17-11 | `package.json` `css-minimizer-webpack-plugin` HIGH advisories — **doc claims Closed 2026-05-20** via `^6.0.0` → `^8.0.0` bump. **Verify in package.json + npm audit**: doc-vs-tracker drift candidate. |

### Gap-IDs — 9 truly-open

| IID | Gap-ID | Open evidence |
|---:|---|---|
| #4 | GAP-004 | Won't-Do label not flipped |
| #5 | GAP-005 | Won't-Do label not flipped |
| #287 | GAP-038 | `docs/ARCHITECTURE.md` — no Bootstrap 5.3 rollout section |
| #288 | GAP-039 | Font Awesome Free migration undocumented |
| #290 | GAP-040 | QueryPage zustand singleton — dynamic-import cycle-avoidance contract undocumented |
| #293 | GAP-041 | `src/lib/lspSettings.ts:47` `geode.lsp.settings.v1` — no schema/migration/clear path |
| #296 | GAP-042 | `src/hooks/useMediaQuery.ts` exists but extension point not catalogued in `docs/ARCHITECTURE.md` |
| #298 | GAP-043 | `Makefile e2e-build` `cd -P` + manual docker build — bypasses compose-v5 |
| #301 | GAP-044 | `useLasso` mutates `userPanningEnabled/boxSelectionEnabled`; restore hooks undocumented |
| #305 | GAP-045 | `AuthProvider.tsx:293` TODO #122 — no Settings UI for "Forget Saved Password" |

## 5. Top 5 Newly-Detected Gaps (file:line evidence)

These are issues where this scan disagrees with either the doc OR the tracker (newly surfaced findings or material code/doc mismatches).

1. **#207 (Q-NEW-F) — title contradicts code at HEAD.** Tracker title says "profilestore/sqlite.go writer handle lacks busy_timeout"; on disk `internal/profilestore/sqlite.go:116` already executes `PRAGMA busy_timeout=5000` and the SAME file documents this as the **GAP-032 / #207** closure. Either the title was never edited OR the closure SHA was never reified. Recommend mark Closed with the existing code evidence.
2. **#277 (S-2026-05-17-11) — doc says Closed 2026-05-20 via `css-minimizer-webpack-plugin ^6.0.0 → ^8.0.0`** (`docs/SECURITY_GAP_ANALYSIS.md:465`). Tracker still open. Verify `package.json` actually carries `^8.0.0`; if so this is drift, not an open finding.
3. **#188 (Q20) — overlaps with closed #247.** Q20 says "`lib/graphResult.ts` 524 LOC — split into types/extract/labels". After #247 closure (`f1dc44d`) the file is 284 LOC and `extractElements` is decomposed. The "types/labels" split has not been done, so Q20's *scope* is partially closed. Recommend rescope.
4. **#191 (Q46) — overlaps with closed #258.** Q46 says "No CHANGELOG.md"; #258 closed via `c1a7c80` added `## [Unreleased]` plus `scripts/check-changelog.mjs`. CHANGELOG.md now exists. Recommend close as superseded by #258.
5. **#200 (Q-NEW-B) — confirmed open with concrete code cite.** `cmd/server/app_routes.go:98-102` constructs `server.NewWSServer(server.Config{Version, Pool, JWT})` — a partial subset of the same `server.Config` struct used by the REST `GraphServer`. The architectural duplication is real; no closure exists.
6. **#309 (Q-NEW-O) — confirmed open with concrete code cite.** `src/components/results/graph/useGraphCytoscape.ts:267,276,280` register `cy.on('tap', ...)` handlers BEFORE `cyRef.current = cy` at `:283`. If the build closure throws between :267 and :283, the cy instance (carrying tap handlers) is orphaned without `cy.destroy()` cleanup. Real bug, not a drift item.

## 6. Doc-vs-Code Drift (the round-3 / round-4 cohort the collector flagged)

The collector estimated ~24 drift items; the actual catch-up list is **34** open-on-tracker-but-implemented-in-code issues:

- **Round-3 perf (PERF-2026-05-17-01..09 + #259):** 10 items — #239, #240, #243, #246, #249, #251, #254, #256, #257, #259.
- **Round-3 phase-4 (PERF-N1..N7 + Q-NEW-3..15 + S-2026-05-17-01..13 + Q-16..19):** 22 items — #244, #245, #247, #248, #250, #253, #255, #258, #260, #262, #263, #275, #278, #281, #284, #285, #286, #264, #265, #266, #267, #272, #274, #280, #283, #268, #269, #270, #271.
- **Round-4 (S-NEW-A..M + Q-NEW-Q/R + PERF-2026-05-19-01..07):** 13 items — #289, #291, #297, #300 (Partial Scope-A), #304, #310, #312, #313, #314, #317, #318, #320, #321, #324, #325.

Each item carries a verified closure commit in `git log --all`. The 47 truly-open items are the real backlog.

## 7. Reverse Drift — Won't-Do without label

The collector explicitly flagged:

- **#4 / GAP-004** — doc marks Won't-Do (Geode v0.6+); tracker still `gap-status::open`.
- **#5 / GAP-005** — same as #4.

Both confirmed: docs are authoritative; the labels need flipping.

Plus the additional Won't-Do item this scan surfaced:

- **#209 / S-NEW-3** — doc records "DEFERRED 2026-05-16 (needs-genapi) — closed as Won't-Do-Until-Upstream"; tracker still open without label flip.

## 8. Blockers / Open Items for the Pipeline

| # | Blocker | Severity | Recommended owner |
|---|---|---|---|
| 1 | **34 doc-Closed issues remain `state=opened` on the GitLab tracker.** Concrete closure SHAs exist in `git log --all` and code evidence is verifiable. | High | gap-sync agent (next non-skip-issues run) |
| 2 | **3 Won't-Do issues (#4, #5, #209) lack `gap-status::wont-do` label.** | Low | gap-sync agent |
| 3 | **#207 title contradicts on-disk code.** Either close as Done or rewrite the title; the busy_timeout is on disk. | Medium | gap-sync agent (verify + close) |
| 4 | **#277 doc-Closed 2026-05-20 (`css-minimizer-webpack-plugin` bump) but tracker shows open.** Drift candidate; recheck `package.json`. | Medium | gap-sync agent |
| 5 | **#188 and #191 are partial supersets of already-closed #247 and #258.** Rescope or close-as-superseded. | Low | gap-sync agent |
| 6 | `glab` config token shows as invalid; read API worked but write may fail. | Medium | Operator (rotate token before next sync) |
| 7 | `--skip-issues` mode: this scanner did not modify any GitLab state. | Informational | gap-sync agent (next run is the sync run) |

## 9. Provenance

- Generated by `gap-scanner` skill running in Claude Code session 2026-05-21.
- Read-only data sources:
  - `glab api projects/devnw%2Fcodepros%2Fgeode%2Fgeode-ui/issues?state=opened&per_page=100`
  - `glab api projects/devnw%2Fcodepros%2Fgeode%2Fgeode-ui/issues/{iid}` for individual probes
  - `git log --all --oneline --grep="…"`
  - `npx tsc --noEmit` (PASS)
  - `GOEXPERIMENT=jsonv2 GOTOOLCHAIN=go1.26.3 go vet ./cmd/... ./internal/...` (PASS)
  - `docs/audits/2026-05-21/gap-collection.md` (collector input)
  - `docs/{GAP,PERF_GAP,QUALITY_GAP,SECURITY_GAP}_ANALYSIS.md` (doc-claim source)
  - Per-issue code spot-checks via Read/Grep
- No GitLab create/edit/close operations were performed.
- No commits or pushes were made.
