# Security Gap Analysis — geode-ui

**Last updated:** 2026-05-24 (appsec gap-close cohort — **docs-only**, no platform issues created. All 9 findings from `docs/APPSEC_REVIEW_2026-05-24_auth-ipc.md` (Auth + Electron IPC surface) closed across 10 commits on `main` (`0d60d6b..a8ed74e`). Severity counts: Critical 0 / High 0 / Medium 2 (APP-01, APP-02) / Low 6 (APP-03..08) / Info 1 (APP-09). APP-01 closed in three sub-commits (R1 trust-boundary doc → R2 unlock-token gate → R3 OS-native biometric wrapper). Verifier verdict: ACCEPT-WITH-NITS — follow-ups recorded in `GAP_ANALYSIS_RESOLVED.md` "Closure cohort 2026-05-24 (appsec auth + IPC)" section. See [2026-05-24 appsec cohort — auth + IPC closure](#2026-05-24-appsec-cohort--auth--ipc-closure) below.)

**Previous:** 2026-05-21 (gap-close pass — 2 of the 2026-05-21 cohort items CLOSED in this session: `A1` BOLA on POST /users/{u}/password via `ad4fe56` (in-handler subject-equality gate against `actor.Subject`; `auditEventUserPasswordForbidden` records rejected attempts; 4 new tests pin self / admin / non-admin / anonymous matrix); `S1` dev-machine npm cluster via `6835660` (`electron-builder 25.1.8 → 26.8.1` + `webpack-dev-server 5.0 → 5.2.4`, `ws` follows via dedup to 8.20.1; `npm audit --omit=dev` reports 0 production-tree vulnerabilities). Authenticode validation on a Windows release host is OUTSTANDING and must be run before tagging the next electron build. Remaining 2026-05-21 items: S2 + 11 Low + 5 Info.)

**Previous:** 2026-05-21 (Phase 1–3 inputs against HEAD `1199648`; `--skip-issues` mode — docs-only. Phase 4 docs-only consolidation of `docs/audits/2026-05-21/security-{inventory,scan,review}.md`. **No GitLab writes** in this run; confidential issues recorded here instead. Cohort: 13 items (A1, A2, A4, A5, W4, W6, W7, I1, I2, I3, I7, I9, I10) + 4 supply/CI items (S1, S2, S3, S4, S5) + 5 Info (W2, W5, O3, O4, O8). Severity counts: Critical 0 / High 0 / Medium 2 / Low 11 / Info 5. Scanner cross-check: gitleaks 2 non-actionable; govulncheck 0; gosec/semgrep 0 actionable; npm prod 0; npm full-tree 15 dev-only (tar / webpack-dev-server / ws cluster, **MEDIUM at dev-machine boundary**, LOW at CI). Top action: atomic MR bumping `electron-builder 25.1.8 → 26.8.1` + `webpack-dev-server@latest` (ws follows via npm dedup). See [2026-05-21 audit cohort](#2026-05-21-audit-cohort) below.)

**Previous:** 2026-05-19 (closure cohort — /codepros:gap-close round-4 against the 2026-05-19 audit Phase 4 surface: S-NEW-J / #322 + S-NEW-K / #323 Closed via `1cde6ba` (`${VAR:?msg}` required form + per-checkout `.env.test` random generation + pre-commit gate); S-NEW-C / #308 Closed via `36661d7` (`extractTokenForRevoke` sunset-exempt); S-NEW-A / #300 **Partial — Scope-A Closed** via `71352b2` (`auth_role_resolved` audit event with `source=bootstrap`); Scope-B remains Open — blocked on upstream Geode (real SHOW USERS ROLES discovery). 9 of 13 2026-05-19 security items remain Open. See `GAP_ANALYSIS_RESOLVED.md` "Closure cohort 2026-05-19" for evidence.)

**Previous:** 2026-05-19 (Phase 4 — /codepros:audit 2026-05-19 cohort: 13 new findings filed (#300, #304, #308, #310, #313, #317, #318, #320, #321, #322, #323, #324, #325); 3 confidential (#300, #322, #323); 0 Critical, 1 High, 5 Medium, 4 Low, 3 Info; top risk is S-NEW-A / #300 (Risk 48 — authenticateUpstream returns nil roles); supply-chain hardening: S-NEW-J / #322 + S-NEW-K / #323 remove operator-misuse hardcoded defaults from `deploy/docker-compose.test.yml`. Prior content below preserved verbatim.)

**Last updated (prior):** 2026-05-17 (Phase 5 — /codepros:gap-close round-3 cohort: 9 security gaps reified with closure SHAs. S-09/#272 (`b0e7cc6`), S-10/#274 (`8bc00af` — ADR 0002), S-12/#280 (`8b01c57`), S-13/#283 (`c672d36`), S-NEW-10/#264 (`3bcba7d`), S-NEW-11/#265 (`a758ac4`), S-NEW-12/#267 (`9823965`, underlying fix `755ede6`), S-NEW-13/#266 (`f60f1a2`, underlying fix `d914df6`), CO-242 NFKC corpus on #242 (`5e54315`). S-11/#277 (css-minimizer 7→8) deferred to a separate PR per user direction. GAP-037 / #282 (SECURITY.md misattribution) closed via `60d965a` and tracked under `GAP_ANALYSIS.md`. Detail in `GAP_ANALYSIS_RESOLVED.md` "Closure cohort 2026-05-17 (audit Phase 5 — /codepros:gap-close round-3 cohort)" section.)
**Audit:** /codepros:audit Phase 3 → Phase 4 tracking (Audit-2026-05-17 cohort)
**Repository:** `devnw/codepros/geode/geode-ui`
**Branch reviewed:** `main` @ `d5c47da`

> **Appsec-2026-05-24 closure jump-link (docs-only, no platform issues):** see [2026-05-24 appsec cohort — auth + IPC closure](#2026-05-24-appsec-cohort--auth--ipc-closure) for the **9 findings closed across 10 commits** against `docs/APPSEC_REVIEW_2026-05-24_auth-ipc.md`. Severity counts: 0 Critical / 0 High / 2 Medium (APP-01 saved-password IPC; APP-02 Electron CSP) / 6 Low / 1 Info. APP-01 landed in three sub-commits (R1 → R2 → R3). Verifier verdict: ACCEPT-WITH-NITS. Cohort range `0d60d6b..a8ed74e` on `main`.
>
> **Audit-2026-05-21 Phase 4 jump-link (docs-only, `--skip-issues`):** see [2026-05-21 audit cohort](#2026-05-21-audit-cohort) for the **13 in-doc findings** consolidated from `docs/audits/2026-05-21/security-{inventory,scan,review}.md`. **No GitLab writes** in this run; items that would normally be confidential GitLab issues are tracked in-doc only. 0 Critical, 0 High, 2 Medium (A1 BOLA on `POST /api/v1/users/{u}/password` + S1 dev-machine npm cluster), 11 Low, 5 Info. Top recommended action: atomic MR `electron-builder 25.1.8 → 26.8.1` + `webpack-dev-server@latest` (ws follows via dedup).
>
> **Audit-2026-05-19 Phase 4 jump-link:** see [2026-05-19 audit cohort](#2026-05-19-audit-cohort) for the **13 newly-filed `S-NEW-A..M` findings** (issues #300, #304, #308, #310, #313, #317, #318, #320, #321, #322, #323, #324, #325). Three confidential (#300, #322, #323). 0 Critical, 1 High, 5 Medium, 4 Low, 3 Info. Top risk: S-NEW-A / #300 (Risk 48 — `authenticateUpstream` returns nil roles).
>
> **Audit-2026-05-17 Phase 4 follow-on jump-link:** see [2026-05-17 audit cohort](#2026-05-17-audit-cohort) for the **9 cohort-resident findings**: the original 8 from earlier in the day (S-2026-05-17-01..08, mapped to #264-#267 + cross-links to #241/#242/#71/#233) PLUS the Phase-4 follow-on **5 newly-filed `S-2026-05-17-09..13`** findings (issues #272, #274, #277, #280, #283 — all public, no confidential filings) and **two Phase-4 update comments** on existing issues (#233 enumerated phased remediation; #242 missing-case classification). Two findings from Phase 2 dropped as not-a-gap (see Dropped subsection). No findings warrant CVE filing.
>
> **Audit-2026-05-13 cohort jump-link:** see [2026-05-13 audit cohort](#2026-05-13-audit-cohort) for the 8 newly-filed `S-NEW-*` + `GO-2026-4918` findings (issues #201, #202, #205, #206, #209, #210, #211, #212; three confidential — #201, #202, #205). S3 (#116) is explicitly upgraded from PARTIAL → CLOSED in this pass. F2/F4/F7/N2/S5/S8 re-validated as still-closed.
>
> **Audit-2026-05-11 cohort jump-link:** see [Audit-2026-05-11 cohort — full-tree security pass](#audit-2026-05-11-cohort--full-tree-security-pass) for the 7 newly-filed `F-AUTH-*`/`F-INPUT-*`/`F-SUP-*` findings (issues #132, #135, #140, #143, #148, #153, #160, #161) plus the deferred-comment on #72 (F-SUP-2). Earlier cohorts (PSR S01-S10 = #114-#123; `F*`/`N*` = #58-#77) remain the canonical historical record below.
>
> **PSR cohort jump-link:** see [Profile System Rebuild (PSR) — 2026-05-10 audit](#profile-system-rebuild-psr--2026-05-10-audit) for the 10 newly-filed S01-S10 findings (issues #114-#123) covering the recent profile-system rebuild only. Prior cohort (`F*`/`N*` series, issues #58-#77) below remains the canonical baseline.

## 2026-05-24 appsec cohort — auth + IPC closure

**Source review:** `docs/APPSEC_REVIEW_2026-05-24_auth-ipc.md` (defensive code review of `electron/*`, `src/auth/*`, `src/api/*` — OWASP Top 10:2025 + CIS Controls v8.1.2; evidence-first with `path:line` citations).
**Cohort range:** `0d60d6b..a8ed74e` on `main` (10 commits, all unpushed pending review at tracking-commit time).
**Mode:** **docs-only**, no platform issues created. Same `--skip-issues` precedent as the 2026-05-21 cohort: confidential issues for this repo would normally go to GitLab; we keep this run docs-only and let `git log` + this tracker carry the closure evidence.
**Verifier verdict:** **ACCEPT-WITH-NITS** (4 follow-ups recorded; none release-blocking).

| Gap-ID | Severity | Confidence | Title | File:Line (fix) | Closure SHA | Closing tests | Status |
|--------|----------|------------|-------|------------------|-------------|---------------|--------|
| **APP-01** | Medium | High | Saved-password IPC channels have no session/origin binding | R1: `electron/main.ts` (SECURITY block above `geode:get-stored-password` handler) + `docs/ELECTRON.md` (Saved-password trust boundary). R2: `electron/lib/unlock-tokens.ts` (new) + `electron/main.ts` (`geode:open-unlock-window` IPC; consume-token in `geode:get-stored-password`) + `electron/preload.ts:53-71` + `src/api/electron-bridge.ts` + `src/auth/AuthProvider.tsx` (fire-and-forget post-login window). R3: `electron/lib/biometric.ts` (new) + `electron/main.ts` (`systemPreferences.promptTouchID` wrapper; Windows/Linux fail-closed stubs; 60 s recent-success window) + `electron/lib/secure-store.ts` (`savedPasswordRequireBiometric` field). | `794d657` (R1) + `a4135a9` (R2) + `a8ed74e` (R3) | `__tests__/electron-saved-password-security-block.test.ts` (R1); `__tests__/electron-unlock-token.test.ts` + `src/api/electron-bridge.test.ts` + `src/lib/usePublicProfilesWithStoredPasswords.test.ts` (R2); `__tests__/electron-biometric.test.ts` (R3) | **Closed** (R1 + R2 + R3; biometric is opt-in via secure-store pref) |
| **APP-02** | Medium | High | Electron path ships no Content-Security-Policy | `electron/lib/safety.ts` (`buildCspValue` + `cacheControlFor` pure helpers) and `electron/main.ts:206-218` (CSP + `X-Content-Type-Options: nosniff` + `Referrer-Policy: no-referrer` + `Cache-Control` on every `geode://` response, both success and SPA-fallback branches) | `7bb6335` (paired with APP-09) | `__tests__/electron-safety.test.ts` directive-by-directive + snapshot lock; `__tests__/__snapshots__/electron-safety.test.ts.snap` pins CSP value | **Closed** |
| **APP-03** | Low | High | `isAllowedExternal` regex matches opaque `https:` and `mailto:` URIs | `electron/lib/safety.ts:17-38` (replace scheme-prefix regex with `new URL(input)` parser; require non-empty `hostname` AND `https://` prefix for `https:`; require `@` in `pathname` for `mailto:`) | `aa1c2e4` | `__tests__/electron-safety.test.ts` opaque-URI rejection corpus (`https:evil`, `https:`, `https://`, `https:./path`, `mailto:`, `mailto:noaddress`) + positive cases | **Closed** |
| **APP-04** | Low | Medium | MAC-key derivation depends on undocumented `safeStorage` determinism | `electron/lib/secure-store.ts:145-153` replaced with `loadOrCreateMacKey()` — first run generates 32 random bytes via `crypto.randomBytes`, wraps via `safeStorage.encryptString`, atomically writes to `<storePath dir>/secure-store.mackey` (tmp-suffix + rename, mode 0o600). Subsequent runs decrypt the wrapped key. Deleting the key file forces a one-shot wipe rather than silent corruption. | `1c0f895` | `electron/lib/__tests__/secure-store.test.ts` (new round-trip + restart-survival + missing-key-file wipe assertions) | **Closed** |
| **APP-05** | Low | High | No `setPermissionRequestHandler` / `setPermissionCheckHandler` on privileged session | `electron/lib/safety.ts` (new `buildPermissionHandlers(allowed)` pure factory) + `electron/main.ts` (wired inside `app.whenReady` before `createWindow`; deny-by-default; empty `ALLOWED_PERMS` set) + `docs/ELECTRON.md` Permission-policy section | `08a1ed9` | `__tests__/electron-safety.test.ts` (pure-factory `buildPermissionHandlers` unit tests; empty allow-set rejects all permissions) | **Closed** |
| **APP-06** | Low | High | `RoleGate` doc-string says "disclosure-only" but mounted as the SPA admin gate | `src/auth/RoleGate.tsx:5-23` (doc-string reconciled; explicit "client-side gate is information-disclosure-only; every API handler on the server independently checks `hasRole('admin')` — DO NOT remove the server-side check"). `src/auth/AuthProvider.tsx` adds `fetchWhoAmI`-driven bootstrap effect that authoritatively overwrites the sessionStorage roles cache when authenticated. | `c2faab8` | `src/auth/AuthProvider.test.tsx` (forged `sessionStorage['geode-ui.session-roles']` overwritten by empty `whoAmI` response → `isAdmin === false`) | **Closed** |
| **APP-07** | Low | High | Legacy backout flag re-enables JS-readable bearer token in `localStorage` | `src/api/auth.ts` — delete `LEGACY_FLAG_KEY`, `LEGACY_TOKEN_KEY`, `isLegacyMode()`, legacy branch in `login()`, `auth.getToken()`, `auth.clearToken()`, `auth.isLegacyMode`. `src/api/client.ts:74,99` — drop `auth.getToken()` checks + `?? COOKIE_MODE_PLACEHOLDER` fallback. `src/lib/queryStream.ts` — repoint at `getLatestToken()` from `src/api/connections`. | `0d60d6b` | `src/api/auth.test.ts` (retired flag has no effect on fresh login; surface is gone); `src/lib/queryStream.test.ts` (bearer-fallback test switched from `localStorage` to in-memory latch) | **Closed** |
| **APP-08** | Low | Medium | `setLatestToken` module-level latch not bound to request connection-id | `src/api/connections.tsx` adds `getTokenForConnection(id)` per-connection accessor over `Map<connectionId, token>` + `internalSyncConnectionTokens(entries)` persist-effect sync. `src/api/client.ts` plumbs optional `connectionId` through `RequestInit` via a `ConnectionScopedInit` type; fetch wrapper resolves bearer via `getTokenForConnection(init.connectionId)` when set, falls back to `getLatestToken()` when unset (legacy callers unchanged). | `a15f9a7` | `src/api/connections.test.tsx` (per-connection token returned after reducer add; cleared on remove); `src/api/client.test.ts` (`init.connectionId` beats latch; latch is fallback when no `connectionId`) | **Closed** |
| **APP-09** | Info | High | `geode://` protocol handler does not set `X-Content-Type-Options: nosniff` or `Cache-Control` | Bundled into the APP-02 commit — `electron/main.ts:206-218` now sets `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and an extension-keyed `Cache-Control` policy (`no-store` for `.html`; `public, max-age=31536000, immutable` for fingerprinted assets) via `cacheControlFor` in `electron/lib/safety.ts`. | `7bb6335` (cross-closed with APP-02) | `__tests__/electron-safety.test.ts` `cacheControlFor` html/asset/fallthrough cases | **Closed** |

**Severity counts:** Critical 0 / High 0 / Medium 2 (APP-01, APP-02) / Low 6 (APP-03..08) / Info 1 (APP-09). All 9 findings Closed.

**Verifier follow-ups (ACCEPT-WITH-NITS — none release-blocking):**

1. `src/auth/GqlEditor.tsx:213-216` carries a comment referencing the deleted `geode-ui.legacy-auth=1` backout — tidy in a docs-only follow-up commit (inline `// FIXME(APP-07-followup):` or stripped reference).
2. Jest worker-process force-exit warning surfaced during regression runs — pre-existing teardown leak, not introduced by this cohort. Recommend a focused `--detectOpenHandles` pass in a separate session.
3. APP-01 R3 Windows / Linux platform stubs are **fail-closed** by design. Real Windows Hello (native module) and Linux polkit/pkexec integration must land BEFORE the `savedPasswordRequireBiometric` pref is exposed in any settings UI, to avoid the usability footgun where a user opts in on Windows and discovers every saved-password read returns `null`.
4. Focused e2e against the saved-password unlock + biometric flow on darwin CI is recommended before the next release tag.

**Cross-references:**

- Source review: `docs/APPSEC_REVIEW_2026-05-24_auth-ipc.md`.
- Per-finding evidence + commit map: `GAP_ANALYSIS_RESOLVED.md` "Closure cohort 2026-05-24 (appsec auth + IPC)" section.
- Cohort range on `main`: `0d60d6b..a8ed74e` (10 commits).

---

## Scope

Adversarial security review of the geode-ui admin SPA + Go server. Covers:

- Go server: `cmd/server/main.go`, `internal/server/`, `internal/jwt/`, `internal/conn/`, `internal/ui/`
- Generated server surface: `gen/api/`, `gen/ws/`, `gen/mcp/`, `gen/pkg/{httpx,obsx,gqlx,mcpx}` (read-only — emitted by `~/src/devnw/apps/genapi`)
- TypeScript SPA: `src/`
- Build / supply chain: `package-lock.json`, `package.json`, `go.mod`/`go.sum`

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
| **npm audit** | npm transitive | 8 advisories on `dompurify@3.2.7` (F8); HIGH advisory on dev-only `serialize-javascript` via `copy-webpack-plugin` (F12). |
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
| 16 | F12 | Low | **8** | serialize-javascript HIGH RCE in dev-only copy-webpack-plugin | [#73](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/73) | `package-lock.json` | **Closed (2026-05-16)** — also closes F-SUP-2 #72. `package.json` bumped `copy-webpack-plugin` from `^12.0.0` to `^14.0.0`. v14 pulls in `serialize-javascript@^7.0.3` (post-advisory; the GHSA-5c6j-r48x-rmvq and GHSA-qj8w-gfj5-8c6v fixes shipped in v6.0.2 are sub-set of v7's policy). `npm audit --audit-level=high` now reports zero `copy-webpack-plugin`-rooted findings. The remaining high finding via `css-minimizer-webpack-plugin` is a SEPARATE upstream issue tracked under the wider `serialize-javascript` audit, not the `copy-webpack-plugin` chain we owned in F12/F-SUP-2. Production build still passes (`npm run build`). |
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
- ~~F8 — Bump `monaco-editor` or pin via npm overrides.~~ **Closed 2026-05-10** via `package.json::overrides.dompurify ^3.4.0`; resolves to `dompurify@3.4.2 overridden`.
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
| S9 | (accepted-risk) | **3** | Low | **Closed 2026-05-10 (sec::accepted-risk / Won't Do)** | [#122](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/122) | `src/auth/AuthProvider.tsx:219-238` | `signOut` does not `clearStoredPassword` — intentional per Plan E §8 (browser-password-manager analog). **Closed 2026-05-10** as `sec::accepted-risk`: in-line `signOut` block now carries an explicit "do not 'fix' without re-reading Plan E §8 + this row" guard comment naming the underlying `clearStoredPassword` IPC + TODO #122 follow-up for a Settings UI affordance ("Forget Saved Password"). **2026-05-16 gap-close pass:** formally re-classified as **Won't Do (accepted risk per Plan E §8)** — the existing 2026-05-10 closure is the right outcome; this row reaffirms it during the gap-close sweep. Risk accepted because forcing a clear on signOut would silently nuke a credential the user explicitly opted to save and would diverge from every browser password manager in the ecosystem; the user retains explicit control via the planned Settings affordance and the existing `geode:clear-stored-password` IPC. |

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
| F-SUP-2 | A06 / CWE-1395 | **9** | Medium | **Closed (2026-05-16)** — cross-closed with F12 (#73): `copy-webpack-plugin` bumped 12 → 14, which pulls `serialize-javascript@^7.0.3` (post-advisory). | [#72](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/72) | `package-lock.json` | serialize-javascript HIGH RCE in dev-only copy-webpack-plugin |
| F-SUP-4 | A08 / CWE-1357 | **6** | Low | **Closed `f444c70`** | [#160](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/160) | `package.json:31-34` | electron / electron-builder referenced in scripts but missing from devDependencies |
| F-INPUT-2 | A04 / CWE-665 | **4** | Low | **Closed `ea3f681`** (2026-05-12) — `unsealBytes`'s `cipher == nil` branch now `if IsCiphertext(raw) { return "", fmt.Errorf("profilestore: ciphertext present but no cipher configured") }`; plaintext + empty pass through unchanged; defense-in-depth (production still fail-fasts on missing `GEODE_PROFILESTORE_KEY` at store construction). Test: `sqlite_test.go` +`TestUnsealBytes_FailsLoudWithoutCipher`. `internal/profilestore` cov 80.7%→81.0%; **#143 closed** | [#143](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/143) | `internal/profilestore/sqlite.go` | `unsealBytes` silently passes ciphertext when cipher unconfigured |
| F-SUP-5 | A07 / CWE-798 | **2** | Low (info) | **Closed (2026-05-16)** — `docs/superpowers/plans/2026-05-06-e2e-testing-stack.md:458,461,1697` literal 32-byte hex replaced with the `<GENERATE_WITH_openssl_rand_hex_32>` placeholder string per the planner's spec. Comment block warns future copy-paste readers. `grep "0123456789abcdef" docs/superpowers/plans/2026-05-06-e2e-testing-stack.md` returns no hits. | [#161](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/161) | `docs/superpowers/plans/2026-05-06-e2e-testing-stack.md:458,461,1697` | Plan doc embeds copyable JWT_SECRET_HEX placeholder |

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
- **Carried-forward CI follow-up — Won't Do (until upstream ci-catalog tagged release)** (2026-05-16): pin `codesign-windows-ssl` to an immutable ci-catalog tag once one ships that component. Today the component is only on the catalog's `main`, so there is no immutable ref to pin to. Tracked via the in-file `# ci-pins-allow:` marker + #127's `TODO`; not a security item per F-SUP-3 closure (`d35d3c7`) which already pinned the other 3 floating refs. **Unblock condition:** upstream ci-catalog publishes a tagged release of `codesign-windows-ssl`; flip the pin and drop the `# ci-pins-allow:` marker.

## 2026-05-13 audit cohort

A focused security re-sweep on top of the Audit-2026-05-11 cohort. Eight new findings filed (three confidential), and **S3 (#116) explicitly upgraded from PARTIAL → CLOSED** based on re-reading `electron/lib/ipc-guards.ts:81`. The Phase 2 PARTIAL tag was incorrect: the closure already had the full `O_NOFOLLOW`/fstat-on-FD/1 MiB-cap/PEM-armor-validation chain in place.

### 2026-05-13 findings — stack ranked by risk score

| ID | File:Line | OWASP / CWE | Risk (L x I) | Severity | Confidential | Issue | Status |
|---|---|---|---|---|---|---|---|
| **S-NEW-5** | `internal/server/loginlimiter.go:337-350` | A07 / CWE-290, CWE-348, CWE-799 | **20** (5 x 4) | **High** | **YES** | [#201](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/201) | **RESOLVED 2026-05-13** (commit `6f75a74`) — `clientIP()` no longer honors `X-Forwarded-For` by default. New `-trust-proxy-xff` boolean CLI flag (default `false`) is threaded through `LoginLimiterConfig.TrustProxyXFF` + `ProfileLimiterConfig.TrustProxyXFF` so both limiters key on `net.SplitHostPort(r.RemoteAddr)` unless the operator explicitly opts in for a trusted-proxy deployment. Closes the XFF spoofing bypass of the 5 rps login limiter and the DoS-by-lockout vector against arbitrary innocent IPs. Pinned by two new unit tests (`TestClientIP_RemoteAddrOnly_WhenXFFNotTrusted`, `TestClientIP_HonorsXFF_WhenTrusted`). Trusted-proxy CIDR enforcement was deemed out-of-scope for the 1-day fix — the flag is binary and operator-opt-in; deployments behind multi-hop proxies will be revisited if/when XFF parsing on the trusted path proves insufficient. |
| **S-NEW-2** | `cmd/server/app.go:74` + `internal/server/handlers_auth.go:149-154` | A07 + A05 / CWE-1188, CWE-269 | **15** (3 x 5) | **Medium** | **YES** | [#202](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/202) | **CLOSED (2026-05-16)** — `cmd/server/app.go:82` `-admin-users` flag default changed from `"geode"` to `""` (no auto-bootstrap). `newApp` emits an `obsx.LogAudit("admin_bootstrap", {admin_count, admin_users[sorted]})` record on every startup, including the zero-admin case after the default flipped. Breaking-change migration note added to `deploy/RELEASE.md`. Pinned by `TestParseFlags_AdminUsersDefaultEmpty` and the three-case table `TestNewApp_AdminBootstrapAuditEvent` in `cmd/server/app_test.go` (empty / single / multi-sorted). |
| **GO-2026-4918** | `go.mod` (toolchain `go1.26.2`) — reachable via `gen/pkg/oidcx.Do` | A06 / CWE-835 | **6** (2 x 3) | **Medium** | NO | [#212](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/212) | **CLOSED (2026-05-16)** — combined commit with QUALITY rank 1 (#148). `go.mod` `go 1.26.3`; `.goreleaser.yaml` `GOTOOLCHAIN=go1.26.3`; `README.md` badge + quick-start updated. New `scripts/check-go-toolchain.sh` guard pins all five audited files (`go.mod`, `.goreleaser.yaml`, `Makefile`, `.gitlab-ci.yml`, `README.md`) to a single source-of-truth version and fails on stale `1.26.x` references. Wired into pre-commit. Removes the `net/http2` SETTINGS frame infinite-loop path. |
| **S-NEW-9** | `internal/server/csrf.go:146-152` + `handlers_auth.go:195-211` | A04 + A07 / CWE-613, CWE-352 | **6** (3 x 2) | **Medium** | **YES** | [#205](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/205) | **CLOSED (2026-05-16)** — `internal/server/handlers_auth.go:HandleLogout` now best-effort extracts the JWT via the same three-source priority order as AuthJWT (header / cookie / query), Parse-validates it, and on success calls `s.cfg.JWT.Revocation().Revoke(jti, exp)`. New helper `bestEffortRevokeFromRequest()` returns the subject + a `revoked` boolean for the audit record. Every logout emits `emitAudit("auth_logout", "sub", <username>, "revoked", <bool>, "path", <url>)` — no JTI in the log, on purpose. Cookie clear behavior + idempotent-anonymous contract preserved. Pinned by `TestLogout_RevokesCookieJTI_SEC_NEW_9`, `TestLogout_RevokesAuthorizationHeaderJTI_SEC_NEW_9`, `TestLogout_NoTokenStillReturns204`, `TestLogout_GarbageCookieReturns204`, `TestLogout_EmitsAuthLogoutAuditEvent_SEC_NEW_9` in `internal/server/handlers_auth_test.go`. |
| **S-NEW-6** | `internal/server/security_headers.go:107-117` | A09 / CWE-778 | **6** (3 x 2) | **Low** | NO | [#206](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/206) | **CLOSED (2026-05-16)** — `WithAccessTokenDeprecation` now (a) unconditionally increments the `security_access_token_query_total` expvar counter on every deprecated-surface request (no throttling — counters are cheap and operators want true counts) and (b) emits a per-path rate-limited `audit_event=access_token_query` with `{path, user_agent}` (10 s window per path so floods can't drown the log but every distinct surface still surfaces). Pinned by 4 tests in `internal/server/security_headers_test.go`: emission shape, rate-limiting math (5 reqs → at most 2 audits), counter increment of 3, no-op when query param absent. |
| **S-NEW-3** | `internal/server/auth.go:69-71` | A04 / CWE-1023, CWE-289 | **3** (1 x 3) | **Low** | NO | [#209](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/209) | **DEFERRED 2026-05-16** (needs-genapi) — the fix requires teaching the upstream `genapi`-emitted per-route middleware to consume claims from `req.Context()` instead of re-parsing `Authorization: Bearer`. Until that upstream change lands, the geode-ui-side shim at `auth.go:70` is the only viable workaround and is safe today (single-process, single-issuer, claims-already-validated). Closed as **Won't-Do-Until-Upstream**. Re-open once the corresponding `genapi#XXX` issue lands a release. |
| **S-NEW-7** | `internal/jwt/jwt.go:71-92` + `cmd/server/app.go:72,138-144` | A02 / CWE-321, CWE-320 | **2** (1 x 2) | **Low** | NO | [#210](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/210) | **CLOSED (2026-05-16)** — `internal/jwt/jwt.go`: new `Issuer` carries a `kid → secret` map + `activeKID`; `Issue()` stamps `t.Header["kid"]` on every token; `Parse()` picks the verification key by inbound kid, hard-fails on unknown kid, falls back to activeKID for legacy no-kid tokens. New constructor `NewIssuerWithKeys(keys, activeKID, ttl)` with `DefaultKID="current"` + `PreviousKID="previous"` constants. `NewIssuer` is now a thin back-compat wrapper. `cmd/server/app.go:buildJWTKeys()` honours `JWT_SECRET_HEX_CURRENT` (preferred) + `JWT_SECRET_HEX_PREVIOUS` (rotation window) env vars; the legacy `-jwt-secret-hex` flag still works. New `docs/OPERATIONS.md#jwt-secret-rotation` runbook walks operators through the dual-secret deploy → wait one TTL → drop previous procedure. Pinned by 6 tests in `internal/jwt/jwt_kid_rotation_test.go` (kid header stamped, dual-key verification, unknown-kid rejection, constructor validation, KID introspection, legacy no-kid fallback) + 6 tests in `cmd/server/app_test.go` for buildJWTKeys (legacy, env mode, partial env, env-beats-CLI, missing-secret, malformed hex). |
| **S-NEW-8** | `internal/profilestore/crypto.go:28-32` | A02 / CWE-320 | **1** (1 x 1) | **Info** | NO | [#211](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/211) | **CLOSED (2026-05-16)** — `internal/profilestore/crypto.go`: new `(*Cipher).Rewrap(prev, sealed)` decrypts under prev and re-encrypts under the receiver (fresh nonce, fail-loud on plaintext input, nil-checked args, idempotent when prev==c). `internal/profilestore/sqlite.go`: new `Rewrapper` optional Store interface + `RewrapSensitiveColumns(ctx, prev)` walks every profile row, re-seals the four encrypted columns under the active cipher, returns `RewrapResult{RowsTouched, SealsRewritten, SkippedPlaintext}`. Wrapped in a SQLite transaction so partial failure does not leave half-rewrapped rows. `cmd/server/app.go`: new `-profilestore-rewrap-from <base64>` flag triggers the one-shot startup sweep, emits `audit_event=profilestore_rewrap_complete {rows_touched, seals_rewritten, skipped_plaintext}`, and aborts startup loud on wrong-prev-key. `docs/OPERATIONS.md#profile-store-key-rotation`: full operator runbook. Pinned by 4 Rewrap unit tests in `crypto_test.go` (roundtrip-under-new-key, rejects-plaintext, nil-args, idempotent) + 3 sqlite tests (rotates-every-row end-to-end across reopens, wrong-prev-key-fails-loud, leaves-plaintext-alone) + 2 startup-sweep tests in `cmd/server/app_test.go` (audit event emitted, wrong-legacy-key aborts newApp). |

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

## 2026-05-17 audit cohort

A targeted security re-sweep on top of HEAD `d5c47da` after the gap-closure pass that landed the Audit-2026-05-13 cohort. **Four new public issues filed (#264, #265, #266, #267)** plus **four cross-link comments** on existing issues already covering the finding from a different angle (#241, #242, #71, #233), then a **Phase-4 follow-on cohort** added **five additional issues #272, #274, #277, #280, #283** (S-2026-05-17-09..13) plus **two Phase-4 update comments** on #233 (enumerated phased remediation plan) and #242 (missing-case classification + adversarial NFKC vectors). **No new confidential issues** — the top finding (#1, NFKC vs BINARY collation) was independently filed by the quality reviewer as public #241 earlier the same day, so a confidential security re-file would not add value. None of the Phase-4 follow-on items are confidential either — all hygiene / defense-in-depth / dev-tree dependency bumps.

### 2026-05-17 findings — stack ranked by risk score

| ID | File:Line | OWASP / CWE | Risk (I x L x 4) | Severity | Confidential | Issue | Status |
|---|---|---|---|---|---|---|---|
| **S-2026-05-17-01** | `internal/profilestore/schema.go:26` + `sqlite.go:605-657` + `handlers_profiles_crud.go:60-70` + `src/components/profiles/ProfileEditorModal.tsx:70-80` | A04 / CWE-1289 | **48** (3 x 4 x 4) | **High** | NO (already-public on #241) | [#241](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/241) | **Closed (2026-05-17)** — `bf0c571` — Go authority `profilestore.NormalizeProfileName` (NFKC+trim+lower) mirrors the SPA `nameIsDuplicate` norm helper. `Put` / `Patch` pre-flight a normalised uniqueness check against the (scope, owner) bucket before INSERT/UPDATE; NFKC- or case-equivalent duplicates surface as `ErrConflict`. Cross-stack contract file + Go test + TS test pin the agreement; `TestNormalizeProfileName_DuplicateBypassClosed` pins the security behaviour. |
| **S-2026-05-17-02** | `internal/server/ws_lsp.go:95-108` + `internal/server/ws_query` (generated) | A05 / CWE-1385 | **36** (3 x 3 x 4) | **Medium** | NO | [#265](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/265) | **Closed (2026-05-17)** — `8880d12` (`/ws/lsp`) + upstream genapi `7dfda0d` (`SameOriginOnly` in `wsx.Options`) + `6bab5f6` (geode-ui adoption) + Phase 5 `a758ac4` (cmd-level WS Origin allowlist test against generated `/ws/query` handler — 403 + `wsx: origin not allowed`). All three WebSocket surfaces (`/ws/lsp`, `/ws/ping`, `/ws/query`) now default-deny cross-origin upgrades and accept the SPA's own origin via runtime same-origin synthesis. Pinned by `internal/server/ws_lsp_test.go::{Rejects,Accepts}CrossOriginUpgrade`, upstream `pkg/wsx/ws_test.go::TestUpgradeStrict_SameOriginOnly_*` (5 new cases), and `cmd/server/main_test.go::TestWSQueryRejectsCrossOriginUpgrade` (Phase 5 cmd-level pin). |
| **S-2026-05-17-03** | `internal/server/auth.go:88-104` | A02 / CWE-598 | **36** (3 x 3 x 4) | **Medium** | NO | [#71](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/71) | **Closed (2026-05-17)** — `ff7f388` — refusal logic now staged at `extractToken`: when `time.Now() >= AccessTokenSunsetTime` AND the path is NOT a `/ws/*` upgrade, the `?access_token=` query fallback is rejected with `errAccessTokenQuerySunset` (returned as 401). WS upgrades stay exempt because browsers cannot attach the Authorization header to the upgrade request. `init()` parses the date once and panics on typo so the constant cannot silently desync. Three new tests pin pre-sunset, post-sunset REST, and post-sunset WS behaviour. |
| **S-2026-05-17-04** | `src/App.tsx:152-166` + `src/pages/AdminPage.tsx:42-76` + `src/components/layout/Shell.tsx:274,301` | A01 / CWE-285 | **24** (2 x 3 x 4) | **Medium** | NO | [#264](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/264) | **Closed (2026-05-17)** — `9a787d8` (RoleGate component) + Phase 5 `3bcba7d` (App-level non-admin redirect smoke test in `__tests__/App.test.tsx::redirects authenticated non-admin away from /admin (issue 264)`). New `RoleGate` component wraps the `/admin` parent route; non-admin callers redirect to `/` with the original location in router state. Shell conditions the Admin nav link on `useAuth().isAdmin`. `RoleGate.test.tsx` + `Shell.test.tsx::hides the Admin nav link` pin the chrome behaviour. Server-side authority unchanged. |
| **S-2026-05-17-05** | `internal/server/security_headers.go:55-65` | A05 / CWE-1021 | **24** (2 x 3 x 4) | **Medium**\* | NO | [#266](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/266) | **Closed (2026-05-17)** via `d914df6` (CSP fix) + Phase 5 `f60f1a2` (doc-side SLA sync). Dropped the bare `wss:` token from the CSP `connect-src` directive. Same-origin wss:// (e.g. `/ws/query`, `/ws/lsp`) continues to work under `'self'`. New `TestCSPDirective_ConnectSrcOmitsWildcardWss` pins the omission so a regression can't silently re-introduce the wildcard. |
| **S-2026-05-17-06** | `deploy/Dockerfile:53` + `.gitlab-ci.yml:45,320` | A06 / CWE-1395 | **16** (2 x 2 x 4) | **Low** | NO | [#233](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/233) | **CROSS-LINKED** — `golang:1.26-alpine` floating tag, but `GOTOOLCHAIN=go1.26.3` pins the Go compiler version explicitly in both files. Residual risk is base-image apk drift (libc, git, etc.). Phase-4 follow-on (note 3356242415) posted the **enumerated phased remediation plan**: Phase 1 production (5 refs + #280 release-cli folding in = 6 refs); Phase 2 CI (9 refs); Phase 3 test (1 ref). **Total 16 unpinned refs + 1 reference convention (deploy/geode/Dockerfile.geode:41).** S-2026-05-17-12 / #280 (release-cli:latest) folds into Phase 1 of this issue. Earlier note (3355781013) recommended the `node:22-alpine@sha256:<digest>` pattern. |
| **S-2026-05-17-07** | `src/lib/passwordPolicy.ts:33-93` + `internal/server/password_policy.go:80-112` | A04 / CWE-1390 | **16** (2 x 2 x 4) | **Low** | NO | [#242](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/242) | **Closed 2026-05-17 (CO-242)** via `5e54315` — `contracts/password-policy.contract.json` bumped to `version: 2` with a new `adversarialVectors` map: `fullwidthUsername` (ＡＬＩＣＥ vs `alice`), `cjkDigits` (０１２...), `nbspPassword` (NBSP padding), `nbspAllSame` (all-NBSP triggers the weak-pattern rule). The contract pins the policy's CURRENT ASCII-only behaviour; each vector carries a `policyComment` explaining why the documented outcome is intentional. Mirror tests added on both sides: `password_policy_contract_test.go::TestPasswordPolicyContract_AdversarialVectors` (4 subtests) and `src/lib/passwordPolicy.contract.test.ts` `adversarial Unicode vectors (CO-242)` describe (4 cases). A future NFKC regression trips BOTH suites. |
| **S-2026-05-17-08** | `cmd/server/app_test.go:186,203,217,471` | (test) / CWE-798 (categorical) | **8** (1 x 2 x 4) | **Low** | NO | [#267](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/267) | **Closed (2026-05-17)** via `755ede6` (rename + detector) + Phase 5 `9823965` (doc-side sync). Renamed all four `adminUsers: "geode"` fixtures to `"test-admin"`. New `TestNoLiteralGeodeAdminFixture` self-inspects the test file and trips on any future regression that re-introduces the product-name literal; the detector assembles the forbidden token at runtime from substrings so it does not match its own source. |
| **S-2026-05-17-09** | `.gitignore` + `.gitleaks.toml` + `.scratch/triage/recon-conn.json:5`, `.scratch/triage/ui-login-400.json:37,42` | A05 / CWE-538 | **24** (2 x 3 x 4) | **Medium** | NO | [#272](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/272) | **Closed 2026-05-17** via `b0e7cc6` — `.gitignore:76` added `/.scratch/` (verified via `git check-ignore -v .scratch/triage/foo.json` exit 0); `.gitleaks.toml::[allowlist].paths` extended with `'''\.scratch'''` so local gitleaks scans skip cached SAST artefacts. JWTs in fixtures are already expired (cannot be replayed); pre-commit-stage guard tracked separately as a follow-up if/when `.scratch/` is renamed. |
| **S-2026-05-17-10** | `internal/profilestore/crypto.go:25-31,57-93` | A02 / CWE-320 | **12** (3 x 1 x 4) | **Low** | NO | [#274](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/274) | **Closed 2026-05-17** via `8bc00af` — accepted the existing single-tier env-keyed DEK trust model under `ADR 0002` (`docs/adr/0002-profile-store-dek-trust-model.md`). ADR records: current model + crypto wire format + rotation flow (`-profilestore-rewrap-from`) + legacy-plaintext sentinel + explicit operator-owned-secret trust assumption + the three triggers that would force a migration to KEK→DEK (multi-tenant, HSM/KMS, federated key management) + the migration shape when those triggers fire. Linked from `SECURITY.md` (new "Profile-store at-rest encryption" bullet) + `SECURITY_GAP_ANALYSIS.md`. |
| **S-2026-05-17-11** | `package.json` (`css-minimizer-webpack-plugin` dep) | A06 / CWE-1395 | **12** (3 x 1 x 4) | **Low** | NO | [#277](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/277) | **Closed (2026-05-20)** — `package.json` bumped `css-minimizer-webpack-plugin` from `^6.0.0` to `^8.0.0`. `npm audit --omit=dev` reports zero vulnerabilities; `npm run build` still passes. |
| **S-2026-05-17-12** | `.gitlab-ci.yml:753` | A06 / CWE-1395 | **16** (2 x 2 x 4) | **Low** | NO | [#280](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/280) | **Closed 2026-05-17** via `8b01c57` — pinned to `registry.gitlab.com/gitlab-org/release-cli:v0.24.0@sha256:3f52d526f48e8d10625c722fa6d6423ee82aadeae1b1aa91f07b62551d96dacf` (digest resolved via `docker buildx imagetools inspect`). Added `image-pin: 2026-05-17 @ ...` marker so `scripts/check-image-pins.sh` covers the new pin. |
| **S-2026-05-17-13** | `cmd/server/app.go:298-302` + `cmd/server/profileseed.go:24-33` | A05 / CWE-400 | **6** (1 x 1 x 6) | **Low (info)** | NO | [#283](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/283) | **Closed 2026-05-17** via `c672d36` — added `TestRESTHandler_SlowReadClientTerminatedByTimeoutHandler` + `TestWSExemptTimeoutHandler_WSPathSurvivesPastRESTBudget` in `cmd/server/main_test.go`. Both tests use a real `httptest.NewServer` running the production `wsExemptTimeoutHandler` wrap, exercise a blocking handler, and assert the slow-read REST request gets terminated within budget+margin (503 + "request timed out") while the same wrap lets WS paths run past the budget. Verified the negative path: when the wrap is bypassed in a local mutation, the REST test fails on `context deadline exceeded`. |
| **S-2026-05-17-13** | `cmd/server/app.go:298-302` | A05 / CWE-400 | **6** (1 x 1 x 6) | **Info** | NO | [#283](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/283) | **Closed 2026-05-17** via `c672d36` (Phase 5) — same closure as the duplicate-cited row above; the regression test asserting slow-read REST clients are terminated by `TimeoutHandler` was added in `cmd/server/main_test.go`. |

\* `severity::low` label on #266 vs Risk score 24 / Medium — see Status column for the explanation. Both perspectives are valid; treat the score as the long-term roadmap signal and the label as the short-term triage signal.

### Findings that did NOT warrant new issues

| Phase 3 finding | Risk | Reason for no new issue |
|---|---|---|
| `/auth/logout` JTI-revoke silently swallows failures, no rate-limit | 8 (Low) | Re-read of `internal/server/handlers_auth.go:202-261` confirms the S-NEW-9 closure (2026-05-16) wires `bestEffortRevokeFromRequest` cleanly and emits `auth_logout` audit. The "silently swallows failures" wording in Phase 3 is correct but **intentional** — see the in-line comments at lines 211-214 explaining the security rationale (no benefit to announcing token-recognition failures). No rate-limit is acceptable for an idempotent POST-only endpoint. **No issue filed; no action.** |
| No CI `npm ci --frozen-lockfile` enforcement + no SBOM | 8 (Info) | Re-read of `.gitlab-ci.yml` confirms `npm ci` (which IS frozen-lockfile semantics by definition — `npm ci` requires `package-lock.json` and refuses to update it) is used at lines 95, 245, 364, 593, 594, 690, 707, 725. `ci-catalog/sbom-generate@v1.7.1` and `ci-catalog/sbom-scan@v1.7.1` are wired at lines 13-14. Phase 3 wording is incorrect on both counts. **No issue filed; no action.** |

### Dropped (Phase 4 2026-05-17)

The Phase-3 cohort proposed S-2026-05-17-09 through S-2026-05-17-16. Two of those collapsed to dedupe and two were dropped after end-to-end re-validation:

| Phase 3 ID | Title | Reason for drop |
|---|---|---|
| **NEW-2** | File-upload MIME validation | **Not a gap.** End-to-end review shows no downstream consumer of staged uploads — no `exec`, no archive parsing, no SQL parser fed from staged files. The v0.5.x Geode wire dialect does not have `RESTORE` / `MIGRATION` verbs that would consume server-side files. Logged here as "would-be-nice hardening when those verbs land" but not a tracked S-ID. **No issue filed; no action.** |
| **NEW-4** | `golang.org/x/net@v0.52.0` upgrade (potential CVE chain) | **Not a gap today.** `govulncheck` reports the relevant call paths as unreached. The advisory is real but not exploitable from the current binary surface. Folds into the routine CI dependency-bump cadence, not a security gap. **No issue filed; no action.** |

The remaining Phase-3 IDs deduplicated as follows:

- S-09 (`.scratch/` gitignore) and S-13 (`.scratch/` JWTs) merged into a **single** S-2026-05-17-09 / #272 — one umbrella issue per root cause (unignored `.scratch/` containing JWT fixtures).
- Net Phase-4 follow-on: **5 new issues filed** (S-09..S-13 mapped to #272/#274/#277/#280/#283).

### 2026-05-17 — regression check of previously-closed items

| Closed item | Issue | Spot-check at 2026-05-17 | Verdict |
|---|---|---|---|
| F2 — `/auth/login` rate-limit | #58 | `internal/server/loginlimiter.go` still wired, XFF-spoofing closure (S-NEW-5) intact at `clientIP()` | **PASS** |
| F4 — CSP / COOP / Permissions-Policy | #60 | `internal/server/security_headers.go` still emits CSP+COOP on SPA HTML; `connect-src wss:` widening is the S-2026-05-17-05 follow-up | **PASS** (with the new `wss:` tighten follow-up) |
| F7 — Cookie-mode JWT + CSRF | #62 | Auth cookie `SameSite=SameSiteStrictMode` still set at `handlers_auth.go:227` | **PASS** |
| N2 — Durable JWT revocation | #64 | `RevocationSet.AttachSQLite` + JTI emission + revoke-on-password-change + S-NEW-9 logout-side revoke all intact | **PASS** |
| S5 — Profilestore at-rest encryption | #118 | AES-256-GCM `Cipher` still in `internal/profilestore/crypto.go`; `OpenSQLiteEncrypted` wiring intact | **PASS** |
| S-NEW-2 — admin-users default | #202 | `cmd/server/app.go:89` flag defaults to `""`; `TestParseFlags_AdminUsersDefaultEmpty` pins it; admin_bootstrap audit emits on every newApp | **PASS** |
| S-NEW-9 — Logout-side JTI revoke | #205 | `bestEffortRevokeFromRequest` wired into `HandleLogout` at lines 215-220; emits `auth_logout` audit | **PASS** |
| S-NEW-3 — auth shim removal | #209 | `internal/server/auth.go:60-83` now stashes `*securex.Claims` via `securex.ContextWithClaims`; the legacy header re-set is removed (lines 77-82 document the removal) | **PASS** (closed via genapi v0.3.2 — re-verify when filing said the upstream `genapi#XXX` was the remaining blocker; current code shows the shim is already gone, so #209 itself may be closable — flagging for follow-up) |
| GO-2026-4918 — Go toolchain bump | #212 | `GOTOOLCHAIN=go1.26.3` in both `deploy/Dockerfile:54` and `.gitlab-ci.yml:323`; `scripts/check-go-toolchain.sh` guard still wired | **PASS** |

### 2026-05-17 — top 5 risk-ranked items (post-cohort)

1. **S-2026-05-17-01 (#241)** — Profile-name NFKC vs SQLite BINARY collation mismatch. Risk 48 / High. Owned by quality (#241) with security cross-link.
2. **S-2026-05-17-02 (#265)** — `/ws/lsp` (and `/ws/query`) `AllowAnyOrigin: true` — CSWSH defense-in-depth. Risk 36 / Medium. Filed today; needs upstream `genapi` coordination for `/ws/query`.
3. **S-2026-05-17-03 (#71)** — `?access_token=` query fallback still alive; 45 days to sunset 2026-07-01. Risk 36 / Medium. Refusal logic must be staged before sunset.
4. **S-2026-05-17-04 (#264)** — SPA `/admin/*` routes lack client-side role gate. Risk 24 / Medium. Defense-in-depth; server-side gates are correct.
5. **S-2026-05-17-09 (#272)** — `.scratch/` not gitignored; contains short-lived (expired) JWT fixtures. Risk 24 / Medium. Phase-4 follow-on. Easy fix: `.gitignore` + `.gitleaks.toml` + pre-commit guard.

(S-2026-05-17-05 / #266 dropped from the top 5 by the new Phase-4 follow-on entry; #266 Risk 24 still tracked under post-cohort items 6+.)

### 2026-05-17 — verdict

The cohort is **smaller and lower-impact than the 2026-05-13 cohort**. The dominant new pattern is **defense-in-depth tightening on already-mitigated surfaces** rather than novel vulnerability classes — the team's prior closure cadence (Audit-2026-05-11 and -13 cohorts) has already addressed the obvious attack chains. No active RCE, no leaked production secrets, no privilege-escalation path open. No findings warrant CVE filing.

### 2026-05-17 — immediate actions

- **None requiring secret rotation.** No live credentials surfaced. The three JWT fixtures under `.scratch/triage/` are already expired; rotation is hygiene-only.
- **None requiring immediate code change for active exploit mitigation.**
- **Coordinate (within 30 days):** S-2026-05-17-03 (#71) — confirm `?access_token=` refusal logic is staged for 2026-07-01 sunset (45 days from today). Review S-NEW-6 (#206) audit data to confirm zero legitimate traffic remains.
- **Within 30 days:** S-2026-05-17-01 (#241) — owned by quality; needs cross-stack `normalizeProfileName` helper + migration. **S-2026-05-17-09 (#272)** — add `.scratch/` to `.gitignore` + `.gitleaks.toml` + pre-commit guard (Phase-4 follow-on; quick win — same-day fix).
- **Within 90 days:** (all earlier items already Closed). Note: S-2026-05-17-02 / #265 already Closed — all three WS surfaces default-deny cross-origin upgrades; cmd-level pin added 2026-05-17. S-2026-05-17-04 / #264 already Closed via `9a787d8` — `RoleGate` wraps `/admin/*`; App-level smoke added 2026-05-17. S-2026-05-17-05 / #266 already Closed via `d914df6` — bare `wss:` removed from CSP `connect-src`.
- **Backlog:** S-2026-05-17-06 (#233 already filed; Phase-4 follow-on enumerated 16 unpinned refs + phased remediation), S-2026-05-17-07 (#242 already filed; Phase-4 follow-on reclassified as missing-case), S-2026-05-17-10 (#274, **Closed 2026-05-17** via ADR 0002), **S-2026-05-17-11 (#277)** (css-minimizer-webpack-plugin dev-tree bump), S-2026-05-17-12 (#280, **Closed 2026-05-17** via release-cli:v0.24.0 + digest pin), S-2026-05-17-13 (#283, **Closed 2026-05-17** via the slow-read regression test in `cmd/server/main_test.go` exercising `wsExemptTimeoutHandler` end-to-end with an `httptest.NewServer`). Note: **S-2026-05-17-08 (#267) was already Closed via `755ede6`** (renamed fixtures to `test-admin`, added `TestNoLiteralGeodeAdminFixture`); the GitLab tracker label was the only state still showing Open and is being synced. All remaining Low / Info; bundle with the next routine hardening sprint.
- **Follow-up to verify:** S-NEW-3 (#209) — current code shows the shim is already removed; the issue may be eligible for closure. Quick read confirms it's gone; suggest re-validating against the original issue body before closing.

---

## 2026-05-19 audit cohort

**Audit:** /codepros:audit Phase 3 → Phase 4 tracking (Audit-2026-05-19 cohort)
**Branch reviewed:** `main` @ HEAD (2026-05-19)
**Scope:** Adversarial security review of auth, web/API, input handling, supply chain, operational surfaces against the post-2026-05-17 closure tree.

### 2026-05-19 findings — stack ranked by Risk Score

| Rank | ID | Severity | Risk (I × L × 4) | Title | Issue | Confidential | File:Line | OWASP / CWE | Confidence | Status |
|------|----|----------|------------------|-------|-------|--------------|-----------|-------------|------------|--------|
| 1 | **S-NEW-A** | High | **48** (4 × 3 × 4) | `authenticateUpstream` returns nil roles — admin gate stale after `CREATE USER ROLE admin` | [#300](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/300) | **YES** | `internal/server/handlers_auth.go:333`; `cmd/server/app.go:310-322` | A01 / CWE-285 | confirmed | **Partial — Scope-A Closed (2026-05-19)** via `71352b2` (`auth_role_resolved` audit event from `adminRolesFor` with `source=bootstrap`); Scope-B (real SHOW USERS ROLES upstream role discovery) remains Open — blocked on upstream Geode. Issue #300 stays open pending Scope-B. |
| 2 | **S-NEW-B** | Medium | **32** (4 × 2 × 4) | `-admin-users` CSV case-sensitive and not NFKC-normalised | [#304](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/304) | no | `cmd/server/app.go`; `internal/server/handlers_auth.go`; `internal/server/admin_normalise.go` | A01 / CWE-178 | suspected | **Closed** — NFKC + Unicode case-fold via shared `server.NormaliseAdminLookupKey` at both ingestion + lookup sites. |
| 3 | **S-NEW-J** | Medium | **32** (4 × 2 × 4) | `docker-compose.test.yml` `GEODE_PROFILESTORE_KEY` default is 32 zero bytes | [#322](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/322) | **YES** | `deploy/docker-compose.test.yml:124` | A07 / CWE-798 | confirmed | **Closed (2026-05-19)** via `1cde6ba` — `${VAR:?msg}` required form in compose; `make e2e-env` generates per-checkout `deploy/.env.test` with `openssl rand`; `scripts/check-compose-secrets.mjs` pre-commit gate. See `GAP_ANALYSIS_RESOLVED.md` "Closure cohort 2026-05-19". |
| 4 | **S-NEW-K** | Medium | **32** (4 × 2 × 4) | `docker-compose.test.yml` `JWT_SECRET_HEX` default is hardcoded `0123…cdef` | [#323](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/323) | **YES** | `deploy/docker-compose.test.yml:129` | A07 / CWE-798 | confirmed | **Closed (2026-05-19)** via `1cde6ba` — same supply-chain hardening as #322; `JWT_SECRET_HEX` default stripped; per-checkout `.env.test` provides a freshly random value. See `GAP_ANALYSIS_RESOLVED.md` "Closure cohort 2026-05-19". |
| 5 | **S-NEW-C** | Medium | **24** (2 × 3 × 4) | Post-2026-07-01 sunset: `?access_token=` logout becomes silent no-op (defeats S-NEW-9 / #205) | [#308](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/308) | no | `internal/server/handlers_auth.go:215,245`; `auth.go:104-118` | A07 / CWE-613 | confirmed | **Closed (2026-05-19)** via `36661d7` — `extractTokenForRevoke` (sunset-exempt) keeps post-2026-07-01 logout-side `?access_token=` revoke working; preserves S-NEW-9 / #205 nuisance-replay defense. See `GAP_ANALYSIS_RESOLVED.md` "Closure cohort 2026-05-19". |
| 6 | **S-NEW-I** | Medium | **24** (2 × 3 × 4) | `injectAuthIntoInitialize` — no depth/size cap on LSP initialize JSON re-emit (authenticated DoS) | [#321](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/321) | no | `internal/server/ws_lsp.go` | A04 / CWE-1287 + CWE-770 | suspected | **Closed** — 64 KiB size cap + 32-level nesting cap; oversized / pathologically-nested bodies short-circuit before unmarshal. |
| 7 | **S-NEW-E** | Low | **16** (2 × 2 × 4) | JWT kid rotation does not mass-revoke legacy tokens (operator-expectation gap) | [#313](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/313) | no | `internal/jwt/jwt.go` | A02 / CWE-294 | confirmed | **Closed** — new `Issuer.RotateAndRevokeAll(newKID, secret)` atomically replaces the keys map; prior-kid tokens hard-fail in Parse. |
| 8 | **S-NEW-F** | Low | **16** (2 × 2 × 4) | `peekLoginCreds`: multipart/form-data falls through, limiter bucket desyncs from inner Login | [#317](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/317) | no | `internal/server/loginlimiter.go` | A07 / CWE-799 | suspected | **Closed** — Content-Type gate; only `application/x-www-form-urlencoded` bodies are peeked; everything else lands in the IP-fallback bucket. |
| 9 | **S-NEW-D** | Low | **8** (2 × 1 × 4) | Login min-failure-latency floor bypassed on JWT-issuer-nil / Profiles-nil 500 paths | [#310](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/310) | no | `internal/server/handlers_auth.go` | A07 / CWE-208 | suspected | **Closed** — `authStart` captured at function entry; both misconfig 500 paths now run the same `respectLoginLatencyFloor`. |
| 10 | **S-NEW-G** | Info | **8** (1 × 2 × 4) | CSRF middleware exempts `/api/v1/auth/logout` — defense-in-depth gap (mitigated by SameSite=Strict) | [#318](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/318) | no | `internal/server/csrf.go` | A01 / CWE-352 | confirmed | **Closed** — exemption removed; SPA already attached the token, so server-side enforcement is a no-op for honest clients and a hard block for cross-site posts. |
| 11 | **S-NEW-L** | Low | **8** (2 × 1 × 4) | GO-2026-4918: `golang.org/x/net@v0.52.0` indirect (fixed in v0.53.0); unreached today | [#324](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/324) | no | `go.sum`, `go.mod` | A06 / CWE-835 | confirmed | **Closed** — `go.mod`: x/net v0.52.0 → v0.53.0 (and x/crypto v0.50.0, x/text v0.36.0 per `go mod tidy`). |
| 12 | **S-NEW-M** | Info | **8** (1 × 2 × 4) | `emitAudit` in `rejectLogin` includes `key` with embedded NUL byte (possible SIEM truncation) | [#325](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/325) | no | `internal/server/profilelimiter.go` | A09 / CWE-117 | suspected | **Closed** — `auditableActorKey` replaces NUL with a printable pipe before the audit emit; in-memory limiter map keeps the NUL for namespace disambiguation. |
| 13 | **S-NEW-H** | Info | **4** (1 × 1 × 4) | `mcpx.SetAuthVerifier` is process-wide global (embedding-only architectural risk) | [#320](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/320) | no | `gen/pkg/mcpx/engine.go:221-227` | A05 / CWE-1357 | confirmed | **Closed as accepted-risk (2026-05-20)** — the global lives in the genapi-generated `gen/pkg/mcpx` package, not in geode-ui source. Geode-ui runs as a standalone binary with exactly one `cmd/server` entrypoint and one `mcpx.SetAuthVerifier` call (`cmd/server/app.go`), so the global cannot collide in this deployment. The embedding-only failure mode requires another binary to import genapi's `mcpx` AND embed geode-ui as a library AND call SetAuthVerifier from both — out of scope for the project today. Tracked as a genapi follow-up (refactor `authVerifier` from package-global to per-Server field) outside this repo's commit cadence. Re-open here if multi-tenant embedding becomes a goal. |

**Severity counts (2026-05-19 cohort):** Critical 0 | High 1 | Medium 5 | Low 4 | Info 3 | **Total 13**.
**Confidential issues:** S-NEW-A (#300), S-NEW-J (#322), S-NEW-K (#323) — 3 of 13. Filed `--confidential` because each describes either an authorization-staleness exploit path or a hardcoded-credential operator-misuse class.

### 2026-05-19 findings by area

**Auth / Authorization:** S-NEW-A (#300), S-NEW-B (#304), S-NEW-C (#308), S-NEW-D (#310), S-NEW-E (#313)
**Web / API:** S-NEW-F (#317), S-NEW-G (#318), S-NEW-H (#320)
**Input handling:** S-NEW-I (#321)
**Supply chain / Infra:** S-NEW-J (#322), S-NEW-K (#323), S-NEW-L (#324)
**Operational / Observability:** S-NEW-M (#325)

### 2026-05-19 — top 5 Risk-Score findings

1. **S-NEW-A (#300, confidential)** — `authenticateUpstream` returns nil roles. Risk 48 / High. Admin authority sourced solely from bootstrap `-admin-users` allowlist; post-boot `CREATE USER ROLE admin` grants are silently denied, post-boot `DROP USER ROLE admin` revocations don't reach existing JWTs until natural expiry. Fix: real upstream role-discovery OR document the bootstrap-only contract + audit-emit. SLA 2026-06-18.
2. **S-NEW-B (#304)** — `-admin-users` CSV case-sensitive, no NFKC. Risk 32 / Medium. Suspected. Confirm by cross-reading Geode's username normalisation rules; if Geode normalises and this server doesn't, the gap is real. Fix: reuse the existing `profilestore.NormalizeProfileName` helper (Phase-5 closed #241 with that helper) at bootstrap + login.
3. **S-NEW-J (#322, confidential)** — `GEODE_PROFILESTORE_KEY` default = 32 zero bytes in test compose. Risk 32 / Medium. Operator-misuse class. Fix: remove the default; require explicit env var or secrets manager.
4. **S-NEW-K (#323, confidential)** — `JWT_SECRET_HEX` default = `0123…cdef` in test compose. Risk 32 / Medium. Operator-misuse class. Fix: remove the default; require explicit env var or secrets manager; consider startup low-entropy rejection.
5. **S-NEW-C (#308)** — Post-sunset logout silently no-ops for `?access_token=` clients. Risk 24 / Medium. Defeats S-NEW-9 / #205 nuisance-replay defense. **Must land before 2026-07-01 sunset** — 43 days from filing.

### 2026-05-19 — roadmap

**Quick wins (< 1 day):**

- S-NEW-J / #322 — remove `GEODE_PROFILESTORE_KEY` default from compose.
- S-NEW-K / #323 — remove `JWT_SECRET_HEX` default from compose.
- S-NEW-L / #324 — `go get golang.org/x/net@v0.53.0` + `go mod tidy`.
- S-NEW-G / #318 — drop the `/api/v1/auth/logout` CSRF exemption or pin SameSite=Strict dependency in a code-comment.

**Medium (1–5 days):**

- S-NEW-B / #304 — wire NFKC+lower normaliser at bootstrap + login.
- S-NEW-C / #308 — extend `extractToken` for logout-specific bypass OR add post-sunset legacy-shape audit. **Land before 2026-07-01 sunset.**
- S-NEW-I / #321 — cap LSP `initialize` body size + typed-struct + RawMessage pass-through.
- S-NEW-D / #310 — convert bootstrap-misconfig nil branches into startup invariants OR extend latency-floor wrap to the 500 paths.
- S-NEW-F / #317 — extend `peekLoginCreds` to parse multipart bodies (or reject multipart login with 415).
- S-NEW-M / #325 — replace NUL separator with printable representation in `emitAudit`.

**Strategic (> 5 days):**

- S-NEW-A / #300 — wire real upstream role discovery (preferred) OR document bootstrap-only contract + admin-resolution audit.
- S-NEW-E / #313 — add `RotateAndRevokeAll` API on `Issuer` (preferred) OR runbook entry under #179.
- S-NEW-H / #320 — upstream genapi PR to remove the process-wide global verifier.

### 2026-05-19 — immediate actions

- **None requiring secret rotation.** The compose defaults are test-only and have not (per current scan) reached production deploys. Confirm with operator before closing — if any production deploy ever inherited the compose default, rotate both `GEODE_PROFILESTORE_KEY` and `JWT_SECRET_HEX`.
- **None requiring immediate code change for active exploit mitigation.** No active RCE, no live leaked credentials, no privilege-escalation path open without operator action.
- **Coordinate before 2026-07-01 (43 days):** S-NEW-C / #308 must land before the `?access_token=` sunset to preserve the S-NEW-9 / #205 logout-side revocation contract for legacy clients.
- **Cross-cohort observation:** S-NEW-A (#300) and the 2026-05-17 cohort's "RoleGate" closure (#264 / S-2026-05-17-04) are both rooted in the same admin-authority surface. The RoleGate gives correct client-side hiding for non-admins; #300 highlights that server-side authority remains bootstrap-only. Both need to be considered together when expanding the admin model upstream.

### 2026-05-19 — verdict

The 2026-05-19 cohort is **smaller than the 2026-05-17 cohort** and dominated by **defense-in-depth tightening + operator-misuse hardening** on already-mitigated surfaces. No novel vulnerability classes. The single High finding (S-NEW-A / #300) is an architectural authority-source clarification rather than an active exploit. No active RCE, no live leaked production secrets, no auth-bypass-without-operator-action. No findings warrant CVE filing.

---

## 2026-05-21 audit cohort

**Audit:** /codepros:audit Phase 1–3 → Phase 4 tracking (Audit-2026-05-21 cohort, **`--skip-issues` mode**)
**Branch reviewed:** `main` @ HEAD `1199648`
**Inputs:** `docs/audits/2026-05-21/security-inventory.md` · `docs/audits/2026-05-21/security-scan.md` · `docs/audits/2026-05-21/security-review.md`
**Scope:** Adversarial security review against the post-2026-05-19 closure tree. STRIDE-per-element + OWASP API 2023→2025 overlay.

> **Mode caveat.** This is a **docs-only** tracking pass. **No GitLab writes** were made. Items that would normally be filed as confidential GitLab issues (e.g. exploit-chain BOLA paths) are tracked in-doc only; no separate confidential filing exists for this cohort. If/when this is re-run without `--skip-issues`, the rows below become the canonical issue bodies.

### Scoring framework (codepros security-scoring)

`Risk Score = Impact (1–5) × Likelihood (1–5) × 4` (range 4–100). Confidentiality gate: any finding involving secrets, auth bypass, RCE, priv-esc, or a detailed exploit path would normally be filed `--confidential`; in this docs-only run those rows are marked **`would-be-confidential`** in the Confidential column.

### Scanner cross-check (Phase 2)

| Tool | Result | Confidence |
|---|---|---|
| gitleaks | 2 matches — both non-actionable (test literal + docs placeholder) | confirmed |
| govulncheck (Go, source) | 0 reachable across 251 OSV candidates | confirmed |
| npm audit `--omit=dev` | 0 advisories across 226 prod deps | confirmed |
| npm audit (full tree) | **15** dev-only (tar / webpack-dev-server / ws cluster) — see S1 | confirmed |
| gosec `./...` | 7 findings; 0 actionable (RFC 6455 SHA-1 nolint-tagged, LOW-conf string false-positives, operator-supplied paths in `gen/cmd/server`) | confirmed |
| semgrep (`p/security-audit p/golang p/javascript p/typescript p/react`) | 6 warnings; 0 actionable (config-gated `Secure`, intentional CSRF non-HttpOnly, HIBP/RFC SHA-1) | confirmed |
| shellcheck / hadolint / trivy / grype / syft / osv-scanner | not installed locally; CI pipeline runs SBOM-generate + SBOM-scan via `ci-catalog@v1.7.1` | n/a |

**Reclassification:** the dev-only npm cluster (tar / webpack-dev-server / ws — 15 advisories) is reclassified **MEDIUM at the dev-machine boundary** (open-LAN webpack-dev-server attack window + electron-builder release-host tar-extraction window) and **LOW at the CI boundary** (single-tenant per-pipeline; would require already-compromised CI variables to exploit). Production runtime image is unaffected (npm prod tree clean).

### 2026-05-21 findings — stack ranked by Risk Score

| Rank | ID | Severity | Risk (I × L × 4) | Title | Confidential | File:Line | OWASP / CWE | Confidence | Status |
|------|----|----------|------------------|-------|--------------|-----------|-------------|------------|--------|
| 1 | **A1** | Medium | **24** (3 × 2 × 4) | `POST /api/v1/users/{u}/password` not subject-bound — relies on upstream Geode RBAC alone | **would-be-confidential** (BOLA exploit path) | `internal/server/handlers_users.go:403-438`; `geode.json:204-210` | OWASP API1:2023 (BOLA) / CWE-639 | confirmed | **Open** — defense-in-depth fix: `if username != actr.Subject && !isAdmin { 403 }` gate at `handlers_users.go:404`. Issue creation deferred (`--skip-issues`). SLA: **30 days** (Medium) — by 2026-06-20. |
| 2 | **S1** | Medium (dev-machine) / LOW (CI) | **24** (3 × 2 × 4) dev-machine; **8** (2 × 1 × 4) CI | Dev-only npm cluster — `tar` <7.5.7 + `webpack-dev-server` <=5.2.3 + `ws` ≥8.0.0 <8.20.1 (15 advisories) | no | `package.json` devDependencies; scan §npm-audit (GHSA-34x7-hfp2-rc4v / GHSA-8qq5-rm4j-mr97 / GHSA-83g3-92jg-28cx / GHSA-79cf-xcqc-c78w / GHSA-58qx-3vcg-4xpx) | OWASP A06:2021 / CWE-22 (tar) + CWE-749 (webpack-dev-server) + CWE-908 (ws) | confirmed | **Open** — **recommended atomic MR**: bump `electron-builder 25.1.8 → 26.8.1` (semver-major; re-validate Authenticode signing pipeline on ssl.com side) + `webpack-dev-server@latest` (ws follows via npm dedup); `jest-environment-jsdom → 30.4.1` rides along. Reclassified UP from scanner default at dev-machine boundary. SLA: **90 days** (Medium dev-machine) — by 2026-08-19. |
| 3 | **S2** | Medium | **16** (2 × 2 × 4) | `ci-catalog/codesign-windows-ssl@~latest` floating ref in `.gitlab-ci.yml` | no | `.gitlab-ci.yml:34` | OWASP A06:2021 / CWE-829 | confirmed | **Open — mitigated** by `tag_only: true` + `allow_failure: true` on the job (codesign never gates a pipeline pass). Allowlisted via `scripts/check-ci-pins.sh` + TODO #127. **Unblock condition:** upstream ci-catalog publishes a tagged release of `codesign-windows-ssl` — flip the pin then. Cross-link [F-SUP-3 / #153](#audit-2026-05-11-cohort--full-tree-security-pass). |
| 4 | **A2** | Low | **8** (2 × 1 × 4) | WebSocket `AllowEmptyOrigin: true` on every WS route | no | `gen/ws/ws_handlers.gen.go:55,65`; `internal/server/ws_lsp.go:147` | OWASP A05:2021 / CWE-346 | confirmed | **Open** — defense-in-depth: refuse empty Origin on `/ws/query` (SPA is the only legitimate client). `/ws/lsp` operator-pinned upstream; same recommendation. JWT remains the actual authority. Cross-link [S-2026-05-17-02 / #265](#2026-05-17-audit-cohort) (closed). |
| 5 | **A4** | Low | **8** (2 × 1 × 4) | JWT revocation latency is best-effort on SQLite write failure | no | `internal/jwt/revocation.go:140-156` | OWASP A07:2021 / CWE-613 | confirmed | **Open — accepted-risk candidate.** Exposure bounded by TTL (default 8h, max 24h). Action: document in operator runbook (`docs/OPERATIONS.md`). |
| 6 | **A5** | Low | **8** (2 × 1 × 4) | Admin-bootstrap audit emits bare `-admin-users` list verbatim | no | `cmd/server/app.go:257-260` | CWE-532 | confirmed | **Open** — `admin_users` value is not in `obsx.DefaultSensitiveKeyFragments`; audit log becomes a registry of admin accounts. Action: extend the sensitive-key list OR hash the list before emit. |
| 7 | **W4** | Low | **8** (2 × 1 × 4) | HSTS `preload` emitted unconditionally — even on plaintext deployments | no | `gen/pkg/httpx/server.go:187` | OWASP A05:2021 / CWE-1004 (adjacent) | suspected (operationally documented) | **Open — genapi follow-up.** Recommendation: condition HSTS emission on `r.TLS != nil \|\| cfg.behindTrustedProxy`, or drop `preload` from default. Production deploys are expected to terminate TLS upstream (documented). |
| 8 | **W6** | Low | **8** (2 × 1 × 4) | `/api/v1/metrics` has no per-route rate limit | no | `internal/server/handlers_metrics.go:141`; `cmd/server/app_routes.go:90` | OWASP API4:2023 / CWE-770 | confirmed | **Open** — global per-IP 50 rps applies (≈50 rps amplifies upstream Prom load). Cheap fix: declare `rateLimit` in `geode.json` for the metrics route. |
| 9 | **W7** | Low | **8** (2 × 1 × 4) | Global per-IP limiter is `RemoteAddr`-only — collapses to proxy IP when `-trust-proxy-xff=true` | no | `cmd/server/app_csrf.go:42-44` | CWE-307 (adjacent) | confirmed | **Open — documented.** Action: align `PerIPSource` with `-trust-proxy-xff` setting OR document the asymmetry (login limiter trusts XFF, global per-IP does not). |
| 10 | **I1** | Low | **8** (2 × 1 × 4) | `sanitizeGraphName` silently strips disallowed runes (no rejection) | no | `internal/server/quoting.go:12-25` | CWE-20 / CWE-89 (adjacent, mitigated upstream) | confirmed | **Open** — silent strip masks caller intent. Action: make `sanitizeGraphName` strict (return error on disallowed rune). |
| 11 | **I2** | Low | **8** (2 × 1 × 4) | `promparse.ParseProm` has no per-family count or total-byte cap | no | `internal/server/promparse.go:85-125` | OWASP A05:2021 / CWE-400 + CWE-770 | confirmed | **Open** — defense-in-depth on operator-controlled `GEODE_METRICS_URL`. Action: cap family count (~1024) + cumulative bytes (~4 MiB). |
| 12 | **I3** | Low | **8** (2 × 1 × 4) | `splitCSVRespectingQuotes` doesn't handle backslash escapes | no | `internal/server/promparse.go:304-323` | CWE-1287 | confirmed | **Open** — limited impact (only `le` label is read), but a future use of label values inherits the bug. Documented in source as "escapes not handled". |
| 13 | **I7** | Low | **8** (2 × 1 × 4) | WS / REST query params accept arbitrary key names with no validation | no | `internal/server/ws_query.go:525-534`; `internal/server/sqlexec.go:71-87` | CWE-20 / CWE-89 (adjacent) | confirmed | **Open** — validate keys against `[A-Za-z_][A-Za-z0-9_]*` before forwarding to `sql.Named`. Cross-cuts I10 (size cap). |
| 14 | **I9** | Low | **8** (2 × 1 × 4) | Error responses leak driver `err.Error()` verbatim on query + metrics paths | no | `internal/server/handlers_query.go:118-138`; `handlers_metrics.go:171,179` | CWE-209 | suspected (depends on caller log handling) | **Open** — for MCP path specifically, consider redacting the statement bytes from error responses (agent-mediated callers may surface to end-users). |
| 15 | **I10** | Low | **8** (2 × 1 × 4) | `mapToNamedArgs` has no key-count / nesting-depth cap on WS params | no | `internal/server/ws_query.go:525-534`; `internal/server/sqlexec.go:71-87` | OWASP A05:2021 / CWE-400 + CWE-770 | confirmed | **Open** — 16 MiB WS frame cap is the upper bound; a 100k-key params blob still allocates aggressively. Combined remediation with I7. |
| 16 | **S3** | Low | **8** (2 × 1 × 4) | `zig build`-from-clone in e2e job has OR-fallback to less-specific repo path | no | `.gitlab-ci.yml:534-536` | OWASP A06:2021 / CWE-829 | suspected (depends on GitLab namespace control) | **Open** — recommendation: drop the OR-fallback; let pipeline fail-fast if canonical tag URL is unavailable. |
| 17 | **S4** | Low | **8** (2 × 1 × 4) | Test-fixture `JWT_SECRET_HEX` committed in `.gitlab-ci.yml` (allowlisted) | no | `.gitlab-ci.yml:525` | CWE-798 | confirmed | **Open** — pragma-allowlisted but the same hex is reused across every pipeline run. Recommendation: generate per-pipeline via `openssl rand -hex 32` through the `make e2e-env` mechanism that production-style runs already use. Cross-link [S-NEW-K / #323](#2026-05-19-audit-cohort) (closed for compose). |
| 18 | **S5** | Low | **8** (2 × 1 × 4) | `docker-compose.example.yml` ships HTTP-only on `:8080` with legacy `JWT_SECRET_HEX` env var | no | `deploy/docker-compose.example.yml:38-53` | CWE-319 | confirmed | **Open** — recommendation: add explicit `# REQUIRES upstream HTTPS terminator; see docs/OPERATIONS.md` banner; migrate example to the rotation-aware `JWT_SECRET_HEX_CURRENT` env var. |
| 19 | **W2** | Info | **4** (1 × 1 × 4) | CSRF token unbound to JTI / session | no | `internal/server/csrf.go:36-42,93-118` | CWE-352 (residual) | confirmed | **Open — accepted-risk.** Acknowledged follow-up (SEC-N2 historical). SameSite=Strict on both auth + CSRF cookies makes the cross-origin attach impossible; practical residual is "compromised same-origin renderer" which is already game over. |
| 20 | **W5** | Info | **4** (1 × 1 × 4) | CSP retains `style-src 'unsafe-inline'` for styled-components | no | `internal/server/security_headers.go:60` | CWE-1336 (adjacent) | confirmed | **Open — roadmap.** Roadmap to migrate to nonces is acknowledged in source. No user-controlled `<style>` content rendered today. |
| 21 | **O3** | Info | **4** (1 × 1 × 4) | `docker exec` / `kubectl exec` insider risk on `JWT_SECRET_HEX_CURRENT` + `GEODE_PROFILESTORE_KEY` env vars | no | `deploy/docker-compose.{example,test}.yml` | CWE-526 | confirmed | **Open — deployment-time.** Compensating control: source secrets from k8s Secret / Docker secret / external secret manager, not docker-compose env. Documented. |
| 22 | **O4** | Info | **4** (1 × 1 × 4) | Audit ring in-memory only (10k FIFO, process-local) | no | `internal/server/audit.go:109-118` | CWE-778 (adjacent) | confirmed | **Open — by design.** `slog` still writes to stdout; durable shipping is operator-owned. No code change required. |
| 23 | **O8** | Info | **4** (1 × 1 × 4) | `/api/v1/profiles/public` is anonymous; returns system-profile names + descriptions | no | `internal/server/handlers_profiles_public.go:21` | CWE-200 (residual, by design) | confirmed | **Open — by design.** Enables unauthenticated login UI to enumerate available profiles. Trade-off accepted by design. |

**Severity counts (2026-05-21 cohort, excluding "good practice; verified"):** Critical 0 | High 0 | Medium 2 | Low 11 | Info 5 | **Total 18 rows** (consolidating dev-machine vs CI views of S1 onto one row; the cohort's net adversarial findings are the 18 rows above).

**Would-be-confidential (`--skip-issues`):** A1 — recorded in-doc only. No GitLab confidential filing exists for this cohort.

### 2026-05-21 — dev-machine vs CI-host boundary note

The 15 dev-only npm advisories (S1 — `tar` / `webpack-dev-server` / `ws` cluster) have **two distinct exploit boundaries**:

| Boundary | Exploit window | Severity here |
|---|---|---|
| **Dev-machine** | `npm run dev` spawns `webpack-dev-server` on the developer LAN; a lure page on an open network can exploit GHSA-79cf-xcqc-c78w (CWE-749) to read `/sockjs-node`-mediated source maps or land XSS on `localhost:8080`. Coffee-shop / hot-desk environment is the bad case; trusted home/office LAN is fine. | **MEDIUM** |
| **CI release-host** | `tar` symlink-escape CVEs fire only when `electron-builder` extracts an archive at packaging time. Exploit requires landing a malicious archive into the electron-builder cache, which in turn requires already-compromised CI variables. Single-tenant per-pipeline. | **LOW** |

Production runtime image is **not affected** by either boundary — `npm audit --omit=dev` reports 0 advisories across 226 production deps (Monaco, Cytoscape, monaco-languageclient, vscode-ws-jsonrpc, React, Zustand, DOMPurify), confirmed in scan §npm-audit.

### 2026-05-21 — recommended atomic remediation MR (S1)

Single focused MR that closes the dev-machine + release-host residuals:

1. `package.json`: `electron-builder ^25.1.8` → `^26.8.1` (semver-major).
2. `package.json`: `webpack-dev-server` → `@latest`.
3. (Optional but rides along) `jest-environment-jsdom` → `^30.4.1`.
4. `package-lock.json`: regenerate via `npm install`.
5. Re-run `npm audit --omit=dev` → must report **0** advisories.
6. Re-validate the Authenticode signing pipeline end-to-end on the ssl.com side (electron-builder 26 has signing-flow changes vs 25).
7. The `ws` cluster (GHSA-58qx-3vcg-4xpx) **resolves transitively via npm dedup** once webpack-dev-server is current — no separate change required.

Acceptance criteria: `npm audit --omit=dev` and `npm audit` (full tree) both report 0 advisories; Authenticode signing job exits green on the next tag-only release; no production-runtime delta detectable in `internal/ui/dist/main.*.js`.

### 2026-05-21 — top 10 by Risk Score

1. **A1 (would-be-confidential)** — `POST /api/v1/users/{u}/password` not subject-bound. Risk 24 / Medium. CWE-639 / OWASP API1:2023 BOLA. Fix: subject-equality gate at `handlers_users.go:404`.
2. **S1** — dev-only npm cluster (tar / webpack-dev-server / ws — 15 advisories). Risk 24 / Medium **(dev-machine boundary)**, 8 / Low (CI). CWE-22 / CWE-749 / CWE-908. Fix: atomic 2-bump MR described above.
3. **S2** — `ci-catalog/codesign-windows-ssl@~latest` floating ref. Risk 16 / Medium (pin-on-tagged-release mitigates). CWE-829. Blocked on upstream tagged release.
4. **A2** — WS `AllowEmptyOrigin: true`. Risk 8 / Low. CWE-346.
5. **A4** — Revocation SQLite write-failure exposure. Risk 8 / Low. CWE-613.
6. **A5** — Admin-bootstrap audit list emitted verbatim. Risk 8 / Low. CWE-532.
7. **W4** — HSTS `preload` on plaintext. Risk 8 / Low. CWE-1004 adjacent.
8. **W6** — `/api/v1/metrics` no per-route limiter. Risk 8 / Low. CWE-770 / OWASP API4:2023.
9. **W7** — Global per-IP limiter collapses to proxy IP under XFF trust. Risk 8 / Low. CWE-307 adjacent.
10. **I1** — `sanitizeGraphName` silent strip. Risk 8 / Low. CWE-20.

### 2026-05-21 — findings by area

- **Auth / Authorization:** A1, A2, A4, A5
- **Web / API:** W2, W4, W5, W6, W7
- **Input handling:** I1, I2, I3, I7, I9, I10
- **Deserialization / Dynamic execution:** (all "good practice; verified" — no new findings; encoding/json/v2 throughout; no template engine; audit cannot escalate to 500)
- **Supply chain / CI/CD:** S1, S2, S3, S4, S5
- **Infrastructure / Operations:** O3, O4, O8 (O1 pprof loopback, O2 DEK lifecycle, O5 redaction list, O6 Electron hardening, O7 healthz — all "good practice; verified")

### 2026-05-21 — roadmap

**Quick wins (< 1 day):**

- A5 — add `admin_users` to `obsx.DefaultSensitiveKeyFragments` (or hash the list before emit) in `cmd/server/app.go:257-260`.
- A4 — operator-runbook doc note in `docs/OPERATIONS.md` about TTL-bounded exposure window on SQLite write failure.
- W6 — declare `rateLimit` for `/api/v1/metrics` in `geode.json`.
- I1 — flip `sanitizeGraphName` to strict-reject in `internal/server/quoting.go:12-25`.
- I2 — add family-count + total-byte caps in `internal/server/promparse.go:85-125`.
- S5 — add `# REQUIRES upstream HTTPS terminator` banner to `deploy/docker-compose.example.yml`; migrate to `JWT_SECRET_HEX_CURRENT`.
- S3 — drop the OR-fallback in `.gitlab-ci.yml:534-536`.

**Medium (1–5 days):**

- **A1** — subject-equality gate at `handlers_users.go:404`. **Defense-in-depth release-blocker for any future Geode RBAC regression. SLA 2026-06-20.**
- **S1** — atomic 2-bump MR (`electron-builder` + `webpack-dev-server`). **SLA 2026-08-19** (90d Medium dev-machine). Re-validate Authenticode pipeline.
- A2 — refuse empty Origin on `/ws/query` (cross-link upstream genapi change for `ws_handlers.gen.go`).
- I7 + I10 — validate WS/REST param key shape + add per-key count cap.
- I9 — redact statement bytes from MCP-path error responses.
- S4 — switch CI `JWT_SECRET_HEX` to per-pipeline `openssl rand -hex 32`.

**Strategic (> 5 days):**

- W4 — upstream genapi PR to condition HSTS emission on `r.TLS != nil`.
- W7 — align global per-IP limiter source with `-trust-proxy-xff` setting.
- W5 — migrate styled-components to CSP nonces (long-standing SEC-F4 follow-up).
- S2 — pin `codesign-windows-ssl` to an immutable ci-catalog tag once one ships (cross-link Q32 / #127).

### 2026-05-21 — immediate actions

- **None requiring secret rotation.** No live credentials surfaced. The 2 gitleaks matches are a test-literal (`Password: "wrong"`) and a documentation placeholder (`<GENERATE_WITH_openssl_rand_hex_32>`). The `.gitlab-ci.yml` test JWT secret (S4) is pragma-allowlisted by intent; recommendation is per-pipeline generation, not rotation.
- **None requiring immediate code change for active exploit mitigation.** No active RCE, no live leaked production secrets, no auth-bypass-without-operator-action.
- **Coordinate (within 30 days, by 2026-06-20):** **A1 subject-equality gate** at `handlers_users.go:404`. Filed in-doc only this run (`--skip-issues`). If the upstream Geode `ALTER USER` RBAC broadens silently, this defense-in-depth gate becomes the last line.
- **Coordinate (within 90 days, by 2026-08-19):** **S1 atomic 2-bump MR** (`electron-builder 25.1.8 → 26.8.1` + `webpack-dev-server@latest`; `ws` follows via dedup). Re-validate the Authenticode signing pipeline against the ssl.com side after the bump.
- **Cross-cohort observation:** A1 is the natural extension of [S-NEW-A / #300](#2026-05-19-audit-cohort) (`authenticateUpstream` returns nil roles) and [S-2026-05-17-04 / #264](#2026-05-17-audit-cohort) (RoleGate). All three trace to the admin-authority surface: #300 documents the bootstrap-only authority source, #264 closed the client-side admin chrome gate, and A1 surfaces a server-side subject-check gap on the password-change route. Sequencing of these three closures (S-NEW-A Scope-B, #264 already closed, A1 new) should be considered together when expanding the admin model upstream.

### 2026-05-21 — verdict

The 2026-05-21 cohort is **smaller than the 2026-05-19 cohort and dominated by defense-in-depth tightening on already-mitigated surfaces** (HSTS scheme handling, WS empty-origin tighten, metrics rate-limit, graph-name strictness, prom-parser size caps). The single notable new finding is **A1 — `POST /api/v1/users/{u}/password` not subject-bound** — which is bracketed by upstream Geode RBAC today but is a clean defense-in-depth one-line gate. The dev-only npm cluster (S1) reclassifies UP to **MEDIUM at the dev-machine boundary** because of the open-LAN webpack-dev-server attack window — production runtime image remains clean.

No active RCE. No live leaked production secrets. No privilege-escalation path open without operator action. No findings warrant CVE filing. This cohort is in-doc only — no GitLab issues filed in this run.

---

## 2026-05-21 follow-up — Profile-onboard trust-on-first-use

**Surface:** `POST /api/v1/profiles/onboard` (`internal/server/handlers_profiles_onboard.go`)

**Context:** the login-profile-ux feature (commits `b16512b..1ad3650`) added an
unauthenticated server endpoint that the SPA calls from the first-run landing
view and the Add-profile toggle on LoginPage. The endpoint accepts a profile
`name`, a `quic://` DSN, and an admin username + password, then opens a
short-lived `*sql.DB` against the supplied DSN to validate the credentials
before persisting the profile to the profile store and minting a JWT.

**Threat model — trust on first use (TOFU).** The endpoint does not check
whether the caller already controls the upstream Geode whose DSN they supply.
The implicit trust contract is: *if the caller can authenticate against the
upstream as an admin, they are entitled to register a profile pointing at that
upstream and to log into the SPA as that admin*. In the current deployment
shape — operators bringing up a geode-ui instance against geode clusters they
already own — this is the intended behaviour: operator-owned creds gating
operator-owned registration. Two non-obvious corollaries follow:

- **An attacker who possesses admin credentials for ANY reachable geode
  instance can add a profile pointing at it.** "Reachable" here means
  reachable from the geode-ui process, not from the public Internet — most
  deployments front geode-ui with a reverse proxy whose network neighbours
  are private. The attacker gains nothing beyond what the stolen creds already
  give them (the upstream itself is the authority), but they do gain a UI
  surface for them.

- **Profile rows are system-scope by default.** A successful onboard adds a
  row that every subsequent SPA visitor sees on the login picker. There is
  no review step. An operator who shares the SPA's URL with a co-worker can
  watch the co-worker arrive at a populated picker with profiles they did
  not configure if the co-worker (or any past visitor) onboarded their own.

**Mitigations already in place:**

- DSN is constrained to the `quic://` scheme; `file://`, `http://`,
  `gopher://`, etc. are rejected at validation time.
- Server-side DSN length cap at 1024 bytes (commit `0e7a643`) matches the SPA
  input maxLength and prevents pathological payloads from reaching `url.Parse`,
  `sql.Open`, or the audit pipeline.
- The 401 response on a failed probe is generic (`"upstream rejected the
  supplied admin credentials"`); no driver error string is echoed back, so the
  endpoint does not leak upstream reachability or infrastructure details
  through error-message timing oracles.
- Per-IP rate limit (follow-up #2 from the post-feature review — tracking
  separately) and audit events for every onboard attempt (follow-up #3) close
  the credential-spray and forensic-trail gaps respectively.

**Why not require existing-admin auth on the onboard route?** Bootstrapping.
The endpoint is designed for the zero-profile first-run case where no operator
has logged in yet because no profile exists to log into. Requiring an existing
JWT would create a chicken-and-egg paradox. The same endpoint serves the
"add another profile" flow from an authenticated SPA visit; that visit does
have a JWT (the SPA could attach it), but the server-side handler is
deliberately uniform — TOFU on every call — so the two entry points share a
single code path.

**Acceptance signal:** record this section as documentation that the next
SEC review (or the next operator onboarding a multi-tenant deployment) reads
before tightening the contract. If the deployment story shifts toward shared
geode-ui instances serving heterogeneous tenants, this endpoint MUST be
either (a) gated on a deployment-time `-allow-self-onboard=false` flag that
disables the route entirely, or (b) repointed at a one-shot bootstrap token
written to disk by the operator and consumed on first call (cf. Geode itself
generates a one-shot admin password file on `geode auth init`).

**Status:** TOFU is **accepted risk** in the current deployment shape and
documented here as the contract. Re-evaluate when the deployment story
changes.
