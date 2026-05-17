# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

This section backfills closure batches landed between v0.1.0 (2026-05-06)
and 2026-05-17. Entries are grouped by the date the cohort closed, then
by Keep-a-Changelog subsection. Issue numbers reference
`gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/<id>`.

### Added — 2026-05-12 batch

- Multi-pane query workspace at `/workspace` (1–4 tiled editor+result
  panes, each with its own WebSocket stream) and overview dashboard at
  `/dashboard` (cards for graphs, recent queries, connection status,
  on-demand graph stats). Both routes were later removed on 2026-05-16
  (workspace) — see Removed below.
- Persisted FIFO query-history store (`useQueryHistory`, capped at
  20 entries, `localStorage`-backed) feeding the dashboard's
  "recent queries" card; clicking a row prefills the editor via
  `?statement=...`.
- `useOverviewData` hook (eager graph list + capabilities, on-demand
  default-graph stats), `Card` shell + four dashboard cards
  (`GraphsCard`, `RecentQueriesCard`, `ConnectionCard`, `GraphStatsCard`).
- Server-side per-graph `GRANT`/`REVOKE` and `SHOW PERMISSIONS`
  alignment with Geode v0.5.15 GQL DDL grammar across user/role/policy
  admin handlers.
- `SHOW CAPABILITIES` + `SHOW VERSION` probe surface (#198).
- `useFillHeight`, `useGraphPathMode`, `useGraphElements` hooks extracted
  from `GraphView` (Bundle C decomposition, #192/#194/#195/#196).
- E2E specs for dashboard cards and workspace pane independence.

### Changed — 2026-05-12 batch

- Consolidated TypeScript config via `tsconfig.base.json`; dropped the
  `noImplicitAny` loophole (#194/#195/#196).
- `GraphSidebar`, `GraphToolbar`, `GraphInspector` extracted from
  `SelectedInspector` and the monolithic GraphView orchestrator.

### Fixed — 2026-05-12 batch

- Graph labelling: every placeholder endpoint now carries its own
  RETURN-variable label (was: actor names appeared on Movie nodes).
- Responsive graph sidebar + matrix view tolerate scalar-projection
  results.
- `policy_active`-style schema_cache reads no longer block writers
  (RWMutex on schema_cache, #223).
- 2-map limiter design eliminates the global mutex from the rate-limit
  hot path (#220).
- Embed FS Stat is cached for static asset hits (GAP-022 / #103).

### Security — 2026-05-12 batch

- `-trust-proxy-xff` flag gates `X-Forwarded-For` parsing; default off
  prevents IP spoofing via untrusted proxy chains (S-NEW-5 / #201).

### Added — 2026-05-13 batch

- Test fixtures + integration smoke for v0.5.15 auth DDL surface.
- Gap-close pipeline run report documenting eight closures.

### Changed — 2026-05-13 batch

- 2026-05-13 gap-close pipeline run resolved eight tracked items
  (closure note in `docs/GAP_ANALYSIS_RESOLVED.md`).

### Fixed — 2026-05-13 batch

- Annotated `gqlLanguage` parameter (Bundle C follow-up for #194).

### Added — 2026-05-14 batch

- ResultPanel maximize toggle (fullscreen mode) on both query and
  workspace surfaces.
- Test scaffolding for the v0.5.15 auth DDL transitions.

### Changed — 2026-05-14 batch

- Sidebar collapsibles persist per-section open state via
  `localStorage` (`useCollapsibleSection`).
- ResultPanel headers + footers refactored for shared usage from
  query / workspace pane surfaces.

### Fixed — 2026-05-14 batch

- Streaming-mode toggle no longer flickers between expand states on
  rapid run/cancel cycles.
- Audit log render: timezone label uses local zone abbreviation, not
  the raw IANA name.

### Added — 2026-05-15 batch

- `GraphFilterChips` strip mounted under the graph toolbar; surfaces
  active filters at a glance.
- `GraphToolbarMore` overflow menu for the rare graph toggles; toolbar
  splits into View / Filters / Analysis groups.
- Stream/Expand toggles moved into a query-page Options dropdown.
- `CollapsibleSection` wrapper for sticky sidebar details sections.
- Mobile-viewport E2E coverage for the data-view UX overhaul; canvas
  clamped to `60vh` min-height at mobile widths; fullscreen row hidden
  on touch.

### Changed — 2026-05-15 batch

- QueryPage made a viewport-filling flex column; tab-group flex-grows
  into the page column; table body grows to wrap container height (no
  720px cap); matrix wrap flex-fills the heatmap; JSON view drops the
  max-height cap.
- Graph canvas + sidebar always fill; the `fillHeight` variant dropped.
- Node-inspector picker tests migrated to `find-input`; Expand and
  graph-toolbar tests migrated to the More-dropdown pattern;
  graph-more-sidebar assertions switched from `aria-pressed` to
  `aria-checked`.

### Fixed — 2026-05-15 batch

- Profile rows: `width:100%` keeps the flex column from shrinking Page
  to content width.
- E2E console sweep filters Font Awesome data-URI fetch errors.

### Added — 2026-05-16 batch

- Password-generator UI + client-side Geode policy enforcement
  (`src/lib/passwordGenerator.ts`).
- Profile-name uniqueness enforced both client- and server-side.
- Sentinel-aware code generation (genapi v0.3.2 / v0.3.3 contracts).
- ADR-0001 documenting the generated API boundary (`docs/adr/`).
- Image-pin comment convention + staleness guard; pinned
  `golangci-lint` config + bootstrap.

### Changed — 2026-05-16 batch

- Ops sub-pages moved under the Admin tab strip; single admin surface
  for ops/admin functions.
- GitHub Pages + CI artifact target switched to `internal/ui/dist`
  (#226).
- pnpm-to-npm migration finished (#44 / GAP-017).
- Jest + Go coverage thresholds ratcheted (#48 / GAP-019).
- `make generate` regenerates `gen/` via genapi v0.3.2/v0.3.3, landing
  PERF #171, #167, #169, #163, #238 and S-NEW-3 upstream fixes.
- `newApp` split into four focused modules (#193).
- `TableView.tsx` split (multi-concern decomposition, #184).
- `GraphViewCytoscape` orchestrator split into focused hooks (#164;
  also split `GraphView.test.tsx` into three focused files).
- `golangci-lint` + `go test` scoped to project-owned trees (#174;
  also `bench-gate.sh` installs `benchstat` at the pinned version,
  #230).
- E2E + support scripts now typecheck under `test:ts` (#228).

### Fixed — 2026-05-16 batch

- Visibility-gated workspace pane suspension (#213, later moot after
  workspace removal).
- Sparse matrix cells + 60-label budget (#216); column budget + row
  cap + NDJSON export (#234/#236).
- Audit log polling visibility-gating regression test (#224); audit
  ring uses RWMutex (#246, landed 2026-05-17 — see below).
- `driftSeen` mutex on read-mostly warning dedupe (#221).
- Column descriptors marshalled once per response, not per column
  (#219).
- `Pool.DB` global mutex removed from read-mostly cache hits (#165).
- WS cancel-reader goroutines no longer leak (#218).
- Limiter unique-key map gains a TTL janitor (#225).
- `Result` codec per-row JSON allocation eliminated (#217).
- Dashboard graph stats run uncached and on-demand only (#237).
- Production source maps no longer embedded in SPA bundle (#235).
- GraphView resize/rebuild coalescing regression test (#222).
- CI uses `GOMODCACHE` cache keyed on `go.sum` (#175).
- `profiles.ts` uses the generated `Profile` type, not an `unknown[]`
  cast (#231).
- CI now reuses the build artifact in `go:test` (#229); Webpack CSS
  Minimizer warnings cleared (#232).
- act() warnings eliminated; fail-on-warning gate added (#227).

### Removed — 2026-05-16 batch

- `/workspace` route + `src/pages/workspace/*` + `WorkspacePage` +
  `e2e/specs/21-workspace.spec.ts` per user request; the visibility
  gating from #213 is retained in `usePaneVisibility` for potential
  future reuse but is currently unwired.

### Security — 2026-05-16 batch

- Go toolchain bumped to 1.26.3 (GO-2026-4918 / #212) with a
  stale-pin guard (#148) so go.mod, .goreleaser.yaml, Makefile,
  .gitlab-ci.yml, and README all agree on the single source.
- `Cipher.Rewrap` + `profilestore` rewrap-from sweep (S-NEW-8 / #211).
- JWT kid header + rotating secret map + ops runbook
  (S-NEW-7 / #210).
- Rate-limited `access_token_query` audit + Prom counter
  (S-NEW-6 / #206).
- `HandleLogout` best-effort JTI revoke + `auth_logout` audit
  (S-NEW-9 / #205).
- `-admin-users` default flipped to empty + `admin_bootstrap` audit
  (S-NEW-2 / #202).
- JWT secret placeholder + auth-shim deferral (F-SUP-5 / #161 +
  S-NEW-3 deferred).
- `copy-webpack-plugin` bumped to ^14 (post-`serialize-javascript`
  RCE) (F-SUP-2 / #72, F12 / #73).
- VulnDB seed escapes backslashes + dedups CLI-batch artefacts
  (#236).

### Fixed — 2026-05-17 batch

- Audit ring switched from `sync.Mutex` to `sync.RWMutex` so read
  traffic doesn't contend with the writer (#246).
- `streamStateToResp` rAF-throttles the `resp` identity, preventing
  per-row React rerenders in long streams (#239).
- `queryStreamReducer` retention cap + overflow banner: streams past
  the cap stop accumulating rows but flag the truncation in-band
  (#240).
- AdminPage migrated to `theme.text.*` tokens; eliminates last
  hardcoded colour literals on the admin surface (#250).
- `RoleGate` enforces required roles on `/admin` SPA routes + hides
  the nav link for unauthorised users (#264).
- AuditLogPage debounce + server-side limit; cuts re-fetch storm
  during rapid filter input (#243).
- Server-side profile-name NFKC normalisation (#241).
- Password-policy cross-stack contract test pins client/server policy
  parity (#242).
- `passwordGenerator` validates the fallback path and throws on
  budget exhaustion rather than degrading silently (#244).
- `projectColumns` no longer mutates the `Plan` object — input
  immutability is now a typed-contract (#248).
- `cytoscape-popper` dependency + typings shim removed; not used by
  any component path (#255).
- Geode admin test fixture renamed `test-admin` so it can't be
  mistaken for the runtime admin user (#267).
- Unused unicode import keeper dropped from `password_policy.go`
  (#245).

### Changed — 2026-05-17 batch

- `streamRowsOverWS` pools its `ptrs` slab via `sync.Pool` (#251).
- LSP reconnect backoff uses equal-jitter (was: exponential without
  jitter) — smoother behaviour under load (#254).
- CSRF refresh uses singleflight to prevent thundering-herd refresh
  stampedes (#257).
- Lazy chunks for Monaco + Cytoscape carry `webpackPrefetch` hints
  (#256).
- `/ws/ping` + `/ws/query` adopt the genapi `SameOriginOnly` middleware
  (Issue 265 follow-up).

### Removed — 2026-05-17 batch

- Workspace doc residue: README route list and PERF/QUALITY closure
  notes that still cited the deleted `/workspace` route. A new
  `scripts/check-doc-routes.mjs` pre-commit gate prevents
  resurfacing of the deleted path (#253).

### Security — 2026-05-17 batch

- `?access_token=` query fallback refusal staged at sunset (#71).
- `/ws/lsp` origin allowlist (CSWSH defense-in-depth, #265).
- Wildcard `wss:` dropped from CSP `connect-src` (#266).

### Documentation — 2026-05-17 batch

- Round-1 audit refresh (`docs/audit/2026-05-17/*`): 29 new findings
  recorded, 47 stale closures verified.
- Gap-tracking docs (`docs/GAP_ANALYSIS.md`,
  `docs/QUALITY_GAP_ANALYSIS.md`, `docs/PERF_GAP_ANALYSIS.md`,
  `docs/GAP_ANALYSIS_RESOLVED.md`) updated for the round-1 and round-2
  closure cohorts including closure SHAs.

## v0.1.0 — 2026-05-06

Initial release.

### Backend (Go API)

- `genapi`-generated REST API with 44 endpoints across query, schema discovery,
  transactions, user/role/policy/grant management, backup/restore, migrations,
  audit log, MCP, profiles, and login.
- WebSocket streaming GQL queries via `/ws/query`.
- HS256 JWT auth with `profile` and `roles` claims; `required_roles`
  enforcement on admin routes.
- Connection pool with multiple upstream profiles (functional-options config).
- Audit log with sensitive-key redaction; ring-buffer query endpoint.
- MCP `query` tool reachable at `/mcp`.

### Frontend (React + TypeScript SPA)

- Login + protected routes with `AuthProvider`.
- Connection profile picker.
- Monaco GQL editor with Monarch syntax highlighting.
- Tabular + JSON + interactive graph result views.
- Cytoscape graph visualization with label-coloured nodes and click-to-inspect.
- Schema explorer (graphs / labels / edge types / indexes / constraints).
- Admin UIs for users, roles, policies, grants.
- Ops UIs for backups, restore, migrations, audit log.
- WebSocket streaming queries with progressive table population.

### Infrastructure

- Multi-stage Dockerfile (Node web build → Go static binary → Alpine runtime).
- GitLab CI pipeline: `golangci-lint`, `make generate` verification,
  `go test -race -cover`, and `docker build`.
- `make` targets for build / test / generate / lint / dev.

[v0.1.0]: https://gitlab.com/devnw/geode/geode-ui/-/releases/v0.1.0
