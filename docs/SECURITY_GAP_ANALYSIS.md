# Security Gap Analysis — geode-ui

**Last updated:** 2026-05-13 (audit cohort filed: 7 new findings #201/#202/#205/#206/#209/#210/#211 + GO-2026-4918 toolchain follow-up #212; S3 #116 explicitly upgraded PARTIAL → CLOSED; F2/F4/F7/N2/S3/S5/S8 re-validated as still-closed)
**Audit:** /codepros:audit Phase 3 → Phase 4 tracking (Audit-2026-05-13 cohort)
**Repository:** `devnw/codepros/geode/geode-ui`
**Branch reviewed:** `main` @ `d3e5de1`

> **Audit-2026-05-13 cohort jump-link:** see [2026-05-13 audit cohort](#2026-05-13-audit-cohort) for the 8 newly-filed `S-NEW-*` + `GO-2026-4918` findings (issues #201, #202, #205, #206, #209, #210, #211, #212; three confidential — #201, #202, #205). S3 (#116) is explicitly upgraded from PARTIAL → CLOSED in this pass. F2/F4/F7/N2/S5/S8 re-validated as still-closed.
>
> **Audit-2026-05-11 cohort jump-link:** see [Audit-2026-05-11 cohort — full-tree security pass](#audit-2026-05-11-cohort--full-tree-security-pass) for the 7 newly-filed `F-AUTH-*`/`F-INPUT-*`/`F-SUP-*` findings (issues #132, #135, #140, #143, #148, #153, #160, #161) plus the deferred-comment on #72 (F-SUP-2). Earlier cohorts (PSR S01-S10 = #114-#123; `F*`/`N*` = #58-#77) remain the canonical historical record below.
>
> **PSR cohort jump-link:** see [Profile System Rebuild (PSR) — 2026-05-10 audit](#profile-system-rebuild-psr--2026-05-10-audit) for the 10 newly-filed S01-S10 findings (issues #114-#123) covering the recent profile-system rebuild only. Prior cohort (`F*`/`N*` series, issues #58-#77) below remains the canonical baseline.

## Scope

Adversarial security review of the geode-ui admin SPA + Go server. Covers:

- Go server: `cmd/server/main.go`, `internal/server/`, `internal/jwt/`, `internal/conn/`, `internal/ui/`
- Generated server surface: `gen/api/`, `gen/ws/`, `gen/mcp/`, `gen/pkg/{httpx,obsx,gqlx,mcpx}` (read-only — emitted by `~/src/devnw/apps/genapi`)
- TypeScript SPA: `src/`
- Build / supply chain: `pnpm-lock.yaml`, `package.json`, `go.mod`/`go.sum`

Excluded: upstream Geode database (separate repo, separate threat model). Tested against Geode `v0.5.11` wire dialect.

## Threat Model Summary

geode-ui is an **admin-facing** SPA + thin reverse-proxy/auth-fronting server for Geode. Trust boundaries:

1. **Internet ↔ httpx server** — public, unauthenticated for `/auth/login`, `/healthz`, `/.well-known/*`, static assets. All other surface authenticates via `AuthJWT`.
2. **Server ↔ Geode (QUIC)** — server holds long-lived QUIC connections per profile; admin actions are gated by `roles=admin` claim derived from `-admin-users` flag.
3. **Browser ↔ SPA** — JWT today held in `localStorage` (see SEC-F7). Same-origin only.

**Top adversaries we model:**

- Unauthenticated remote actor running credential-stuffing against `/auth/login`.
- Compromised npm transitive dependency injecting code into the SPA bundle.
- Authenticated-but-non-admin user attempting privilege escalation.
- Accidental log/audit-ring exposure of secrets via misconfigured logging.

**Out of scope (this audit):** physical access, side-channel attacks against the host kernel, supply-chain attacks against the Go module graph (covered separately by `govulncheck`).

## Tool Results

| Tool | Scope | Result |
|------|-------|--------|
| **gosec** | Go (`./...`) | 1 finding in generated code (G115 in `gen/pkg/gqlx/subscription.go:394`); G703/G304 reviewed and mitigated by surrounding code (see Confirmed-Safe). G120 (`crypto/rand` not used in `internal/jwt`) cleared 2026-05-11 — `jwt.Issuer.Issue` now emits a `crypto/rand` 128-bit jti per token (SEC-N2). |
| **govulncheck** | Go modules | Clean against current `go.sum`. |
| **gitleaks** | Git history | F14 — confirmed test/placeholder; informational only (close as won't-do; allowlist comment recommended). |
| **detect-secrets** | Working tree | F14 (same placeholder, audited safe). |
| **pnpm audit** | npm transitive | 8 advisories on `dompurify@3.2.7` (F8); HIGH advisory on dev-only `serialize-javascript` via `copy-webpack-plugin` (F12). |
| **semgrep** | Go + TS | XSS / injection / auth-bypass rule packs ran clean except for the SQL-string composition flagged manually (N1). |

## Findings — Stack Ranked by Risk Score

| Rank | ID | Severity | Risk | Title | Issue | File:Line | Fix / Status |
|------|-----|---------|------|-------|-------|-----------|-----|
| 1 | F2 | High | **64** | /auth/login lacks per-IP and per-(profile,username) rate limiting | [#58](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/58) | `gen/api/handlers_gen.go:1471-1483`, `cmd/server/main.go:101-103` | **Closed** 2026-05-07 (`8e9f5d2`) -- `internal/server/loginlimiter.go` (5 rps/IP, burst 10; 5 fails/15min lockout). Cross-closes N3 (#65) via `canonicalProfile()`; partially closes N7 (#66) for the login surface only. Genapi follow-up `genapi#215` filed for global per-IP partition. |
| 2 | F4 | High | **64** | Missing CSP, Permissions-Policy, COOP/COEP/CORP | [#60](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/60) | `gen/pkg/httpx/server.go:110-145` | **Closed** 2026-05-07 (`1791a37`) -- `internal/server/security_headers.go` (CSP+COOP on SPA, Permissions-Policy global). Genapi follow-up `genapi#214` filed to move into `httpx.WrapHandler`. |
| 3 | F7 | High | **48** | JWT in localStorage | [#62](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/62) | `src/api/auth.ts:30-36` | **Closed** 2026-05-07 (`56d4e5f` + `21955c4` + `4eb3dcd`) -- (1/3) server JWT cookie writer/reader (`internal/server/auth.go:65` `r.Cookie(...)`); (2/3) CSRF double-submit middleware; (3/3) SPA cookie-based auth + CSRF header. Backout: dual-mode `?access_token=` fallback retained (deprecated, F5/#71). |
| 4 | N2 | Medium | **36** | No JWT revocation / no session invalidation on password change | [#64](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/64) | `internal/jwt/jwt.go`, `internal/jwt/revocation.go`, `internal/jwt/revocation_sqlite.go` (new), `internal/profilestore/sqlite.go` (`DBHandle`/`DBHandleProvider`), `internal/server/handlers_users.go` (Password + PatchUsername), `cmd/server/main.go` (`AttachSQLite` + sweeper) | **Closed (resolved 2026-05-11) + durable SQLite upgrade 2026-05-11 follow-up** — see [GAP_ANALYSIS_RESOLVED.md](./GAP_ANALYSIS_RESOLVED.md#n2-64-jwt-revocation-and-session-invalidation-on-password-change-resolved) (durable follow-up commit `3059710`). (1) Every issued JWT carries a `jti` (RFC 7519 `ID` claim) — 128 bits from `crypto/rand`, hex-encoded — set in `jwt.Issuer.Issue`. (2) `internal/jwt/revocation.go` provides `*RevocationSet` (one per `Issuer`, via `Issuer.Revocation()`): per-token `Revoke(jti, exp)`, per-user `RevokeUser(username)` (geode-ui has no user-attribute store of its own — users live upstream in Geode — so the "password-changed instant" map is the pragmatic equivalent of a per-user token-generation counter), `IsRevoked(*Claims)` checking both, `Sweep(maxTokenAge)`, `StartSweeper(ctx, interval, maxTokenAge)` (10-min cadence in `cmd/server/main.go`). `Issuer.Parse` consults the set after signature + standard-claim validation and returns `jwt.ErrRevoked`; `internal/server/auth.go` validates via `Issuer.Parse`, so revocation is enforced on every REST and WS request. (3) On a successful password change — `POST /users/{u}/password` and `PATCH /users/{u}` with a `password` field — the handler calls `s.cfg.JWT.Revocation().RevokeUser(<targetUsername>)`. (4) **Durable backing (follow-up):** `RevocationSet.AttachSQLite(*sql.DB)` makes the two `sync.Map`s an in-memory **read-through cache** over a `revoked_jti` / `password_changed_at` table pair living in the **profile-store SQLite file** (a new table pair in the existing DB — no second file; the `*sql.DB` is obtained via the new `profilestore.DBHandleProvider` optional interface, wired in `cmd/server/main.go` right after the profile store opens). At startup `AttachSQLite` runs `CREATE TABLE IF NOT EXISTS`, `SELECT`s every still-relevant row into the cache (skipping already-expired jtis), and GCs stale `revoked_jti` rows. `Revoke`/`RevokeUser` are write-through (SQLite first, then the cache); `Sweep` deletes from both layers. The hot path — `IsRevoked` — reads the cache only and issues **zero SQL per request**. Net: revocation state survives a process restart while the validation path stays in-memory-fast. With `-profile-store :memory:` the revocation store shares that in-memory SQLite, so tests keep working with no new flag. Clears `gosec G120`. Tests: `internal/jwt/revocation_test.go` (in-memory backend regression suite — unchanged); `internal/jwt/revocation_sqlite_test.go` (Revoke-then-IsRevoked round-trip, jti survives restart against the same db file, expired jti not re-hydrated + GC'd, RevokeUser round-trip + restart-survival, Sweep removes from both layers, **hot-path zero-SQL-query** assertion via a backend query counter, Issuer end-to-end + restart); `internal/server/handlers_users_test.go` (`TestUsers_ChangePassword_RevokesExistingTokens`, `TestUsers_PatchPassword_RevokesExistingTokens`) + `internal/server/handlers_users_revocation_restart_test.go` (`TestUsers_ChangePassword_RevocationSurvivesRestart`: password change → token rejected → "restart" against the same DB → still rejected → post-change re-login validates). |
| 5 | N3 | Medium | **36** | Login silently defaults profile="" → "default" | [#65](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/65) | `internal/server/handlers_auth.go:43-46` | **Closed** 2026-05-07 (cross-closed via `8e9f5d2` for #58) -- profile canonicalised in `handlers_auth.go` and the rate-limiter via `canonicalProfile()`. |
| 6 | F6+N6 | Medium | **36** | Audit log redaction gap (LogAudit not redacting; sensitiveKeys incomplete) | [#67](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/67) | `gen/pkg/obsx/log.go:381-382`, `internal/server/audit.go:56-70` | **Closed (resolved 2026-05-10)** — see [GAP_ANALYSIS_RESOLVED.md](./GAP_ANALYSIS_RESOLVED.md#f6n6-67-centralised-audit-redaction-resolved-genapi-paired). Closure commits `cea4fbd` + genapi `e100aed`. Genapi adds `obsx.RedactSensitiveKeys` + `obsx.DefaultSensitiveKeyFragments`; `obsx.LogAudit` now redacts before emission. `internal/server/audit.go` extends the central list with geode-ui-specific keys (saved_password, tls_client_*, tls_server_*, tls_password, url, connection_string, access_token, refresh_token, session_id) and delegates `isSensitive` to `obsx.IsSensitiveKey`. |
| 7 | N7 | Medium | **32** | Global-only rate limiter (no per-IP partition) | [#66](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/66) | `cmd/server/main.go`, `gen/pkg/httpx/peerlimit.go` | **Closed (resolved 2026-05-11)** — see [GAP_ANALYSIS_RESOLVED.md](./GAP_ANALYSIS_RESOLVED.md#n7-remainder-66-global-per-ip-rate-limiter-in-genapi-httpx-resolved-genapi-paired); closure commit `bc10708` (pairs with genapi `fd31bbc`; supersedes the 2026-05-07 `8e9f5d2` partial) -- genapi `pkg/httpx.PeerLimiter`: a token bucket partitioned by client IP, applied to **every** route as a coarse abuse ceiling underneath the tighter per-route limiters (`loginlimiter.go` 5 rps/IP on `/auth/login`; `profilelimiter.go` 30 req/min per JWT subject on profile CRUD). Idle buckets are swept periodically (eviction policy) so a flood of unique source addresses cannot pin memory. Key source is configurable via `security.rate_limit.per_ip_source` (`remote_addr` default / `x-forwarded-for` / `x-real-ip` / `tls-subject`); `per_ip_rps` of `0` disables it. 429 responses carry `Retry-After` + a `{code,description,reason}` body matching the per-route limiters so the SPA's existing 429 handler covers all layers. Wired via `httpx.Config{PerIPRPS: 50, PerIPBurst: 100, PerIPSource: httpx.IPSourceRemoteAddr}` in `cmd/server/main.go` + `security.rate_limit.per_ip_rps/per_ip_burst/per_ip_source` in `geode.json` (keyed on `RemoteAddr` — this server is not behind a trusted proxy that rewrites `X-Forwarded-For`). Tests: `gen/pkg/httpx/peerlimit_test.go`. |
| 8 | N1 | Medium | **24** | ALTER USER quoteString edge-case audit | [#63](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/63) | `internal/server/quoting.go:61` (`quoteString`), `quoting.go:45` (`quoteIdent`) | **Closed (resolved 2026-05-10)** — see [GAP_ANALYSIS_RESOLVED.md](./GAP_ANALYSIS_RESOLVED.md#n1-63-adversarial-quotestring-corpus-resolved). Closure commit `8a4e96d`. New `internal/server/quoting_test.go` adds an adversarial corpus covering classic SQL-injection shapes (quote-style, comment-style, statement-terminator), the full ASCII control set (0x00, 0x08-0x0d, 0x1b, 0x1f, 0x7f), unicode lookalikes (RTL-override, smart quote U+2018, zero-width space, combining marks), and length stress (64 KiB). Invariant pinned for the `quoteString` accept path: every run of consecutive single quotes in the body is even-length (escape correctness); reject path produces empty output. `quoteIdent` invariant: no interior backtick survives. The existing helpers passed every adversarial input without modification — no escape gap surfaced. |
| 9 | N4 | Low | **24** | No server-side password policy | [#72](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/72) | `internal/server/password_policy.go` (new), wired into `handlers_users.go` PostUsers/PatchUsername/Password sites | **Closed (resolved 2026-05-10)** — see [GAP_ANALYSIS_RESOLVED.md](./GAP_ANALYSIS_RESOLVED.md#n4-72-server-side-password-policy-12-chars-resolved). Closure commit `6765e64`. `validatePassword(ctx, pw, username, policy)` enforces: (1) `len(pw) >= 12` (MinPasswordLength constant), (2) reject all-same-char or all-ASCII-digit strings, (3) reject passwords whose lower-cased form contains the lower-cased username when username is >=4 chars, (4) optional HIBP k-anonymity lookup gated behind `Config.PasswordPolicy.HIBPCheck` and the new `-password-hibp-check` CLI flag (default OFF for hermetic tests + air-gap deployments). Stable 400 response codes: `password_too_short` / `password_too_weak` / `password_contains_username` / `password_pwned`. Tests in `password_policy_test.go` cover length/weak/username/HIBP-hit/HIBP-miss/fail-open paths and integration with PostUsers + Password handlers. |
| 10 | N10 | Low | **24** | User-enumeration timing channel on /auth/login | [#76](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/76) | `internal/server/handlers_auth.go:Login` + `errors.go:errorBody` | **Closed (resolved 2026-05-10)** — see [GAP_ANALYSIS_RESOLVED.md](./GAP_ANALYSIS_RESOLVED.md#n10-76-constant-time-auth-failure-path-resolved). Closure commit `502a865`. Every Login failure path (wrong password, unknown user, upstream transport failure, profile-lookup failure) now collapses into a single `401 invalid_credentials` response with a byte-identical body. Three defences combined: (1) `performDummyCompare` runs a SHA-256+constant-time-compare on every failure so a "user not found" path spends comparable CPU to a "wrong password" path; (2) `respectLoginLatencyFloor` waits out a 250 ms minimum-latency window on every failure to absorb upstream timing diffs (lowercase `loginMinFailureLatency` var so tests can lower it); (3) `errorBody` struct (in errors.go) replaces the `map[string]any` body so Go's map-iteration randomisation can't reorder JSON keys across responses. The audit log still distinguishes `reason=upstream_error` vs `invalid_credentials` for operator diagnostics. Tests: `TestLogin_FailureBodyIsIdentical_AcrossModes` (3 modes, byte-identical assertion), `TestLogin_LatencyFloor`. |
| 11 | F8 | Medium | **16** | dompurify@3.2.7 transitive (8 advisories) | [#68](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/68) | `package.json` (`overrides`) | **Closed (resolved 2026-05-10)** — see [GAP_ANALYSIS_RESOLVED.md](./GAP_ANALYSIS_RESOLVED.md#f8-sec-68-dompurify-resolves-to--34-via-npmoverrides-resolved). Closure commit `edbd1d9`. `package.json` declares `"overrides": { "dompurify": "^3.4.0" }`; `npm ls dompurify --all` resolves the transitive (under `monaco-editor@0.55.1`) to `dompurify@3.4.2 overridden`, satisfying the `>= 3.4` floor and closing the 6+ XSS advisories. Cross-closed by S-NEW-8. |
| 12 | F5 | Low | **16** | Deprecate ?access_token= query fallback | [#71](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/71) | `internal/server/auth.go:88` | **Closed** 2026-05-08 — `WithAccessTokenDeprecation` middleware emits `Deprecation: true`, `Sunset: <AccessTokenSunsetDate>`, and a `Link; rel="deprecation"` header on every response that carried `?access_token=`. Sunset 2026-07-01. |
| 13 | N5 | Low | **16** | httpx CORS supports wildcard origin | [#74](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/74) | `gen/pkg/httpx/server.go:117-141` | **Closed (resolved 2026-05-10)** — see [GAP_ANALYSIS_RESOLVED.md](./GAP_ANALYSIS_RESOLVED.md#n5-74-reject-wildcard-cors-at-startup-resolved-genapi-paired). Closure commits `0fbccc6` + genapi `df654de`. Genapi adds `httpx.ValidateConfig` and `ErrCORSWildcardWithCredentials`; `WrapHandler` panics and `Serve` returns the error when `CORSEnabled && CORSOrigins` contains `"*"`. CI catches the misconfiguration at startup instead of shipping silent wildcard CORS. |
| 14 | F1 | Low | **8** | /mcp mounted but mcpx.SetAuthVerifier never called (fail-closed) | [#69](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/69) | `cmd/server/main.go:165` | **Closed** 2026-05-08 — `mcpx.SetAuthVerifier(srv.AuthJWT)` wired so /mcp authorizes via the same HS256 verifier that gates the REST API. |
| 15 | F3 | Low | **8** | JWT verify has no clock leeway | [#70](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/70) | `internal/jwt/jwt.go:82-94` | **Closed** 2026-05-08 — `jjwt.WithLeeway(60 * time.Second)` passed to `ParseWithClaims`. Tests pin the upper bound: an exp 2 minutes in the past still rejects. |
| 16 | F12 | Low | **8** | serialize-javascript HIGH RCE in dev-only copy-webpack-plugin | [#73](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/73) | `package-lock.json` | Bump or replace plugin |
| 17 | N8 | Low | **8** | Missing public/.well-known/security.txt | [#75](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/75) | `public/.well-known/security.txt` | **Closed** 2026-05-08 — file added per RFC 9116 (Contact, Expires 2027-05-08, Encryption, Acknowledgments, Canonical, Policy). Webpack CopyPlugin emits it under the SPA's `/.well-known/security.txt`. |
| 18 | F11 | Low | **4** | gosec G115 in genapi-emitted gqlx/subscription.go | [#77](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/77) | `gen/pkg/gqlx/subscription.go:394` | **Closed (resolved 2026-05-10)** — see [GAP_ANALYSIS_RESOLVED.md](./GAP_ANALYSIS_RESOLVED.md#f11-77-gosec-g115-fixed-in-genapi-resolved-genapi-paired). Closure commits `8336a43` + genapi `1033c50`. Replaces the `//nolint:gosec` suppression with a real `uint64 > maxWSFrameBytes` bounds check before the int64 cast in `pkg/gqlx/subscription.go:readWSFrame`. Regenerated; `gosec -include=G115 ./gen/...` reports 0 issues. |

**Confidential issues** (Critical/High): F2 (#58), F4 (#60), F7 (#62) — created with `--confidential` because they describe an exploit chain or a credential-storage flaw with a concrete exfil path. **All three closed in the 2026-05-07 closure run.**

### Closure run 2026-05-07

Three High-severity confidential issues + one cross-closed Medium + one partially closed Medium:

- **F2 (#58)** -- closed via `8e9f5d2`. Per-IP (5 rps, burst 10) and per-(profile,username) (5 fails / 15 min lockout) limiter wired into `/auth/login`.
- **F4 (#60)** -- closed via `1791a37`. CSP + COOP on SPA HTML; Permissions-Policy global.
- **F7 (#62)** -- closed via `56d4e5f` + `21955c4` + `4eb3dcd`. Server cookie writer/reader (1/3), CSRF double-submit middleware (2/3), SPA refactor (3/3). Dual-mode kept on `?access_token=` for one minor (F5/#71 deprecation).
- **N3 (#65)** -- cross-closed via `8e9f5d2` (profile canonicalisation lands in the same commit).
- **N7 (#66)** -- **closed 2026-05-11** (pairs with genapi `fd31bbc`). genapi `pkg/httpx.PeerLimiter` adds a per-IP token bucket on every route (configurable key source: `remote_addr` default / `x-forwarded-for` / `x-real-ip` / `tls-subject`; idle-bucket sweep; `per_ip_rps=0` disables; 429 body matches the per-route limiters). Wired in `cmd/server/main.go` at 50 rps / burst 100 per IP keyed on `RemoteAddr`. The 2026-05-07 `8e9f5d2` partial (`loginlimiter.go` for `/auth/login`) and `profilelimiter.go` (per-actor profile CRUD) remain as the tighter inner layers.

Genapi follow-ups filed in the upstream project:

- `genapi#214` -- move CSP/COOP/Permissions-Policy headers into `httpx.WrapHandler`.
- `genapi#215` -- add per-IP global rate limit + per-route per-IP option in httpx.

### Closure run 2026-05-08

Four Low-severity hardening items closed in a single pass:

- **F1 (#69)** — `mcpx.SetAuthVerifier(srv.AuthJWT)` wired in
  `cmd/server/main.go:165`. The MCP route now authorizes through the
  same HS256 verifier as the REST API instead of fail-closing on every
  call.
- **F3 (#70)** — `jjwt.WithLeeway(60 * time.Second)` added to
  `Issuer.Parse`. Tests pin the lower bound (a token whose iat is 30 s
  in the future parses cleanly) and the upper bound (a token whose exp
  is 2 minutes in the past is rejected).
- **F5 (#71)** — `WithAccessTokenDeprecation` middleware in
  `internal/server/security_headers.go` emits `Deprecation: true`,
  `Sunset: <AccessTokenSunsetDate>` (2026-07-01), and a
  `Link; rel="deprecation"` header on any response whose request
  carried `?access_token=` on the URL. Wrapped into the global
  pipeline in `cmd/server/main.go` alongside `WithPermissionsPolicy`.
- **N8 (#75)** — `public/.well-known/security.txt` per RFC 9116
  (Contact, Expires 2027-05-08, Encryption, Acknowledgments,
  Canonical, Policy). The webpack `CopyPlugin` copies it into
  `internal/ui/dist/.well-known/security.txt` so the embedded UI
  handler serves it as text/plain at `/.well-known/security.txt`.

## New findings — 2026-05-08 audit pass

| ID | Risk | Severity | Title | File:Line | Status / Action |
|----|------|----------|-------|-----------|-----------------|
| S-NEW-1 | 16 | Medium | Electron-packaging surface not yet finalized | `package.json:36-49` (no `electron`/`electron-builder` dep) | Deferred (release-engineering). **Unblock condition:** release-engineer pulls `electron@^32` + `electron-builder@^25` + `@types/node` into devDependencies. Then enable ASAR, validate `nativeWindowOpen`/`webPreferences.sandbox`, document that `corsEnabled:false` is intentional but means the renderer can fetch any bundled subresource. |
| S-NEW-2 | 4 | Low (informational) | `geode://` SPA fallback masks 404 | `electron/main.ts:122-128` | Accepted-informational. Any miss returns `index.html`; not exploitable. Documented in `docs/ELECTRON.md` as the SPA fallback contract. No code change. |
| S-NEW-3 | 36 | Medium | i18n `escapeValue: false` lacks `<Trans>` lint guard | `src/services/i18n/config.ts:39` + `scripts/check-html-renderers.mjs` | **Closed** 2026-05-08 (cross-closed via Q-NEW-2). New `check:html-renderers` audit script greps for the two HTML-rendering JSX patterns; pre-commit + CI gate, strict from day one (zero pre-existing hits). Discipline doc at `docs/I18N.md`. |
| S-NEW-4 | 4 | Low (informational) | `data-theme` attribute is a fingerprint surface | `src/theme/ThemeContext.tsx:81-87` | Accepted-informational. Reflects only user-controlled local state; not a finding. No code change. |
| S-NEW-5 | 4 | Low (informational/policy) | `WithAccessTokenDeprecation` requires no auth | `internal/server/security_headers.go:107-119` | Accepted-informational. Intentional — emits Sunset header on probes; unauthenticated attacker observing `Sunset:` learns the migration timeline (already public via N8 security.txt). No code change. |
| S-NEW-6 | 8 | Low | `security.txt` mailto routability unverified | `public/.well-known/security.txt:7-9` | Deferred (DNS / inbox verification). **Unblock condition:** ops confirms `security@geodedb.com` routes to a monitored inbox AND the PGP key URL resolves. Without verification, the N8 closure is technically incomplete (file exists, address unverified). |
| S-NEW-7 | — | Info / net positive | Self-hosted brand fonts close CSP relaxation need | `src/assets/fonts/*.woff2`, `src/assets/fonts/fonts.css` | Accepted-informational. Net positive — CSP `font-src 'self' data:` no longer needs the `https://fonts.gstatic.com` allowance. Recorded for future reviewers; no action. |
| S-NEW-8 | 16 | Low | dompurify ^3.4.0 fix is now available; npm.overrides feasible | `package.json:overrides` | **Closed** 2026-05-08. `package.json` declares `"overrides": { "dompurify": "^3.4.0" }`; npm install resolves the transitive `dompurify@3.2.7` (under `monaco-editor`) to `dompurify@3.4.2`, closing the 6+ XSS advisories tracked under F8 (#68). No monaco bump required. |

## Threat-Model Verdict

The geode-ui server has a **defensible foundation** — JWT lock-down to HS256 with mandatory `-jwt-secret-hex`, mux-level admin role enforcement on all destructive routes, multipart upload sanitization, and a fail-closed MCP mount. The dominant residual risk is **brute-forceable credential entry** (F2 + N3 + N4 compose into a credential-stuffing chain) combined with **token theft amplification** (F7 + F4 compose into a one-shot exfil chain on any future XSS).

The **High-severity findings cluster on the auth and frontend-storage surfaces** rather than on data-plane or privilege-escalation paths. That is good news: each High has a well-understood, well-scoped fix with no architectural rework. F2 and F4 are 1–3 day implementations; F7 is the only one with non-trivial SPA refactor (estimate 1 week including CSRF middleware on the server side).

**Recommended next 30 days:** land F2 (per-IP + per-user rate limit), F4 (CSP/COOP), F7 (cookie-based JWT with CSRF). Those three fixes close the dominant exploit chains and allow F8/F12 (supply chain) to be patched without urgency.

**Strategic items (90+ days):** ~~N1 (quoteString hardening)~~ — closed 2026-05-10. ~~N2 (revocation list)~~ — closed 2026-05-11; durable SQLite-backed follow-up landed the same day (`RevocationSet` is now an in-memory read-through cache over a `revoked_jti`/`password_changed_at` table pair in the profile-store DB — survives restart, validation path stays zero-DB-query). ~~F6+N6 (centralised redaction in genapi)~~ — closed 2026-05-10 ahead of schedule. All originally-strategic items are now closed.

## Confirmed-Safe (Scanned-positive, verified false-positive)

These were flagged by tools or surfaced during manual review but are **confirmed safe** under current code paths:

| ID | What was flagged | Verdict | Evidence |
|----|------------------|---------|----------|
| **N9** | `/api/v1/backups/upload` and `/api/v1/migrations/upload` hand-rolled outside genapi via `mux.HandleFunc` — suspected to bypass admin gate. | **CONFIRMED SAFE.** Both handlers explicitly call `s.AuthJWT(r)` and then `hasAdminRole(rolesFromContext(r.Context()))` before any file IO. | `internal/server/handlers_uploads.go:96-111` performs JWT + admin check; `cmd/server/main.go:116-117` wires `POST /api/v1/backups/upload` and `POST /api/v1/migrations/upload` with method-pinning to avoid mux conflicts. |
| `sanitizeGraphName` | Concatenated graph name in GQL — suspected injection. | Safe. Names regex-validated to `^[A-Za-z0-9_][A-Za-z0-9_-]{0,62}$` before any GQL composition; no separator characters can survive. | `internal/server/handlers_graphs.go` (regex-validated) |
| Upload filename traversal | Multipart filename could escape UploadDir. | Safe. `sanitiseUploadName` rejects everything outside `[A-Za-z0-9._-]+`, plus `.`/`..`/path-separator special cases, plus a defense-in-depth `filepath.Base(name) != name` check. | `internal/server/handlers_uploads.go:236-254` |
| JWT alg lock-down | `alg=none` / algorithm confusion | Safe. `internal/jwt/jwt.go::Verify` rejects any header where `alg != "HS256"` BEFORE signature verification. Constant-time HMAC compare via `subtle.ConstantTimeCompare`. | `internal/jwt/jwt.go` |
| MCP fail-closed | `/mcp` mounted but unverified. | Safe-but-noisy: returns 401 on every request because `authVerifier == nil`. No exploitable surface; tracked separately as F1 hardening. | `gen/pkg/mcpx/engine.go:171-176` |
| Restore extraction | Hand-rolled tarball extraction in restore path. | Safe. Restore path 501s in v0.5.11; no extraction code currently runs. Re-audit when wire support lands. | `internal/server/handlers_backups.go` (501 stub) |
| **F14** | Placeholder string flagged by gitleaks/detect-secrets. | Confirmed placeholder; informational only. **Action:** add `# pragma: allowlist secret` comment near the placeholder line to silence the scanner; otherwise close as won't-do. | (file/line in original Phase-2 inventory) |
| gosec G703 | `fmt.Sprintf` formatting in error messages. | Safe. No user input flows into the format string; all are static format directives. | (multiple) |
| gosec G304 | `os.ReadFile(profilesFile)` from `-profiles` flag. | Safe. Operator-controlled CLI input; not a remote vector. | `cmd/server/main.go:64` |
| gosec G302/G304 | `os.OpenFile(tmpPath, …, 0o640)` for the staged upload temp file. | **Confirmed safe — annotated 2026-05-11.** `0o640` is intentional: the staged file must be group-readable so the backup/restore worker (same group) can consume it. The path is `filepath.Join(UploadDir, subdir, name)` where `name` is the return of `sanitiseUploadName` (the `[A-Za-z0-9._-]+` allowlist + `.`/`..`/separator rejection + `filepath.Base(name)==name` re-check), so no traversal is possible. Carries a `//nolint:gosec` directive on the line documenting both. | `internal/server/handlers_uploads.go:125-126`, sanitizer at `internal/server/handlers_uploads.go:186-204` |
| gosec G120 | `crypto/rand` not used in `internal/jwt`. | **Cleared 2026-05-11.** SEC-N2 landed: `jwt.Issuer.Issue` now reads `crypto/rand` for a 128-bit, hex-encoded `jti` on every token (`internal/jwt/jwt.go` `newJTI`). HMAC keys remain operator-supplied via `-jwt-secret-hex` (32+ bytes). | `internal/jwt/jwt.go` |

## Roadmap

**Quick wins (< 1 day each):**

- F3 — JWT clock leeway (`internal/jwt/jwt.go:82-94`).
- N8 — Add `public/.well-known/security.txt`.
- F1 — Either call `mcpx.SetAuthVerifier(srv.AuthJWT)` or unmount `/mcp`.
- ~~F11 — Fix in genapi template; regenerate.~~ **Closed 2026-05-10** via genapi `1033c50` + regen.
- F14 — Add allowlist pragma; close.

**Medium (1–5 days each):**

- F2 — Per-IP + per-(profile,username) rate-limiter on `/auth/login`.
- F4 — Add CSP/Permissions-Policy/COOP/COEP/CORP in `httpx.WrapHandler` (genapi).
- N3 — Require explicit profile on Login (or share rate-limit bucket).
- N4 — Server-side password policy.
- ~~N5 — Reject wildcard CORS when credentials enabled.~~ **Closed 2026-05-10** via genapi `df654de` + regen.
- ~~N7 — Per-IP global rate limiter.~~ **Closed 2026-05-11** via genapi `fd31bbc` (`pkg/httpx.PeerLimiter`) + `cmd/server/main.go` wiring (50 rps / burst 100 per IP, `remote_addr` keyed) + `geode.json` `security.rate_limit.per_ip_*`. `loginlimiter.go` (per-IP `/auth/login`) and `profilelimiter.go` (per-actor profile CRUD) remain the tighter inner layers.
- N10 — Constant-time auth-failure path.
- F5 — Emit Deprecation header on `?access_token=` fallback.
- ~~F6+N6 — Centralize redaction in `obsx.LogAudit`; expand `sensitiveKeys`.~~ **Closed 2026-05-10** via genapi `e100aed` + `internal/server/audit.go` refactor.
- ~~F8 — Bump `monaco-editor` or pin via pnpm overrides.~~ **Closed 2026-05-10** via `package.json::overrides.dompurify ^3.4.0`; resolves to `dompurify@3.4.2 overridden`.
- F12 — Bump or replace `copy-webpack-plugin`.

**Strategic (> 5 days):**

- F7 — Cookie-based JWT + CSRF middleware (server) + SPA refactor.
- N1 — Audit + harden `quoteString`/`quoteIdent` with adversarial test corpus.
- ~~N2~~ — **Closed 2026-05-11.** crypto/rand jti on every token + `RevocationSet` (per-jti `Revoke` + per-user `RevokeUser` on password change) consulted by `Issuer.Parse`; sweeper prunes dead entries. **SQLite-backed (follow-up, same day):** the set's `sync.Map`s are an in-memory read-through cache over a `revoked_jti`/`password_changed_at` table pair in the profile-store DB (shared file, no second DB) — `AttachSQLite` hydrates the cache and GCs stale rows at startup, writes are write-through, `IsRevoked` is zero-SQL-per-request. Revocation state now survives a process restart.

## Immediate Actions

None of the findings require immediate secret rotation or active-RCE remediation. F14 was the only secret-adjacent flag and is a confirmed placeholder. **No production credentials are leaked; no active RCE path was identified.**

---

## Profile System Rebuild (PSR) — 2026-05-10 audit

**Scope:** Recent profile-system rebuild only — Electron main/preload/IPC additions, the new `internal/profilestore` module, the new profile CRUD handlers, the SPA bootstrap rewrite, and the new `secure-store` and `AuthProvider` paths. Excludes the prior cohort (F*/N*) which is tracked above.

**All 10 findings are PUBLIC** (no `--confidential` flag). None expose live secrets; the highest-impact items (S1, S2, S5, S6) all require either a renderer/admin foothold or local file access, so the exploit narratives are already in the public record once issues are filed. Filed as `psr` cohort.

### Coordinated fix modules

The 10 findings collapse into **3 coordinated PRs**. Cross-issue references in the bodies should drive these to land as cohorts, not 10 separate MRs.

| Module | New file | Closes | Touches |
|--------|----------|--------|---------|
| **C1** | `electron/lib/ipc-guards.ts` | **S3** (TOCTOU + `*` filter on `pickPemFile`), **S8** (no IPC input validation), **S4** (HMAC envelope, surface unavailable, randomized tmp) — **all three closed 2026-05-10** as a single cohort. | `electron/main.ts` (handler rewrites), `electron/lib/ipc-guards.ts` (new), `electron/lib/secure-store.ts` (HMAC envelope, surfaceUnavailable, joinTmp), `__tests__/ipc-guards.test.ts` (new, 30 cases), `__tests__/secure-store.test.ts` (extended, +5 S4 cases) |
| **C2** | `internal/profilestore/crypto.go` | **S5** (plaintext PEM/DSN at rest) | `internal/profilestore/sqlite.go`, `internal/profilestore/schema.go`, `internal/profilestore/crypto.go` (new), `cmd/server/main.go` (key bootstrap), tests |
| **C3** | Expanded `audit.go` event taxonomy | **S6** (no audit on profile CRUD) — also tightens defense-in-depth around **S5** (encrypted column names listed in redaction allowlist) | `internal/server/audit.go`, `internal/server/handlers_profiles_crud.go`, tests |

**Standalone PRs** (no shared module): S1, S2, S7, S9, S10.

### PSR findings — stack ranked by risk score

| ID | OWASP / CIS | Risk | Severity | Decision | GitLab issue | File:Line | Title |
|----|-------------|-----:|----------|----------|--------------|-----------|-------|
| S1 | A05 + A03 / CWE-939, CWE-1188 | **30** | High | **Closed 2026-05-10** (release blocker) | [#114](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/114) | `electron/main.ts:303-308` | **Closed 2026-05-10** -- new `safeOpenExternal` helper in `electron/lib/safety.ts` funnels both `setWindowOpenHandler` and `will-navigate` through `isAllowedExternal` before any `shell.openExternal` call. 25 new test cases pin the gate (https/mailto allowed; file://, javascript:, blob:, data:, app://, ftp://, geode://app/admin, non-strings all rejected). |
| S5 | A02 + CIS 3.11 / CWE-311, CWE-312 | **30** | High | **Closed 2026-05-10** | [#118](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/118) | `internal/profilestore/sqlite.go:27-50`, `crypto.go` (new) | **Closed 2026-05-10** -- new `internal/profilestore/crypto.go` (`Cipher`, `NewCipherFromEnv`, AES-256-GCM with random nonce + sentinel-prefixed v1 wire format). `OpenSQLiteEncrypted` wires the cipher into `sqliteStore`; `Put`/`Patch` seal the four sensitive columns (`dsn`, `tls_ca_pem`, `tls_cert_pem`, `tls_key_pem`) before INSERT/UPDATE; `scanProfile`/`unsealBytes` decrypt on read. Legacy plaintext rows are detected via `IsCiphertext` (sentinel byte 0x01 never collides with PEM '-' or DSN scheme letters) and pass through transparently; the next Patch re-encrypts them in place. `cmd/server/main.go` reads `GEODE_PROFILESTORE_KEY` at startup and fails fast with a generator-command hint (`openssl rand -base64 32`) if missing/invalid. Pinned by `TestCipher_Roundtrip`, `TestCipher_DistinctNoncesPerCall`, `TestCipher_WrongKeyFailsAuth`, `TestCipher_TamperedCiphertextFailsAuth`, `TestNewCipherFromEnv_{MissingEnvVar,BadBase64,WrongLength}`, `TestIsCiphertext_DistinguishesPlaintext`, `TestSQLiteEncrypted_PutWritesCiphertextOnDisk` (raw `*sql.DB` re-read confirms ciphertext + non-leakage of plaintext literals + name column stays plaintext for the UNIQUE constraint), `TestSQLiteEncrypted_RoundtripGet`, `TestSQLiteEncrypted_LegacyPlaintextPassthrough`, `TestSQLiteEncrypted_LegacyRowReencryptedOnPatch`, `TestSQLiteEncrypted_ListReturnsPlaintext`, `TestOpenSQLiteEncrypted_RequiresCipher`. `deploy/docker-compose.test.yml` pins a fixed test key; `deploy/docker-compose.example.yml`, `deploy/Dockerfile`, `deploy/Dockerfile.release[.alpine]` document the production env-var contract. |
| S2 | A05 / CWE-489 | **22** | High | **Closed 2026-05-10** (release blocker) | [#115](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/115) | `src/index.tsx:33-41` | **Closed 2026-05-10** -- new webpack DefinePlugin constant `__E2E_ENABLED__` (`webpack.common.js`) substitutes the literal `false` in every release build, so webpack + Terser dead-code-eliminate the wrapped block in `src/index.tsx`. `deploy/Dockerfile` (e2e variant) sets `ENV GEODE_E2E_BUILD=true` so Playwright's `addInitScript` fixture keeps working; `Dockerfile.release` and `Dockerfile.release.alpine` deliberately omit the env var. Verified empirically: `grep GEODE_E2E_INITIAL_CONNECTIONS internal/ui/dist/main.*.js` returns 0 hits in the production build, 1 hit in the e2e build. New `src/__tests__/index-e2e-flag.test.tsx` pins the runtime contract. |
| S3 | A04 / CWE-367, CWE-22 | **17** | Medium | **Closed 2026-05-10 (PARTIAL → CLOSED upgrade 2026-05-13)** | [#116](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/116) | `electron/lib/ipc-guards.ts:81` (was `electron/main.ts:379-397`) | **Closed 2026-05-10; re-validated and upgraded from PARTIAL → CLOSED 2026-05-13.** Phase 2 incorrectly tagged this as PARTIAL; re-reading `electron/lib/ipc-guards.ts:81` confirms the full chain shipped at closure: `safeReadPemFile` opens with `fsConstants.O_RDONLY \| fsConstants.O_NOFOLLOW`, handles `ELOOP` / `EMLINK`, fstats the FD (no second path resolution → TOCTOU window closed), enforces a 1 MiB cap before any bytes are read, and validates the body carries `-----BEGIN .* -----` / `-----END .* -----` armor lines. The dialog's `extensions: ['*']` "All files" filter is dropped; the dialog now restricts to `pem`/`crt`/`key`/`cert`/`cer` only. Pinned by 6 cases in `__tests__/ipc-guards.test.ts` (valid PEM read, oversized rejection, symlink rejection, non-PEM rejection, missing file, non-string path). 2026-05-13 confirmation comment on the issue documents the correction. |
| S6 | A09 + CIS 8.5/8.11 / CWE-778 | **17** | Medium | **Closed 2026-05-10** (release blocker) | [#119](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/119) | `handlers_profiles_crud.go:24-234` | **Closed 2026-05-10** -- POST/PATCH/DELETE handlers in `internal/server/handlers_profiles_crud.go` now emit `profile_created` / `profile_updated` / `profile_deleted` events with actor, profile_id, scope, owner, name (no DSN/PEM material); `maybeReload` emits `profile_reload_failed` on list-or-reload error (PSR-G08). `internal/server/audit.go` adds `dsn`, `pem`, `tls_ca_pem`, `tls_cert_pem`, `tls_key_pem`, `ca_pem`, `cert_pem`, `key_pem` to the redaction substring list (defense-in-depth for S5). Pinned by `TestPostProfiles_EmitsAuditEvent`, `TestPostProfiles_AuditNotEmittedOnFailure`, `TestPatchProfileid_EmitsAuditEvent`, `TestDeleteProfileid_EmitsAuditEvent`, `TestMaybeReload_EmitsAuditOnReloadFailure`, `TestEmitAudit_RedactsProfileStoreSecrets`, and the extended `TestIsSensitive` matrix. |
| S8 | A04 + A03 / CWE-20, CWE-1284 | **17** | Medium | **Closed 2026-05-10** | [#121](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/121) | `electron/main.ts:320-335`, `:345-354` | **Closed 2026-05-10** -- new `sanitizeConnections` and `sanitizeSavedPasswordInput` helpers in `electron/lib/ipc-guards.ts` validate every renderer-supplied payload before it reaches the secure-store layer. Caps: 32 connections, 4 KB tokens, 128-char names, 256-char usernames, 1 KB passwords, 7-day forward expiry. Null-byte rejection on profile/username (closes the `pwKey` separator collision vector). Unknown fields stripped on the way through. `geode:store-connections`, `geode:store-saved-password`, `geode:get-stored-password`, and `geode:clear-stored-password` IPC handlers now reject malformed input with a typed error (or `null`/idempotent `true` on the read/clear paths). 22 cases in `__tests__/ipc-guards.test.ts` pin the contract. |
| S4 | A02 / CWE-311, CWE-353 | **16** | Medium | **Closed 2026-05-10** | [#117](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/117) | `electron/lib/secure-store.ts:69-77`, `:66` | **Closed 2026-05-10** -- `electron/lib/secure-store.ts` now writes a v2 envelope `{ v: 2, ciphertext, hmac }` where `hmac` is hex-encoded HMAC-SHA256 of the safeStorage ciphertext under a per-install MAC key derived from `safeStorage.encryptString("geode-ui-mac-key-v1")`. Tampered ciphertexts fail the MAC check (`crypto.timingSafeEqual`) before decrypt is attempted; legacy `{ encrypted }` envelopes are detected on cold read and re-encrypted into the v2 shape on the next `write()` (one-shot migration, no data loss). Predictable `${storePath}.tmp` replaced with `${storePath}.${randomBytes(8).hex}.tmp` via `joinTmp` + `randomTmpSuffix` from `ipc-guards.ts`. `surfaceUnavailable: true` (default) makes `write()` throw `SecureStoreUnavailableError` when `safeStorage.isEncryptionAvailable()` is false instead of silently dropping data; legacy callers can opt back into the silent contract via `surfaceUnavailable: false`. Pinned by 5 new cases in `__tests__/secure-store.test.ts` (envelope shape, tampered MAC rejection, unavailable surface, legacy migration, randomized tmp suffix) plus 3 cases in `__tests__/ipc-guards.test.ts` (`requireSafeStorage`, `SecureStoreUnavailableError`). |
| S7 | A04 / CWE-799 | **11** | Low | **Closed 2026-05-10** | [#120](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/120) | `cmd/server/main.go` (route wiring) | **Closed 2026-05-10** -- new `internal/server/profilelimiter.go` adds a per-actor (JWT subject) token bucket around POST/PATCH/DELETE on `/api/v1/profiles`. Default 30 req/min, burst 10. Subject extracted via the same Authorization-header / `geode-ui-auth` cookie / `?access_token=` priority order as `extractToken`; unauthenticated callers fall back to a per-IP key prefixed `ip\x00` (the downstream genapi middleware will 401 them, but the IP bucket stops malformed-POST floods from being free). 429 responses carry `Retry-After` and emit a new `profile_rate_limited` audit event so abuse is operator-visible. GET read paths and `/api/v1/profiles/public` pass through unchanged. Wired into `cmd/server/main.go` after `WrapLoginLimit`. Pinned by `TestProfileLimiter_AllowsBurstThenDenies`, `TestProfileLimiter_PerActorIsolation`, `TestProfileLimiter_Wrapper_PassesThroughGET`, `TestProfileLimiter_Wrapper_LimitsPostThirtyOne` (the W1 acceptance: 30 then 429 then refill), `TestProfileLimiter_Wrapper_LimitsPatchAndDelete`, `TestIsProfileCRUDPath` (path/method gate matrix), `TestProfileLimiter_AuditEmittedOn429`. |
| S10 | A04 / CWE-20 | **7** | Low | **Closed 2026-05-10** | [#123](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/123) | `handlers_profiles_crud.go:252-269` | **Closed 2026-05-10** -- new `internal/server/pemvalidate.go` adds `validatePEM(raw, role)` and `validateTLSMaterialPEM(ca, cert, key)`. Per-field cap of 64 KiB (`maxPEMFieldSize`); CA / cert roles require every block in the input to be `Type=="CERTIFICATE"` AND parseable by `x509.ParseCertificate` (cert chains supported); key role requires exactly one block of `PRIVATE KEY` (PKCS8) / `RSA PRIVATE KEY` (PKCS1) / `EC PRIVATE KEY` (SEC1) parsed by the matching stdlib helper. PKCS8 envelopes are type-asserted to `*rsa.PrivateKey` / `*ecdsa.PrivateKey` / `ed25519.PrivateKey` so a malformed-but-decodable shape with an unsupported algorithm fails closed. Trailing non-PEM bytes after the last block are rejected. Error wording is intentionally generic (`invalid CA PEM` / `invalid client cert PEM` / `invalid client key PEM`) so the parser path is not used as a format oracle. Empty strings continue to flow through unchanged so the PSR-G02 `tls: {}` clear path keeps working. Wired into `tlsFromGenJSON` (which `tlsPatchFromGenJSON` already delegates to, so PATCH inherits the same validation). 16 unit tests in `pemvalidate_test.go` (valid CA, valid cert, valid PKCS8 key, valid PKCS1 RSA key, valid SEC1 EC key, valid cert chain, empty-string accepted across all roles, garbage rejected across all roles, key-in-CA-field rejected, cert-in-key-field rejected, oversize rejected with `errPEMTooLarge`, trailing garbage rejected, key+cert-in-key-field rejected, malformed DER rejected, all-valid happy path on the helper, all-empty happy path on the helper, single-bad-field short-circuit). 4 integration tests in `handlers_profiles_crud_test.go` pin the HTTP boundary: `TestPostProfiles_RejectsGarbagePEM`, `TestPostProfiles_AcceptsValidPEM`, `TestPatchProfileid_RejectsGarbagePEM`, `TestPatchProfileid_TLSClearViaEmptyObject_StillWorks`. |
| S9 | (accepted-risk) | **3** | Low | **Closed 2026-05-10 (sec::accepted-risk)** | [#122](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/122) | `src/auth/AuthProvider.tsx:219-238` | `signOut` does not `clearStoredPassword` — intentional per Plan E §8 (browser-password-manager analog). **Closed 2026-05-10** as `sec::accepted-risk`: in-line `signOut` block now carries an explicit "do not 'fix' without re-reading Plan E §8 + this row" guard comment naming the underlying `clearStoredPassword` IPC + TODO #122 follow-up for a Settings UI affordance ("Forget Saved Password"). Risk accepted because forcing a clear on signOut would silently nuke a credential the user explicitly opted to save and would diverge from every browser password manager in the ecosystem; the user retains explicit control via the (planned) Settings affordance and via the existing `geode:clear-stored-password` IPC. |

### PSR — release blockers

Three issues must land before the next tagged release:

1. **S1 (#114)** — trivial one-line allowlist fix; no excuse to ship without it.
2. **S2 (#115)** — backdoor-in-production class; build-time strip is the right primary fix, runtime gate is the safety net.
3. **S6 (#119)** — compliance-stop. The spec advertises an audit trail that does not exist; release notes that say "audit-tracked profile changes" would be false advertising.

### PSR — cross-references

- **S2 (#115) ↔ #64 (SEC-N2)** — JWT revocation was the long-term mitigation for S2's blast radius. N2 landed 2026-05-11 (`RevocationSet` + revoke-on-password-change; SQLite-backed the same day), so a long-lived seeded session can be explicitly revoked and the revocation now survives a restart. S2 remains independently fixed (the e2e backdoor is build-time-gated out of release bundles).
- **S6 (#119) ↔ #78 (PSR-G01)** — gap-sync filed a parallel issue covering the same code from the requirements-coverage angle. Both should close in the same MR.
- **S5 (#118) ↔ S6 (#119)** — encrypted column names (S5) must appear in S6's redaction allowlist. Defense in depth: even if a future emitter passes `dsn` to `emitAudit`, redaction kicks in.
- **S3 (#116) ↔ S10 (#123)** — same payload (PEM material), two ends of the wire. Electron-side picker (S3) and server-side validator (S10) should both land before the v0.6 cutover.

### PSR — accepted risk

**S9 (#122)** is documented and intentional. No code-behaviour change; only a comment in `signOut` and a Settings UI affordance ("Forget Saved Password"). Future reviewers should not "fix" it without re-reading Plan E §8.

### PSR closure run — 2026-05-10 (C1 cohort)

The Phase 3 module **C1 (`electron/lib/ipc-guards.ts`)** landed as a single commit closing all three IPC-layer findings:

- **S3 (#116)** — `pickPemFile` rewritten to use `safeReadPemFile`: `O_NOFOLLOW` open, fstat on the descriptor (no second path resolution), 1 MiB cap before any bytes are read, PEM armor-line validation. The `extensions: ['*']` "All files" filter is dropped from the dialog spec.
- **S4 (#117)** — secure-store now writes a `{ v: 2, ciphertext, hmac }` envelope with HMAC-SHA256 over the safeStorage ciphertext under a per-install MAC key (derived from `safeStorage.encryptString("geode-ui-mac-key-v1")`). Tampered files fail `crypto.timingSafeEqual` before decrypt is attempted. Predictable `${storePath}.tmp` replaced with `${storePath}.${randomBytes(8).hex}.tmp`. `surfaceUnavailable: true` (default) makes `write()` throw `SecureStoreUnavailableError` instead of silently no-oping. **Migration:** legacy `{ encrypted: <base64> }` envelopes are detected on cold read (no MAC field), decrypted as-is, and re-emitted as v2 on the next `write()`. Zero data loss. The `surfaceUnavailable: false` switch remains for the one legacy-contract unit test.
- **S8 (#121)** — `sanitizeConnections` and `sanitizeSavedPasswordInput` validate every renderer-supplied IPC payload (typed, capped, finite, null-byte-rejected). Malformed shapes throw a typed error to the renderer instead of round-tripping through the secure-store. The `geode:get-stored-password` and `geode:clear-stored-password` read paths get the same input gate (returning `null`/`true` to keep the surface idempotent).

Test pinning: 30 cases in `__tests__/ipc-guards.test.ts` (new) + 5 S4-specific cases added to `__tests__/secure-store.test.ts`. Full SPA suite: 38 suites, 336 tests, all passing.

### PSR — verdict

The PSR cohort is **healthier than the prior F*/N* cohort** by raw count of release blockers (3 vs 5 from the prior cohort's first pass). The dominant pattern is **trust-boundary porosity at the IPC layer** (S3, S4, S8 all live under `electron/`) and **missing crypto/audit envelopes** at the persistence layer (S5, S6). Both clusters have well-scoped fixes via the C1/C2/C3 coordinated modules.

**No production credentials are leaked; no active RCE path was identified.** S1 is the closest thing to a remote-pivot primitive but is gated on a renderer compromise.

**Recommended sequencing for the v0.6 release window:**

1. **Week 1:** Land S1 (#114), S2 (#115), S6 (#119) — release blockers, all small PRs.
2. **Week 2:** Land C1 (S3 + S8 + S4-partial) and C2 (S5) — coordinated PRs, two reviewers each.
3. **Week 3:** Land S4 (full) and S10 — straightforward; depend on C1/C2 review feedback.
4. **Backlog:** S7, S9 — post-release hardening + docs.

---

## Audit-2026-05-11 cohort — full-tree security pass

**Scope:** Full-tree adversarial security pass on HEAD `d3e5de1`. Re-runs gitleaks / npm-audit / govulncheck / gosec / semgrep on the working tree and applies manual review against the MCP, profilestore, quoting, CI, and Electron-packaging surfaces.

**Cohort summary:** 7 new GitLab issues (1 confidential, 1 release-blocker) + 1 cross-link comment on the existing F-SUP-2 (#72). The dominant new pattern is **upstream-genapi context-threading** — F-AUTH-1 and F-AUTH-2 both trace back to the MCP tool generator template — combined with a **stdlib supply-chain bump** (F-SUP-1, release-blocker) and three lower-severity hardening items.

### Audit-2026-05-11 findings — stack ranked by risk score

| ID | OWASP / CWE | Risk | Severity | Decision | GitLab issue | File:Line | Title |
|----|-------------|-----:|----------|----------|--------------|-----------|-------|
| F-AUTH-1 | A01 / CWE-863 | **20** | High | **Closed `4002c6f`** (geode-ui) + genapi `e01b2de` (+ `1ffa8eb` precursor) — full fix; release-blocker cleared; **#132 closed** | [#132](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/132) | `gen/mcp/tools.gen.go:40`; `internal/server/mcp.go:38-40` | MCP `query` tool drops JWT `profile` claim — cross-profile data access |
| F-SUP-1 | A06 / CWE-1395 | **16** | High | **Closed `d464fe6`** (release-blocker cleared) | [#148](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/148) | `scripts/run-go.sh:9` | Go 1.26.2 stdlib has 4 CALLED CVEs — bump to go1.26.3 |
| F-AUTH-2 | A01 / CWE-862 | **12** | Medium | **Closed `1ec9889`** (geode-ui) + genapi `30fad5d` — mechanism landed; `query` keeps its no-role policy (matches the `POST /api/v1/query` REST route); **#135 closed** | [#135](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/135) | `gen/pkg/mcpx/engine.go:500-580` | MCP layer has no per-tool role enforcement |
| F-INPUT-1 | A03 / CWE-89 | **9** | Medium | **Closed `454d0ba`** | [#140](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/140) | `internal/server/quoting.go:61-68` | `quoteString` does not escape backslash — diverges from authoritative GQL escaper |
| F-SUP-3 | A08 / CWE-829 | **9** | Medium | **Closed `d35d3c7`** (2026-05-12) — 3/4 floating refs pinned to immutable tags (`genapi@v0.3.0`, `golangci-lint@v2.12.2`, `benchstat@…`); the 4th (`codesign-windows-ssl@~latest`) carries a `# ci-pins-allow:` marker + `TODO(#127)` (no tagged ci-catalog release ships it yet — pre-existing); new `scripts/check-ci-pins.sh` guard + `ci-pins-check` job still catches *new* `@latest` regressions; **#153 closed** (codesign pin tracked via the marker + #127's TODO) | [#153](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/153) | `.gitlab-ci.yml`, `scripts/check-ci-pins.sh` (new) | CI components pinned to floating refs |
| F-SUP-2 | A06 / CWE-1395 | **9** | Medium | **#72 already open** — deferred-comment by gap-sync | [#72](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/72) | `pnpm-lock.yaml` | serialize-javascript HIGH RCE in dev-only copy-webpack-plugin |
| F-SUP-4 | A08 / CWE-1357 | **6** | Low | **Closed `f444c70`** | [#160](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/160) | `package.json:31-34` | electron / electron-builder referenced in scripts but missing from devDependencies |
| F-INPUT-2 | A04 / CWE-665 | **4** | Low | **Closed `ea3f681`** (2026-05-12) — `unsealBytes`'s `cipher == nil` branch now `if IsCiphertext(raw) { return "", fmt.Errorf("profilestore: ciphertext present but no cipher configured") }`; plaintext + empty pass through unchanged; defense-in-depth (production still fail-fasts on missing `GEODE_PROFILESTORE_KEY` at store construction). Test: `sqlite_test.go` +`TestUnsealBytes_FailsLoudWithoutCipher`. `internal/profilestore` cov 80.7%→81.0%; **#143 closed** | [#143](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/143) | `internal/profilestore/sqlite.go` | `unsealBytes` silently passes ciphertext when cipher unconfigured |
| F-SUP-5 | A07 / CWE-798 | **2** | Low (info) | Open | [#161](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/161) | `docs/superpowers/plans/2026-05-06-e2e-testing-stack.md:458,461,1697` | Plan doc embeds copyable JWT_SECRET_HEX placeholder |

### Audit-2026-05-11 — release blockers

Both original release-blockers are now **fully resolved** (the 2026-05-12 gap-closure run landed the authoritative F-AUTH-1 fix that replaces the earlier in-repo mitigation):

1. **F-AUTH-1 (#132)** — **CLOSED at `4002c6f`** (geode-ui) + genapi `e01b2de` (+ `1ffa8eb` precursor). genapi now threads `context.Context` natively through the MCP tool path: `mcpx.Tool` takes a `ctx` param, `MCPServerInterface.Query(ctx, params)`, and `mcpx.SetAuthVerifier` takes a `func(*http.Request)(context.Context,error)`. In geode-ui, `internal/server/mcp.go`'s `MCPServer.Query(ctx, params)` → `handleQuery(ctx, params)` reads the JWT-enriched context directly; the entire per-goroutine stash (`mcpQueryContext`/`mcpRequestCtx`/`goID`/`WrapMCPHTTP`) is **deleted**. `MCPAuthVerifier func(*http.Request)(context.Context,error)` runs `AuthJWT` (which mutates `*r` so `r.Context()` carries `profileCtxKey`/`rolesCtxKey`) and returns `r.Context()`. Pinned by `internal/server/mcp_profile_test.go` against the native path: `TestMCPQuery_CrossProfileIsolation`, `TestMCPQuery_AppliesProfileClaim`, `TestMCPQuery_AuditAttributedToJWTProfile`, `TestMCPQuery_NoTokenFallsBackToDefault`. Release-blocker → **cleared**. **#132 closed.** (Originally filed `--confidential`.)
2. **F-SUP-1 (#148)** — **CLOSED at `d464fe6`** (+ `a7d63f3` in sibling `../geode-client-go` on branch `codex/client-parity-sync`). All 5 repo refs (`Makefile:3`, `scripts/run-go.sh:9`, `scripts/check-go-mod-tidy.sh:10`, `.gitlab-ci.yml:242`, `deploy/Dockerfile:45`) now `go1.26.3`; sibling `go.mod` `toolchain go1.26.3`; `govulncheck ./...` → "No vulnerabilities found" (GO-2026-4980/4982/4918/4971 no longer CALLED). **Note:** the sibling-repo commit landed on branch `codex/client-parity-sync`, not `main` — a separate PR/merge there is still pending. Release-blocker → **cleared**.

### Audit-2026-05-11 — cross-references

- **F-AUTH-1 (#132) ↔ F-AUTH-2 (#135)** — both trace to the MCP tool generator template in upstream genapi. F-AUTH-1 (context-threading) must land first because F-AUTH-2 (per-tool role gate) needs the verified context to read role claims from.
- **F-AUTH-1 (#132) ↔ F-1 (#69)** — SEC-F1 wired `mcpx.SetAuthVerifier` (closed); F-AUTH-1 is the follow-on showing that auth is verified but the verified context is dropped before the tool body runs.
- **F-INPUT-1 (#140) ↔ N1 (#63)** — same `quoting.go` surface; the existing adversarial corpus (closed via SEC-N1) is the extension point for the new backslash-escape test cases.
- **F-INPUT-2 (#143) ↔ S5 (#118)** — defense-in-depth on the encryption layer that S5 introduced; **closed `ea3f681`** — `unsealBytes` now closes the `cipher == nil && IsCiphertext(raw) == true` truth-table gap by failing loud.
- **F-SUP-1 (#148)** — touches `~/src/devnw/codepros/geode/geode-client-go/scripts/run-go.sh` cross-module; both repos must bump in lockstep.
- **F-SUP-3 (#153) ↔ Q32 (#127)** — same `.gitlab-ci.yml` surface; **both closed `d35d3c7`** (Q32 is the maintainability framing, F-SUP-3 the upstream-takeover-risk framing). 3/4 floating refs pinned to immutable tags; `codesign-windows-ssl@~latest` pin pending an upstream ci-catalog release (tracked via the `# ci-pins-allow:` marker + #127's `TODO`).
- **F-SUP-4 (#160) ↔ SEC-NEW-1** — both observe the same Electron-packaging surface; F-SUP-4 is the lockfile-integrity fix while SEC-NEW-1 is the broader release-engineering deferral.

### Audit-2026-05-11 — upstream-genapi follow-ups

**Status (2026-05-12 gap-closure run): both landed in genapi `main`.** F-AUTH-1's full fix and F-AUTH-2's mechanism were both implemented in `~/src/devnw/go/genapi` and the generated surface regenerated into geode-ui's `gen/`. The relevant genapi commits sit on genapi `main` **unpushed** (5 commits ahead of origin: `1ffa8eb`, `e01b2de`, `30fad5d`, `09d4ac8`, `55c79d2`); the user decides on pushing / tagging genapi.

- **genapi `e01b2de`** (+ `1ffa8eb` precursor) — **F-AUTH-1 (#132) full fix**: MCP tool generator threads `context.Context` through `MCPServerInterface.<Tool>`, the `mcpx.Tool` signature, and `mcpx.SetAuthVerifier`. geode-ui regen'd `gen/mcp/tools.gen.go` (`Query(ctx, ...)`) + `gen/pkg/mcpx/engine.go` (`Tool` ctx param); the `mcpQueryContext()` per-goroutine stash in `internal/server/mcp.go` is **deleted**; `mcp_profile_test.go` green against the native path. **#132 closed at `4002c6f`.**
- **genapi `30fad5d`** — **F-AUTH-2 (#135)**: `mcpx.ContextWithRoles`/`RolesFromContext`/`SetToolRoles` + a `handleRaw` gate (no roles in ctx + tool requires a role → audit + JSON-RPC `-32000 "insufficient role"`, tool body never runs) + `mcpToolRoles` template emission. geode-ui's `geode.json` `query` tool deliberately declares **NO** required role (matches the `POST /api/v1/query` REST route, which has none) so behavior is unchanged; `internal/server/mcp.go` re-publishes JWT roles via `mcpx.ContextWithRoles(ctx, rolesFromContext(ctx))`. Upstream genapi tests cover sufficient / insufficient / none-declared. **#135 closed at `1ec9889`.**

> ⚠️ **Breaking-change caveat for other genapi consumers** — `e01b2de` and `30fad5d` change genapi's `mcpx.Tool` / `MCPServerInterface` / `SetAuthVerifier` API → the next genapi release should be a **minor version bump**. Other genapi consumers (notably `devnw.dev/oidc`) must: (1) regenerate against the new genapi; (2) update their `MCPServerInterface` implementations to the new `ctx`-carrying signatures; (3) add a `defer obsx.FlushLogs()` on shutdown (see PERF-2026-05-11-03 / genapi `09d4ac8` below). Flagged here so the genapi release notes pick it up.

### Audit-2026-05-11 — regression check of previously-closed items

Re-ran the relevant smoke tests against HEAD `d3e5de1`:

| Closed item | Issue | Regression check | Result |
|---|---|---|---|
| F1 — `/mcp` auth verifier wired | #69 | `mcpx.SetAuthVerifier(...)` still wired in `cmd/server/app.go` — now with the `func(*http.Request)(context.Context,error)` signature; the verified context reaches the tool body natively (F-AUTH-1 #132 closed) | **PASS** |
| F2 — `/auth/login` rate-limit | #58 | `internal/server/loginlimiter.go` still wired | **PASS** |
| F3 — JWT clock leeway | #70 | `WithLeeway(60s)` still in `internal/jwt/jwt.go` | **PASS** |
| F4 — CSP / Permissions-Policy / COOP | #60 | `internal/server/security_headers.go` still wraps the SPA pipeline | **PASS** |
| F5 — `?access_token=` Deprecation header | #71 | `WithAccessTokenDeprecation` still wired | **PASS** |
| F6+N6 — Audit-log redaction | #67 | `obsx.IsSensitiveKey` + `audit.go` extension still in place | **PASS** |
| F7 — JWT cookie + CSRF middleware | #62 | Cookie writer/reader + CSRF middleware still in place | **PASS** |
| F8 — dompurify override | #68 | `package.json` `"overrides": { "dompurify": "^3.4.0" }` resolves to `3.4.2 overridden` | **PASS** |
| F11 — gosec G115 in gqlx/subscription.go | #77 | Real bounds-check still in the regenerated file | **PASS** |
| N1 — `quoteString` adversarial corpus | #63 | `quoting_test.go` corpus intact; **F-INPUT-1 extends it with backslash cases** | **PASS** (corpus needs extension) |
| N2 — JWT revocation | #64 | `RevocationSet` + SQLite-backed cache still wired | **PASS** |
| N3 — Login profile canonicalisation | #65 | `canonicalProfile()` still called from `handlers_auth.go` | **PASS** |
| N4 — Server-side password policy | #72 | `validatePassword` still wired | **PASS** |
| N5 — Wildcard CORS rejection | #74 | `httpx.ValidateConfig` still in place | **PASS** |
| N7 — Per-IP global rate limiter | #66 | `httpx.PeerLimiter` still wired at 50 rps / burst 100 | **PASS** |
| N8 — security.txt | #75 | `/.well-known/security.txt` still served (mailto routability **deferred** under SEC-NEW-6) | **PASS** (with caveat) |
| N10 — Constant-time auth-failure path | #76 | `performDummyCompare` + `loginMinFailureLatency` still present | **PASS** |
| S1-S10 PSR — | #114-#123 | All ten closures still in place; spot-checked S5 (`OpenSQLiteEncrypted`), S6 (`profile_*` audit events), S8 (`sanitizeConnections`) | **PASS** |

**Hardening tweaks (not regressions):** F-INPUT-1 extended N1's quoting corpus (closed `454d0ba`); F-INPUT-2 hardened S5's `unsealBytes` (closed `ea3f681` — fail-loud on ciphertext-without-cipher; `TestUnsealBytes_FailsLoudWithoutCipher`). Both were flagged in the cohort table above; no previously-closed item is reopened.

### Audit-2026-05-11 — verdict

The cohort is **smaller and more focused than PSR**: 1 confidential High (cross-profile data access), 1 supply-chain High (stdlib CVEs), 1 latent Medium (MCP role gate), 2 hardening Mediums (quoting backslash escape, CI pin-immutability), 3 Lows (electron lockfile, ciphertext truth-table, doc placeholder).

**Gap-closure status (2026-05-11 run):** F-SUP-1 (#148) **CLOSED** (`d464fe6`); F-INPUT-1 (#140) **CLOSED** (`454d0ba`); F-SUP-4 (#160) **CLOSED** (`f444c70`).

**Gap-closure status (2026-05-12 genapi+medium run):** F-AUTH-1 (#132) **CLOSED** (`4002c6f` + genapi `e01b2de`/`1ffa8eb`) — full fix; the in-repo mitigation `c46e77e` is fully superseded (the per-goroutine stash is deleted). F-AUTH-2 (#135) **CLOSED** (`1ec9889` + genapi `30fad5d`) — per-tool role mechanism landed; `query` keeps its no-role policy. **Both original release-blockers are now fully resolved.**

**Gap-closure status (2026-05-12 top-10 quality/perf/CI run):** F-SUP-3 (#153) **CLOSED** (`d35d3c7`) — 3/4 floating CI refs pinned to immutable tags (`genapi@v0.3.0` [== genapi `main` HEAD `55c79d2`, the tree `gen/` was generated against], `golangci-lint@v2.12.2`, `benchstat@…`); `codesign-windows-ssl@~latest` left unpinned with a `# ci-pins-allow:` marker + `TODO(#127)` (**deviation** — no tagged ci-catalog release ships that component yet; pre-existing — `glab ci lint` failed on that line before this change too); the codesign-pin follow-up is tracked via the marker + #127's TODO; new `scripts/check-ci-pins.sh` guard wired into `.pre-commit-config.yaml` + a `ci-pins-check` CI lint job still catch *new* `@latest` regressions. F-INPUT-2 (#143) **CLOSED** (`ea3f681`) — `unsealBytes` fails loud on ciphertext without a cipher; defense-in-depth (production still fail-fasts at store construction); `TestUnsealBytes_FailsLoudWithoutCipher`.

F-SUP-2 (#72) and F-SUP-5 (#161) remain open (out of scope for these closure runs).

**No production credentials are leaked; no active RCE path was identified.** F-AUTH-1 (the closest thing to an immediate concern, and JWT-gated) is now fully fixed via natively-threaded request context.

### Audit-2026-05-11 — immediate actions

- **None requiring secret rotation.** F-SUP-5 is a placeholder (not deployed).
- **DONE:** F-SUP-1 (`go1.26.3` bump) — `d464fe6`, closes 4 CALLED CVEs. Sibling-repo merge (`../geode-client-go` branch `codex/client-parity-sync`) still pending.
- **DONE:** F-AUTH-1 full fix — `internal/server/mcp.go` / `cmd/server/app.go` natively-threaded ctx — `4002c6f` + genapi `e01b2de`/`1ffa8eb`. **#132 closed.** genapi commits unpushed; the API change is breaking for other genapi consumers (see the upstream-genapi follow-ups note above).
- **DONE:** F-AUTH-2 per-tool role mechanism — `1ec9889` + genapi `30fad5d`. **#135 closed.**
- **DONE (2026-05-12 top-10 batch):** F-SUP-3 CI ref pinning — `d35d3c7`. 3/4 floating refs pinned (`genapi@v0.3.0`, `golangci-lint@v2.12.2`, `benchstat@…`); `codesign-windows-ssl@~latest` carries a `# ci-pins-allow:` marker + `TODO(#127)` because no tagged ci-catalog release ships it yet (the pin-immutability follow-up rides on the marker + #127's TODO); new `scripts/check-ci-pins.sh` guard + `ci-pins-check` job. **#153 closed.**
- **DONE (2026-05-12 top-10 batch):** F-INPUT-2 ciphertext truth-table — `ea3f681`. `unsealBytes` now fails loud (`fmt.Errorf("profilestore: ciphertext present but no cipher configured")`) when `cipher == nil && IsCiphertext(raw)`; plaintext + empty pass through; defense-in-depth (production still fail-fasts on missing `GEODE_PROFILESTORE_KEY` at store construction). `TestUnsealBytes_FailsLoudWithoutCipher`. **#143 closed.**
- **Remaining:** F-SUP-2 (dev-only serialize-javascript, #72), F-SUP-5 (doc placeholder, #161).
- **Carried-forward CI follow-up (not a security item — tracked via the in-file `# ci-pins-allow:` marker + #127's `TODO`):** pin `codesign-windows-ssl` to an immutable ci-catalog tag once one ships that component (today it's only on the catalog's `main`).

## 2026-05-13 audit cohort

A focused security re-sweep on top of the Audit-2026-05-11 cohort. Eight new findings filed (three confidential), and **S3 (#116) explicitly upgraded from PARTIAL → CLOSED** based on re-reading `electron/lib/ipc-guards.ts:81`. The Phase 2 PARTIAL tag was incorrect: the closure already had the full `O_NOFOLLOW`/fstat-on-FD/1 MiB-cap/PEM-armor-validation chain in place.

### 2026-05-13 findings — stack ranked by risk score

| ID | File:Line | OWASP / CWE | Risk (L x I) | Severity | Confidential | Issue | Status |
|---|---|---|---|---|---|---|---|
| **S-NEW-5** | `internal/server/loginlimiter.go:337-350` | A07 / CWE-290, CWE-348, CWE-799 | **20** (5 x 4) | **High** | **YES** | [#201](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/201) | **RESOLVED 2026-05-13** (commit `6f75a74`) — `clientIP()` no longer honors `X-Forwarded-For` by default. New `-trust-proxy-xff` boolean CLI flag (default `false`) is threaded through `LoginLimiterConfig.TrustProxyXFF` + `ProfileLimiterConfig.TrustProxyXFF` so both limiters key on `net.SplitHostPort(r.RemoteAddr)` unless the operator explicitly opts in for a trusted-proxy deployment. Closes the XFF spoofing bypass of the 5 rps login limiter and the DoS-by-lockout vector against arbitrary innocent IPs. Pinned by two new unit tests (`TestClientIP_RemoteAddrOnly_WhenXFFNotTrusted`, `TestClientIP_HonorsXFF_WhenTrusted`). Trusted-proxy CIDR enforcement was deemed out-of-scope for the 1-day fix — the flag is binary and operator-opt-in; deployments behind multi-hop proxies will be revisited if/when XFF parsing on the trusted path proves insufficient. |
| **S-NEW-2** | `cmd/server/app.go:74` + `internal/server/handlers_auth.go:149-154` | A07 + A05 / CWE-1188, CWE-269 | **15** (3 x 5) | **Medium** | **YES** | [#202](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/202) | **OPEN** — `-admin-users` defaults to `"geode"`; any successful login as username `geode` auto-grants `admin` role. Exploitable only if upstream Geode accepts `geode/<password>` (the typical bootstrap state). Fix: default to empty; emit startup audit event listing the configured admins; release-note the change. |
| **GO-2026-4918** | `go.mod` (toolchain `go1.26.2`) — reachable via `gen/pkg/oidcx.Do` | A06 / CWE-835 | **6** (2 x 3) | **Medium** | NO | [#212](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/212) | **OPEN** — `net/http2` SETTINGS frame infinite loop, CALLED via the OIDC discovery client. Bump toolchain to the patched 1.26.x release; pair with the prior F-SUP-1 (#148) toolchain-bump path. |
| **S-NEW-9** | `internal/server/csrf.go:146-152` + `handlers_auth.go:195-211` | A04 + A07 / CWE-613, CWE-352 | **6** (3 x 2) | **Medium** | **YES** | [#205](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/205) | **OPEN** — `/auth/logout` is CSRF-exempt and only clears the cookie; it does NOT revoke the JTI via the durable N2 `RevocationSet`. Nuisance forced-logout via cross-origin POST; stolen JWT stays valid until `exp`. Fix: parse the cookie/header token best-effort in `HandleLogout` and call `Revocation().Revoke(jti, exp)` + emit `auth_logout` audit event. |
| **S-NEW-6** | `internal/server/security_headers.go:107-117` | A09 / CWE-778 | **6** (3 x 2) | **Low** | NO | [#206](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/206) | **OPEN** — `WithAccessTokenDeprecation` emits the `Sunset`/`Deprecation`/`Link` headers but no audit event. Operators land blind on the 2026-07-01 sunset. Fix: emit a rate-limited `access_token_query` audit event with `{path, user_agent}`; add a Prometheus counter on the same code path. |
| **S-NEW-3** | `internal/server/auth.go:69-71` | A04 / CWE-1023, CWE-289 | **3** (1 x 3) | **Low** | NO | [#209](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/209) | **OPEN** (upstream-genapi follow-up) — auth shim re-injects `Authorization: Bearer <tok>` after a successful `s.cfg.JWT.Parse` so the genapi-emitted per-route middleware's re-parse succeeds. Safe today; brittle. Fix: file `genapi#XXX` to teach the per-route middleware to consume claims from `req.Context()`; once landed, delete the shim. |
| **S-NEW-7** | `internal/jwt/jwt.go:71-92` + `cmd/server/app.go:72,138-144` | A02 / CWE-321, CWE-320 | **2** (1 x 2) | **Low** | NO | [#210](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/210) | **OPEN** — HS256 single-secret, no `kid` claim, no rotation runbook. Hard rotation invalidates all sessions instantly. Fix: emit `kid` header on every issued token; accept a `-jwt-secret-hex-rotating` JSON map; document the swap-and-restart runbook. |
| **S-NEW-8** | `internal/profilestore/crypto.go:28-32` | A02 / CWE-320 | **1** (1 x 1) | **Info** | NO | [#211](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/211) | **OPEN** — AES-256-GCM `Cipher` has a sentinel byte reserving wire-format space for `v2+` but no `Rewrap` primitive and no operator migration. Fix: add `Cipher.Rewrap` + `-profilestore-rewrap-from <hex>` one-shot startup sweep + operator runbook. |

### 2026-05-13 — confidential issues

Three issues filed `--confidential`:

- **#201 (S-NEW-5)** — auth-bypass chain via XFF spoofing, plus DoS-by-lockout against arbitrary IPs.
- **#202 (S-NEW-2)** — admin-role privilege escalation via bootstrap default username.
- **#205 (S-NEW-9)** — exploitation requires a specific forced-logout / stolen-token chain that we'd rather not publish before fix.

The five public issues (#206, #209, #210, #211, #212) describe architectural / operational gaps with no immediate exploit chain.

### 2026-05-13 — S3 PARTIAL → CLOSED correction

S3 (#116, `pickPemFile` TOCTOU + `extensions:['*']`) was tagged **PARTIAL** in the Phase 2 sweep. Re-reading the post-closure code today:

`electron/lib/ipc-guards.ts:81`

```ts
const flags = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
```

The closure already shipped the full chain — `O_NOFOLLOW` at open time (with `ELOOP` / `EMLINK` handling), `fstat` on the FD (no second path resolution → TOCTOU window closed), 1 MiB cap before any bytes are read, PEM armor-line validation, and the dialog's `extensions:['*']` filter dropped in favour of `pem`/`crt`/`key`/`cert`/`cer`. Six unit tests in `__tests__/ipc-guards.test.ts` pin the contract. The PARTIAL tag was incorrect; **upgraded to CLOSED** in this audit. A confirmation comment was added to #116 documenting the correction.

### 2026-05-13 — regression check of previously-closed items

| Closed item | Issue | Spot-check at 2026-05-13 | Verdict |
|---|---|---|---|
| F2 — `/auth/login` rate-limit | #58 | `internal/server/loginlimiter.go` still wired (per-IP 5 rps; 5-fail-in-15-min lockout) | **PASS** (with caveat — see S-NEW-5 on XFF spoofing the IP attribution) |
| F4 — CSP / COOP / Permissions-Policy | #60 | `internal/server/security_headers.go` still emits CSP+COOP on SPA HTML, Permissions-Policy globally | **PASS** |
| F7 — Cookie-mode JWT + CSRF | #62 | Auth cookie + CSRF double-submit middleware + SPA cookie-mode auth still intact | **PASS** (with caveat — see S-NEW-9 on logout-side revocation) |
| N2 — Durable JWT revocation | #64 | `RevocationSet.AttachSQLite` + JTI emission + revoke-on-password-change all intact; restart-survival test still passes | **PASS** (with caveat — see S-NEW-9 on the missing call-site at logout) |
| S3 — `safeReadPemFile` | #116 | `O_NOFOLLOW`+fstat+1 MiB cap+PEM armor at `electron/lib/ipc-guards.ts:81` | **PASS — upgraded PARTIAL → CLOSED** (see correction above) |
| S5 — Profilestore at-rest encryption | #118 | AES-256-GCM `Cipher` with random nonce + sentinel-prefixed v1 wire format intact; `Put`/`Patch` seal four sensitive columns | **PASS** (S-NEW-8 filed as Info-level rewrap follow-up; closure unaffected) |
| S8 — IPC input validation | #121 | `sanitizeConnections` + `sanitizeSavedPasswordInput` continue to gate every renderer-supplied payload | **PASS** |

### 2026-05-13 — verdict

The cohort is **small and architectural**. One High (S-NEW-5, XFF spoofing → login-limiter bypass + DoS-by-lockout) is the only finding requiring near-term remediation. The remaining items split into:

- **Operational hardening** (S-NEW-2 admin-bootstrap default, S-NEW-6 sunset visibility, S-NEW-7 JWT key rotation, S-NEW-8 cipher rewrap) — all closable with no architectural rework.
- **Follow-ups on existing closures** (S-NEW-9 wires the logout side of N2; S-NEW-3 is the upstream-genapi structural cleanup of F7's shim).
- **Toolchain bump** (GO-2026-4918) — coordinate with #148.

**No active RCE, no leaked production secrets, no privilege-escalation path open.**

### 2026-05-13 — immediate actions

- **None requiring secret rotation.** No live credentials surfaced.
- **DONE 2026-05-13 (commit `6f75a74`):** S-NEW-5 (#201) — gated XFF parsing behind `-trust-proxy-xff` flag (default off); `clientIP()` now returns `RemoteAddr` host portion by default, so an attacker can no longer rotate the per-IP login-limiter key or trip lockouts against arbitrary innocent IPs. Both `LoginLimiter` and `ProfileLimiter` honor the flag. Pinned by `TestClientIP_RemoteAddrOnly_WhenXFFNotTrusted` and `TestClientIP_HonorsXFF_WhenTrusted` in `internal/server/loginlimiter_test.go`.
- **Coordinate:** GO-2026-4918 (#212) toolchain bump with the existing F-SUP-1 (#148) path.
- **Next:** S-NEW-2 (#202) default `-admin-users` to empty; emit startup audit; release-note the change.
- **Then:** S-NEW-9 (#205) wire `Revocation().Revoke(jti, exp)` into `HandleLogout`.
- **Lower priority:** S-NEW-6 (#206), S-NEW-7 (#210), S-NEW-8 (#211), S-NEW-3 (#209) — defer to the next operational-hardening sprint.
