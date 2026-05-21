# Security Review — geode-ui (Adversarial / Manual)

**Repo:** `/data/home/benji/src/gl/gitlab.com/devnw/codepros/geode/geode-ui`
**Platform:** GitLab — `git@gitlab.com:devnw/codepros/geode/geode-ui.git`
**Branch / commit:** `main`, clean tree (`1199648` head)
**Date:** 2026-05-21
**Phase 1+2 inputs:** `security-inventory.md`, `security-scan.md`

This review is the adversarial follow-on to Phase 1 (inventory) + Phase 2 (scanner sweep).
It maps STRIDE / OWASP-2025 against the codebase by reading the actual handlers and
middleware, not just running tools. Findings are tagged with confidence and CWE/OWASP
references. No code modifications were made and no live system was exercised.

---

## 0. Scope, Method, Caveats

| Item | Value |
|---|---|
| Files inspected (primary) | `internal/server/{auth,csrf,handlers_auth,handlers_query,handlers_profiles,handlers_profiles_crud,handlers_metrics,handlers_uploads,handlers_users,ws_lsp,ws_query,security_headers,promparse,quoting,audit,loginlimiter}.go`; `internal/jwt/{jwt,revocation}.go`; `internal/profilestore/crypto.go`; `cmd/server/{app,app_issuer,app_csrf,app_routes,app_limiters,pprof}.go`; `gen/pkg/httpx/{server,peerlimit}.go`; `gen/ws/ws_handlers.gen.go`; `electron/main.ts`; `deploy/docker-compose.{example,test}.yml`; `.gitlab-ci.yml`; `geode.json`. |
| Tools used | grep / read / static analysis (manual). Not run: dynamic probes, fuzzers, network scans (per task constraint). |
| Reclassifications from scan | None of the gosec / semgrep findings were reclassified upward. One new MEDIUM, one new HIGH, several LOW/INFO surfaced via adversarial reading — listed below. |
| Threat model used | STRIDE-per-element with OWASP API Security Top 10 (2023 → 2025 draft) overlay. |

---

## 1. Authentication & Authorization

| # | Finding | Severity | File:Line | Attack Scenario | CWE/OWASP | Confidence |
|---|---|---|---|---|---|---|
| A1 | **Self-service password change endpoint is not subject-bound.** `POST /api/v1/users/{username}/password` is JWT-gated but has no `required_roles:["admin"]` and the handler does not verify `claims.Subject == path.username`. The handler runs `ALTER USER <name> SET PASSWORD '<pw>'` against the JWT subject's own DSN-bound connection pool; cross-user password change is therefore **gated by the upstream Geode RBAC alone**. If a future Geode release silently broadens `ALTER USER` to non-admin callers, every authenticated geode-ui user could change every other user's password. **Defense-in-depth recommendation:** add an explicit `if username != actr.Subject && !isAdmin { 403 }` gate at `handlers_users.go:404`. | MEDIUM | `internal/server/handlers_users.go:403-438`; route declared at `geode.json:204-210` (no `required_roles`) | An attacker who has any valid JWT calls `POST /api/v1/users/victim/password` with a new password. If upstream RBAC ever regresses (or the DSN is admin-credentialed for a misconfigured profile), takeover succeeds. Local audit trail records the attempt under `auditEventUserPasswordSet`, so it is observable post-hoc. | CWE-639 (Authorization Bypass via User-Controlled Key) / OWASP API1:2023 (BOLA) | `confidence::confirmed` (handler reads `req.Username` from path; no subject equality check). |
| A2 | **`AllowEmptyOrigin: true` on every WS route.** `/ws/ping`, `/ws/query` (`gen/ws/ws_handlers.gen.go:55,65`) and `/ws/lsp` (`internal/server/ws_lsp.go:147`) accept upgrades when the Origin header is absent. Defense-in-depth: a non-browser client (curl, native CLI) that has obtained a valid JWT can connect without Origin. Auth still requires JWT, so the residual is the CSWSH window when SameSite=Strict regresses AND the attacker has a path to set Origin to empty — practically narrow, but worth tightening: refuse empty Origin on `/ws/query` because the only known legitimate client is the SPA. (`/ws/lsp` faces the same situation but is operator-pinned to upstream; same recommendation applies.) | LOW | `gen/ws/ws_handlers.gen.go:55,65`; `internal/server/ws_lsp.go:147` | Browser-internal upgrades sometimes omit Origin (legacy IE quirk; modern browsers always send it). A non-browser attacker with a valid token can still bypass the same-origin gate. JWT remains the actual authority. | CWE-346 (Origin Validation Error) / OWASP A05:2021 | `confidence::confirmed` (flag is literally set true in source). |
| A3 | **JWT kid downgrade is closed — verified.** `Parse` (`internal/jwt/jwt.go:294-324`) hard-fails unknown kid and rejects non-HS256 algorithms. Tokens without a kid header fall through to `activeKID`, which is the conservative choice (legacy in-flight tokens). `RotateAndRevokeAll` (`jwt.go:212-223`) replaces the kid map atomically, denying all prior tokens. The kid header is signed alongside the payload — an attacker cannot rewrite kid to point at a weaker key without breaking the HS256 MAC. | — (good practice) | `internal/jwt/jwt.go:294-324` | n/a | CWE-345 (mitigated) | `confidence::confirmed`. |
| A4 | **JWT revocation latency is best-effort.** `RevocationSet.Revoke` writes to SQLite first then to the in-memory map (`internal/jwt/revocation.go:140-156`). A SQLite write failure is logged but not fatal — a process restart between the SQLite failure and the in-memory write would let a revoked token re-validate after restart. The exposure is bounded by the token TTL (default 8h, max 24h). Acceptable trade-off, but worth documenting in the operator runbook. | LOW | `internal/jwt/revocation.go:150-156` | A revoked token continues to authenticate for at most one TTL window after a crash that occurred during a SQLite write failure. | CWE-613 (Insufficient Session Expiration) / OWASP A07:2021 | `confidence::confirmed`. |
| A5 | **Admin-bootstrap audit emits the bare username list.** `cmd/server/app.go:257-260` calls `obsx.LogAudit("admin_bootstrap", {"admin_users": adminList})`. The list is operator-supplied via `-admin-users` and may include sensitive identifiers (e.g. service-account names) that the operator did not intend to log. Per `obsx.DefaultSensitiveKeyFragments`, `admin_users` is not a sensitive key fragment; the value is written verbatim. Low risk (no secret), but the audit channel becomes a registry of admin accounts. | LOW (info-leak) | `cmd/server/app.go:257-260` | An attacker with audit-log read access (which is admin-gated anyway) sees the full admin bootstrap set. Recoverable from process logs. | CWE-532 (Insertion of Sensitive Information into Log File) | `confidence::confirmed`. |
| A6 | **Bearer header is checked before cookie.** `extractToken` (`internal/server/auth.go:104-118`) prefers Authorization header over cookie, then query. Correct — an attacker cannot pin a token in cookie or URL when the legitimate caller sent a header. The CSRF middleware mirrors the same priority via `sourceForRequest`. | — (good practice) | `internal/server/auth.go:104-118` | n/a | CWE-352 (mitigated) | `confidence::confirmed`. |
| A7 | **`bestEffortRevokeFromRequest` accepts `?access_token=` post-sunset.** `extractTokenForRevoke` (`internal/server/auth.go:135-146`) deliberately bypasses the sunset refusal so logout can still revoke a token presented via the deprecated transport. Documented in source. Trade-off is acceptable because revocation cannot escalate privileges. | — (good practice; documented) | `internal/server/auth.go:135-146` | n/a | n/a | `confidence::confirmed`. |
| A8 | **Profile cross-tenant matrix is consistent.** `handlers_profiles.go:30-54`, `handlers_profiles_crud.go:92-199` — list, GET-by-id, PATCH, DELETE all gate on `isAdmin || owner==subject`. Non-admin reads of other users' personal profiles return 404 (not 403) to avoid existence-leak. PATCH-by-admin emits `auditEventProfileUpdated`. **One residual:** `PostProfiles` (handlers_profiles_crud.go:24-89) returns `toGenProfile(saved, reveal=true)`, but the create path forces `owner = actr.Subject` for personal scope, so reveal=true is reveal-to-owner. Safe. | — (good practice; confirmed) | `internal/server/handlers_profiles.go:30-54`, `handlers_profiles_crud.go:92-199` | n/a | CWE-639 (mitigated) | `confidence::confirmed`. |

---

## 2. Web / API Security

| # | Finding | Severity | File:Line | Attack Scenario | CWE/OWASP | Confidence |
|---|---|---|---|---|---|---|
| W1 | **CSRF middleware skips Bearer-authed and probe-defaults to enforcement on cookie.** `csrfMiddleware` (`internal/server/csrf.go:197-238`) safely defaults to enforcement when AuthJWT has not yet run by sniffing the raw request for the auth cookie. Bearer-authed requests bypass — correct per the design comment. Constant-time compare via `subtle.ConstantTimeCompare`. The csrf token is 32 bytes from crypto/rand (256-bit). The CSRF cookie is `SameSite=Strict, Secure=<configurable>, HttpOnly=false` (per design, the SPA must read it). | — (good practice; verified) | `internal/server/csrf.go:93-238` | n/a | CWE-352 (mitigated) | `confidence::confirmed`. |
| W2 | **CSRF token is unbound to JTI / session.** The mint endpoint (`HandleCSRF`) issues a fresh 32-byte token per call without binding it to the JWT/JTI. The source comment acknowledges this as a follow-up (SEC-N2). An attacker who has stolen BOTH the CSRF cookie and the auth cookie (e.g. via a malicious browser extension) can replay the pair from another origin — but the SameSite=Strict on both cookies makes the cross-origin attach impossible for HTTP requests, so the practical residual is "compromised same-origin renderer", which is already game over. Acceptable trade-off. | INFO | `internal/server/csrf.go:36-42, 93-118` | Only relevant if SameSite=Strict regresses. | CWE-352 (residual) | `confidence::confirmed`. |
| W3 | **CORS is wired but inert by default.** `gen/pkg/httpx/server.go:185-220` emits CORS only when `cfg.CORSEnabled=true`; the geode-ui `httpxConfig` in `cmd/server/app_csrf.go:17-46` does NOT set `CORSEnabled`, so CORS headers are never emitted. SameSite=Strict + bearer-only programmatic auth + no CORS allowance = same-origin-only by design. Wildcard origins with credentials are explicitly rejected at config-validate time (`ErrCORSWildcardWithCredentials`, see scan §SAST). | — (good practice; verified) | `cmd/server/app_csrf.go:17-46`; `gen/pkg/httpx/server.go:185-220` | n/a | CWE-942 (mitigated) | `confidence::confirmed`. |
| W4 | **HSTS is unconditional even on plaintext deployments.** `gen/pkg/httpx/server.go:187` sets `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` on every response, including the plain-HTTP e2e/test stack. Browsers that hit the server over HTTPS first (production) get the right behaviour; browsers that hit it over HTTP first will store HSTS for two years against the wrong scheme if the server is later promoted. Production deployments must terminate TLS upstream (documented). For pure HTTP dev/e2e, HSTS-on-HTTP is benign because browsers ignore HSTS on HTTP responses unless served over HTTPS, but the preload directive in particular is irreversible — submitting localhost or a non-prod hostname to the preload list is a real footgun if an operator runs a dev instance behind a one-off LE cert. **Recommendation:** condition HSTS emission on `r.TLS != nil || cfg.behindTrustedProxy`, or drop `preload` from the default until the deployment is verified production. | LOW | `gen/pkg/httpx/server.go:187` | A developer runs `geode-ui` behind a temporary HTTPS cert for testing; the browser caches the HSTS+preload bid; subsequent plaintext access from that host is broken until the max-age expires. | CWE-1004 (Sensitive Cookie without 'HttpOnly') — adjacent / OWASP A05:2021 | `confidence::suspected` (operationally documented; no code fix required). |
| W5 | **CSP retains `unsafe-inline` for style-src.** Documented as a styled-components requirement. The roadmap to migrate to nonces is acknowledged in source. Residual: stored CSS-injection in any rendered field could exfiltrate via `background-image: url(attacker)` — but no user-controlled field is rendered as `<style>` content; styled-components emits its own templated CSS at render time and React escapes everything else. Practical risk is low; documenting for completeness. | INFO | `internal/server/security_headers.go:60` | n/a today | CWE-1336 (Improper Neutralization of Special Elements Used in a Template Engine) — adjacent | `confidence::confirmed`. |
| W6 | **`/api/v1/metrics` has no per-route limiter.** The metrics proxy (`HandleMetrics`, `handlers_metrics.go:141`) is JWT-gated and the upstream call is capped at 2s, but the route has no per-route rate limit — only the global 50 rps / 100 burst per-IP limit applies. An authenticated insider can poll metrics aggressively, multiplying the load on the upstream Prom listener. Cheap fix: declare a `rateLimit` in `geode.json` (or wrap with a route limiter in app_routes.go). | LOW | `internal/server/handlers_metrics.go:141`; `cmd/server/app_routes.go:90` | An authenticated user runs `for(;;) GET /api/v1/metrics` to amplify load on the geode metrics endpoint. Bounded by the global 50 rps/100 burst per-IP, so the worst case is ~50 rps per attacker IP. | CWE-770 (Allocation of Resources Without Limits) / OWASP API4:2023 | `confidence::confirmed`. |
| W7 | **Per-IP limit on the WHOLE pipeline is RemoteAddr-only, not configurable from XFF.** `cmd/server/app_csrf.go:42-44` hard-codes `PerIPSource: IPSourceRemoteAddr`. This is the correct default; an attacker behind a reverse proxy CANNOT spoof. However, if the operator is behind a proxy and DID set `-trust-proxy-xff=true` for the login limiter, the global per-IP limiter still keys on RemoteAddr (the proxy's IP), collapsing the whole datacenter into one bucket. Documented operationally as part of `-trust-proxy-xff`; the structural mismatch is worth flagging. | LOW | `cmd/server/app_csrf.go:42-44` | When the operator enables XFF trust for login, the global per-IP limiter still treats every request as coming from the reverse proxy's IP, so the 50 rps/100 burst becomes a global cap (not per-true-source). | CWE-307 (Improper Restriction of Excessive Authentication Attempts) — adjacent | `confidence::confirmed`. |
| W8 | **CSP `connect-src 'self'` — verified.** The bare `wss:` scheme token was removed under SEC #266. Same-origin XHR/fetch + same-origin wss only. | — (good practice; verified) | `internal/server/security_headers.go:48-50` | n/a | n/a | `confidence::confirmed`. |
| W9 | **CSRF exempt path list is closed; logout is no longer exempt.** `csrfExemptPaths` (csrf.go:155-160) contains only `/api/v1/auth/login`, `/api/v1/csrf`, and `/healthz`. Logout is enforced via the SPA's `isCsrfRequired` (per source comment). Verified. | — (good practice; verified) | `internal/server/csrf.go:155-160` | n/a | n/a | `confidence::confirmed`. |

---

## 3. Input Handling

| # | Finding | Severity | File:Line | Attack Scenario | CWE/OWASP | Confidence |
|---|---|---|---|---|---|---|
| I1 | **`sanitizeGraphName` silently strips disallowed characters.** `internal/server/quoting.go:12-25` uses an allowlist approach (`[a-zA-Z0-9_-]`) but the output is just the stripped string — there is no rejection. An input like `"; DROP GRAPH x;` would emit `DROPGRAPHx` and be inlined into `USE GRAPH DROPGRAPHx;`. The upstream GQL parser would reject the resulting identifier (no graph named `DROPGRAPHx`), so the practical exploit is blocked at the next layer. However, silent stripping hides caller intent: a buggy client name like `my graph` becomes `mygraph` and quietly hits the wrong (or no) graph. **Recommendation:** make `sanitizeGraphName` strict (reject on any disallowed rune, return error). | LOW | `internal/server/quoting.go:12-25` | A user submits a graph name containing GQL keywords; the sanitiser produces a name that doesn't exist; the query fails with a confusing error. Defense-in-depth: a future Geode release that adds new lexer dispatch could be more permissive on identifier-shapes — the silent-strip model would then admit characters the upstream now treats specially. | CWE-20 (Improper Input Validation) / CWE-89 — adjacent (mitigated upstream) | `confidence::confirmed`. |
| I2 | **`promparse.go` has no per-family size cap.** `ParseProm` (`internal/server/promparse.go:85-125`) accumulates families in a map keyed by name, with no upper bound on the number of families or the cumulative size. The bufio.Scanner buffer is capped at 1 MiB per line, but a malicious upstream could emit thousands of synthetic families. The metrics URL is operator-controlled (`GEODE_METRICS_URL`) and assumed loopback/cluster-internal, so this is a defense-in-depth concern, not an attacker-reachable surface. **Recommendation:** add a sanity cap on family count (e.g. 1024) and total accumulated bytes (e.g. 4 MiB) before the parser returns. | LOW | `internal/server/promparse.go:85-125` | A compromised geode metrics endpoint (or a misconfigured `GEODE_METRICS_URL` pointing at an attacker-controlled host) emits a 100 MiB Prometheus exposition; the parser allocates an unbounded map and the metrics proxy exhausts memory. | CWE-770 / CWE-400 | `confidence::confirmed`. |
| I3 | **`splitCSVRespectingQuotes` does not handle quote escapes.** `internal/server/promparse.go:304-323` toggles `depth ^= 1` on every `"`, which misreads `"foo\""` as two separate quoted segments. Real Prometheus exposition uses backslash escapes inside label values; the parser silently mis-splits them. Source comment acknowledges this (`escapes not handled`). Practical impact is limited because the only label the parser reads is `le` (numeric upper bound), but a future use of label values for projection would inherit the bug. | LOW | `internal/server/promparse.go:304-323` | A pathological label value `path="/a,\",/b"` could cause the parser to read the wrong `le` value and skew histogram bucket bounds. | CWE-1287 (Improper Validation of Specified Type) | `confidence::confirmed`. |
| I4 | **`peekLoginCreds` enforces Content-Type before parsing.** `loginlimiter.go:505-548` gates the form parse on `application/x-www-form-urlencoded`. Multipart bodies, JSON bodies, or missing Content-Type land in the conservative IP-only limiter bucket. S-NEW-F (#317) verified closed. | — (good practice; verified) | `internal/server/loginlimiter.go:505-548` | n/a | CWE-352 (mitigated) | `confidence::confirmed`. |
| I5 | **`sanitiseUploadName` is robust.** `handlers_uploads.go:187-205` enforces `^[A-Za-z0-9._-]+$`, rejects `"."`/`".."`, refuses path separators, AND re-checks `filepath.Base(name)==name`. Multipart 64 MiB cap is enforced upstream by genapi's `MaxBytesReader`. Admin-only. Atomic rename via tmp file. | — (good practice; verified) | `internal/server/handlers_uploads.go:187-205` | n/a | CWE-22 / CWE-23 (mitigated) | `confidence::confirmed`. |
| I6 | **Upload content-type is not inspected.** Files staged under `/var/lib/geode-ui/uploads/{backups,migrations}` are written verbatim. The endpoint is admin-only, and the consumer of these files (operator-driven RESTORE / CREATE MIGRATION) is responsible for content validation, but the geode-ui audit log records the upload event with the operator's identity. Reasonable trust boundary. | INFO | `internal/server/handlers_uploads.go:135-180` | An admin (or an attacker who has stolen admin credentials) stages a malicious GQL migration; the operator runs RESTORE later. The audit log captures who staged it. | CWE-434 (mitigated by admin-only) / OWASP A04:2021 | `confidence::confirmed`. |
| I7 | **WS query params accept arbitrary JSON shapes.** `mapToNamedArgs` (`ws_query.go:525-534`) wraps every key/value pair as `sql.Named(k, v)` with no key validation — reserved names, dotted notation, etc. are passed straight to the driver. The driver and upstream Geode are responsible for rejection. Recommendation: validate keys against `[A-Za-z_][A-Za-z0-9_]*` before forwarding. | LOW | `internal/server/ws_query.go:525-534` | A WS client submits `params: {"DROP GRAPH x": 1}` — the driver-level rejection should kick in, but the geode-ui layer doesn't enforce the constraint. | CWE-20 / CWE-89 — adjacent (mitigated upstream) | `confidence::confirmed`. |
| I8 | **LSP initialize JSON depth+size caps are enforced.** `injectAuthIntoInitialize` (`ws_lsp.go:256-331`) caps body at 64 KiB and JSON depth at 32 before unmarshalling. S-NEW-I (#321) closed correctly. The depth scanner correctly handles quoted strings and escape sequences. | — (good practice; verified) | `internal/server/ws_lsp.go:256-331` | n/a | CWE-674 (mitigated) | `confidence::confirmed`. |
| I9 | **Error responses leak driver errors verbatim.** `handlers_query.go:118, 127, 137, 174` and `handlers_metrics.go:171, 179` write `err.Error()` directly into the response `description` field. The upstream geode error text may include the failing GQL statement (which contains user-supplied input) and, in rare driver-bug paths, more detail. Geode-side: the auth error path already discards the err message to avoid username echo (`handlers_auth.go:340-345`). For query/metrics, the operator argument is "the caller wrote the statement so they already know what's in it" — true for the streaming HTTP path, less true for the MCP path (where an agent might submit statements an end-user did not author). **Recommendation:** for the MCP path, consider redacting the statement out of error responses. | LOW | `internal/server/handlers_query.go:118-138`; `handlers_metrics.go:171,179` | An MCP-agent caller surfaces driver error text to a downstream user including statement bytes; an attacker observes those bytes via the MCP client logs. | CWE-209 (Generation of Error Message Containing Sensitive Information) | `confidence::suspected` (depends on caller's log handling). |
| I10 | **`mapToNamedArgs` mirrors `namedArgs` but bypasses the JSON depth/size cap that the HTTP body limiter enforces.** The WS frame body is capped at 16 MiB via `MaxMessage` in `wsOptions`. A 16 MiB JSON params map decoded into Go maps could OOM the streamer. Combined with finding I7. **Recommendation:** add a key-count + nesting-depth limit on params for both HTTP and WS. | LOW | `internal/server/ws_query.go:525-534`; `internal/server/sqlexec.go:71-87` | A WS client submits `start` with a 16 MiB params blob containing 100k keys; the handler allocates `make([]any, 0, len(m))` and an `[]any` per pair before dispatch. | CWE-770 / CWE-400 | `confidence::confirmed`. |

---

## 4. Deserialization & Dynamic Execution

| # | Finding | Severity | File:Line | Attack Scenario | CWE/OWASP | Confidence |
|---|---|---|---|---|---|---|
| D1 | **No unsafe deserialization.** `encoding/json/v2` and `encoding/json/jsontext` are used throughout; no `encoding/gob`, no reflection-driven user-controlled types, no Go plugins. Reviewed `handlers_*.go`, `audit.go`, `mcp.go`. | — (good practice; verified) | n/a | n/a | CWE-502 (mitigated) | `confidence::confirmed`. |
| D2 | **No template engine.** SPA-side rendering is React (which escapes by default). Markdown rendering goes through DOMPurify (`src/lib/docs/markdown.ts`). Server-side has no template engine — `WithSPASecurityHeaders` sniffs Content-Type and emits CSP only for HTML. | — (good practice; verified) | n/a | n/a | CWE-94 (mitigated) | `confidence::confirmed`. |
| D3 | **Audit emission cannot escalate to a 500.** `emitAudit` (`internal/server/audit.go:249-285`) wraps the whole body in `defer recover()` and writes panic surfaces to `os.Stderr` directly (bypassing slog) so a misbehaving sink can never crash a handler. | — (good practice; verified) | `internal/server/audit.go:249-285` | n/a | CWE-209 (mitigated) | `confidence::confirmed`. |

---

## 5. Supply Chain & CI/CD

| # | Finding | Severity | File:Line | Attack Scenario | CWE/OWASP | Confidence |
|---|---|---|---|---|---|---|
| S1 | **Dev-only `tar`/`webpack-dev-server`/`ws` CVEs (15 advisories) — dev-machine risk.** The 15 npm-audit findings all live in `devDependencies` (electron-builder toolchain + jest-jsdom + webpack-dev-server). Production runtime is unaffected. **Dev-machine residual:** a developer running `webpack-dev-server` (`webpack.dev.js`) on an open network is vulnerable to GHSA-79cf-xcqc-c78w (CSRF-via-misconfigured-host); on a developer laptop on a trusted home/office LAN this is benign, but contractors / hot-desk environments are not. The `tar` symlink-escape CVEs (GHSA-34x7-hfp2-rc4v, GHSA-8qq5-rm4j-mr97, GHSA-83g3-92jg-28cx) only fire during release-time archive extraction in the electron-builder chain — i.e. when packaging the desktop client on CI / signing host. The CI release host is single-tenant per pipeline, so the practical attacker would need to land a malicious archive into the electron-builder cache, which requires already-compromised CI variables. **Recommended remediation:** bump `electron-builder@25.1.8 → 26.8.1` (semver-major, re-validate Authenticode signing) and `jest-environment-jsdom → 30.4.1`. `webpack-dev-server` is a one-line dev-dep bump. | MEDIUM (dev-machine) / LOW (CI) | `package.json` devDependencies; scan §npm-audit | A developer runs `npm run dev` on an open Wi-Fi; an attacker lures them to a malicious page that exploits webpack-dev-server's host-checker bypass to exfiltrate source from `/sockjs-node` or land an XSS on `localhost:8080`. | CWE-22 (tar), CWE-749 (webpack-dev-server), CWE-908 (ws) | `confidence::confirmed`. |
| S2 | **`ci-catalog@~latest` floating reference for codesign-windows-ssl.** `.gitlab-ci.yml:34` includes `gitlab.com/devnw/ci-catalog/codesign-windows-ssl@~latest`. Allowlisted by `scripts/check-ci-pins.sh` with a documented TODO #127 to pin once the catalog releases a tagged version. Risk: a malicious push to ci-catalog `main` could compromise the Windows Authenticode signing job. Compensating control: `tag_only: true` on the job and `allow_failure: true` mean the codesign step never gates a pipeline pass. | MEDIUM (pinned-on-release-only mitigates) | `.gitlab-ci.yml:34` | An attacker pushes a malicious component to ci-catalog main that runs in the codesign job context; if the ssl.com signing creds are scoped per-job, blast radius is the per-job env (ESIGNER_*). | CWE-829 (Inclusion of Functionality from Untrusted Control Sphere) / OWASP A06:2021 | `confidence::confirmed` (documented in source). |
| S3 | **`zig build`-from-clone in e2e job.** `.gitlab-ci.yml:534-536` does `git clone --depth=1 --branch v0.5.11 https://gitlab.com/devnw/codepros/geode/geode.git ../geode || git clone --depth=1 --branch v0.5.11 https://gitlab.com/devnw/geode/geode.git ../geode` — the OR-fallback could clone from a less-specific repo path if the primary is unreachable or moved. Mitigation: both URLs are gitlab.com under devnw, but the fallback path is one rename away from cloning whatever the user named `geode` under the broader namespace. **Recommendation:** drop the OR-fallback and let the pipeline fail-fast if the canonical tag URL is unavailable. | LOW | `.gitlab-ci.yml:534-536` | An attacker renames a project to `gitlab.com/devnw/geode/geode.git` (the fallback) when the primary is briefly 404; the e2e job clones malicious sources and runs them. | CWE-829 / OWASP A06:2021 | `confidence::suspected` (depends on GitLab namespace control). |
| S4 | **Test-fixture JWT secret committed in CI.** `.gitlab-ci.yml:525` carries `JWT_SECRET_HEX: "0123456789abcdef..."` with `pragma: allowlist secret`. This is the e2e suite's known-test secret; legitimate use, but the secret value is the same across every pipeline run, so any artifact (e.g. a logged JWT) issued during e2e could in principle be re-validated by anyone who knows the value. **Recommendation:** generate per-pipeline via `openssl rand -hex 32` and pass through the `make e2e-env` mechanism that production-style runs already use. | LOW | `.gitlab-ci.yml:525` | A test JWT is logged and later replayed against a separate dev/staging instance that shares the same e2e secret. | CWE-798 (Use of Hard-coded Credentials) | `confidence::confirmed`. |
| S5 | **`docker-compose.example.yml` ships HTTP-only and a single legacy env var.** `deploy/docker-compose.example.yml:38,41` exposes `8080:8080` on the host with `-secure-cookies` left at its true default, and uses the legacy `JWT_SECRET_HEX` env var passed via `-jwt-secret-hex` (not the rotation-aware `JWT_SECRET_HEX_CURRENT`). An operator who copy-pastes this example without an upstream TLS terminator will get auth cookies that fail to attach (Secure flag + plain HTTP). The example documents `-secure-cookies=false` is only for dev — but the comment lives in the secure-cookies notes, not the wider deploy-strategy section. **Recommendation:** add an explicit `# REQUIRES upstream HTTPS terminator; see docs/OPERATIONS.md` banner. | LOW | `deploy/docker-compose.example.yml:38-53` | An operator deploys the example to a public host on port 8080 over plain HTTP; browsers refuse to send the auth cookie; the operator flips `-secure-cookies=false` to "fix" it; the deployment is now susceptible to cookie theft over plain HTTP. | CWE-319 (Cleartext Transmission of Sensitive Information) | `confidence::confirmed`. |
| S6 | **Production npm tree clean (re-verified).** `npm audit --omit=dev` returns 0 advisories across 226 production deps including Monaco, Cytoscape, monaco-languageclient, vscode-ws-jsonrpc, React, Zustand, DOMPurify (used by `src/lib/docs/markdown.ts`). | — (good practice; verified) | `package.json`; scan §npm-audit | n/a | n/a | `confidence::confirmed`. |

---

## 6. Infrastructure & Operations

| # | Finding | Severity | File:Line | Attack Scenario | CWE/OWASP | Confidence |
|---|---|---|---|---|---|---|
| O1 | **pprof loopback enforcement.** `cmd/server/pprof.go:51-69` parses `GEODE_PPROF_LISTEN` and refuses any non-loopback host (`127.0.0.1`, `[::1]`, `localhost`). Off by default. Separate listener (not on the main mux). Verified. | — (good practice; verified) | `cmd/server/pprof.go:51-69` | n/a | CWE-200 (mitigated) | `confidence::confirmed`. |
| O2 | **Profile-store DEK is read once at startup; never persisted.** `internal/profilestore/crypto.go:57-114` loads from env, decodes, validates length, instantiates AES-256-GCM. The cipher object holds the AEAD; the raw key is not retained in a long-lived variable. Rewrap sweep (`SEC-NEW-8 / #211`) lets operators rotate. | — (good practice; verified) | `internal/profilestore/crypto.go:57-114` | n/a | CWE-321 (mitigated) | `confidence::confirmed`. |
| O3 | **`docker exec` insider risk.** Per `security-inventory.md` top-abuse case #8, anyone with `docker exec` or `kubectl exec` can read process env. This is a deployment-time concern, not a code-fix. Compensating control: `JWT_SECRET_HEX_CURRENT` and `GEODE_PROFILESTORE_KEY` should be sourced from a secret manager (k8s Secret, Docker secret) not docker-compose env. | INFO | `deploy/docker-compose.{example,test}.yml` | An insider with k8s exec runs `cat /proc/<pid>/environ`; both secrets leak. | CWE-526 (Cleartext Storage of Sensitive Information in an Environment Variable) | `confidence::confirmed`. |
| O4 | **Audit ring is in-memory only.** `internal/server/audit.go:109-118` is bounded at 10k entries, FIFO, process-local. A crash loses the ring. slog continues to write to stdout, so the durable trail depends on the operator's log-shipping pipeline. Acknowledged in source. | INFO | `internal/server/audit.go:109-118` | A crash / restart wipes the in-memory audit ring; subsequent /api/v1/audit reads show only post-restart events. | CWE-778 (Insufficient Logging) — adjacent | `confidence::confirmed`. |
| O5 | **Sensitive-key redaction list is wide.** `audit.go:82-97` extends `obsx.DefaultSensitiveKeyFragments` with `saved_password`, `tls_ca_pem`, `tls_client_*`, `tls_server_*`, `tls_password`, `url`, `connection_string`, `session_id`, `refresh_token`, `access_token`. `isSensitive` is case-insensitive substring match. False-positive over-redaction is the documented preferred failure mode. | — (good practice; verified) | `internal/server/audit.go:82-97` | n/a | CWE-532 (mitigated) | `confidence::confirmed`. |
| O6 | **Electron renderer hardening — verified.** `electron/main.ts:329-331` sets `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`. `will-navigate` blocks any non-`geode://` URL. `setWindowOpenHandler` routes external links through `safeOpenExternal` (allowlist `https://` / `mailto:` only). IPC handlers all wrap untrusted renderer payloads in `sanitize*` helpers with explicit size + shape caps (S8 / GitLab #121). `safeReadPemFile` uses `O_NOFOLLOW` + fstat to close TOCTOU, caps at 1 MiB, validates PEM armor. | — (good practice; verified) | `electron/main.ts:329-331, 380-528`; `electron/lib/{ipc-guards,safety}.ts` | n/a | CWE-829 / CWE-352 (mitigated) | `confidence::confirmed`. |
| O7 | **`/healthz` is anonymous and public.** Geode.json:31-36 declares the route without auth. The handler returns `{"status":"ok"}`. No request body parsing. The route is exempt from CSRF. Per-IP global limit applies. Acceptable. | — (good practice; verified) | `geode.json:31-36`; `internal/server/server.go:223` | n/a | n/a | `confidence::confirmed`. |
| O8 | **`/api/v1/profiles/public` is anonymous.** Per inventory, returns only system-profile names + descriptions, no DSN / TLS / saved credentials. Verified at `handlers_profiles_public.go:21`. The endpoint enables an unauthenticated login UI to enumerate available profiles. Audit-log impact: an attacker can enumerate the system-profile naming convention without authenticating. Trade-off accepted by design. | INFO | `internal/server/handlers_profiles_public.go:21` | An unauthenticated attacker enumerates system-profile names to craft a more convincing phishing UI. | CWE-200 (residual, by design) | `confidence::confirmed`. |

---

## 7. Cross-Cutting / Re-classifications from Scanners

| Scanner finding | Original triage | Re-classification | Rationale |
|---|---|---|---|
| gitleaks `handlers_auth_test.go:478` (`Password: "wrong"`) | non-actionable | **unchanged** — confirmed test literal. | False positive on a unit-test password constant. |
| gitleaks `docs/superpowers/plans/...:1697` (placeholder) | non-actionable | **unchanged**. | False positive on a documentation placeholder. |
| gosec G304 on `gen/cmd/server/main.go:339,360` | suspected acceptable | **confirmed acceptable**. | Operator-supplied paths from CLI flags; not request-controlled. The gen-server scaffold is not the production binary. Recommend an explicit `//nolint:gosec` with rationale. |
| gosec G104 on `gen/cmd/server/main.go:242` (SafeGo unused return) | suspected acceptable | **confirmed acceptable**. | `SafeGo` is documented to route panics through obsx; discarded return is the documented contract. |
| semgrep `cookie-missing-httponly` on `csrf.go:104` | intentional design (double-submit) | **confirmed acceptable**. | Pattern is correct; the CSRF cookie has to be JS-readable for the SPA to echo it as `X-CSRF-Token`. |
| semgrep `cookie-missing-secure` on `csrf.go:104`, `handlers_auth.go:195,244` | config-gated | **confirmed acceptable**. | `Secure` flag is config-gated via `s.cfg.SecureCookies` (true in production; e2e turns it off explicitly). |
| semgrep / gosec `use-of-sha1` on `gen/pkg/wsx/ws.go:576` | RFC 6455 mandated | **confirmed acceptable**. | WebSocket Accept-key handshake; protocol-required SHA-1. |
| semgrep `use-of-sha1` on `password_policy.go:161` | HIBP k-anonymity | **confirmed acceptable**. | Required by the HIBP API. |
| npm `tar`/`webpack-dev-server`/`ws` cluster (15 advisories) | all dev-only | **re-classified to MEDIUM at dev-machine boundary**; LOW at CI. | See §S1. Dev-machine + open-network case is materially worse than scanner's "dev-only" label suggests. |

---

## 8. Top-of-Funnel Summary

### Counts by Severity (this review only; excludes "good practice; verified" rows)

| Severity | Count | Notes |
|---|---|---|
| Critical | 0 | |
| High | 0 | |
| Medium | 2 | A1 (self-service password change is not subject-bound); S1 (dev-machine residual for the tar/webpack-dev-server/ws cluster) |
| Low | 11 | A2, A4, A5, W4, W6, W7, I1, I2, I3, I7, I9, I10 (+ S2, S3, S4, S5) |
| Info | 5 | W2, W5, O3, O4, O8 + D1/D2/D3 are best-practice confirmations |

(Items marked "good practice; verified" are NOT counted as findings — they document
controls that work correctly so a reviewer can avoid re-walking them next round.)

### Dev-machine risk note for the `tar` / `webpack-dev-server` / `ws` cluster

The 15 dev-only CVEs do NOT affect the production runtime image (224 prod npm deps clean
under both `--omit=dev` and full-tree scans). They DO affect developer laptops in two
distinct ways:

1. **`webpack-dev-server <=5.2.3` (GHSA-79cf-xcqc-c78w, CVSS 5.3, CWE-749).** When a developer
   runs `npm run dev` (which spawns webpack-dev-server) and visits a malicious page on the
   same network — or follows a lure link while devserver is bound — the dev page can
   read `/sockjs-node`-mediated source maps and emit XSS into the dev origin. Trusted-LAN
   home/office posture mitigates; coffee-shop / hot-desk does not. **Mitigation cost:** one
   `npm install webpack-dev-server@latest -D`.

2. **`tar` chain (GHSA-34x7-hfp2-rc4v, GHSA-8qq5-rm4j-mr97, GHSA-83g3-92jg-28cx).** These
   fire only when `electron-builder` extracts an archive at packaging time. The runtime is
   the CI release host (or a developer's release-staging laptop). To exploit, an attacker
   must land a malicious archive into the electron-builder cache or its dependency tree —
   which requires already-compromised CI vars OR a developer who runs `electron-builder`
   against an attacker-controlled source. **Mitigation:** bump
   `electron-builder@25.1.8 → 26.8.1` (semver-major; re-validate the Authenticode pipeline
   on the ssl.com side).

3. **`ws >=8.0.0 <8.20.1` (GHSA-58qx-3vcg-4xpx).** Dev-only via `jest-environment-jsdom` /
   webpack-dev-server. Fires during dev/test runs, not in production. **Mitigation:** rides
   with the two bumps above via npm's dedup resolution.

**Net guidance:** bump `webpack-dev-server` and `electron-builder` in one focused MR,
re-run `npm audit --omit=dev` to confirm 0, re-run the Authenticode signing pipeline
end-to-end before merging. The `ws` cluster will follow via transitive resolution.

### Re-classifications from scanners

- **Dev-only npm cluster:** reclassified UP at the dev-machine boundary (MEDIUM) — see §S1.
- All gosec / semgrep / gitleaks "non-actionable" calls held after manual review.

### Blockers

None for shipping. Two recommendations the team should take in the next sprint:

1. **A1 (subject-bound password change)** — add the `if username != actr.Subject && !isAdmin`
   gate at `handlers_users.go:404`. Defense-in-depth against an upstream RBAC regression.
2. **S1 (dev-only npm cluster)** — bump `electron-builder` and `webpack-dev-server` to
   close the dev-machine and release-host residuals.

The rest are LOW / INFO and can be batched into a follow-up sprint focused on hardening
diagnostics (W4 HSTS-on-plaintext, W6 metrics rate-limit, W7 global per-IP under XFF trust,
I1 strict graph-name sanitisation, I2/I9/I10 input-size caps, S2/S3/S5 supply-chain pin
discipline, O5 process-env secret sourcing).

---

## 9. Coverage Table — STRIDE × Surface

| Surface | Spoofing | Tampering | Repudiation | Info-Disclosure | DoS | Elevation |
|---|---|---|---|---|---|---|
| `/api/v1/auth/login` | per-IP + per-(profile,user) limiter (`loginlimiter.go`); constant-time fail (`handlers_auth.go:123-145`) | CSRF-exempt by design (no session yet); body cap 4 KiB | every fail emits `auditEventLoginFailure` | upstream username NOT echoed in 401 (`handlers_auth.go:340-345`) | 5 rps/IP, 5-fail/15-min lockout, 250 ms latency floor | adminRolesFor uses NFKC + case-fold canonical key |
| `/api/v1/auth/logout` | best-effort revoke; sunset-exempt extractor | CSRF enforced (#318) | every call emits `auth_logout` | n/a | global per-IP only | n/a |
| `/api/v1/csrf` | n/a | CSRF-exempt (mint endpoint) | n/a | 32-byte crypto/rand token | global per-IP only | n/a |
| `/api/v1/query` (REST stream) | JWT | CSRF (cookie auth); body cap 1 MiB; per-route 100 rps | `auditEventQueryExecuted` | err.Error() echoed (I9); GQL params passed through (I7) | per-route + global per-IP | role-gated `required_roles=[]` |
| `/ws/query` | JWT (header / cookie / query); same-origin strict | 16 MiB MaxMessage; per-frame deadlines | n/a (audit on REST mirror) | row stream straight through | 30s deadlines + cancel-reader | n/a |
| `/ws/lsp` | JWT; same-origin strict; AllowEmptyOrigin (A2) | 16 MiB cap; 64 KiB + depth-32 cap on initialize | n/a | token injected into LSP initialize only (operator-pinned upstream) | upstream dial 5s timeout; per-frame 30s write | n/a |
| `/api/v1/users/{u}/password` | JWT but NO subject equality (A1) | CSRF; rate 20 rpm | `auditEventUserPasswordSet` (no value logged) | pw never logged | per-route | A1: relies on upstream RBAC |
| `/api/v1/profiles` CRUD | JWT + per-actor 30/min limiter | CSRF; SQL via parameterised store | `auditEventProfile{Created,Updated,Deleted}` | redaction matrix verified | per-actor limit | owner/admin gates verified |
| `/api/v1/backups/upload`, `/migrations/upload` | JWT + admin | CSRF; allowlist filename; 64 MiB cap | `auditEventBackupCreated` / `MigrationCreated` | content not inspected (I6) | rateLimit 10; 64 MiB cap | admin-only |
| `/api/v1/metrics` | JWT in-handler | n/a (GET only) | n/a | upstream Prom err echoed (I9) | NO per-route limiter (W6) | n/a |
| `/api/v1/audit` | JWT + admin | n/a (GET only) | reads from process ring (O4) | redaction at write time (O5) | per-route 100 rps | admin-only |
| `POST /mcp` | JWT via mcpAuthVerifier (re-uses AuthJWT) | CSRF (cookie auth flow); MaxBodyBytes 1 MiB | inherits `auditEventQueryExecuted` via handleQuery | err.Error() echoed (I9) | per-route via genmcp + global per-IP | single tool `query`; no admin tool surface |
| `/debug/pprof/*` | none (loopback-only) | n/a | n/a | profile data assumed operator-only (O1) | separate listener, no global limits | n/a |
| Electron renderer | sandbox + contextIsolation (O6) | IPC payload guards (O6) | n/a | safeStorage / DPAPI / libsecret | size caps + 32-conn cap | navigation locked to `geode://` (O6) |

---

*End of review.*
