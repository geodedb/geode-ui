# Gap Closure Completion Report -- 2026-05-11

- **Repository:** `devnw/codepros/geode/geode-ui`
- **Branch:** `main`
- **Verifier:** GREEN (all CI gates clean)
- **Run window:** 2026-05-11 follow-up gap-close pass (follow-up to the 2026-05-10 run)

## Summary

| Metric                              | Value                                            |
|-------------------------------------|--------------------------------------------------|
| Gaps closed (this session)          | **9** (F10, F12, F13, N2, N7-remainder, Q5, Q8, PSR-F5, PSR-F15) |
| Gaps won't-do (this session)        | **1** (F18)                                      |
| Gaps still deferred                 | **1** (F3 — perf streaming response; `genapi#216`) |
| geode-ui commits this session       | **9** (one per closed/won't-do gap; Q5+Q8 share `2046289`) |
| genapi commits this session         | **3** (`fd31bbc`, `5dd5f61`, `7eaf8a1`)          |
| Bookkeeping commit (this report)    | 1                                                |
| Genapi-paired closures              | 2 (F13, N7-remainder — both genapi `fd31bbc`)    |
| Build / CI status                   | GREEN                                            |

This run cleared four of the five items that were deferred-to-genapi in the 2026-05-10 run
(F13 #57, N7-remainder #66, Q5 #34, Q8 #38) plus five standalone perf/quality/security items,
and closed F18 (#61) won't-do after a benchmark refuted its premise. genapi was **pushed to
origin** (the 2026-05-10 commits `1033c50` / `df654de` / `e100aed` are now pushed too).

**Backlog status after this run** (against the *original* perf/quality/security backlogs):

- **PERF:** only F3 left, and it is *deferred* (per-endpoint streaming-template work — needs a
  dedicated genapi cycle; tracked at `genapi#216`). Everything else is closed or won't-do.
- **QUALITY:** clean. Every Q-series engineering gap is closed. Q-NEW-T1 / Q-NEW-T3 / Q-NEW-T4
  are *adoption-decision-blocked* tooling gaps (Storybook/Chromatic choice; Lighthouse-CI
  preview-URL infra; `jest-axe` adoption), not engineering gaps. Q-NEW-T2 (webpack bundle
  budget) was actually wired by the F10 closure and the overstated 2026-05-08 doc row was
  corrected.
- **SECURITY:** clean. Every N-series gap is closed. S-NEW-1 (Electron-packaging surface) is
  *release-engineering-blocked*; S-NEW-6 (`security.txt` mailto routability) is *ops/DNS-blocked*.

## Closed by Category

### Performance (4) -- `docs/PERF_GAP_ANALYSIS.md`

| ID       | Title                                                            | Commit    | genapi pairing |
|----------|------------------------------------------------------------------|-----------|----------------|
| F10 (#54)  | Monaco + Cytoscape lazy code-split via `React.lazy`; webpack entrypoint 12.8 MiB → 454 KiB; budget tightened to `hints:'error'`/1.5 MiB; corrected the overstated Q-NEW-T2 doc row | `130e413` | — |
| F12 (#56)  | Server-wide `WriteTimeout` was dead config — closed the footgun: `wsExemptTimeoutHandler` caps REST+SPA at 60s, routes `/ws/` around it; per-frame WS deadlines already enforced via `wsx.Options` 30s, now documented + regression-tested | `13b7d5c` | — |
| F13 (#57)  | gzip middleware in genapi `pkg/httpx` — text-ish JSON ≥ 1 KiB, `Vary`, pooled BestSpeed writers, `Hijack` passthrough; pprof already gated behind `Observability.EnableDebug` + authSurface (no change); jsontext-pool sub-item dropped (`json.MarshalWrite` writes straight to the `ResponseWriter`) | `58b285f` | genapi `fd31bbc` |
| PSR-F5 (#103) | On-the-fly gzip for embedded SPA assets in `internal/ui/embed.go`; pooled `gzip.Writer`s; binary/tiny files served raw; `index.html` no-cache vs hashed-asset-immutable preserved | `d5126ad` | — |
| PSR-F15 (#112) | Precompute zero-value `tls` / `pool_overrides` wire encodings (`zeroTLSWire` / `zeroPOWire`) — skips a `json.Marshal` per zero-valued profile row on the list path; bytes byte-identical to a fresh marshal | `7e611a2` | — |

### Quality (2) -- `docs/QUALITY_GAP_ANALYSIS.md`

| ID       | Title                                                            | Commit    | genapi pairing |
|----------|------------------------------------------------------------------|-----------|----------------|
| Q5 (#34)  | Typed multipart upload endpoints — `POST /api/v1/backups/upload` + `/api/v1/migrations/upload` declared in `geode.json` using genapi's existing multipart `"type":"file"` support; removed hand-rolled `mux.HandleFunc`; rewrote `handlers_uploads.go` to generated signatures; replaced raw `fetch`/`FormData` in `MigrationsPage.tsx` + `RestorePage.tsx` with `client.migrationUpload` / `client.backupUpload`; removed orphaned `errors.uploadFailed` locale key | `2046289` | — (existing genapi support) |
| Q8 (#38)  | Typed `User` / `Permission` list responses — `geode.json`: `UserList.users → array<User>`, new `Permission` schema, `PermissionList.permissions → array<Permission>`; `handlers_users.go` `GetUsers`/`Permissions` build typed slices via `userFromRow` / `permissionFromRow` projecting runtime-discovered SHOW-catalogue columns onto known fields, dropping unknowns with a once-per-process `warnRowDrift` log; `UsersPage.tsx` imports `User` from `@api` | `2046289` | — (existing genapi support) |

### Security (2) -- `docs/SECURITY_GAP_ANALYSIS.md`

| ID       | Title                                                            | Commit    | genapi pairing |
|----------|------------------------------------------------------------------|-----------|----------------|
| N2 (#64)  | JWT revocation — `crypto/rand` 128-bit `jti` per token + in-memory `RevocationSet` (`sync.Map` jti→exp + `sync.Map` username→passwordChangedAt) consulted by `Issuer.Parse`; revoke-on-password-change in both password handlers; sweeper wired in `cmd/server/main.go`; clears `gosec G120`; in-memory caveat documented (state lost on restart, durable store is the upgrade path) | `ed9e69c` | — |
| N7-remainder (#66) | Global per-IP rate limiter `PeerLimiter` in genapi `pkg/httpx` — token bucket per IP, idle sweeper, configurable key source (`remote_addr`/`x-forwarded-for`/`x-real-ip`/`tls-subject`), `per_ip_rps=0` disables, 429 + `Retry-After` body matching the per-route limiters; geode-ui wired at 50 rps / burst 100 keyed on `RemoteAddr`; supersedes the 2026-05-07 `8e9f5d2` login-only partial | `bc10708` | genapi `fd31bbc` |

## Won't-Do

| ID       | Title                          | Commit    | Reason |
|----------|--------------------------------|-----------|--------|
| F18 (#61) | Driver re-parse / stmt cache  | `06e98f1` | Benchmark `internal/conn/pool_bench_test.go` (`BenchmarkParseVsExecute`, `BenchmarkParseFraction`) refutes the premise: (1) parse is ~10% of a modelled round-trip — under the ~20% threshold the AC set for landing the cache; (2) more decisively, the **geode driver has no server-side prepared statements** — `geode.Conn.PrepareContext` does no round-trip and just stashes the query text, and `geode.Stmt.QueryContext` re-sends that text via `conn.QueryContext(ctx, s.query, args)`, so the server re-parses on every call regardless of whether a `*sql.Stmt` was used. A stmt cache has nothing to amortise. Re-open only if the geode driver gains real server-side prepare/parse-cache support. |

## Still Deferred

| ID       | Title                          | Tracking | Notes |
|----------|--------------------------------|----------|-------|
| F3 (#25) | `handlers_query` fully synchronous; TTFB == TTLB; needs streaming JSON | `genapi#216` | Heaviest of the five 2026-05-10 deferrals: per-endpoint streaming-template design — a schema flag, a changed handler signature, flush wiring in `cmd/genapi/templates/api.go.tmpl` (chunked Marshal + WriteHeader-then-stream), plus adapting `internal/server/handlers_query.go`. Ran past this run's time budget. Design notes intact in `docs/PERF_GAP_ANALYSIS.md` → "Closure run 2026-05-11" / findings table row 7. Needs a dedicated genapi work cycle. |

## Build Verification (verifier CI gates)

| Gate                | Result |
|---------------------|--------|
| `make build`        | PASS — webpack entrypoint **454 KiB** (was 12.8 MiB) |
| `make go-test`      | PASS — `internal/server` 77.2% (↑ from 75.7%), `internal/jwt` 88.1%, `gen/pkg/httpx` 67.6%, `internal/conn` 83.2%, `internal/ui` 86.1% |
| Jest                | PASS — 378/378 |
| `tsc --noEmit`      | clean |
| `golangci-lint`     | clean |
| `eslint`            | clean |
| `gosec G120`        | cleared (N2 — `jwt.Issuer.Issue` now reads `crypto/rand` for the 128-bit `jti`) |
| Gap-row state       | all 9 closable rows verified Closed; F18 = Won't-do; F3 (perf) = Deferred |
| Working tree        | clean except the known pre-existing exceptions (`e2e/specs/01`, `02`, `15`, `electron/main.ts`, untracked detritus) |
| genapi              | builds clean, working tree clean, **pushed to origin** |

## Notable Findings During This Run

- **F12 was a footgun, not a live bug.** The server-wide `WriteTimeout` was *dead config* — the
  hand-rolled `*http.Server` in `cmd/server/main.go` only set `ReadHeaderTimeout`, and
  `httpx.WrapHandler` consumes only `MaxBodyBytes`/CORS from its `Config`, so WS streams >60s were
  not in fact being killed at 60s. The closure removes the dead config and adds an explicit 60s
  `http.TimeoutHandler` (`wsExemptTimeoutHandler`) on the REST + SPA surface that `/ws/` is routed
  *around* (TimeoutHandler buffers + drops `http.Hijacker`, both fatal for a streaming upgrade);
  per-frame WS deadlines were already enforced via `wsx.Conn` + the 30s `wsx.Options`.
- **F18 was closed by architecture, not just the 20% threshold.** Even if parse cost were above the
  20% AC, the geode driver has no server-side prepared statements, so an LRU `*sql.Stmt` cache has
  nothing to amortise — the server re-parses every call regardless.
- **Q5 + Q8 needed NO genapi change.** Both turned out to need only `geode.json` config — multipart
  `"type":"file"` request schemas (Q5) and `"items":{"$ref":"Schema"}` typed list items (Q8) both
  already exist upstream in genapi.
- **F10 entrypoint dropped 96%** — 12.8 MiB → 454 KiB (`vendors.js` ~12.5 MiB → ~290 KiB; monaco +
  cytoscape now ~6.7 MiB + ~3.8 MiB on-demand async chunks). The build now passes `hints:'error'`.
- **The Q-NEW-T2 webpack-budget doc row was overstated and got corrected.** Since 2026-05-08 it
  claimed the budget was wired, but the file still carried `hints:'warning'` + 16 MiB caps until
  the F10 commit actually wired `hints:'error'` / 1 MiB asset / 1.5 MiB entrypoint.
- **genapi was finally pushed** — it had been 10 commits ahead of origin (the three 2026-05-10
  commits `1033c50` / `df654de` / `e100aed` plus this run's `fd31bbc` / `5dd5f61` / `7eaf8a1` and
  prior in-progress work).
- **gosec G120 cleared** by N2 — `crypto/rand` is now used in `internal/jwt` for the per-token `jti`.

## Follow-ups for Next Session

- **GAP-F3 (perf — streaming response).** Needs a dedicated genapi work cycle: streaming-template
  redesign of `cmd/genapi/templates/api.go.tmpl` (chunked Marshal + WriteHeader-then-stream) plus a
  per-endpoint opt-in contract change, then adapt `internal/server/handlers_query.go`. Tracked at
  `genapi#216`.
- **genapi pre-existing `tsc moduleResolution=node10` deprecation test failures**
  (`TestGeneratedClients_ReactSecurityHygiene` and friends) — needs an `ignoreDeprecations` bump in
  the generated `tsconfig`. Pre-existing on the genapi side, not introduced by this run.
- **N2 durable revocation-store upgrade (SQLite row / Redis)** if ops wants revocation state to
  survive a process restart. The current in-memory `RevocationSet` is acceptable given the short JWT
  TTL (1m..24h, 8h default) but a token revoked before a restart validates again until natural TTL.
- **The `0o640` upload-tmp-file `gosec G302`/`G304` annotation** on the new `handlers_uploads.go`
  atomic-write path — review and annotate (or tighten) the temp-file perms / path handling.
- **e2e docker image rebuild** to exercise F13 gzip + N7-remainder per-IP limiter live (the e2e
  Dockerfiles need a rebuild to pick up the regenerated server + `geode.json` config keys).

## Tracking Files Touched

- `docs/GAP_ANALYSIS_RESOLVED.md` — new "2026-05-11 closure run -- follow-up batch" section (9
  RESOLVED entries + 1 WON'T DO entry) + "Index by closure date" row + `Last updated` bump.
- `docs/PERF_GAP_ANALYSIS.md` — F10, F12, F13, F18, PSR-F5, PSR-F15 rows now carry
  "Closed/Won't-do (resolved 2026-05-11)" + a back-pointer anchor to `GAP_ANALYSIS_RESOLVED.md`;
  F3 row unchanged (still Deferred); `Last updated` bump.
- `docs/QUALITY_GAP_ANALYSIS.md` — Q5, Q8 rows carry "Closed (resolved 2026-05-11)" + back-pointer
  anchor; `Last updated` bump.
- `docs/SECURITY_GAP_ANALYSIS.md` — N2, N7 rows carry "Closed (resolved 2026-05-11)" + back-pointer
  anchor; `Last updated` bump.
- `docs/gap-closure-reports/2026-05-11-completion.md` — this report.

## Platform Issues

Internal doc tracking only this run — no GitLab issues were opened or closed by this report step.
(The closure commits themselves are the record of work; the per-gap GitLab work-items referenced
in the tracking files reflect their pre-existing state.)
