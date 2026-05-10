# Security Gap Analysis — geode-ui

**Last updated:** 2026-05-10
**Audit:** /codepros:audit Phase 3 → Phase 4 tracking (PSR cohort)
**Repository:** `devnw/codepros/geode/geode-ui`
**Branch reviewed:** `main` @ `0b73836`

> **PSR cohort jump-link:** see [Profile System Rebuild (PSR) — 2026-05-10 audit](#profile-system-rebuild-psr--2026-05-10-audit) for the 10 newly-filed S01-S10 findings (issues #114-#123) covering the recent profile-system rebuild only. Prior cohort (F*/N* series, issues #58-#77) below remains the canonical baseline.

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
| S3 | A04 / CWE-367, CWE-22 | **17** | Medium | **Closed 2026-05-10** | [#116](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/116) | `electron/main.ts:379-397` | **Closed 2026-05-10** -- new `safeReadPemFile` in `electron/lib/ipc-guards.ts` opens the picked path with `O_NOFOLLOW`, fstats the descriptor (no second path resolution → TOCTOU window closed), enforces a 1 MiB cap before reading bytes, and validates the body carries `-----BEGIN .* -----` / `-----END .* -----` armor lines. The `extensions: ['*']` "All files" filter is dropped; the dialog now restricts to `pem`/`crt`/`key`/`cert`/`cer` only. Pinned by 6 cases in `__tests__/ipc-guards.test.ts` (valid PEM read, oversized rejection, symlink rejection, non-PEM rejection, missing file, non-string path). |
| S6 | A09 + CIS 8.5/8.11 / CWE-778 | **17** | Medium | **Closed 2026-05-10** (release blocker) | [#119](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/119) | `handlers_profiles_crud.go:24-234` | **Closed 2026-05-10** -- POST/PATCH/DELETE handlers in `internal/server/handlers_profiles_crud.go` now emit `profile_created` / `profile_updated` / `profile_deleted` events with actor, profile_id, scope, owner, name (no DSN/PEM material); `maybeReload` emits `profile_reload_failed` on list-or-reload error (PSR-G08). `internal/server/audit.go` adds `dsn`, `pem`, `tls_ca_pem`, `tls_cert_pem`, `tls_key_pem`, `ca_pem`, `cert_pem`, `key_pem` to the redaction substring list (defense-in-depth for S5). Pinned by `TestPostProfiles_EmitsAuditEvent`, `TestPostProfiles_AuditNotEmittedOnFailure`, `TestPatchProfileid_EmitsAuditEvent`, `TestDeleteProfileid_EmitsAuditEvent`, `TestMaybeReload_EmitsAuditOnReloadFailure`, `TestEmitAudit_RedactsProfileStoreSecrets`, and the extended `TestIsSensitive` matrix. |
| S8 | A04 + A03 / CWE-20, CWE-1284 | **17** | Medium | **Closed 2026-05-10** | [#121](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/121) | `electron/main.ts:320-335`, `:345-354` | **Closed 2026-05-10** -- new `sanitizeConnections` and `sanitizeSavedPasswordInput` helpers in `electron/lib/ipc-guards.ts` validate every renderer-supplied payload before it reaches the secure-store layer. Caps: 32 connections, 4 KB tokens, 128-char names, 256-char usernames, 1 KB passwords, 7-day forward expiry. Null-byte rejection on profile/username (closes the `pwKey` separator collision vector). Unknown fields stripped on the way through. `geode:store-connections`, `geode:store-saved-password`, `geode:get-stored-password`, and `geode:clear-stored-password` IPC handlers now reject malformed input with a typed error (or `null`/idempotent `true` on the read/clear paths). 22 cases in `__tests__/ipc-guards.test.ts` pin the contract. |
| S4 | A02 / CWE-311, CWE-353 | **16** | Medium | **Closed 2026-05-10** | [#117](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/117) | `electron/lib/secure-store.ts:69-77`, `:66` | **Closed 2026-05-10** -- `electron/lib/secure-store.ts` now writes a v2 envelope `{ v: 2, ciphertext, hmac }` where `hmac` is hex-encoded HMAC-SHA256 of the safeStorage ciphertext under a per-install MAC key derived from `safeStorage.encryptString("geode-ui-mac-key-v1")`. Tampered ciphertexts fail the MAC check (`crypto.timingSafeEqual`) before decrypt is attempted; legacy `{ encrypted }` envelopes are detected on cold read and re-encrypted into the v2 shape on the next `write()` (one-shot migration, no data loss). Predictable `${storePath}.tmp` replaced with `${storePath}.${randomBytes(8).hex}.tmp` via `joinTmp` + `randomTmpSuffix` from `ipc-guards.ts`. `surfaceUnavailable: true` (default) makes `write()` throw `SecureStoreUnavailableError` when `safeStorage.isEncryptionAvailable()` is false instead of silently dropping data; legacy callers can opt back into the silent contract via `surfaceUnavailable: false`. Pinned by 5 new cases in `__tests__/secure-store.test.ts` (envelope shape, tampered MAC rejection, unavailable surface, legacy migration, randomized tmp suffix) plus 3 cases in `__tests__/ipc-guards.test.ts` (`requireSafeStorage`, `SecureStoreUnavailableError`). |
| S7 | A04 / CWE-799 | **11** | Low | Backlog | [#120](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/120) | `cmd/server/main.go` (route wiring) | No rate-limit on profile CRUD routes (only `/auth/login` is rate-limited) |
| S10 | A04 / CWE-20 | **7** | Low | Fix-Soon | [#123](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/123) | `handlers_profiles_crud.go:252-269` | `tlsFromGenJSON` accepts arbitrary strings; no `pem.Decode` / `x509.ParseCertificate` / size cap |
| S9 | (accepted-risk) | **3** | Low | **Closed 2026-05-10 (sec::accepted-risk)** | [#122](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/122) | `src/auth/AuthProvider.tsx:219-238` | `signOut` does not `clearStoredPassword` — intentional per Plan E §8 (browser-password-manager analog). **Closed 2026-05-10** as `sec::accepted-risk`: in-line `signOut` block now carries an explicit "do not 'fix' without re-reading Plan E §8 + this row" guard comment naming the underlying `clearStoredPassword` IPC + TODO #122 follow-up for a Settings UI affordance ("Forget Saved Password"). Risk accepted because forcing a clear on signOut would silently nuke a credential the user explicitly opted to save and would diverge from every browser password manager in the ecosystem; the user retains explicit control via the (planned) Settings affordance and via the existing `geode:clear-stored-password` IPC. |

### PSR — release blockers

Three issues must land before the next tagged release:

1. **S1 (#114)** — trivial one-line allowlist fix; no excuse to ship without it.
2. **S2 (#115)** — backdoor-in-production class; build-time strip is the right primary fix, runtime gate is the safety net.
3. **S6 (#119)** — compliance-stop. The spec advertises an audit trail that does not exist; release notes that say "audit-tracked profile changes" would be false advertising.

### PSR — cross-references

- **S2 (#115) ↔ #64 (SEC-N2)** — JWT revocation deferred amplifies S2's blast radius. Until N2 lands, fixing S2 is the only short-term mitigation against a long-lived seeded session.
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
