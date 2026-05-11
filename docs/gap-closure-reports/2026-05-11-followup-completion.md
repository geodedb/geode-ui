# Gap Closure Completion Report -- 2026-05-11 (same-day follow-up)

- **Repository:** `devnw/codepros/geode/geode-ui`
- **Branch:** `main`
- **Verifier:** GREEN (all CI gates clean)
- **Run window:** 2026-05-11 same-day follow-on to the 2026-05-11 follow-up gap-close batch
- **Companion docs:** [GAP_ANALYSIS_RESOLVED.md](../GAP_ANALYSIS_RESOLVED.md#2026-05-11-closure-run----same-day-follow-up-1-gap-closed--1-gap-durable-upgraded--2-operational-follow-ups-4-geode-ui-commits--2-genapi-commits), [PERF_GAP_ANALYSIS.md](../PERF_GAP_ANALYSIS.md), [SECURITY_GAP_ANALYSIS.md](../SECURITY_GAP_ANALYSIS.md), prior run: [2026-05-11-completion.md](./2026-05-11-completion.md)

## Summary

| Metric                              | Value                                                                 |
|-------------------------------------|-----------------------------------------------------------------------|
| GAP-* items closed (this batch)     | **1** — F3 (`#25`, perf — streaming `/api/v1/query` response)          |
| GAP-* items durable-upgraded        | **1** — N2 (`#64`, security — JWT revocation store: in-memory → SQLite-backed) |
| Operational follow-ups (no gap ID)  | **2** — genapi tsc `moduleResolution=node10` deprecation test fix; gosec G302/G304 false-positive annotation on the upload temp file |
| geode-ui commits this batch         | **4** — `502e34f` (gosec annotation), `3059710` (N2 durable store + `profilestore.DBHandle()` plumbing), `bb8319d` (F3 streaming), + the bookkeeping commit that lands this report |
| genapi commits this batch           | **2** — `a192022` (tsc-deprecation test scaffold fix), `38c3c1e` (per-route `"streaming": true` template support + `TestGenerated_UsesJSONV2Imports` fix); both pushed to origin |
| Genapi-paired closure               | 1 — F3 (geode-ui `bb8319d` ↔ genapi `38c3c1e`)                        |
| Build / CI status                   | GREEN                                                                 |
| e2e suite                           | GREEN — 60 passed / 2 flaky-but-recovered / 5 skipped (image rebuilt this batch) |

This is a same-day follow-on to the 2026-05-11 follow-up batch. It closes **F3** — the last of the
five items that were deferred-to-genapi in the 2026-05-10 run (it had been tracked at `genapi#216`) —
and durable-upgrades **N2** (closed the same day with an in-memory `RevocationSet`) to a SQLite-backed
store, plus two operational follow-ups with no gap ID (a genapi tsc-deprecation test fix and a gosec
false-positive annotation). genapi was pushed to origin.

**With F3 closed, the PERF backlog's original F-series is now fully clear — no F-item is left open or
deferred.**

## Closed / upgraded by item

### F3 (`#25`) — stream the `/api/v1/query` response  [CLOSED, genapi-paired]

- **Domain:** Performance · **Severity at close:** P1 high (PerfScore 60)
- **Commits:** geode-ui `bb8319d` (`geode.json` streaming flag, regen, `handlers_query.go` rewrite) + genapi `38c3c1e` (per-route `"streaming": true` template support).
- **What changed:** genapi gained a per-endpoint `"streaming": true` schema flag. For a streaming
  route the generated user-handler signature becomes `func(http.ResponseWriter, *http.Request, *ReqType) error`
  and the handler owns the entire 200 response (status, `Content-Type`, body, flushing via
  `http.Flusher`). The generated wrapper still runs **every pre-handler concern** — auth/role/scope,
  rate limiting, body-size limit, request parsing/validation — and emits the standard
  `{error,error_description}` envelope for any *pre-handler* failure (incl. 501 for `ErrNotImplemented`),
  then flushes after the handler returns. Streaming error contract: a non-nil error returned *before
  any bytes are written* gets the standard envelope; an error returned *after* bytes are on the wire
  is logged (`http_handler_err` audit) but cannot change the status — the handler signals failure
  in-band by truncating the stream. `catchAllServer` adapters dispatch streaming routes via a new
  `callCatchAllStream` helper; non-streaming routes are byte-identical after regen. On the geode-ui
  side `/api/v1/query` is marked `"streaming": true` in `geode.json` (just that route) and
  `internal/server/handlers_query.go`'s `Query` is rewritten to: run every pre-write step
  (pool/profile/params/submit/columns) and on any such failure write the structured envelope itself
  and return nil; then write `{"columns":[...],"rows":[` and **flush** — so TTFB = time-to-first-rows-arrive,
  not time-to-all-rows; then stream each row from the driver cursor, flushing every 64 rows, folding
  the graph summary inline; then close with the `],"row_count":...,"elapsed_ms":...,"graph_summary":...}`
  trailer. A mid-stream `rows.Scan`/`rows.Err` failure returns the error with the body intentionally
  truncated. The buffered codepath (`handleQuery`, MCP `query` tool) is unchanged — both share a new
  `runQuery` setup helper. **Wire shape UNCHANGED** — still `{columns, rows, row_count, elapsed_ms,
  graph_summary}` JSON; only difference is bytes arriving sooner and a chunked (no `Content-Length`)
  response. No SPA change. The genapi commit also fixed the previously-pre-existing
  `TestGenerated_UsesJSONV2Imports` failure (introduced by the prior `fd31bbc` per-IP work) by
  switching the generated `pkg/httpx/peerlimit_test.go` to import `encoding/json/v2`.
- **Evidence:** `internal/server/result_codec_stream_test.go` — `TestStreamQueryResult_{WireShape,
  EmptyResult,MidStreamError}`; genapi side pinned by `cmd/genapi/streaming_template_test.go`
  (`TestStreamingRoute_{GeneratesStreamingSignature,DefaultsOff}`) + `TestGenerated_UsesJSONV2Imports`
  (now passing). E2E: image rebuilt; query specs `03-query-sync` / `04-query-stream` / `12-multi-request`
  8/8 pass against the streaming handler; full suite green.

### N2 (`#64`) — JWT revocation store: durable SQLite backing  [DURABLE UPGRADE of an already-RESOLVED item]

- **Domain:** Security · **Severity at close:** Medium (Risk 36)
- **Commits:** `502e34f` (gosec annotation on the same file — separate concern) + `3059710` (the
  durable store + `internal/profilestore.DBHandle()`/`DBHandleProvider` plumbing + `cmd/server/main.go`
  wiring).
- **What changed:** N2 was closed earlier the same day with an in-memory `RevocationSet`. This batch
  upgrades it to durable: `internal/jwt/revocation_sqlite.go` adds `RevocationSet.AttachSQLite(*sql.DB)`,
  which makes the two `sync.Map`s an in-memory **read-through cache** over a
  `revoked_jti(jti TEXT PRIMARY KEY, exp INTEGER)` / `password_changed_at(username TEXT PRIMARY KEY,
  changed_at INTEGER)` table pair that lives in the **existing profile-store SQLite file** — a new
  table pair in the existing DB, NOT a second file. The `*sql.DB` handle is obtained via the new
  `profilestore.DBHandleProvider` optional interface (`DBHandle() *sql.DB` on `sqliteStore`,
  deliberately kept off the `profilestore.Store` interface so the in-memory handler-test fakes don't
  need it), wired in `cmd/server/main.go` immediately after the profile store opens via `AttachSQLite(db)`
  — no new flag, it piggybacks on `-profile-store` (`:memory:` shares the in-memory SQLite for tests).
  At startup `AttachSQLite` runs `CREATE TABLE IF NOT EXISTS`, `SELECT`s every still-relevant row into
  the cache (skipping already-expired jti rows), then `DELETE`s the stale `revoked_jti` rows.
  `Revoke`/`RevokeUser` are write-through (SQLite first, then the cache; a SQLite write failure is
  logged, not fatal). `Sweep` deletes expired rows from both layers. The hot path — `IsRevoked` —
  reads the cache only and issues **zero SQL per request** (verified by an `atomic.Int64` backend query
  counter: 1200 `IsRevoked` calls = 0 queries after startup). Net: a token revoked before a process
  restart stays revoked afterward, while the validation path keeps in-memory latency. The 2026-05-11
  N2 doc caveat ("in-memory; lost on restart") is removed.
- **Evidence:** `internal/jwt/revocation_sqlite_test.go` (Revoke-then-IsRevoked round-trip; jti
  survives "restart" against the same db file with a fresh `RevocationSet`; expired jti not re-hydrated
  (and GC'd); RevokeUser round-trip + restart-survival + post-change token still validates; `Sweep` removes
  from both layers; **hot-path zero-SQL-query** assertion across all `IsRevoked` branches via the query
  counter; Issuer end-to-end including a rebuilt revocation set on the same db file).
  `internal/server/handlers_users_revocation_restart_test.go` (`TestUsers_ChangePassword_RevocationSurvivesRestart`).

### Operational follow-up — genapi tsc `moduleResolution=node10` deprecation test failures  [FIXED, no gap ID]

- genapi `a192022`: bumped `ignoreDeprecations` `"5.0"` → `"6.0"` in genapi's React-runtime test
  scaffold (`cmd/genapi/client_examples_integration_test.go`, `reactRuntimeTSConfig` const). The 3
  `TestGeneratedClients_*` tests now pass. No geode-ui change — genapi doesn't ship a tsconfig in its
  generated React client.

### Operational follow-up — gosec G302/G304 false-positive on the upload temp file  [ANNOTATED, no gap ID]

- geode-ui `502e34f`: added `// #nosec G302 G304` + `//nolint:gosec` with rationale to the
  `os.OpenFile(..., 0o640)` in `internal/server/handlers_uploads.go`. Confirmed `sanitiseUploadName`
  enforces a `^[A-Za-z0-9._-]+$` allowlist + rejects `/`/`\`/`.`/`..` + re-checks
  `filepath.Base(name)==name`; `0o640` is intentional (group-readable for the backup-restore worker).
  Recorded as a "Confirmed-Safe" row in `docs/SECURITY_GAP_ANALYSIS.md` — not a gap.

## Build verification (verifier — GREEN)

| Gate | Result |
|------|--------|
| `make build` | PASS — webpack entrypoint **454 KiB** (F10 not regressed) |
| `make go-test` | PASS — `internal/jwt` 81.3%, `internal/server` 76.6%, `internal/profilestore` 80.9% |
| Jest | PASS — 378/378 |
| `tsc` | PASS — clean |
| `golangci-lint` | PASS — clean |
| `eslint` | PASS — clean |
| `gosec` | G302/G304 on `handlers_uploads.go` suppressed with rationale; **no new findings from this batch's code** (the higher absolute count vs prior is the gosec "dev" build's expanded ruleset, not a regression) |
| F3 check | streaming flag present; `Query` handler signature `func(w, r, req) error`; non-streaming routes byte-identical after regen |
| N2-durable check | `internal/jwt/revocation_sqlite.go` present; `AttachSQLite` wired in `cmd/server/main.go`; `DBHandle()` exposed via `profilestore.DBHandleProvider`; docs updated |
| genapi | all tests pass (incl. the 3 `TestGeneratedClients_*` and `TestGenerated_UsesJSONV2Imports`); working tree clean + pushed |
| e2e | docker stack healthy; `/healthz` 2xx; full suite GREEN — 60 passed / 2 flaky-but-recovered / 5 skipped |
| Working tree | clean except the known pre-existing exceptions (`e2e/specs/01`, `02`, `15`, `electron/main.ts`, untracked detritus) |

**Live smoke:** `main.js` (~50 KB) served with `Content-Encoding: gzip` on the rebuilt e2e image
(F13 working live); sub-1KiB JSON correctly skipped.

## Notable findings during this run

- **F3's streaming contract is "handler-owns-the-body, wrapper-still-runs-pre-handler-concerns."** A
  streaming route's user handler gets `func(http.ResponseWriter, *http.Request, *ReqType) error` and
  owns status/Content-Type/body/flushing; the generated wrapper still does auth/role/scope, rate
  limiting, body-size limit, parse/validate, the `{error,error_description}` envelope for *pre-handler*
  failures, and the 501 for `ErrNotImplemented`. The error split is the subtle part: error **before**
  any bytes → standard envelope; error **after** bytes on the wire → logged (`http_handler_err`),
  status can't change, handler truncates the stream. This keeps the security/validation surface
  identical to non-streaming routes while letting `/api/v1/query` flush the `columns`/`rows[` head
  before the driver has produced every row.
- **The genapi `TestGenerated_UsesJSONV2Imports` failure was introduced by the prior `fd31bbc` per-IP
  work** (the generated `pkg/httpx/peerlimit_test.go` imported `encoding/json` instead of
  `encoding/json/v2`); it surfaced as a "previously-pre-existing" failure and is now fixed inside
  `38c3c1e`.
- **N2's durable store is zero-DB-query on the hot path.** `IsRevoked` (called on every authenticated
  REST/WS request) reads only the in-memory read-through cache; only `Revoke`/`RevokeUser`/`Sweep` and
  startup hydration touch SQLite. Restart-survival is the only behavioural change — verified by an
  `atomic.Int64` query counter in the test suite (1200 `IsRevoked` calls = 0 queries after startup).
- **F13 gzip confirmed live on the rebuilt image** — `main.js` (~50 KB) served with `Content-Encoding:
  gzip`; sub-1KiB JSON correctly skipped. (F13 closed in the prior batch; this confirms it end-to-end
  on the image used by this batch's e2e run.)
- **The gosec finding-count jump is a tooling-version artifact, not a regression** — it is the gosec
  "dev" build's expanded ruleset. No new findings come from this batch's code; the G302/G304 pair on
  `handlers_uploads.go` is annotated/suppressed with documented rationale.

## Backlog status after this batch

- **PERF (`docs/PERF_GAP_ANALYSIS.md`):** **F-series fully clear** — F3 was the last open/deferred
  F-item; every F-series item is now closed or won't-do.
- **QUALITY (`docs/QUALITY_GAP_ANALYSIS.md`):** clean — every Q-series engineering gap is closed.
  Q-NEW-T1 / Q-NEW-T3 / Q-NEW-T4 are *adoption-decision-blocked* tooling gaps (Storybook/Chromatic
  choice; Lighthouse-CI preview-URL infra; `jest-axe` adoption), not engineering gaps.
- **SECURITY (`docs/SECURITY_GAP_ANALYSIS.md`):** clean — every N-series gap is closed, N2 now
  durable. S-NEW-1 (Electron-packaging surface) is *release-engineering-blocked*; S-NEW-6
  (`security.txt` mailto routability) is *ops/DNS-blocked*.
- **Only remaining tracked-but-not-actionable items:** the upstream-Geode-blocked GAP-002..005 and the
  product/release-eng deferrals (GAP-011 / GAP-012, Q-NEW-T1/T3/T4, S-NEW-1/6).

## Follow-ups for next session

- **e2e docker image** — the rebuilt one is current as of this batch (it carries the streaming
  `/api/v1/query` handler + the F13 gzip path). No rebuild needed unless server code changes again.
- **Pin gosec to a tagged release for reproducible CI** — the "dev" build's expanded ruleset is the
  reason the absolute finding count drifted vs prior runs; a pinned version makes the count
  comparable batch-to-batch.
- **No code follow-ups outstanding from this batch** — F3 is closed, N2 is durable, the genapi tsc
  fix and the gosec annotation are operational and complete; genapi is pushed.
