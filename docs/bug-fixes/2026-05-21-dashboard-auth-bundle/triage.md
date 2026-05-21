# Triage — dashboard / auth / metrics bundle

Date: 2026-05-21
Branch: `main` @ `ca34382` (clean tree)
Triager: Claude (read-only investigation)

## Issues restated

1. Dashboard should be the default tab after login (currently lands on QueryPage).
2. Browser refresh forces re-authentication even though the HttpOnly cookie is still present.
3. Dashboard cards do not advance — only uptime + health move; queries/connections/storage/transactions stay at "—" or 0.
4. Graph-stats card requires manual click to "Load stats"; want auto-load, refresh button, and an all-graphs aggregate view that lives in the graphs section.

## Build / test / lint entry points

| Action          | Command                               | Config                          |
|-----------------|---------------------------------------|---------------------------------|
| Build (SPA)     | `npm run build`                       | `webpack.prod.js`               |
| Build (server)  | `go build ./...`                      | `go.mod`                        |
| Test (SPA)      | `npm test` (Jest)                     | `jest.config.cjs`               |
| Test (server)   | `go test ./...`                       | -                               |
| Test (e2e)      | `npm run e2e` (Playwright)            | `e2e/playwright.config.ts`      |
| Type-check      | `npm run test:ts`                     | `tsconfig.json`                 |
| Lint            | `npm run lint`                        | `.eslintrc.*`                   |
| Format          | `npm run prettier:check`              | `.prettierrc`                   |

---

## Bug 1 — Dashboard not the default tab after login

**Root cause.**
`src/App.tsx:186` mounts `QueryPage` at the index route inside the protected shell:

```
<Route element={<ProtectedShell />}>
  <Route index element={<QueryPage />} />
  <Route path="dashboard" element={<SuspenseDashboardRoute />} />
  ...
```

`LoginPage.tsx:125` navigates to `/` after a successful `signIn()`, which renders the `index` element — i.e. QueryPage. Comments in `App.tsx:15-19` even acknowledge "The dashboard isn't the landing page anyway — /login or /query is".

**Classification:** UX-decision / logic (intentional but no longer the desired default).

**Repro:** Start dev stack (`npm start` + `go run ./cmd/server`), navigate to `/login`, sign in. URL becomes `/` and QueryPage renders; the left-nav "Dashboard" tab is not selected.

**Fix complexity:** S — flip the index route to a Suspense-wrapped DashboardPage (or add `<Route index element={<Navigate to="dashboard" replace />} />`). Lazy chunk already exists.

---

## Bug 2 — Browser refresh clears the session (HIGH SEVERITY)

**Root cause.**
Two-channel auth: an HttpOnly cookie (`geode-ui-auth`, set in `internal/server/handlers_auth.go:195-203` with `MaxAge=expiresIn`, survives refresh) AND an in-memory `ConnectionState` map managed by `ConnectionsProvider`. `ProtectedRoute.tsx:20-22` redirects to `/login` unless BOTH `isAuthed` (sessionStorage hint, survives same-tab refresh) AND `active = useActiveConnection()` are truthy.

In browser (non-Electron) mode:
- `electron-bridge.ts:50` short-circuits `getStoredConnections()` to `[]` when no bridge is present.
- `connections.tsx:236` then dispatches `hydrate` with an empty list → `byId.size === 0`, `activeId = null`.
- `setLatestToken()` is never called, so the fetch wrapper (`client.ts:71-73`) has no Bearer either.
- Result: `active === null` → ProtectedRoute redirects to `/login` even though the cookie is still attached to the next request.

The cookie itself is correct (`HttpOnly`, `SameSite=Strict`, `MaxAge` set) — the bug is purely client-side: there is no cookie-driven session rehydration on bootstrap (grep confirms no `/api/v1/auth/me`-style endpoint is called).

**Classification:** logic / missing-feature (cookie persistence built but never re-read by the SPA).

**Repro:** Sign in via the browser at `/login`, navigate to `/dashboard`, hit F5. The shell unmounts and `/login` reappears even though `document.cookie`-side the `geode-ui-auth` cookie is still present (HttpOnly so devtools-only visible).

**Fix complexity:** M — needs either (a) a `/api/v1/auth/whoami` endpoint that reads the cookie, returns sub+roles+expiresAt, and lets `ConnectionsProvider` synthesize a `ConnectionState` on mount, or (b) widen the protected gate to allow `isAuthed && cookie-present` even without an active in-memory connection (and have the client.ts wrapper fall through to the cookie). Option (a) is cleaner.

---

## Bug 3 — Dashboard metrics don't advance (only uptime + health do)

**Root cause.**
End-to-end pipeline is healthy on the SPA side (`useMetricsPolling.ts` polls every 5 s, `MetricsCards.tsx` re-renders from `latest`/`history`). The wire shape matches the parser (`promparse.go` handles labeled gauges; sample at `internal/server/testdata/prom-geode-sample.txt` covers all 12 expected families). All 12 families ARE projected (`handlers_metrics.go:241-294`).

The smoking gun is the prom-text sample itself (`prom-geode-sample.txt:1-42`): every counter and gauge except `geode_server_uptime` and `geode_server_health` is literally `0`. `geode_server_uptime` advances because the upstream stamps process wall-time; `geode_server_health` is a constant `1`. Nothing else moves because **the upstream Geode metrics emitter is not being driven** (no queries, no connection traffic, no transactions) AND/OR the upstream binary at the configured `GEODE_METRICS_URL` only wires uptime+health into its `metrics_server.zig` and stubs the rest. Either way the SPA renders exactly what is on the wire.

A live curl against the dev compose stack (`GEODE_METRICS_URL=http://geode:9090/metrics` per `deploy/docker-compose.test.yml:157`) would confirm: if all twelve families come back as 0 even after the user runs a query in QueryPage, this is an upstream gap, not a SPA bug.

**Classification:** dependency / upstream emission (NOT a logic bug in geode-ui).

**Repro:** `curl -s http://geode:9090/metrics` inside the dev compose net while the SPA fires a few queries; observe whether `geode_queries_total` advances. If it stays at 0 → upstream side; file against the Geode Zig source (`src/monitoring/metrics_server.zig`).

**Fix complexity:** L (if upstream emitter needs new counters / instrumentation hooks) — outside geode-ui. S in geode-ui: nothing to change unless we want a "no upstream signal" banner on the cards (already shown as "—" today, which is correct).

---

## Bug 4 — Graph-stats "Load stats" UX

**Root cause / current shape.**
`useOverviewData.ts:235-287` exposes `loadStats(graph)` which only fires on explicit caller invocation. `DashboardPage.tsx:77-85` wires the button via `GraphStatsCard.onLoad`. `GraphStatsCard.tsx:106-113` renders a `LoadButton` until a stats object lands. The card hosts ONE graph at a time (`defaultGraph` from `pickDefaultGraph` in `DashboardPage.tsx:43-47`); there is no multi-graph aggregator and no refresh affordance after stats load.

Comments at the top of `GraphStatsCard.tsx:9-12` are explicit: "loaded on demand: until the operator clicks 'Load stats' the card shows only the button". The button-gated UX exists deliberately to avoid auto-firing two full-graph scans (`MATCH (n) RETURN count(n)` / `MATCH ()-[r]->()`).

**Classification:** missing-feature (UX request, not a regression).

**Repro:** Navigate to `/dashboard`. The graph-stats card shows a single graph name + "Load stats" button. Clicking once loads & caches (60s TTL per PERF #237). No refresh button after load. No "show all graphs" aggregate.

**Fix complexity:** M — three pieces:
- (a) Auto-load on mount once `defaultGraph` (or future "all graphs" set) resolves. Already has cache + 60s TTL so cost is bounded.
- (b) Refresh button next to loaded stats — small addition to `GraphStatsCard.tsx`, plus invalidate cache key on click.
- (c) Multi-graph aggregate — extend `useOverviewData.ts` with a `loadAllStats()` that walks `graphs[]` (cached TTL guards the cost). Card needs to render a small table.
- (d) Move the card adjacent to `GraphsCard` in the grid (`DashboardPage.tsx:64-101`) — pure JSX shuffle.

This is a follow-up feature, not a bug.

---

## Reproduction results

| Issue | Method | Outcome |
|-------|--------|---------|
| 1 | Read `src/App.tsx:186` + `src/pages/LoginPage.tsx:125`. | Confirmed: index route is QueryPage. |
| 2 | Read AuthProvider + connections.tsx + ProtectedRoute. Browser-mode `getStoredConnections()` returns `[]`; ProtectedRoute requires `active != null`. | Confirmed: in-memory only; no cookie rehydration. |
| 3 | Read `handlers_metrics.go`, `projectSnapshot`, `promparse.go`, `testdata/prom-geode-sample.txt`, `useMetricsPolling.ts`. SPA pipeline is correct; sample shows all counters at 0. | Upstream emission gap, not SPA. |
| 4 | Read `GraphStatsCard.tsx` + `useOverviewData.ts` + `DashboardPage.tsx`. | Confirmed: single-graph, manual-click UX is intentional today. |

## Root cause analysis

| Issue | Root cause                                                              | Type             | Files                                                                                                  | Fix order |
|-------|-------------------------------------------------------------------------|------------------|--------------------------------------------------------------------------------------------------------|-----------|
| 1     | `<Route index element={<QueryPage />} />`                               | UX-decision      | `src/App.tsx:186`                                                                                      | 2nd       |
| 2     | No cookie-based session rehydration on SPA bootstrap                    | logic / missing  | `src/auth/ProtectedRoute.tsx:20`, `src/api/connections.tsx:219-251`, `src/api/electron-bridge.ts:48-56` | 1st       |
| 3     | Upstream Geode emits only uptime/health non-zero                        | dependency       | external (`geode/src/monitoring/metrics_server.zig`); geode-ui surface is correct                      | 3rd       |
| 4     | Manual-load UX is current product behaviour, not a bug                  | missing-feature  | `src/components/dashboard/GraphStatsCard.tsx`, `src/lib/useOverviewData.ts`, `src/pages/DashboardPage.tsx` | 4th       |

## Dependencies between failures

- Bug 1 + Bug 2 interact: until Bug 2 is fixed, every refresh sends the user back to `/login`, masking whether the post-login landing tab is correct. Fix Bug 2 first so the user can verify Bug 1's fix actually sticks across reloads.
- Bug 4 lives entirely on the dashboard. Fixing Bug 1 (Dashboard as default) increases the perceived weight of Bug 4 since more users will see the card on first paint.
- Bug 3 is independent of all three and likely belongs in a different repo.

## Security / data integrity concerns

- Bug 2 is the only one with security relevance: the current behaviour forces the user to retype credentials more often than necessary, which (a) trains users to expect frequent re-auth (phishing risk uptick), and (b) increases the rate of password entry under shoulder-surfing exposure. Any fix MUST keep the JWT inside the HttpOnly cookie — do NOT introduce a localStorage echo as part of the rehydration path (would re-open the DOM-XSS exfil channel the SEC-F7 / #62 work closed). The cookie-driven `/auth/whoami` (or equivalent) endpoint is the safe shape; it returns sub + roles + expiresAt and the SPA synthesises a `ConnectionState` whose `token` is the literal `__cookie_mode_placeholder__` (already plumbed in `client.ts:56`).
- No data-integrity concerns on Bug 1, Bug 3, or Bug 4.

## Recommended fix order

1. **Bug 2** — highest severity, blocks user productivity, and is a prerequisite to verifying Bug 1's fix across reloads. Add a `/api/v1/auth/whoami` (or rename of an existing capabilities endpoint) that reads the cookie, returns `{ sub, profile, roles, expires_at, connection_id }`, and lets `ConnectionsProvider` synthesize an active connection on bootstrap. (M)
2. **Bug 1** — flip `<Route index>` to render Dashboard (or `Navigate to="dashboard"`). One-line change once routes are stable. (S)
3. **Bug 3** — file against the upstream Geode repo (`monitoring/metrics_server.zig`) to wire the remaining counters. No geode-ui change required; optionally add a "metrics emitter incomplete" banner on the cards if the operator complaint volume is high. (L upstream / S here)
4. **Bug 4** — feature work: auto-load on mount, refresh button, all-graphs aggregate, relocate next to GraphsCard. Track as a separate feature ticket since it is UX scope creep rather than a defect. (M)
