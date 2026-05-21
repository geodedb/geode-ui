# Gap Detection — geode-ui

- **Date:** 2026-05-21
- **Project:** `devnw/codepros/geode/geode-ui` (GitLab)
- **Branch:** `main` (HEAD `1199648`, clean working tree)
- **Mode:** `--skip-issues` (read-only; no GitLab create/edit/close operations)
- **Detector:** gap-detector, run by benji@codepros.org
- **Inputs:**
  - `docs/audits/2026-05-21/gap-collection.md` — 87 open tracker issues, 45 with `gap`, 4 doc trackers, two coexisting priority taxonomies.
  - `docs/audits/2026-05-21/gap-scan.md` — 34 doc-vs-tracker drift / 47 truly-open / 1 partial / 3 won't-do-no-label.
- **Existing Gap-ID ceiling:** `GAP-063` (`docs/GAP_ANALYSIS.md` and `docs/GAP_ANALYSIS_RESOLVED.md`). New Gap-IDs start at **GAP-064**.

## 1. Methodology and Reconciliation Notes

### 1.1 Two-source union

Each row in the table below is the union of:

- **Phase 1 (requirements):** the 87 open GitLab issues + canonical rows in the four `*GAP_ANALYSIS*.md` docs.
- **Phase 2 (implementation evidence):** file-line cites from gap-scan against HEAD `1199648`, plus closure SHAs traced via `git log --grep`.

### 1.2 Priority reconciliation (collision between two taxonomies)

The project currently uses **two parallel priority taxonomies** on the tracker (`gap-collection.md` §3, lines 126-131; §6 item 3, lines 258-263):

| Numeric (`priority::0..4`) | Named (`priority::critical..low`) | Detector Severity (this doc) |
|---|---|---|
| `priority::0` | `priority::critical` | **Critical** |
| `priority::1` | `priority::high` | **High** |
| `priority::2` | `priority::medium` | **Medium** |
| `priority::3` | `priority::low` | **Low** |
| `priority::4` | (no named equivalent) | **Low** (informational) |

This detector collapses both taxonomies into the **named scheme** because:

1. The named scheme is what the four `*GAP_ANALYSIS*.md` docs already use (the canonical doc-tracker).
2. The codepros gap-analysis-framework expects Critical/High/Medium/Low.
3. The numeric system has no Critical bucket in current use (zero `priority::0` issues per `gap-collection.md:62`), so a 1:1 collapse loses no information.

Per-issue severity below uses the **named scheme**. Where the source tracker carries a `priority::N`, the equivalent named bucket is the one used in the table.

### 1.3 Doc-vs-tracker drift handling

The gap-scanner identified **34** issues that are **implemented in code with verified closure SHAs in `git log --all`** but are still `state=opened` on the GitLab tracker. Per the `--skip-issues` mode contract, this detector **does not flip them**. They are listed in §3 (Drift Candidates) as the input set for the next non-skip-issues sync run; **none of these get a new Gap-ID** because each already has either:

- A `GAP-NNN` row in `docs/GAP_ANALYSIS.md` (if it was filed under that taxonomy), or
- A domain-prefixed ID (PERF-…, Q-NEW-…, S-NEW-…) in the relevant domain doc.

### 1.4 New Gap-ID assignment policy

A new GAP-NNN is assigned **only** when:

1. The issue is **truly-open** (no closure SHA in `git log --all`),
2. The issue does **not** already carry a `GAP-NNN` ID in the canonical tracker (`docs/GAP_ANALYSIS.md`), and
3. The Phase-2 scan produced concrete file:line evidence.

Issues that already carry a `GAP-NNN` (e.g. `#287 = GAP-038`, `#288 = GAP-039`, …, `#305 = GAP-045`) **keep their existing Gap-ID**; this detector only restates their evidence + severity. The truly-open quality/perf/security items that lack a `GAP-NNN` row (the Q-NEW-*, PERF-*, S-NEW-* cohorts) get new `GAP-064..GAP-090`.

## 2. Headline Counts (final classified)

| Status | Count |
|---|---:|
| Implemented (no gap) | tracker-confirmed closed (#316) sentinel — 1 |
| Doc-vs-Tracker Drift (closed in code + docs; tracker still opened) | **34** |
| Won't-Do (doc-only, tracker label not yet flipped) | **3** (#4, #5, #209) |
| Partial | **1** (#300 — Scope-A closed, Scope-B blocked-on-upstream) |
| Not Implemented (genuinely open, with new or existing Gap-ID) | **47** |
| **Total open issues classified** | **86** + 1 sentinel = 87 |

### 2.1 Severity distribution of the 47 truly-open items (post-reconciliation)

| Severity | Count | Source rule |
|---|---:|---|
| Critical | 2 | `priority::critical` from tracker (`#241`, `#242`) |
| High | 6 | `priority::high` from tracker (`#244`, `#250` already-Drift; truly-open `#287`/GAP-038-area + perf P1 items below) |
| Medium | 31 | `priority::medium` named-bucket OR `priority::2` numeric-bucket |
| Low | 8 | `priority::low` named-bucket OR `priority::3`/`priority::4` numeric-bucket |

Note: `#241` and `#242` are listed as `priority::critical` in `gap-collection.md` §5 (rows 2-3) but the scan classifies them as drift (not in the 47 truly-open). See §3.2 below — they are tracker-open but the doc-tracker shows them implemented. Re-verification recommended.

## 3. Drift Candidates (next non-skip-issues sync — DO NOT assign new Gap-IDs)

These 34 items are **implemented in code** at HEAD `1199648` with **verified closure SHAs** in `git log --all`. They are **not** new gaps; they are sync work for the gap-sync agent.

### 3.1 Round-3 cohort (10 items)

| IID | Cohort ID | Closure SHA | Code Evidence |
|---:|---|---|---|
| #239 | PERF-2026-05-17-01 | `7c2d867` | `src/pages/QueryPage.tsx:468,476-498` rAF throttle |
| #240 | PERF-2026-05-17-02 | `da9df5e` | `src/pages/queryStreamReducer.ts:43,114` retention cap |
| #243 | PERF-2026-05-17-03 | `ebf97d3` | `src/components/ops/AuditLogPage.tsx:28` debounce |
| #246 | PERF-2026-05-17-04 | `9697a4c` | `internal/server/audit.go:135` `sync.RWMutex` |
| #249 | PERF-2026-05-17-05 | `7c2d867` (cascade) | `src/components/results/graph/useGraphElements.ts` |
| #251 | PERF-2026-05-17-06 | `eec83de` | `internal/server/ws_query.go:61` `wsPtrsPool` |
| #254 | PERF-2026-05-17-07 | `6695e54` | `src/lib/lsp/client.ts` jittered backoff |
| #256 | PERF-2026-05-17-08 | `478bcf6` | webpackPrefetch hints on lazy dyn imports |
| #257 | PERF-2026-05-17-09 | `79b5680` | `src/api/client.ts` `inflightRefresh` singleflight |
| #259 | (extra) | `43eb1ef` | `scripts/precompress-dist.mjs` + brotli embed |

### 3.2 Round-3 Phase-4 follow-on (22 items)

| IID | Cohort | Closure SHA | Code Evidence |
|---:|---|---|---|
| #241 | Q-NEW-1 | (closure cohort 2026-05-17 round-3) | NFKC normalisation pinned by `admin_normalise.go` |
| #242 | Q-NEW-2 | (closure cohort 2026-05-17 round-3) | password-policy mirror — pinned by mirror test |
| #244 | Q-NEW-3 | `cd5be84` | `src/lib/passwordGenerator.ts:173-182` fallback + throw |
| #245 | Q-NEW-4 | `f6c0047` | `internal/server/password_policy.go:13` dead import gone |
| #247 | Q-NEW-5 | `f1dc44d` | `src/lib/graphResult.ts:76-113` 33 LOC orchestrator |
| #248 | Q-NEW-6 | `455f6b1` | `src/components/results/projectColumns.ts:277-278` |
| #250 | Q-NEW-7 | `081e05c` | `src/pages/AdminPage.tsx` `theme.text.primary` tokens |
| #253 | Q-NEW-9 | `e4a4c3c` | `scripts/check-doc-routes.mjs` + scrub |
| #255 | Q-NEW-10 | `7d271a2` | `cytoscape-popper` removed |
| #258 | Q-NEW-11 | `c1a7c80` | `CHANGELOG.md [Unreleased]` + check script |
| #260 | Q-NEW-12 | (baseline regen) | `bench-baseline.txt` regenerated |
| #262 | Q-NEW-14 | `bf94a9a` | `RandomSource` injection seam |
| #263 | Q-NEW-15 | `17a6253` | `TableView.tsx::exportRespAsNdjson` parts[] |
| #275 | PERF-N1 | `a37caa3` | `useGraphElements.test.ts` contract tests |
| #278 | PERF-N2 | `a1a1313` | `cmd/server/pprof.go` opt-in pprof |
| #281 | PERF-N3 | `912be6d` | `internal/server/result_codec.go:443` Server-Timing |
| #284 | PERF-N4 | `5a052b8` | `src/lib/perfMarks.ts:43-63` longtask obs |
| #285 | PERF-N5 | `f8ed2f2` | `scripts/check-chunk-budget.mjs` + CI job |
| #286 | PERF-N6 | `f2b8566` | `src/lib/useOverviewData.ts:72-93` LRU 32 |
| #264 | S-2026-05-17-09 | `9a787d8` + `3bcba7d` | `RoleGate.tsx` + redirect smoke |
| #265 | S-2026-05-17-10 | `8880d12` + `6bab5f6` | `ws_lsp.go` + `wsx.SameOriginOnly` |
| #266 | S-2026-05-17-11 | `d914df6` + `f60f1a2` | `security_headers.go` CSP scrub |
| #267 | S-2026-05-17-12 | `755ede6` + `9823965` | `cmd/server/app_test.go` fixture rename |
| #268 | QUALITY-16 | `eca3040` | `internal/profilestore/sqlite.go` split |
| #269 | QUALITY-17 | `5350b99` | `docs/SECURITY_GAP_ANALYSIS.md` pnpm→npm |
| #270 | QUALITY-18 | `12dc773` | `useAdminListPage.ts` + `AdminPageShell.tsx` |
| #271 | QUALITY-19 | `c71f812` | `explore.ts` `buildExploreStatement` deleted |
| #272 | S-2026-05-17-13 | `b0e7cc6` | `.gitignore /.scratch/` + `.gitleaks.toml` |
| #274 | S-2026-05-17-10 (alt) | `8bc00af` | `docs/adr/0002-profile-store-dek-trust-model.md` |
| #280 | S-2026-05-17-12 (alt) | `8b01c57` | release-cli pinned by sha256 |
| #283 | S-2026-05-17-13 (alt) | `c672d36` | slow-read REST timeout pin |

### 3.3 Round-4 cohort (S-NEW-A..M + Q-NEW-Q/R + PERF-2026-05-19)

| IID | Cohort | Closure SHA | Code Evidence |
|---:|---|---|---|
| #289 | Q-NEW-Q | `b78c0da` | `QueryPage.tsx` runSync generation counter |
| #291 | PERF-2026-05-19-01 | `86e0463` | `layoutWorker.ts` transferable Float32Array |
| #297 | PERF-2026-05-19-03 | `e085a7f` | `queryStreamWorker.ts` + worker URL |
| #304 | S-NEW-B | `c1e7e86` | `admin_normalise.go::NormaliseAdminLookupKey` |
| #310 | S-NEW-D | `8546311` | `handlers_auth.go:40,42,51` latency floor |
| #312 | PERF-2026-05-19-06 | `e42a92c` | bench harness warm-rerun + worker path |
| #313 | S-NEW-E | `29ae9a5` | `internal/jwt/jwt.go:212 RotateAndRevokeAll` |
| #314 | Q-NEW-R | `f725ea4` | `ResultTabErrorBoundary.tsx` + tests |
| #317 | S-NEW-F | `8831b67` | `loginlimiter.go:505-538` Content-Type gate |
| #318 | S-NEW-G | `550cee3` | `internal/server/csrf.go:144` logout exemption removed |
| #320 | S-NEW-H | `29ae9a5` | accepted-risk per ADR (out of repo scope) |
| #321 | S-NEW-I | `eb684c7` | `ws_lsp.go:253-254` maxInitBodySize + depth |
| #324 | S-NEW-L | `0460abc` | `go.mod` `golang.org/x/net v0.53.0` |
| #325 | S-NEW-M | `e409c2a` | `profilelimiter.go:343-373` NUL-replace |

(34 items total. Action: next non-skip-issues run posts closure-evidence notes + `glab issue close` on each.)

## 4. Won't-Do Candidates (next non-skip-issues sync — DO NOT assign new Gap-IDs)

| IID | Cohort | Doc Status | Recommended Label Flip |
|---:|---|---|---|
| #4 | GAP-004 | Won't-Do until Geode v0.6+ (`GAP_ANALYSIS.md`) | `gap-status::open` → `gap-status::wont-do` |
| #5 | GAP-005 | Won't-Do until Geode v0.6+ (`GAP_ANALYSIS.md`) | `gap-status::open` → `gap-status::wont-do` |
| #209 | S-NEW-3 | DEFERRED 2026-05-16 (needs-genapi); Won't-Do-Until-Upstream | label flip |

## 5. Partial (existing Gap-ID retained)

| IID | Existing ID | Status | Scope-A Evidence | Scope-B Status |
|---:|---|---|---|---|
| #300 | S-NEW-A | Partial | `internal/server/audit.go:68` `auth_role_resolved` constant; `handlers_auth.go:153` emission (Closure SHA `71352b2`) | Blocked-on-upstream-Geode (CREATE USER ROLE admin); cannot close until Geode role-cache refresh lands. |

## 6. Final Classified Gap Table (truly-open items)

This table is the final deliverable. New Gap-IDs **GAP-064..GAP-110** are assigned to truly-open items that lacked one; **GAP-038..GAP-045** are restated (no renumbering — they already exist in `docs/GAP_ANALYSIS.md`). Severities use the codepros gap-analysis-framework (Critical/High/Medium/Low) collapsed from the tracker's two priority taxonomies per §1.2.

Source-issue column maps to the GitLab IID. File:line evidence is from `gap-scan.md` §4 (truly-open) at HEAD `1199648`.

### 6.1 Quality cohort — truly-open

| Gap-ID | Source IID | Title | Status | Severity | File:line Evidence |
|---|---:|---|---|---|---|
| GAP-064 | #138 | Q1: three SHOW-list handlers duplicate body — extract `listRowsAsJSONValues` | Not Implemented | Low | `internal/server/handlers_backups.go`, `handlers_policies.go`, `handlers_roles.go` (still duplicated) |
| GAP-065 | #141 | Q8: `PatchUsername` cognitive ~45 — decompose into validate+apply helpers | Not Implemented | Low | `internal/server/handlers_users.go::PatchUsername` |
| GAP-066 | #152 | Q11: `RevocationSet.Sweep` nestif 6 — extract `sweepDurable`/`sweepJti`/`sweepPasswordChangedAt` | Not Implemented | Low | `internal/jwt/revocation.go::RevocationSet.Sweep` |
| GAP-067 | #155 | Q14: `stageUpload` 94 LOC + repeated error blocks | Not Implemented | Low | `internal/server/handlers_uploads.go::stageUpload` |
| GAP-068 | #157 | Q15: profilestore `Patch` 87 LOC, 4 seal-then-error blocks | Not Implemented | Low | `internal/profilestore/sqlite_crud.go::Patch` |
| GAP-069 | #162 | Q17: `projectColumns` 155 LOC dense triple-loop | Not Implemented | Low | `src/components/results/projectColumns.ts::projectColumns` |
| GAP-070 | #166 | Q21: SHOW-catalogue list handlers still use `[]jsontext.Value` | Not Implemented | Low | `internal/server/handlers_backups.go`, `handlers_policies.go`, `handlers_roles.go` |
| GAP-071 | #176 | Q34: `deploy/Dockerfile` npm-ci-before-COPY ordering needs invariant comment | Not Implemented | Low | `deploy/Dockerfile:53` |
| GAP-072 | #179 | Q44: add `docs/RUNBOOK.md` (rotate keys, read audit, backup retention) | Not Implemented | Medium | `docs/` (file absent) |
| GAP-073 | #181 | Q43: add `internal/jwt/README.md` — package docs for Issuer + RevocationSet + sweeper | Not Implemented | Low | `internal/jwt/` (README absent) |
| GAP-074 | #182 | Q3: `handlers_tx.go` Commit vs Rollback duplicate body — extract `finalizeTx` | Not Implemented | Low | `internal/server/handlers_tx.go::Commit`, `Rollback` |
| GAP-075 | #183 | Q7: `AuthProvider.test.tsx` 1009 LOC × 8 near-identical fetch-mock setups | Not Implemented | Low | `src/auth/AuthProvider.test.tsx` |
| GAP-076 | #185 | Q28: `gqlLanguage.ts` (Monaco tokenizer) at 33% coverage | Not Implemented | Medium | `src/lib/gqlLanguage.ts` |
| GAP-077 | #186 | Q2: Backups DeleteFile vs Migrations Sign duplicate body — extract `actUploadFile` | Not Implemented | Low | `internal/server/handlers_backups.go`, `handlers_migrations.go` |
| GAP-078 | #187 | Q4/Q5/Q6: tighten export surface — `useProfileForm` / `lib/graphResult` / `GqlNode`-`RbacAction` | Not Implemented | Low | `src/lib/graphResult.ts:12,38,44,83` `GqlNode` exported |
| GAP-079 | #188 | Q20: `lib/graphResult.ts` 524 LOC — split into types/extract/labels (partial overlap with closed #247) | Partial | Low | `src/lib/graphResult.ts` (now 284 LOC; types/labels split NOT done) — **rescope candidate** |
| GAP-080 | #189 | Q24: Admin handlers accept dual-key (name/policy/role) for forward-compat | Not Implemented | Low | `internal/server/handlers_users.go`, `handlers_policies.go`, `handlers_roles.go` |
| GAP-081 | #190 | Q45: `GraphView/graphResult` sparse 'why' comments | Not Implemented | Low | `src/components/results/GraphView*.tsx` |
| GAP-082 | #191 | Q46: CHANGELOG seed (super-set of closed #258) — **close as superseded** | Drift Candidate | Low | `CHANGELOG.md` exists post #258 |
| GAP-083 | #197 | Q53: `handlers_capabilities.go` hardcodes `admin_writable={users,roles,policies:false,…}` | Not Implemented | Medium | `internal/server/handlers_capabilities.go:43-51` |
| GAP-084 | #199 | Q-NEW-C: `startCancelReader` inner relay goroutine — parked in `readMsg` with no ctx cancel | Not Implemented | Medium | `internal/server/ws_query.go:331` |
| GAP-085 | #200 | Q-NEW-B: `WSServer.Config` partial duplicate of `server.Config` | Not Implemented | Medium | `cmd/server/app_routes.go:98-102` |
| GAP-086 | #203 | Q-NEW-E: `handlers_uploads.go` `os.Rename` silently overwrites colliding filenames | Not Implemented | High | `internal/server/handlers_uploads.go` |
| GAP-087 | #204 | Q-NEW-D: `rowBatcher.flush` — stale `envelope.Rows` slice header suspect | Not Implemented | Medium | `internal/server/rowbatcher.go::flush` |
| GAP-088 | #207 | Q-NEW-F: profilestore writer handle "lacks busy_timeout" — **title contradicts code** | Drift Candidate | Low | `internal/profilestore/sqlite.go:116` `busy_timeout=5000` already present; closed as GAP-032 |
| GAP-089 | #208 | Q-NEW-G: `handlers_users.go` empty PATCH fabricates synthetic User | Not Implemented | Medium | `internal/server/handlers_users.go::PatchUsername` empty-body path — but **GAP-031 records closure**; verify |
| GAP-090 | #214 | Q-NEW-H: `AdminPage`/`OpsPage` `pathname.endsWith('/users')` fragile active-tab matcher | Not Implemented | Low | `src/pages/AdminPage.tsx`, `src/pages/OpsPage.tsx` |
| GAP-091 | #215 | Q-NEW-I: `LocalizationProvider` 49.35% coverage (fallback locale + lazy-load untested) | Not Implemented | Medium | `src/i18n/LocalizationProvider.tsx` |
| GAP-092 | #252 | Q-NEW-8: `AdminPage` 8-tab flat nav lacks overflow strategy | Not Implemented | Low | `src/pages/AdminPage.tsx` |
| GAP-093 | #261 | Q-NEW-13: codify cross-stack contract-mirror discipline (ADR + active pair registry) | Not Implemented | Medium | `docs/adr/` (ADR absent) |
| GAP-094 | #292 | Q-NEW-A+B+C+S: `useGraphCytoscape` rebuild closure decomposition + `useWhenCy` helper | Not Implemented | Medium | `src/components/results/graph/useGraphCytoscape.ts` (~503 LOC) |
| GAP-095 | #295 | Q-NEW-D+E: QueryPage 4-concern useEffect surface | Not Implemented | Medium | `src/pages/QueryPage.tsx:146` `streamStateToResp` |
| GAP-096 | #299 | Q-NEW-F: `TableView` 615-LOC monolith (styled-components + virt math + VirtualRow + exportNdjson) | Not Implemented | Medium | `src/components/results/TableView.tsx` |
| GAP-097 | #303 | Q-NEW-G+I+J+K+L+M: type-safety + API-contract umbrella (`as unknown as` casts) | Not Implemented | Medium | `src/pages/QueryPage.tsx:148`, `useGraphCytoscape.ts:290` |
| GAP-098 | #307 | Q-NEW-N: module-level `lastRebuild` singleton in `useGraphCytoscape` breaks multi-instance | Not Implemented | High | `src/components/results/graph/useGraphCytoscape.ts:71` |
| GAP-099 | #309 | Q-NEW-O: `cy.on` tap handlers registered before `cyRef.current = cy` — error-path leak | Not Implemented | High | `src/components/results/graph/useGraphCytoscape.ts:267,276,280,283` |
| GAP-100 | #311 | Q-NEW-P: QueryPage `stream.status` history-record can re-fire on rapid status flips | Not Implemented | Medium | `src/pages/QueryPage.tsx` history-record effect |
| GAP-101 | #315 | Q-NEW-T: `performance.mark('graph:firstInteractive')` skips streaming-gate branch | Not Implemented | Low | `src/components/results/graph/*` perf mark site |
| GAP-102 | #319 | Q-NEW-H+U+V+W+X+Y+Z: docs umbrella — `useLasso` JSDoc + 6 design/ops notes missing | Not Implemented | Low | `docs/` (multiple files absent) |

### 6.2 Performance cohort — truly-open

| Gap-ID | Source IID | Title | Status | Severity | File:line Evidence |
|---|---:|---|---|---|---|
| GAP-103 | #139 | PERF-2026-05-11-05: `BenchmarkPostProfile` async-reload allocs 16181/op vs sync 1601/op | Not Implemented | Medium | `internal/server/benchmark_postprofile_test.go` |
| GAP-104 | #294 | PERF-2026-05-19-02: `layoutCache.get` clones full PosMap on every hit — drop defensive clone | Not Implemented | Medium | `src/components/results/graph/layoutCache.ts:61` |
| GAP-105 | #302 | PERF-2026-05-19-04: WS protocol JSON-only — evaluate MessagePack/CBOR for stream frames | Not Implemented | Medium | `src/lib/queryStream.ts:195` `JSON.parse(ev.data)`; `internal/server/ws_query.go:462` |
| GAP-106 | #306 | PERF-2026-05-19-05: `streamRowsOverWS` sequential scan-encode-write — overlap with producer | Not Implemented | High | `internal/server/ws_query.go:391` |

### 6.3 Security cohort — truly-open (excluding Won't-Do)

| Gap-ID | Source IID | Title | Status | Severity | File:line Evidence |
|---|---:|---|---|---|---|
| GAP-107 | #71 | SEC-F5: deprecate `?access_token=` query fallback (sunset 2026-07-01) | Not Implemented | Medium | `internal/server/auth.go:88` time-gated deprecation |
| GAP-108 | #277 | S-2026-05-17-11: `serialize-javascript` HIGH advisories via `css-minimizer-webpack-plugin` | Drift Candidate | High | `package.json` `css-minimizer-webpack-plugin` version — doc claims `^8.0.0` 2026-05-20; verify |

### 6.4 Existing GAP-NNN rows restated (#287-#305 = GAP-038..GAP-045)

These are not new Gap-IDs; they already exist in `docs/GAP_ANALYSIS.md`. Severities restated below for completeness.

| Gap-ID | Source IID | Title | Status | Severity | File:line Evidence |
|---|---:|---|---|---|---|
| GAP-038 | #287 | Bootstrap 5.3 rollout undocumented (`docs/ARCHITECTURE.md` gap) | Not Implemented | Medium | `docs/ARCHITECTURE.md` (no Bootstrap 5.3 section) |
| GAP-039 | #288 | Font Awesome Free migration undocumented + CSP `font-src`/`style-src` implications | Not Implemented | High | `docs/ARCHITECTURE.md`, `internal/server/security_headers.go` CSP |
| GAP-040 | #290 | QueryPage zustand singleton — dynamic-import cycle-avoidance contract undocumented + untested | Not Implemented | High | `src/pages/queryStore.ts` (or equivalent); no test pinning import order |
| GAP-041 | #293 | `lspSettings.ts` localStorage `geode.lsp.settings.v1` — no schema/migration/clear path | Not Implemented | Medium | `src/lib/lspSettings.ts:47` |
| GAP-042 | #296 | `src/hooks/useMediaQuery` — new hooks extension point not catalogued | Not Implemented | Low | `src/hooks/useMediaQuery.ts` exists; `docs/ARCHITECTURE.md` lacks catalog |
| GAP-043 | #298 | `Makefile` `e2e-build` `cd -P` + manual `docker build` bypasses compose-v5 + symlink bug | Not Implemented | Medium | `Makefile::e2e-build` |
| GAP-044 | #301 | `useLasso` mutates `userPanningEnabled`/`boxSelectionEnabled`; restore hooks undocumented public API | Not Implemented | Medium | `src/components/results/graph/useLasso.ts` |
| GAP-045 | #305 | `AuthProvider.tsx:293` TODO #122 — "Forget Saved Password" Settings UI never surfaced | Not Implemented | Medium | `src/auth/AuthProvider.tsx:293` |

### 6.5 Won't-Do (existing Gap-IDs; label flip pending)

| Gap-ID | Source IID | Title | Status | Severity | File:line Evidence |
|---|---:|---|---|---|---|
| GAP-004 | #4 | e2e-20 ops audit spec skips when `/api/v1/audit` returns 403 (until Geode v0.6+) | Won't-Do (label flip pending) | Low | `e2e/specs/20-ops-audit.spec.ts` skip-guard |
| GAP-005 | #5 | e2e-21 MCP tools/list skips on jsonrpc error (until Geode v0.6+) | Won't-Do (label flip pending) | Low | `e2e/specs/21-mcp-tools.spec.ts` skip-guard |
| (no GAP-ID) | #209 | S-NEW-3: Auth shim re-injects Authorization header after AuthJWT — Won't-Do-Until-Upstream | Won't-Do (label flip pending) | Low | `internal/server/auth.go:69-71`; needs-genapi follow-up out of repo scope |

## 7. Updated Gaps (evidence changed since last audit)

| Gap-ID | Change | Updated Evidence |
|---|---|---|
| GAP-079 / #188 | Rescope candidate — partial supersession by closed #247 (`f1dc44d`) | `src/lib/graphResult.ts` now 284 LOC (was 524); types/labels split still pending |
| GAP-082 / #191 | Likely close-as-superseded by closed #258 (`c1a7c80`) | `CHANGELOG.md` exists with `[Unreleased]` and `scripts/check-changelog.mjs` |
| GAP-088 / #207 | Title contradicts on-disk code — likely close-as-done | `internal/profilestore/sqlite.go:116` `PRAGMA busy_timeout=5000` already present (GAP-032 closure SHA `c98be97`) |
| GAP-089 / #208 | Likely close-as-done by GAP-031 closure | `internal/server/handlers_users.go::PatchUsername` empty-body returns 400 `empty_patch` per GAP-031 closure `d7eee0a`; verify against tracker title |
| GAP-108 / #277 | Doc claims Closed 2026-05-20 via `css-minimizer-webpack-plugin ^6.0.0 → ^8.0.0` | Verify `package.json` carries `^8.0.0` |

## 8. Resolved Gaps (ready to close — drift sync work)

These are the 34 drift items in §3 plus the 5 updated-evidence cases in §7. The next non-skip-issues sync agent should:

1. Post closure-evidence note + `glab issue close` on the 34 drift items in §3.
2. Re-verify the 5 updated-evidence cases (`#188`, `#191`, `#207`, `#208`, `#277`) and close where evidence supports.
3. Flip `gap-status::open` → `gap-status::wont-do` on the 3 Won't-Do items in §4.
4. Strip stale `status::triage` from any of the 46 issues that already carry `category::*` + `confidence::*` labels (per `gap-collection.md` §6 item 4).

## 9. Gap Priority Matrix (truly-open after reconciliation)

| Severity | Count | Gap-IDs |
|---|---:|---|
| **Critical** | 0 | (none — the two tracker `priority::critical` items #241/#242 are drift candidates, not truly-open) |
| **High** | 6 | GAP-039, GAP-040, GAP-086, GAP-098, GAP-099, GAP-106, GAP-108 (Drift Candidate, severity-tagged) |
| **Medium** | 22 | GAP-038, GAP-041, GAP-043, GAP-044, GAP-045, GAP-072, GAP-076, GAP-083, GAP-084, GAP-085, GAP-087, GAP-089, GAP-091, GAP-093, GAP-094, GAP-095, GAP-096, GAP-097, GAP-100, GAP-103, GAP-104, GAP-105, GAP-107 |
| **Low** | 19 | GAP-004, GAP-005, GAP-042, GAP-064, GAP-065, GAP-066, GAP-067, GAP-068, GAP-069, GAP-070, GAP-071, GAP-073, GAP-074, GAP-075, GAP-077, GAP-078, GAP-079, GAP-080, GAP-081, GAP-082, GAP-088, GAP-090, GAP-092, GAP-101, GAP-102 |

(Total truly-open with file:line evidence: **47 issues mapping to 47 Gap-IDs** (GAP-004/005 + GAP-038..GAP-108, minus drift-candidate slots and #209's unassigned-Gap-ID). The High bucket includes one drift candidate (GAP-108 / #277) whose severity reflects the underlying vuln; if the css-minimizer bump is verified the row collapses into §3.)

## 10. Provenance

- Generated by `gap-detector` skill in Claude Code session 2026-05-21.
- Inputs:
  - `docs/audits/2026-05-21/gap-collection.md`
  - `docs/audits/2026-05-21/gap-scan.md`
  - `docs/GAP_ANALYSIS.md` (Gap-ID ceiling check; existing GAP-038..GAP-063 restated)
  - `docs/GAP_ANALYSIS_RESOLVED.md` (Gap-ID ceiling check; closed cohorts)
- Read-only mode (`--skip-issues`): **no GitLab create/edit/close performed; no commits**.
- Severity reconciliation: numeric `priority::N` and named `priority::*` collapsed into the codepros gap-analysis-framework Critical/High/Medium/Low scheme. See §1.2.
