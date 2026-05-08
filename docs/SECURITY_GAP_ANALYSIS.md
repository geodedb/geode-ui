# Security Gap Analysis — geode-ui

**Last updated:** 2026-05-07
**Audit:** /codepros:audit Phase 3 → Phase 4 tracking
**Repository:** `devnw/codepros/geode/geode-ui`
**Branch reviewed:** `main` @ `c47534a`

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
| **gosec** | Go (`./...`) | 1 finding in generated code (G115 in `gen/pkg/gqlx/subscription.go:394`); G703/G304/G120 reviewed and mitigated by surrounding code (see Confirmed-Safe). |
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
| 4 | N2 | Medium | **36** | No JWT revocation / no session invalidation on password change | [#64](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/64) | `internal/jwt/jwt.go`, `internal/server/handlers_auth.go` | Server-side JTI revocation set; revoke on password change |
| 5 | N3 | Medium | **36** | Login silently defaults profile="" → "default" | [#65](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/65) | `internal/server/handlers_auth.go:43-46` | **Closed** 2026-05-07 (cross-closed via `8e9f5d2` for #58) -- profile canonicalised in `handlers_auth.go` and the rate-limiter via `canonicalProfile()`. |
| 6 | F6+N6 | Medium | **36** | Audit log redaction gap (LogAudit not redacting; sensitiveKeys incomplete) | [#67](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/67) | `gen/pkg/obsx/log.go:381-382`, `internal/server/audit.go:56-70` | Centralize redaction in obsx.LogAudit; expand sensitiveKeys |
| 7 | N7 | Medium | **32** | Global-only rate limiter (no per-IP partition) | [#66](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/66) | `cmd/server/main.go:101-103` | **Partially closed** 2026-05-07 (`8e9f5d2`) -- per-IP wrapper landed for `/auth/login` via `loginlimiter.go`. Structural per-IP across all routes deferred to `genapi#215` (httpx middleware). Issue remains open in geode-ui pending the genapi rollout. |
| 8 | N1 | Medium | **24** | ALTER USER quoteString edge-case audit | [#63](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/63) | `internal/server/handlers_users.go:233` | Targeted unit tests on quoteString edge cases |
| 9 | N4 | Low | **24** | No server-side password policy | [#72](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/72) | `internal/server/handlers_auth.go:99-103` | Min 12 chars; HIBP k-anon (optional) |
| 10 | N10 | Low | **24** | User-enumeration timing channel on /auth/login | [#76](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/76) | `internal/server/handlers_auth.go:131-148` | Constant-time auth-failure path; unify 401 response |
| 11 | F8 | Medium | **16** | dompurify@3.2.7 transitive (8 advisories) | [#68](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/68) | `pnpm-lock.yaml` | Bump monaco-editor or pnpm.overrides |
| 12 | F5 | Low | **16** | Deprecate ?access_token= query fallback | [#71](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/71) | `internal/server/auth.go:88` | **Closed** 2026-05-08 — `WithAccessTokenDeprecation` middleware emits `Deprecation: true`, `Sunset: <AccessTokenSunsetDate>`, and a `Link; rel="deprecation"` header on every response that carried `?access_token=`. Sunset 2026-07-01. |
| 13 | N5 | Low | **16** | httpx CORS supports wildcard origin | [#74](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/74) | `gen/pkg/httpx/server.go:117-141` | Reject `*` when CORSEnabled in prod |
| 14 | F1 | Low | **8** | /mcp mounted but mcpx.SetAuthVerifier never called (fail-closed) | [#69](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/69) | `cmd/server/main.go:165` | **Closed** 2026-05-08 — `mcpx.SetAuthVerifier(srv.AuthJWT)` wired so /mcp authorizes via the same HS256 verifier that gates the REST API. |
| 15 | F3 | Low | **8** | JWT verify has no clock leeway | [#70](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/70) | `internal/jwt/jwt.go:82-94` | **Closed** 2026-05-08 — `jjwt.WithLeeway(60 * time.Second)` passed to `ParseWithClaims`. Tests pin the upper bound: an exp 2 minutes in the past still rejects. |
| 16 | F12 | Low | **8** | serialize-javascript HIGH RCE in dev-only copy-webpack-plugin | [#73](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/73) | `package-lock.json` | Bump or replace plugin |
| 17 | N8 | Low | **8** | Missing public/.well-known/security.txt | [#75](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/75) | `public/.well-known/security.txt` | **Closed** 2026-05-08 — file added per RFC 9116 (Contact, Expires 2027-05-08, Encryption, Acknowledgments, Canonical, Policy). Webpack CopyPlugin emits it under the SPA's `/.well-known/security.txt`. |
| 18 | F11 | Low | **4** | gosec G115 in genapi-emitted gqlx/subscription.go | [#77](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/77) | `gen/pkg/gqlx/subscription.go:394` | Fix in genapi at `~/src/devnw/apps/genapi`; regenerate |

**Confidential issues** (Critical/High): F2 (#58), F4 (#60), F7 (#62) — created with `--confidential` because they describe an exploit chain or a credential-storage flaw with a concrete exfil path. **All three closed in the 2026-05-07 closure run.**

### Closure run 2026-05-07

Three High-severity confidential issues + one cross-closed Medium + one partially closed Medium:

- **F2 (#58)** -- closed via `8e9f5d2`. Per-IP (5 rps, burst 10) and per-(profile,username) (5 fails / 15 min lockout) limiter wired into `/auth/login`.
- **F4 (#60)** -- closed via `1791a37`. CSP + COOP on SPA HTML; Permissions-Policy global.
- **F7 (#62)** -- closed via `56d4e5f` + `21955c4` + `4eb3dcd`. Server cookie writer/reader (1/3), CSRF double-submit middleware (2/3), SPA refactor (3/3). Dual-mode kept on `?access_token=` for one minor (F5/#71 deprecation).
- **N3 (#65)** -- cross-closed via `8e9f5d2` (profile canonicalisation lands in the same commit).
- **N7 (#66)** -- partially closed via `8e9f5d2` for the login surface; structural fix tracked at `genapi#215`.

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

## Threat-Model Verdict

The geode-ui server has a **defensible foundation** — JWT lock-down to HS256 with mandatory `-jwt-secret-hex`, mux-level admin role enforcement on all destructive routes, multipart upload sanitization, and a fail-closed MCP mount. The dominant residual risk is **brute-forceable credential entry** (F2 + N3 + N4 compose into a credential-stuffing chain) combined with **token theft amplification** (F7 + F4 compose into a one-shot exfil chain on any future XSS).

The **High-severity findings cluster on the auth and frontend-storage surfaces** rather than on data-plane or privilege-escalation paths. That is good news: each High has a well-understood, well-scoped fix with no architectural rework. F2 and F4 are 1–3 day implementations; F7 is the only one with non-trivial SPA refactor (estimate 1 week including CSRF middleware on the server side).

**Recommended next 30 days:** land F2 (per-IP + per-user rate limit), F4 (CSP/COOP), F7 (cookie-based JWT with CSRF). Those three fixes close the dominant exploit chains and allow F8/F12 (supply chain) to be patched without urgency.

**Strategic items (90+ days):** N1 (quoteString hardening), N2 (revocation list), F6+N6 (centralised redaction in genapi). These belong in a deliberate hardening pass after the immediate auth/CSP fixes ship.

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
| gosec G120 | `crypto/rand` not used in `internal/jwt`. | Safe. The flag is from a default-disabled rule; HMAC keys are operator-supplied via `-jwt-secret-hex` (32+ bytes), and JWT IDs are not yet emitted (will use `crypto/rand` when SEC-N2 lands). | `internal/jwt/jwt.go` |

## Roadmap

**Quick wins (< 1 day each):**

- F3 — JWT clock leeway (`internal/jwt/jwt.go:82-94`).
- N8 — Add `public/.well-known/security.txt`.
- F1 — Either call `mcpx.SetAuthVerifier(srv.AuthJWT)` or unmount `/mcp`.
- F11 — Fix in genapi template; regenerate.
- F14 — Add allowlist pragma; close.

**Medium (1–5 days each):**

- F2 — Per-IP + per-(profile,username) rate-limiter on `/auth/login`.
- F4 — Add CSP/Permissions-Policy/COOP/COEP/CORP in `httpx.WrapHandler` (genapi).
- N3 — Require explicit profile on Login (or share rate-limit bucket).
- N4 — Server-side password policy.
- N5 — Reject wildcard CORS when credentials enabled.
- N7 — Per-IP global rate limiter.
- N10 — Constant-time auth-failure path.
- F5 — Emit Deprecation header on `?access_token=` fallback.
- F6+N6 — Centralize redaction in `obsx.LogAudit`; expand `sensitiveKeys`.
- F8 — Bump `monaco-editor` or pin via pnpm overrides.
- F12 — Bump or replace `copy-webpack-plugin`.

**Strategic (> 5 days):**

- F7 — Cookie-based JWT + CSRF middleware (server) + SPA refactor.
- N1 — Audit + harden `quoteString`/`quoteIdent` with adversarial test corpus.
- N2 — JTI revocation set + password-change-triggered revocation.

## Immediate Actions

None of the findings require immediate secret rotation or active-RCE remediation. F14 was the only secret-adjacent flag and is a confirmed placeholder. **No production credentials are leaked; no active RCE path was identified.**
