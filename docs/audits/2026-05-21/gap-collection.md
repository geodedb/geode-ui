# Gap Collection — geode-ui

- **Date:** 2026-05-21
- **Project:** `devnw/codepros/geode/geode-ui` (GitLab)
- **Branch:** `main` (clean working tree at HEAD `1199648`)
- **Mode:** `--skip-issues` (read-only; no GitLab create/edit/close operations performed)
- **Collector:** gap-collector, run by benji@codepros.org

## 1. Platform & Authentication

| Item | Value |
|---|---|
| Platform | **GitLab** |
| Remote | `git@gitlab.com:devnw/codepros/geode/geode-ui.git` |
| CLI | `glab` |
| Auth status | OK (`benjiv` on `gitlab.com`) with one warning: `! Invalid token provided in configuration file.` from `glab auth status`. Read API calls succeeded throughout this run, so the warning is informational; flagged below as a blocker-candidate for downstream sync agents. |

## 2. Issue-Tracker Inventory

GitLab issues are the source of truth. Counts captured at run time:

| Slice | Count |
|---|---:|
| **Open** | **87** |
| Closed | 100+ (page 1 of N, full enumeration not required for collection) |
| Open + labelled `gap` | 45 |
| Open + `type::security` | 4 |
| Open + `type::performance` | 13 |
| Open + `type::quality` | 34 |
| Open + `type::feature` | 1 |
| Open + `quality` (legacy umbrella label) | 23 |
| Open + `performance` (legacy umbrella label) | 12 |
| Open + `sec::remediation` | 13 |
| Open + `category::docs` | 12 |
| Open + `release-blocker` | 0 |

### Confidence breakdown (open)

| Confidence | Count |
|---|---:|
| `confidence::confirmed` | 45 |
| `confidence::suspected` | 11 |
| (unlabelled) | 31 |

### Status breakdown (open)

| Status | Count |
|---|---:|
| `status::triage` | 46 |
| `gap-status::open` | 38 |
| `gap-status::needs-doc` | 5 |
| `gap-status::in-progress` | 2 |
| `gap-status::wont-do` | 0 |
| `gap-status::resolved` | 0 |

### Priority breakdown (open)

Two coexisting priority taxonomies are in active use:

| Numeric (`priority::0..4`) | Count |
|---|---:|
| `priority::0` | 0 |
| `priority::1` | 1 |
| `priority::2` | 2 |
| `priority::3` | 4 |
| `priority::4` | 3 |

| Named (`priority::critical..low`) | Count |
|---|---:|
| `priority::critical` | 0 |
| `priority::high` | 7 |
| `priority::medium` | 32 |
| `priority::low` | 21 |

> The two priority systems overlap on the same issues in some cases (numeric is used for security/perf cohorts; named is used for quality and docs cohorts). Downstream agents should treat the union, not the intersection.

### Open issues by IID range

| Range | Cohort | Notes |
|---|---|---|
| #4 – #5 | GAP-004 / GAP-005 (upstream-Geode blockers) | Marked Won't-Do in docs but still labelled `gap-status::open` on tracker; doc/tracker drift. |
| #71 | SEC-F5 (`?access_token=` deprecation) | Sunset 2026-07-01. |
| #138 – #215 | Quality/Perf 2026-05-11/12 cohort | Q1/Q2/Q3/Q4/Q5/Q6/Q7/Q8/Q14/Q15/Q17/Q20/Q21/Q24/Q28/Q43/Q44/Q45/Q46/Q53/Q-NEW-B..H. |
| #226 – #233 | Audit 2026-05-15/16 cohort | CI / quality findings (8 items). |
| #234 – #263 | Audit 2026-05-17 Phase-4 cohort | 30 items spanning Q-NEW-1..15, PERF-2026-05-17-01..16. |
| #264 – #286 | Audit 2026-05-17 Phase-4 follow-on | S-NEW-10..13, S-2026-05-17-09..13, QUALITY-16..19, PERF-2026-05-17-11..16, GAP-034..037. |
| #287 – #325 | Audit 2026-05-19 Phase-4 cohort | 39 items: S-NEW-A..M, PERF-2026-05-19-01..07, Q-NEW-A..T, GAP-038..045. |

Source of truth listing for each open issue is available via:

```bash
glab api "projects/devnw%2Fcodepros%2Fgeode%2Fgeode-ui/issues?state=opened&per_page=100"
```

The full open-issue inventory at the time of this collection is enumerated below under [§7 Open Issue Inventory](#7-open-issue-inventory).

## 3. Label Taxonomy (Current State)

The project uses a richer-than-standard taxonomy. **100 labels** are defined; the following are the active ones the downstream gap-scanner / gap-detector / gap-sync agents need to recognise.

### Discovered-By cohort tags (3)

- `Discovered-By: 2026-05-13 audit`
- `Discovered-By: 2026-05-17 audit`
- `Discovered-By: 2026-05-19 audit`

### Area scopes (12)

`area::api`, `area::app`, `area::auth`, `area::build`, `area::ci`, `area::concurrency`, `area::db`, `area::electron`, `area::infra`, `area::repo`, `area::server`, `area::ui`

### Category facets (12)

`category::api-contract`, `category::architecture`, `category::ci`, `category::ci-cd`, `category::cleanup`, `category::complexity`, `category::concurrency`, `category::dead-code`, `category::deps`, `category::docs`, `category::duplication`, `category::maintainability`, `category::perf`, `category::readability`, `category::test`, `category::test-coverage`, `category::tests`, `category::ui`

### Type (the canonical taxonomy used by recent audits)

| Type | Counterpart legacy umbrella label |
|---|---|
| `type::feature` | — |
| `type::performance` | `performance` |
| `type::quality` | `quality` |
| `type::security` | `sec::remediation` / `sec::vuln` / `sec::accepted-risk` |

> The `gap-collector` should treat **`type::*` as canonical** and the umbrella `quality` / `performance` labels as legacy aliases that survive on older issues (most of #138-#233).

### Priority

| Two systems in use |
|---|
| Numeric: `priority::0`, `priority::1`, `priority::2`, `priority::3`, `priority::4` (security/perf cohorts) |
| Named: `priority::critical`, `priority::high`, `priority::medium`, `priority::low` (quality/docs cohorts) |

### Severity

| Severity | Notes |
|---|---|
| `severity::critical`, `severity::high`, `severity::medium`, `severity::low` | Standard 4-tier |
| `severity::info` | PerfSeverity Info |
| `severity::p0`, `severity::p1`, `severity::p2`, `severity::p3` | Performance-specific |

### Status / lifecycle

`backlog`, `backlog::prioritized`, `blocked`, `blocked-on-upstream-Geode`, `code-complete`, `customer::needs-information`, `dev::active`, `dev::blocked`, `dev::on-hold`, `docs::dev`, `docs::user`, `needs-revalidation::Geode-v0.5.18`, `needs-validation`, `qa`, `released`, `release-blocker`, `status::triage`

### Confidence

`confidence::confirmed`, `confidence::suspected`

### Gap tracking

`gap`, `gap-status::open`, `gap-status::in-progress`, `gap-status::needs-doc`, `gap-status::resolved`, `gap-status::wont-do`

### Security facets

`security::critical`, `security::high`, `security::medium`, `security::low`
`security::category::auth`, `security::category::config`, `security::category::crypto`, `security::category::input-validation`, `security::category::ipc-trust-boundary`, `security::category::logging-audit`, `security::category::rate-limiting`

### Perf facets

`perf::backend`, `perf::electron`, `perf::quick-win`, `perf::renderer`, `perf::startup`

### Epics / themes

`epic::secure-store-coalescing`, `psr` (Profile System Rebuild cohort), `jira-import::CP`, `jira-import::DEV`

### Standard label taxonomy verification (per gap-collector spec)

| Required label | Present? |
|---|---|
| `priority::critical` | yes |
| `priority::high` | yes |
| `priority::medium` | yes |
| `priority::low` | yes |
| `type::feature` | yes |
| `type::bug` | **MISSING** (no `type::bug`; bugs are surfaced via `type::quality` + `severity::high/critical` or via `category::*` facets) |
| `type::enhancement` | **MISSING** (project does not draw the feature-vs-enhancement line; both fall under `type::feature` or `type::quality`) |
| `type::security` | yes |
| `gap` | yes |

> Recommendation for the gap-sync agent: do not auto-create `type::bug` / `type::enhancement` — this project has explicitly chosen a different taxonomy. Treat them as **out of scope** for this repo.

## 4. Repo-Documentation Inventory

| Doc | Size (lines) | Role |
|---|---:|---|
| `README.md` | 207 | Project overview, quick start, configuration flags, e2e harness summary |
| `docs/README.md` | 14 | Doc-index stub |
| `docs/ARCHITECTURE.md` | 267 | Server architecture, auth, admin DDL (v0.5.15+), perf SLOs, metrics proxy |
| `docs/OPERATIONS.md` | 210 | Operational runbook (JWT rotation, etc.) |
| `docs/ELECTRON.md` | 211 | Electron desktop client |
| `docs/I18N.md` | 98 | Locale discipline |
| `docs/BOOTSTRAP_MIGRATION.md` | 108 | Bootstrap 5.3 migration narrative |
| `docs/CONNECTIONS_VS_PROFILES.md` | 63 | UX terminology |
| `docs/UI_AUDIT.md` | 313 | UI audit notes |
| `docs/web-awesome-migration.md` | 83 | Component-library migration notes |
| `docs/GAP_ANALYSIS.md` | 1176 | **Canonical GAP-NNN tracker** mirroring tracker state (last refreshed 2026-05-19) |
| `docs/GAP_ANALYSIS_RESOLVED.md` | 2092 | **Closure cohorts** evidence ledger |
| `docs/PERF_GAP_ANALYSIS.md` | 260 | Performance domain table |
| `docs/QUALITY_GAP_ANALYSIS.md` | 258 | Quality domain table |
| `docs/SECURITY_GAP_ANALYSIS.md` | 609 | Security findings table |
| `docs/adr/0000-record-architecture-decisions.md` | — | ADR meta |
| `docs/adr/0001-generated-api-boundary.md` | — | Generated-API contract rules |
| `docs/adr/0002-profile-store-dek-trust-model.md` | — | Profile-store crypto trust model |
| `docs/gap-closure-reports/2026-05-10..2026-05-13` | 9 reports | Per-pass closure narratives |

### Doc-derived requirements summary

The four `*GAP_ANALYSIS*.md` docs are **flat-file mirrors** of the tracker, not independent requirement sources. Every row has either an issue link (`[#NNN](...)`) or an explicit "Closed (resolved YYYY-MM-DD)" tombstone. Spot-check of recent rows confirmed each one is already represented on the tracker:

- `GAP-001` ... `GAP-045` — every Gap-ID has an issue (`#1` ... `#305`).
- `S-NEW-A..M` (2026-05-19 cohort) — `#300, #304, #308, #310, #313, #317, #318, #320, #321, #322, #323, #324, #325`.
- `PERF-2026-05-17-01..16` and `PERF-2026-05-19-01..07` — every row is represented.
- `Q-NEW-1..15`, `Q-NEW-A..Z` (umbrella naming) — every row is represented.

**No doc-only requirements were found that lack a tracker issue.** Per the `--skip-issues` mode contract, no creation actions were taken regardless; this section is informational.

### Requirement extraction from non-gap docs

| Source | Section | Requirement Class | Tracker Coverage |
|---|---|---|---|
| `README.md` | "Quick start" — `make build` + `openssl rand -hex 32` workflow | Operational, satisfied | (no issue needed) |
| `README.md` | "Configuration" — flags `-listen`, `-jwt-secret-hex`, `-jwt-ttl`, `-profiles`, `-trust-proxy-xff` | Functional contract | Reflected in code under `cmd/server/`. |
| `README.md` | "Security note — `-trust-proxy-xff`" links to #201 (S-NEW-5) | Security control | `#201` (closed cohort). |
| `README.md` | "E2E testing" — 10 specs / 31 tests; partial skips tied to GAP-IDs | Coverage contract | GAP-002..005 (see GAP_ANALYSIS.md). |
| `docs/ARCHITECTURE.md` | "Server-side admin DDL (Geode v0.5.15+)" — 11 supported wire ops + 11 upstream divergences | Functional spec | Divergence #10 ("login roles is null") tracked as `S-NEW-A` / `#300`. |
| `docs/ARCHITECTURE.md` | Performance SLOs (2000 rps / 400 concurrent / p50 10ms / 400-node graph / 1 MiB asset / 1.5 MiB entrypoint) | **Assumed**, not measured | `PERF_GAP_ANALYSIS.md` summary line 49-50 carries this caveat; no telemetry issue filed yet. |
| `docs/ARCHITECTURE.md` | Three-layer rate limit (global / per-route / per-IP) | Implemented | `#159` closed; pinned by `global_ratelimit_test.go`. |
| `docs/ARCHITECTURE.md` | `/api/v1/metrics` proxy contract (5s poll, 5min history, parser ≈280 LoC) | Implemented | Recent feature; covered by `handlers_metrics.go` + `promparse.go`. |
| `docs/OPERATIONS.md` | JWT secret rotation procedure (`JWT_SECRET_HEX_CURRENT/PREVIOUS`, 8h TTL window) | Operator contract | `#210` (closed). |
| `docs/adr/0001-generated-api-boundary.md` | "Hand-edits to `gen/` are forbidden — regenerate via `make generate`" | Process invariant | Enforced via `make generate`. |
| `docs/adr/0002-profile-store-dek-trust-model.md` | KEK/DEK two-tier vs single-tier env-keyed DEK | Design constraint | Open as `S-2026-05-17-10` / `#274`. |

All identifiable requirement statements in the non-gap docs are already either implemented and pinned by tests, or referenced by an existing tracker issue.

## 5. Top-Open Risk Surface (gap-detector seed)

These are the highest-signal items the downstream gap-detector/gap-scanner agents should prioritise for re-validation. Sorted by labelled priority+severity then issue age.

| # | IID | Title (truncated) | Type | Priority | Severity | Confidence |
|---|---|---|---|---|---|---|
| 1 | #300 | [S-NEW-A] authenticateUpstream returns nil roles — admin gate stale after CREATE USER ROLE admin (Scope-B Open; blocked-on-upstream-Geode) | security | priority::1 | security::high / severity::high | confirmed |
| 2 | #241 | [Q-NEW-1] Profile-name NFKC normalisation mismatch — client guard vs SQLite BINARY UNIQUE bypass | quality | priority::critical | severity::critical | confirmed |
| 3 | #242 | [Q-NEW-2] No password-policy drift guard between TS mirror and Go authority | quality | priority::critical | severity::critical | confirmed |
| 4 | #243 | [PERF-2026-05-17-03] AuditLogPage refetches per keystroke + server returns full 10k ring | performance | priority::high | severity::p0 | confirmed |
| 5 | #239 | [PERF-2026-05-17-01] streamStateToResp busts TableView/JsonView memos on every WS batch | performance | priority::high | severity::p0 | confirmed |
| 6 | #240 | [PERF-2026-05-17-02] queryStreamReducer.state.rows unbounded — needs retention cap | performance | priority::high | severity::p0 | confirmed |
| 7 | #244 | [Q-NEW-3] passwordGenerator fallback returns unvalidated password when retry budget is exhausted | quality | priority::high | severity::high | confirmed |
| 8 | #250 | [Q-NEW-7] AdminPage uses stale colors.text / colors.textSecondary tokens (dark-on-dark) | quality | priority::high | severity::high | confirmed |
| 9 | #291 | [PERF-2026-05-19-01] layoutWorker per-tick JSON-encode + toPosMap re-iteration — transferable Float32Array | performance | priority::high | severity::p1 | confirmed |
| 10 | #297 | [PERF-2026-05-19-03] WS frame parse uses JSON.parse on main thread — offload to worker for 100k-row streams | performance | priority::high | severity::p1 | confirmed |

> **Note on rows 4-6:** the doc trackers (`PERF_GAP_ANALYSIS.md`) record `#239`/`#240`/`#243` as **Closed 2026-05-17** with closure SHAs `7c2d867` / `da9df5e` / `ebf97d3`. The tracker still shows them as open. **This is doc/tracker drift** and the highest-priority gap-sync action for downstream agents.

## 6. Conflicts / Ambiguities (must be reconciled by gap-sync)

1. **Doc↔tracker drift on closed perf items** — `PERF_GAP_ANALYSIS.md` lists at least 9 items (#239, #240, #243, #246, #249, #251, #254, #256, #257, plus #275/#278/#281/#284/#285/#286 from the round-3 cohort) as Closed with SHAs, but they remain `state=opened` on the tracker. Same pattern for SECURITY (#264-#283 region) and QUALITY (#244-#271 region) closures. Cause: prior `--skip-issues` audit passes; the 2026-05-17 gap-sync round-1 ran a catch-up but the round-3/round-4 closures filed only in docs are still un-mirrored.
2. **GAP-004 / #4 and GAP-005 / #5** — docs mark Won't Do (until Geode v0.6+); tracker labels still include `gap-status::open` for many in this family. The 2026-05-17 round-2 sync was supposed to flip GAP-002 / #2 and GAP-003 / #3 to `gap-status::wont-do`; #4 / #5 are documented Won't Do (2026-05-16) but lack the label flip.
3. **Dual priority systems** — `priority::0..4` (security/perf cohorts) coexists with `priority::critical..low` (quality/docs cohorts). The gap-scanner should treat these as equivalent buckets:
   - `priority::0` / `priority::critical`
   - `priority::1` / `priority::high`
   - `priority::2` / `priority::medium`
   - `priority::3` / `priority::low`
   - `priority::4` / (no named equivalent — informational)
4. **`status::triage` on closure-pending items** — 46 of 87 open issues still carry `status::triage` even though many have been domain-classified. Downstream agents may safely treat any issue with `category::*` and `confidence::*` labels as triaged, regardless of the `status::triage` label.
5. **No `type::bug` / `type::enhancement` labels exist** — gap-collector spec asks for them, but the project's chosen taxonomy uses `type::quality` + severity instead. Treat as a documented divergence, not a gap.
6. **`glab` token warning** — `glab auth status` returned `! Invalid token provided in configuration file.` despite successful API calls. Downstream gap-sync agents will need write-capable credentials; this token may need rotation before sync runs.

## 7. Open Issue Inventory

Captured at 2026-05-21 from `glab api projects/devnw%2Fcodepros%2Fgeode%2Fgeode-ui/issues?state=opened&per_page=100`. 87 total. Listed newest first.

| IID | Cohort/ID | Title (truncated to 90) |
|---:|---|---|
| #325 | S-NEW-M | emitAudit calls in rejectLogin include key with embedded NUL byte — SIEM truncation risk |
| #324 | S-NEW-L | GO-2026-4918: golang.org/x/net@v0.52.0 indirect (fixed in v0.53.0) — unreached today |
| #321 | S-NEW-I | injectAuthIntoInitialize: no depth/size cap on LSP initialize JSON re-emit |
| #320 | S-NEW-H | mcpx.SetAuthVerifier is process-wide global — embedding-only architectural risk |
| #319 | Q-NEW-H+U+V+W+X+Y+Z | Docs umbrella: useLasso JSDoc + 6 missing design/operations notes |
| #318 | S-NEW-G | CSRF middleware exempts /api/v1/auth/logout — defense-in-depth gap |
| #317 | S-NEW-F | peekLoginCreds: multipart/form-data falls through, limiter bucket desyncs |
| #315 | Q-NEW-T | performance.mark('graph:firstInteractive') skips streaming-gate branch |
| #313 | S-NEW-E | JWT kid rotation does not mass-revoke legacy tokens — operator-expectation gap |
| #311 | Q-NEW-P | QueryPage stream.status history-record can re-fire on rapid status flips |
| #310 | S-NEW-D | Login min-failure-latency floor bypassed on JWT-issuer-nil / Profiles-nil 500 paths |
| #309 | Q-NEW-O | cy.on tap handlers added inside rebuild closure not removed before cy.destroy() |
| #307 | Q-NEW-N | Module-level lastRebuild singleton in useGraphCytoscape breaks multi-instance graph mounts |
| #306 | PERF-2026-05-19-05 | streamRowsOverWS sequential scan-encode-write — overlap with producer goroutine |
| #305 | GAP-045 | AuthProvider.tsx:293 TODO #122 — Forget Saved Password Settings UI never surfaced |
| #304 | S-NEW-B | -admin-users CSV is case-sensitive and not NFKC-normalised |
| #303 | Q-NEW-G+I+J+K+L+M | Type-safety + API-contract umbrella |
| #302 | PERF-2026-05-19-04 | WS protocol is JSON-only — evaluate MessagePack/CBOR for stream frames |
| #301 | GAP-044 | useLasso mutates userPanningEnabled/boxSelectionEnabled; restore hooks undocumented |
| #300 | S-NEW-A | authenticateUpstream returns nil roles — admin gate stale after CREATE USER ROLE admin |
| #299 | Q-NEW-F | TableView 615-LOC monolith mixes styled-components, virt math, VirtualRow, exportNdjson |
| #298 | GAP-043 | Makefile e2e-build cd -P + manual docker build — bypasses compose-v5 + symlink bug |
| #296 | GAP-042 | src/hooks/useMediaQuery — new hooks extension point not catalogued |
| #295 | Q-NEW-D+E | QueryPage 4-concern useEffect surface |
| #294 | PERF-2026-05-19-02 | layoutCache.get clones full PosMap on every hit — drop defensive clone |
| #293 | GAP-041 | lspSettings.ts localStorage geode.lsp.settings.v1 — no schema/migration/clear path |
| #292 | Q-NEW-A+B+C+S | useGraphCytoscape rebuild closure decomposition + useWhenCy helper |
| #290 | GAP-040 | QueryPage zustand singleton — dynamic-import cycle-avoidance contract undocumented |
| #288 | GAP-039 | Font Awesome Free migration undocumented + CSP font-src/style-src implications |
| #287 | GAP-038 | Bootstrap 5.3 rollout undocumented (docs/ARCHITECTURE.md gap) |
| #277 | S-2026-05-17-11 | serialize-javascript HIGH advisories in dev-tree via css-minimizer-webpack-plugin |
| #263 | Q-NEW-15 | NDJSON export concatenates whole body into one string before Blob |
| #262 | Q-NEW-14 | passwordGenerator tests contain probabilistic assertions on real-RNG output |
| #261 | Q-NEW-13 | Codify cross-stack contract-mirror discipline (ADR + active pair registry) |
| #260 | Q-NEW-12 | bench-baseline.txt is 5 days stale |
| #258 | Q-NEW-11 | CHANGELOG.md is stale — 50 issue closures since v0.1.0 are not recorded |
| #257 | PERF-2026-05-17-09 | refreshCsrfToken() stampedes under concurrent 403s — singleflight guard |
| #256 | PERF-2026-05-17-08 | Lazy imports lack webpackPrefetch hints for Monaco/Cytoscape/reagraph |
| #255 | Q-NEW-10 | cytoscape-popper is a dead dependency |
| #254 | PERF-2026-05-17-07 | LSP reconnect schedule has no jitter — thundering herd on bounce |
| #253 | Q-NEW-9 | Workspace doc residue: README/PERF/QUALITY cite removed /workspace paths |
| #252 | Q-NEW-8 | AdminPage 8-tab flat nav lacks overflow strategy |
| #251 | PERF-2026-05-17-06 | streamRowsOverWS allocates row+ptrs slabs per row — pool ptrs |
| #250 | Q-NEW-7 | AdminPage uses stale colors.text / colors.textSecondary tokens |
| #249 | PERF-2026-05-17-05 | useGraphElements rebuilds 3 Maps per baseEls change |
| #248 | Q-NEW-6 | projectColumns mutates Plan via type cast — replace with immutable copy |
| #247 | Q-NEW-5 | extractElements is a 181-LOC multi-concern function |
| #246 | PERF-2026-05-17-04 | audit ring uses Mutex; snapshot blocks emit hot path — use RWMutex |
| #245 | Q-NEW-4 | password_policy.go uses dead import-keeper for unicode.IsDigit |
| #244 | Q-NEW-3 | passwordGenerator fallback returns unvalidated password when retry budget is exhausted |
| #243 | PERF-2026-05-17-03 | AuditLogPage refetches per keystroke + server returns full 10k ring |
| #241 | Q-NEW-1 | Profile-name NFKC normalisation mismatch |
| #240 | PERF-2026-05-17-02 | queryStreamReducer.state.rows unbounded |
| #239 | PERF-2026-05-17-01 | streamStateToResp busts TableView/JsonView memos on every WS batch |
| #215 | Q-NEW-I | LocalizationProvider 49.35% coverage — untested fallback-locale + lazy-load |
| #214 | Q-NEW-H | AdminPage / OpsPage: pathname.endsWith('/users') is fragile active-tab matcher |
| #209 | S-NEW-3 | Auth shim re-injects Authorization header after AuthJWT — structural genapi follow-up |
| #208 | Q-NEW-G | handlers_users.go: empty PATCH fabricates synthetic User response |
| #207 | Q-NEW-F | profilestore/sqlite.go writer handle lacks busy_timeout |
| #204 | Q-NEW-D | rowBatcher.flush: stale envelope.Rows slice header suspect |
| #203 | Q-NEW-E | handlers_uploads.go: os.Rename silently overwrites colliding filenames |
| #200 | Q-NEW-B | cmd/server/app.go: WSServer.Config is a partial duplicate of server.Config |
| #199 | Q-NEW-C | startCancelReader inner relay goroutine: parked in readMsg with no context cancel |
| #197 | Q53 | handlers_capabilities.go hardcodes admin_writable={users,roles,policies:false,…} |
| #191 | Q46 | No CHANGELOG.md — seed from git log and adopt Keep-a-Changelog discipline |
| #190 | Q45 | GraphView/graphResult sparse 'why' comments |
| #189 | Q24 | Admin handlers accept name/policy/role dual-key for forward-compat |
| #188 | Q20 | lib/graphResult.ts 524 LOC — split into types/extract/labels |
| #187 | Q4/Q5/Q6 | Tighten export surface — useProfileForm / lib/graphResult / GqlNode-RbacAction |
| #186 | Q2 | Backups DeleteFile vs Migrations Sign duplicate body — extract actUploadFile |
| #185 | Q28 | gqlLanguage.ts (Monaco tokenizer) at 33% coverage |
| #183 | Q7 | AuthProvider.test.tsx 1009 LOC, 8 near-identical fetch-mock setups |
| #182 | Q3 | handlers_tx.go Commit vs Rollback duplicate body — extract finalizeTx |
| #181 | Q43 | Add internal/jwt/README.md — package docs for Issuer + RevocationSet + sweeper |
| #179 | Q44 | Add docs/RUNBOOK.md (rotate GEODE_PROFILESTORE_KEY/JWT, read audit, backup retention) |
| #176 | Q34 | deploy/Dockerfile npm-ci-before-COPY ordering needs an invariant comment header |
| #166 | Q21 | SHOW-catalogue list handlers still use []jsontext.Value |
| #162 | Q17 | projectColumns 155 LOC dense triple-loop |
| #157 | Q15 | profilestore/sqlite.go Patch 87 LOC, 4 seal-then-error blocks |
| #155 | Q14 | stageUpload 94 LOC + repeated error blocks |
| #152 | Q11 | RevocationSet.Sweep nestif 6 — extract sweepDurable/sweepJti/sweepPasswordChangedAt |
| #141 | Q8 | PatchUsername cognitive ~45 — decompose into validate+apply helpers |
| #139 | PERF-2026-05-11-05 | BenchmarkPostProfile async-reload allocs 16181/op vs sync 1601/op |
| #138 | Q1 | Three SHOW-list handlers duplicate body — extract listRowsAsJSONValues |
| #71 | SEC-F5 | Deprecate ?access_token= query fallback (sunset 2026-07-01) |
| #5 | GAP-005 | e2e-21 MCP tools/list skips on jsonrpc error (Won't-Do until Geode v0.6+) |
| #4 | GAP-004 | e2e-20 ops audit spec skips when /api/v1/audit returns non-2xx |

## 8. Reconciled Requirements (compact)

The reconciled requirements set is the **set of 87 open tracker issues**, each of which has a corresponding row in one of the four `*GAP_ANALYSIS*.md` docs. Downstream agents should treat this as the canonical input:

- 1 `type::feature` (#305 GAP-045 Forget-Saved-Password Settings UI).
- 13 `type::performance` + 12 legacy `performance`-tagged perf items (PERF-2026-05-{11,15,17,19}-NN).
- 4 `type::security` + 13 `sec::remediation` security items (S-NEW-A..M, S-2026-05-17-NN, SEC-F5).
- 34 `type::quality` + 23 legacy `quality` items (Q-NEW-A..T, Q1..Q53, QUALITY-16..19).
- 45 items carry the `gap` label (the gap-collector's canonical bucket); the remaining 42 carry only the umbrella `quality` / `performance` labels and should be **also** treated as gaps by downstream agents.

## 9. Blockers / Open Items for the Pipeline

| # | Blocker | Severity | Recommended owner |
|---|---|---|---|
| 1 | Doc↔tracker drift: ~24 perf+quality+security issues marked Closed in docs but still `state=opened` on tracker. | High | gap-sync agent (next non-skip-issues run) |
| 2 | `glab` config token shows as invalid; read API worked but write may fail. | Medium | Operator (rotate token before next sync) |
| 3 | GAP-004 / GAP-005 (and possibly others) marked Won't-Do in docs but lack `gap-status::wont-do` label flip. | Low | gap-sync agent |
| 4 | `status::triage` label is stale on 46 of 87 open issues. | Low | gap-sync agent |
| 5 | Dual priority taxonomies (`priority::0..4` vs `priority::critical..low`) — downstream agents must collapse before scoring. | Low | gap-scanner / gap-detector |

## 10. Provenance

- Generated by `gap-collector` skill running in Claude Code session 2026-05-21.
- Read-only data sources:
  - `glab issue list` (open + closed page-1 sampling)
  - `glab api projects/devnw%2Fcodepros%2Fgeode%2Fgeode-ui/issues?...`
  - `glab label list -P 200`
  - `docs/*.md` (file-system read)
- No GitLab create/edit/close operations were performed in this run.
- No commits or pushes were made by this skill.
