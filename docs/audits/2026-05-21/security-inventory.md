# Security Inventory — geode-ui

## Security Inventory

**Root:** `/data/home/benji/src/gl/gitlab.com/devnw/codepros/geode/geode-ui`
**Platform:** GitLab (`git@gitlab.com:devnw/codepros/geode/geode-ui.git`)
**Branch:** `main` (clean tree)
**Languages:** Go 1.26.3 (server); TypeScript ~5.8 / Node >=22.14 (SPA + Electron)
**Frameworks:** React 18.2, React Router 7.5, Zustand 5, Monaco editor, Cytoscape, Electron 42, Webpack 5; net/http stdlib server + generated genapi/genws/genmcp (in-repo codegen under `gen/`); golang-jwt v5, lestrrat-go/jwx, modernc.org/sqlite, OpenTelemetry SDK; AES-256-GCM (stdlib `crypto/aes` + `crypto/cipher`).

Repo layout (security-relevant):
- `cmd/server/` — process bootstrap (`main.go`, `app.go`, `app_routes.go`, `app_issuer.go`, `app_csrf.go`, `app_limiters.go`, `pprof.go`).
- `internal/server/` — HTTP/WS handlers, middleware (CSRF, CSP, login limiter, profile limiter), audit ring, password policy, upload sanitisation.
- `internal/jwt/` — HS256 issuer with kid rotation + durable revocation (`revocation.go`, `revocation_sqlite.go`).
- `internal/profilestore/` — SQLite-backed profile store with AES-256-GCM column encryption (`crypto.go`, `sqlite.go`).
- `internal/conn/` — connection pool wrapping `database/sql` "geode" driver.
- `internal/ui/` — `//go:embed` SPA dist.
- `gen/{api,ws,mcp,types,pkg}/` — generated REST/WS/MCP wrappers, `httpx`, `wsx`, `securex`, `obsx` packages (in-tree).
- `geode.json` — API/WS/MCP route+schema spec consumed by codegen.
- `electron/` — desktop wrapper (`main.ts`, `preload.ts`, `lib/{ipc-guards,secure-store,server-url,safety}.ts`).
- `deploy/Dockerfile{,.release,.release.alpine}`, `deploy/docker-compose.{example,test}.yml`.
- `.gitleaks.toml`, `.secrets.baseline`, `.pre-commit-config.yaml`, `.gitlab-ci.yml` — supply-chain + secrets controls.

### Entrypoints & Auth Boundaries

| Entrypoint | Type | Auth Required | Auth Mechanism | File:Line |
|---|---|---|---|---|
| `GET /healthz` | REST | No | None | `geode.json:30-36`, `internal/server/server.go:223` |
| `POST /api/v1/auth/login` | REST | No | Constant-time fail + per-IP + per-(profile,user) lockout | `internal/server/handlers_auth.go:31`, `loginlimiter.go:18` |
| `POST /api/v1/auth/logout` | REST | Optional (best-effort revoke) | Hand-rolled, CSRF-enforced via `csrfExemptPaths` removal (#318) | `cmd/server/app_routes.go:72`, `internal/server/handlers_auth.go:225` |
| `GET /api/v1/csrf` | REST | No (anonymous bootstrap) | Issues 32-byte hex CSRF token | `cmd/server/app_routes.go:79`, `internal/server/csrf.go:93` |
| `GET /api/v1/profiles/public` | REST | No | Returns only system-profile names+descriptions | `geode.json:443-450`, `internal/server/handlers_profiles_public.go:21` |
| `POST /api/v1/query` (streaming) | REST | JWT | genapi auth wrapper | `geode.json:48-56`, `internal/server/handlers_query.go:54` |
| `POST /api/v1/tx`, `/tx/{txid}/{run,commit,rollback}` | REST | JWT | genapi | `geode.json:108-138`, `handlers_tx.go` |
| `GET /api/v1/graphs[/...]`, `/capabilities` | REST | JWT | genapi | `geode.json:58-105` |
| `/api/v1/users[/...]`, `/roles[/...]`, `/policies[/...]`, `/grants[/...]` | REST | JWT + `required_roles=["admin"]` | genapi + `securex.ClaimsFromContext` | `geode.json:141-317` |
| `/api/v1/backups[/...]`, `/api/v1/restore` | REST | JWT + `admin` | genapi | `geode.json:319-385`, `handlers_backups.go` |
| `/api/v1/backups/upload`, `/api/v1/migrations/upload` (multipart, 64 MiB cap) | REST | JWT + `admin` | genapi + allowlist filename sanitiser | `geode.json:366-432`, `internal/server/handlers_uploads.go:57` |
| `/api/v1/migrations[/...]` | REST | JWT + `admin` | genapi | `geode.json:386-432`, `handlers_migrations.go` |
| `/api/v1/audit` | REST | JWT + `admin` | In-memory ring (10k entries), 200-default limit | `geode.json:434-442`, `internal/server/handlers_audit.go:48` |
| `/api/v1/profiles[/...]` (CRUD) | REST | JWT (+ owner/admin redaction) | genapi + per-actor (subject) 30/min limiter | `internal/server/handlers_profiles.go:30`, `cmd/server/app_limiters.go:45` |
| `GET /api/v1/metrics` (Prom proxy) | REST (hand-rolled) | JWT (`s.AuthJWT(r)` in-handler) | Server-side proxy of upstream `GEODE_METRICS_URL` | `cmd/server/app_routes.go:90`, `internal/server/handlers_metrics.go:141` |
| `/ws/ping`, `/ws/query` | WebSocket | JWT (3-source) + same-origin (`same_origin_only: true`) | `wsx.UpgradeStrict`, JWT via header/cookie/`?access_token=` | `geode.json:492-515`, `internal/server/ws_query.go:213`, `cmd/server/app_routes.go:98-105` |
| `/ws/lsp` (WebSocket-to-TCP bridge) | WebSocket | JWT + origin allowlist | `wsx.UpgradeStrict` with `-ws-allowed-origins` (default same-origin) | `cmd/server/app_routes.go:115-121`, `internal/server/ws_lsp.go:73-148` |
| `POST /mcp` (JSON-RPC) | MCP HTTP | JWT (`MCPAuthVerifier`) | `genmcp.HandleMCPHTTP`, single tool `query` | `cmd/server/app_routes.go:135-137`, `internal/server/mcp.go` |
| `/` (SPA catch-all) | Static | No | `WithSPASecurityHeaders` (CSP + COOP on HTML only) | `cmd/server/app_routes.go:149`, `internal/server/security_headers.go:231` |
| `/debug/pprof/*` | REST (opt-in) | No (loopback only) | Separate listener on `127.0.0.1:6060`; gated by `GEODE_PPROF=1` | `cmd/server/pprof.go:38-65` |
| `geode://` (Electron renderer) | Privileged protocol | Origin-restricted; `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true` | `electron/main.ts:1-80` |

Auth-token transports (priority order, `internal/server/auth.go:104-118`):
1. `Authorization: Bearer <jwt>` (preferred programmatic).
2. `Cookie: geode-ui-auth=<jwt>` — `HttpOnly`, `Secure` (cfg), `SameSite=Strict`.
3. `?access_token=<jwt>` — legacy WS fallback; refused for non-`/ws/*` after `AccessTokenSunsetTime` = 2026-07-01 (`internal/server/auth.go:170`).

### Tenant Isolation

| Mechanism | Scope | Implementation | File:Line |
|---|---|---|---|
| JWT `sub` + `profile` + `cid` claims propagated into request context | Per-actor, per-profile, per-connection | `securex.ContextWithClaims`, `userCtxKey`/`profileCtxKey`/`cidCtxKey` | `internal/server/auth.go:55-77`, `context.go` |
| Profile-store scopes `system`/`personal` with `owner_user_id` | Per-user CRUD visibility | `Store.ListVisible(subject)` walks `scope='system' OR (scope='personal' AND owner=?)`; admin still sees only own personal profiles via list path; cross-tenant reach requires per-id GET with audit | `internal/server/handlers_profiles.go:30-54`, `internal/profilestore/sqlite.go` |
| Per-actor rate limiter on profile CRUD (30 req/min default, burst 10) | Per JWT subject | `WrapProfileLimit` keyed on `claims.Subject` (+ IP fallback when unauthenticated) | `cmd/server/app_limiters.go:39-57`, `internal/server/profilelimiter.go` |
| Upstream auth delegation per `profile` | Every login | Login opens fresh `*sql.DB` with submitted creds against `Profiles.Lookup(profile).DSN`; cross-profile data isolation enforced by upstream Geode role/grant model (not by this server) | `internal/server/handlers_auth.go:318-365` |
| Owner/admin redaction matrix for profile reads | Per-resource | `toGenProfile(p, reveal)`: non-owner non-admin sees only `Name`/`Scope`/`Description`; DSN/TLS/pool overrides/saved username zeroed | `internal/server/handlers_profiles.go:48-54`, `:72-` |
| RBAC vocab (deny-by-default) mirroring upstream Zig enums | Frontend gating | `src/lib/rbacVocab.ts` (Action/Resource/Permission) | `SECURITY.md:50-53` |

Note: the bootstrap-admin set is granted via the `-admin-users` CLI flag and canonicalised through NFKC + Unicode case fold (`NormaliseAdminLookupKey`, `internal/server/admin_normalise.go:24`). The previous "geode" default was removed (SEC-NEW-2) so a fresh install does not silently mint an admin.

### External Integrations

| Integration | Type | Credential Source | File:Line |
|---|---|---|---|
| Upstream Geode DB (QUIC, default `quic://127.0.0.1:3141`) | Database driver `sql.Open("geode", dsn)` | Login: user-submitted creds injected into DSN via `injectCreds`; pool seed: env+`profiles.json`+SQLite store | `cmd/server/app.go:208`, `internal/server/handlers_auth.go:323`, `:463-474` |
| Upstream LSP TCP listener (default `127.0.0.1:3142`) | Raw TCP via `net.DialTimeout` | None on dial (loopback); JWT injected into LSP `initialize` `params.initializationOptions.geode.authToken` | `internal/server/ws_lsp.go:140-167`, `:256-331` |
| Upstream Prometheus `/metrics` (`GEODE_METRICS_URL`) | HTTP GET (2 s timeout) | None (assumed loopback / cluster-internal); proxy fronts with JWT check | `internal/server/handlers_metrics.go:141-208` |
| MCP HTTP transport (`POST /mcp`) | JSON-RPC envelope | Same `AuthJWT` as REST via `mcpx.SetAuthVerifier(srv.MCPAuthVerifier)` | `cmd/server/app_routes.go:135-137` |
| HIBP k-anonymity check (optional) | HTTPS GET (off by default) | Hash-prefix only; `-password-hibp-check` flag | `cmd/server/app.go:96`, `internal/server/password_policy.go` |
| OpenTelemetry exporters (otel/metric, otel/trace) | Library | No remote target wired in this binary; library deps only | `go.mod:12-14` |
| Electron `safeStorage` (OS keychain) | OS API | macOS Keychain / DPAPI / libsecret via Electron | `electron/lib/secure-store.ts` |
| Docker Hub push + ssl.com Authenticode (release) | CI secrets | GitLab CI variables `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN`, `ESIGNER_*` | `.gitlab-ci.yml:19-55` |
| GitLab npm registry (`@devnw` scope) | npm registry | `CI_JOB_TOKEN` (CI only) | `.gitlab-ci.yml:62-66` |

### Datastores & Queues

| Store | Type | Connection Pool | Credential Source | File:Line |
|---|---|---|---|---|
| Upstream Geode graph DB | GQL over QUIC (`quic-go`) via `geodedb.com/geode` driver | `internal/conn.Pool` (per-profile `*sql.DB`) | Submitted at login → DSN userinfo; persisted DSN sealed in profile store | `internal/conn/pool.go`, `internal/server/handlers_auth.go:318` |
| Profile store (SQLite, modernc.org/sqlite) | Embedded SQLite at `/var/lib/geode-ui/profiles.db` | `OpenSQLiteEncrypted` with single DB handle (`SetMaxOpenConns(1)` per `PSR-F4` comment) | `GEODE_PROFILESTORE_KEY` (base64 32 bytes) → AES-256-GCM column sealing for `dsn`, `tls_ca_pem`, `tls_cert_pem`, `tls_key_pem`, `saved_password` | `cmd/server/app.go:225-233`, `internal/profilestore/crypto.go:57-114`, `internal/profilestore/sqlite.go` |
| JWT revocation set | SQLite-backed (re-uses profile store handle) | Shared with profile store via `DBHandleProvider` | None (data-at-rest is metadata only: jti, exp, password-changed-at) | `cmd/server/app.go:247-253`, `internal/jwt/revocation_sqlite.go` |
| Audit ring | In-memory FIFO ring (10k entries, ~2.5 MiB) | None | None (process-local) | `internal/server/audit.go:109-118` |
| Tx store | In-memory map keyed by opaque txid | `server.NewTxStore()` | None | `cmd/server/app.go:269`, `internal/server/handlers_tx.go` |
| Electron secure connection store | OS keychain via `safeStorage` | None | DPAPI / Keychain / libsecret | `electron/lib/secure-store.ts` |

No message queues. No object storage. Multipart uploads land in `/var/lib/geode-ui/uploads/{backups,migrations}` on local disk (no network upload).

### Admin Surfaces

| Surface | Auth Level | Exposure | File:Line |
|---|---|---|---|
| All `/api/v1/{users,roles,policies,grants,backups,restore,migrations,audit}` routes | JWT + `required_roles=["admin"]` (genapi-enforced) | Public-listener (`:8080`), bound `0.0.0.0:8080` per `geode.json:3` | `geode.json:141-442` |
| Admin-only profile reach across other personal scopes | JWT + admin (per-id GET with audit) | Same listener | `internal/server/handlers_profiles.go:30-54` |
| `/debug/pprof/*` | None (relies on loopback bind) | OFF by default (`GEODE_PPROF=1`); separate `127.0.0.1:6060` listener; rejects non-loopback override | `cmd/server/pprof.go:38-65` |
| Electron `dialog`/`safeStorage`/`shell` IPC | Renderer → main IPC, allowlisted handlers with size caps | Desktop-app local | `electron/main.ts:30-48`, `electron/lib/ipc-guards.ts` |
| `geode auth init` bootstrap password capture | One-shot, root-owned, mode 0600 | Container init only (e2e); excluded from production wiring | `deploy/docker-compose.test.yml:24-45`, `deploy/geode/geode-entrypoint.sh` |

### Build/Deploy & Secret Management

| Component | Type | Secret Handling | File:Line |
|---|---|---|---|
| `deploy/Dockerfile` (e2e/local build) | Multi-stage Node 22-alpine → golang 1.26-alpine → alpine 3.20 | No baked secrets; runs as non-root `geode`; `EXPOSE 8080`; expects `GEODE_PROFILESTORE_KEY` at runtime | `deploy/Dockerfile:1-100` |
| `deploy/Dockerfile.release` | `debian:bookworm-slim` base, prebuilt binary from GoReleaser | UID/GID 10001, `nologin` shell; no baked secret | `deploy/Dockerfile.release:1-46` |
| `deploy/Dockerfile.release.alpine` | Alpine variant | Same posture | `deploy/Dockerfile.release.alpine` |
| `deploy/docker-compose.example.yml` | Production-style example | `JWT_SECRET_HEX` + `GEODE_PROFILESTORE_KEY` placeholders only; instructs `openssl rand -hex 32` / `-base64 32` | `deploy/docker-compose.example.yml:39-53` |
| `deploy/docker-compose.test.yml` | E2E stack (geode + ui + mcp + lsp) | `${VAR:?}` form forces fail-loud when unset (SEC #322/#323); `make e2e-env` generates `deploy/.env.test` (gitignored); `-secure-cookies=false` for plain-HTTP e2e ONLY | `deploy/docker-compose.test.yml:139-176` |
| `.gitleaks.toml` | Secrets scan config | Allowlists `.scratch/` artefacts | `.gitleaks.toml` |
| `.secrets.baseline` | detect-secrets baseline | Per-file fingerprints | `.secrets.baseline` |
| `.pre-commit-config.yaml` | Pre-commit gates | detect-secrets, gitleaks, gosec, golangci-lint, eslint hooks | `.pre-commit-config.yaml` |
| `.gitlab-ci.yml` (catalog includes pinned to `@v1.7.1`) | Pipeline | SAST + dep-scan + secrets + gitleaks + SBOM generate+scan + semantic release; Authenticode codesign via `ESIGNER_*` group vars | `.gitlab-ci.yml:5-55` |
| GoReleaser (`.goreleaser.yaml`) | Release pipeline | Static `CGO_ENABLED=0`, `-trimpath -ldflags=-s -w`; image pin cadence enforced by `scripts/check-image-pins.sh` (QUALITY #233) | `.goreleaser.yaml`, `deploy/Dockerfile:25-26,53` |
| Electron auto-update / packager | electron-builder 25.1.8 + `electron-builder.yml` | Authenticode signing via ssl.com eSigner; tag-only release stage | `electron-builder.yml`, `.gitlab-ci.yml:30-42` |
| Workspaces | `packages/*` (npm workspaces, `@geodedb/ui-core`) | No secret handling | `package.json:6-8` |

Secrets used at runtime:
- `JWT_SECRET_HEX_CURRENT` (+ optional `JWT_SECRET_HEX_PREVIOUS` for rotation) — HS256 secret(s); legacy `-jwt-secret-hex` flag supported. (`cmd/server/app_issuer.go:45-75`)
- `GEODE_PROFILESTORE_KEY` — base64 32-byte AES-256-GCM DEK. (`internal/profilestore/crypto.go:57-93`)
- `GEODE_METRICS_URL` — upstream Prom endpoint. (`cmd/server/app.go:283`)
- `GEODE_PPROF` / `GEODE_PPROF_LISTEN` — opt-in debug. (`cmd/server/pprof.go`)

Secrets policy:
- `obsx.DefaultSensitiveKeyFragments` + geode-ui extras redact `password`, `jwt`, `bearer`, `token`, `saved_password`, `tls_*`, `dsn`, `url`, `connection_string`, `session_id`, `refresh_token`, `access_token` from audit field values. (`internal/server/audit.go:82-97`)
- `.gitignore` excludes `.env*`, `deploy/.env.test`, `/.scratch/`. (`/.gitignore:24-30,74-78`)

## Threat Model

### Assets

| Asset | Sensitivity | Location |
|---|---|---|
| Upstream Geode credentials (per-user username + password) | High | Submitted to `POST /api/v1/auth/login`; inlined into DSN userinfo (`injectCreds`); never persisted in plaintext; `saved_password` in profile store sealed under DEK |
| JWT signing secret (HS256) | Critical | `JWT_SECRET_HEX_CURRENT` env var; never logged; held in memory only; rotation via `PREVIOUS` |
| Profile-store DEK (`GEODE_PROFILESTORE_KEY`) | Critical | Env var; never persisted; rotation via `-profilestore-rewrap-from <base64-old-key>` one-shot sweep |
| Active session JWTs (cookie + bearer) | High | `geode-ui-auth` cookie (`HttpOnly`, `Secure`, `SameSite=Strict`); revocation set in SQLite |
| Profile DSNs (incl. TLS PEM + saved password) | High | SQLite at `/var/lib/geode-ui/profiles.db`; sealed columns; admin/owner redaction matrix on read |
| Backup + migration files (operator uploads ≤64 MiB) | High (may contain production data) | `/var/lib/geode-ui/uploads/{backups,migrations}`; admin-only; allowlist filename sanitiser |
| Audit ring (in-memory) | Medium | Process memory; admin-only `/api/v1/audit`; non-durable |
| Graph data (queries, results) | Variable (caller-determined) | Streamed through `/api/v1/query` and `/ws/query` |
| Metrics snapshot (Prom projection) | Low | Server-side proxy of upstream metrics endpoint |
| LSP session content (operator GQL drafts) | Medium | Proxied through `/ws/lsp` to upstream LSP TCP listener; JWT-injected into `initialize` |
| Electron stored connections / saved passwords | High | OS keychain via `safeStorage`; size-capped IPC payloads |
| GitLab CI secrets (`DOCKERHUB_TOKEN`, `ESIGNER_*`, `CI_JOB_TOKEN`) | Critical | GitLab CI/CD variables; protected; never committed |

### Trust Boundaries

| Boundary | From | To | Controls |
|---|---|---|---|
| Internet → load balancer / TLS terminator | Browser, CLI, MCP client | Geode-UI HTTP listener (`:8080`) | HTTPS expected upstream (server itself does NOT terminate TLS — `geode.json:tls` empty); `-secure-cookies=true` default; HSTS via `httpx.WrapHandler` (gen) |
| LB → application | Reverse proxy | `http.Server` | `ReadHeaderTimeout=5s`, `ReadTimeout=30s`, `WriteTimeout=60s`, `IdleTimeout=120s`, `MaxHeaderBytes=16384`, `MaxBodyBytes=1 MiB` default (per-route maxBodyBytes overrides), global per-IP 50 rps/burst 100 (`PerIPSource: remote_addr`; XFF NOT trusted unless `-trust-proxy-xff`) |
| Application → upstream Geode (`quic://`) | `*sql.DB` per profile | Geode `:3141/udp` | Per-user creds injected at login round-trip; long-lived pool connection thereafter; query timeouts ≤600s per `QueryReq.timeout_ms` schema |
| Application → upstream LSP (`tcp://`) | `/ws/lsp` bridge | `geode serve --lsp-port` | JWT-injected into LSP initialize; 16 MiB cap per direction; 64 KiB + depth-32 cap on initialize JSON; 30 s WriteTimeout |
| Application → upstream Prom (`http://`) | `HandleMetrics` | `GEODE_METRICS_URL` | 2 s timeout; JWT in-handler before fetch; assumed cluster-internal (compose example notes default-loopback bind) |
| Browser → SPA | Renderer | SPA HTML | CSP (`script-src 'self' 'wasm-unsafe-eval'`, `style-src 'self' 'unsafe-inline'` for styled-components), COOP `same-origin`, `Permissions-Policy: camera=(),microphone=(),geolocation=(),interest-cohort=()`, `frame-ancestors 'none'`, `base-uri 'none'`, `object-src 'none'` (`internal/server/security_headers.go:58-74`) |
| Cookie session ↔ XSS | SPA JS | Auth cookie | `HttpOnly` on auth cookie; `SameSite=Strict`; CSRF double-submit (NON-HttpOnly `geode-ui-csrf` echoed via `X-CSRF-Token`) for cookie-authed state-changing requests; constant-time compare (`internal/server/csrf.go:124-137`) |
| Service ↔ JWT verifier | Per-request | Cross-cutting | `securex.ContextWithClaims` propagation; `required_roles` gates emitted in `gen/api/handlers_gen.go` per `geode.json` |
| Developer → codebase | Engineer | repo | Pre-commit hooks (gitleaks, detect-secrets, gosec, golangci-lint, eslint); CODEOWNERS; SECURITY.md; CI SAST/dep-scan/SBOM/gitleaks gates |
| CI → production | GitLab CI | Docker Hub + signed installers | `ci-catalog@v1.7.1` pinned components (one TODO `~latest` on codesign-windows-ssl, allowlisted); protected vars |
| Electron renderer → main | Sandboxed renderer | Main process IPC | `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, allowlisted IPC channels, size-capped payloads (`STORE_TOKEN_MAX_LEN=4096`, `PEM_FILE_MAX_BYTES=1MiB`) |
| Profile-store at-rest | Disk | SQLite | AES-256-GCM column sealing under env-supplied DEK; sentinel byte allows legacy plaintext detection; rewrap sweep for key rotation |

### Attacker types in scope

- Unauthenticated external (probes `/healthz`, `/api/v1/profiles/public`, `/api/v1/csrf`, `/api/v1/auth/login`, `/ws/*` upgrade, `POST /mcp`).
- Authenticated non-admin (full REST/WS query surface, profile CRUD, password change).
- Authenticated admin (full admin REST surface, uploads, restores, migrations, audit reads).
- Insider with sibling pod / loopback (could reach `127.0.0.1:6060` pprof when enabled, the LSP TCP listener, the Prom listener).
- Supply chain (npm dependencies — 30+ runtime deps including monaco-editor, cytoscape ecosystem, react-router; Go deps incl. `quic-go`, `lestrrat-go/jwx`).

### Top Abuse Cases (Prioritized)

| Rank | Abuse Case | Attacker Type | Likelihood | Impact | Entry Points |
|---|---|---|---|---|---|
| 1 | Credential stuffing / account lockout DoS on `POST /api/v1/auth/login` | Unauth external | Medium | High (account lockout = DoS; success = ATO) | `internal/server/handlers_auth.go:31`, `loginlimiter.go`. Defenses: per-IP 5 rps/burst 10, per-(profile,user) 5-fail/15-min lockout, constant-time 250 ms latency floor, dummy SHA-256 compare. Residual risk: distributed stuffing across IPs (no global per-user cap independent of profile); XFF NOT trusted by default (good) so behind-proxy deployments must opt in. |
| 2 | Cross-tenant data exposure via profile-store / DSN read paths | Authed non-admin | Medium | High (DSN incl. password leak = upstream takeover) | `internal/server/handlers_profiles.go:30-54`, `:72-`. Redaction is on `reveal` boolean from `(isAdmin OR owner == subject)`. Audit per-id admin GET path. Verify: every list/get/patch/delete path consistently applies redaction; `saved_password` and `tls_key_pem` never round-trip back; no JSON-encoding leak via `jsontext.Value` opaque fields. |
| 3 | Stored-XSS / template injection in audit log, query results, or profile description | Authed non-admin | Low–Medium | High (admin XSS → token theft if CSP gaps exist) | `src/lib/cellFormat.ts`, audit viewer page, profile description rendering. CSP forbids `unsafe-eval`; `style-src 'unsafe-inline'` retained for styled-components (residual risk vector). React-managed rendering is the default (`SECURITY.md:48`); DOMPurify pinned via npm override but not actively invoked. |
| 4 | LSP bridge SSRF / token exfil via `/ws/lsp` initialize tampering | Authed | Low | Medium (token is already in-context; SSRF bounded by `cfg.lspUpstreamAddr` constant) | `internal/server/ws_lsp.go:115-167`. Upstream is operator-pinned via `-lsp-upstream`; not user-controlled. Verify the `initialize` rewriter cannot be coerced to inject the token into a non-LSP target. |
| 5 | Path traversal / overwrite via multipart upload | Authed admin | Low | High (RCE via crafted migration content executed by operator) | `internal/server/handlers_uploads.go:85-205`. Allowlist regex `^[A-Za-z0-9._-]+$`, `.`/`..` rejected, `filepath.Base` double-check, 64 MiB cap, atomic rename. Residual: content-type not inspected (migration `.gql` could be anything); admin-only is the primary mitigation. |
| 6 | CSWSH on `/ws/query` or `/ws/lsp` | Unauth external | Low | Medium (auth still required, but cookie auto-attaches if SameSite regresses) | `internal/server/ws_lsp.go:73-148`, `geode.json:same_origin_only:true`. Defenses: `wsx.UpgradeStrict` + explicit origin allowlist (default same-origin via TLS+Host synthesis) + `SameSite=Strict` cookie; `AllowEmptyOrigin: true` retains a residual edge for browser-internal upgrades. |
| 7 | Token theft via `?access_token=` URL fallback (logs, referrers, history) | Various | Medium (until 2026-07-01) | Medium | `internal/server/auth.go:104-179`. Sunset 2026-07-01 for non-`/ws/*` endpoints; emits `Deprecation`/`Sunset`/`Link` headers + expvar counter `security_access_token_query_total` + rate-limited audit. WS surface remains exempt because browsers cannot attach Authorization on upgrade. |
| 8 | JWT secret/DEK leak via env-var exposure (logs, /proc, container inspect) | Insider / supply chain | Low | Critical | `cmd/server/app.go:190-238`. Secrets read once at startup, never re-emitted; profile-store rewrap sweep is operator-initiated; `obsx.DefaultSensitiveKeyFragments` redacts in audit. Residual: container env inspection by anyone with `docker exec`/k8s `pod/exec`. |
| 9 | GQL injection / authorization bypass on `/api/v1/query` and `/ws/query` | Authed non-admin | Medium | Variable (relies on upstream Geode RBAC) | `internal/server/handlers_query.go`, `ws_query.go`. Statements are passed through with named parameter binding (`sql.Named`); graph-name prefix wrapped with `sanitizeGraphName`. Cross-tenant graph access is enforced by Geode's own auth, not by this server. Verify `sanitizeGraphName` is robust against quoting. |
| 10 | CI / supply-chain compromise (npm dep typosquat, Docker base-image drift, ssl.com signing key) | Supply chain | Low | Critical | `.gitlab-ci.yml`, `package.json` (30+ runtime npm deps), `deploy/Dockerfile{,.release,.release.alpine}`, `.goreleaser.yaml`. Mitigations: SBOM + scan, image-pin cadence, pinned `ci-catalog@v1.7.1` (except codesign-windows-ssl `@~latest` allowlisted). Residual: `monaco-languageclient`, `vscode-ws-jsonrpc`, `cytoscape-*` plugins are large transitive surfaces. |

### Unknowns & Assumptions

- **TLS termination owner.** `geode.json` ships `tls.cert_path=""`/`key_path=""` and the example compose binds port `8080` over plain HTTP; production TLS is assumed to be terminated by a reverse proxy (k8s ingress / Cloudflare / etc.). Confirm by inspecting the production deploy manifests; if absent, `-secure-cookies=true` will silently break browser auth.
- **`X-Forwarded-For` policy in production.** `-trust-proxy-xff=false` by default. If the production proxy does NOT strip inbound XFF, an attacker can spoof source IPs in audit logs (limiter keys still use `RemoteAddr`). Confirm with the ingress configuration.
- **CSP `style-src 'unsafe-inline'`** is required by styled-components. Roadmap is to migrate to nonces (SEC-F4 follow-up). Until then, stored CSS-injection in any rendered field is a residual vector.
- **`monaco-editor` + `monaco-languageclient` + `vscode-ws-jsonrpc`** carry a non-trivial WASM/worker surface area. CSP allows `worker-src 'self' blob:` and `script-src 'wasm-unsafe-eval'` to keep them working. Confirm Monaco source is bundled (no remote `cdn.jsdelivr.net` script-src) — `webpack.common.js` should bundle locally.
- **MCP authorization scope.** `POST /mcp` is JWT-gated and the single declared tool is `query`. Confirm no admin tool surfaces leak through `genmcp.Register` and no anonymous tool path exists.
- **Rate-limit ceiling for admin uploads.** `geode.json` declares `rateLimit: 10` for `/api/v1/backups/upload` + `/api/v1/migrations/upload`; combined with 64 MiB body cap, an admin can still burn 640 MiB/min of disk. UploadDir disk quota is enforced only by the host filesystem.
- **Audit ring durability.** Process-local, FIFO, 10k cap, never persisted. A crash loses the in-memory ring; `slog` lines remain in stdout but durable shipping is operator-owned.
- **Embedded geode binary `/data/.../geode/`.** The repo includes a `geode/geode-entrypoint.sh` and a 99 MiB committed `server` binary at repo root (`.rwxrwxr-x 99M benji 17 May 19:25 server`) — confirm whether this is intentional (e.g. e2e snapshot) or a checked-in build artefact that should be excluded.
- **`.serena/`, `.scratch/`, `.remember/`, `.claude/`** directories present. `.gitignore` excludes them; confirm none were committed in earlier history that would expose tool state or scratch secrets.
- **Server-bound default `0.0.0.0:8080`** (`geode.json:3`) — if the container is exposed without an upstream firewall (e.g. on a public docker-compose stack), the API is reachable without TLS.
