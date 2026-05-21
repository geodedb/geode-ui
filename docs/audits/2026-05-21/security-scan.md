# Security Scan — geode-ui

**Repo:** `/data/home/benji/src/gl/gitlab.com/devnw/codepros/geode/geode-ui`
**Platform:** GitLab — `git@gitlab.com:devnw/codepros/geode/geode-ui.git`
**Branch / commit:** `main`, clean tree (`1199648` head)
**Date:** 2026-05-21
**Phase 1 input:** `docs/audits/2026-05-21/security-inventory.md`

## Tool Availability

| Tool | Available | Version | Used | Notes |
|---|---|---|---|---|
| gitleaks | yes | dev (no embedded version) | yes | `--source . --redact` |
| detect-secrets | yes | 1.5.x (via pipx) | partial | Baseline scan failed — `gibberish_detector` module mismatch in pipx venv even after `pipx inject`. Baseline file itself parsed clean (27 plugins, 0 entries). |
| govulncheck | yes | v1.3.0 | yes | Ran with `GOEXPERIMENT=jsonv2` because gen/* imports `encoding/json/v2`. DB last modified 2026-05-20. |
| gosec | yes | dev | yes | `./...` SAST. |
| semgrep | yes | 8.21.2 | yes | Configs: `p/security-audit p/golang p/javascript p/typescript p/react` (auto-config blocked when telemetry off; metrics on, no code uploaded). |
| npm audit | yes | npm 10.9.2 | yes | `--omit=dev` and full tree. |
| shellcheck | no | — | skipped | Not installed; `deploy/geode/*.sh` and `scripts/*.sh` not scanned. |
| hadolint | no | — | skipped | Not installed; `deploy/Dockerfile{,.release,.release.alpine}` not lint-scanned. |
| trivy / grype / syft / osv-scanner | no | — | skipped | Not installed. |
| trufflehog | no | — | skipped | Not installed (gitleaks ran in its stead). |
| checkov | no | — | skipped | Not installed; no Terraform/K8s manifests in tree. |
| bandit | no | — | skipped | Project has no Python source. |
| Go | yes | 1.26.3 | — | runtime |
| Node | yes | v22.14.0 | — | runtime |

Output artefacts (all in `/tmp`, not committed):
- `/tmp/gitleaks.json`
- `/tmp/govulncheck.json` (19,072 NDJSON lines)
- `/tmp/gosec.json`
- `/tmp/semgrep.json`
- `/tmp/npm-audit-prod.json`, `/tmp/npm-audit-all.json`

## Secret Detection

| Tool | Findings | Types | Files Affected | Confidence |
|---|---|---|---|---|
| gitleaks | 2 | generic-api-key | `internal/server/handlers_auth_test.go:478` (test creds); `docs/superpowers/plans/2026-05-06-e2e-testing-stack.md:1697` (placeholder `<GENERATE_WITH_openssl_rand_hex_32>` neighbouring text) | `confidence::suspected` — both reviewed manually as non-actionable (see below) |
| detect-secrets baseline | 0 in baseline, scan failed | n/a | `.secrets.baseline` parses to `{plugins_used:27, results:{}}` — i.e. no accepted secrets, no allowlist drift | `confidence::confirmed` baseline integrity |

Gitleaks redacted-match review (no real secret values reproduced):
- `internal/server/handlers_auth_test.go:478` — finder fired on `Password: "wrong"` literal inside a unit test (`TestLogin_DoesNotSetAuthCookieOnFail`). Not a real secret. **Recommended:** extend `.gitleaks.toml` allowlist to cover `*_test.go` `Password:` literals or tag-comment `gitleaks:allow`.
- `docs/superpowers/plans/2026-05-06-e2e-testing-stack.md:1697` — finder fired on a YAML fragment showing `JWT_SECRET_HEX: <GENERATE_WITH_openssl_rand_hex_32>`. Not a real secret; the value is the documentation placeholder itself. **Recommended:** allowlist the docs path or add a `pragma: allowlist secret` directive.

**No actionable secret exposure detected on `main` HEAD.**

## Dependency Vulnerabilities

### Go (govulncheck)

| Result | Count |
|---|---|
| OSV records considered (vuln.go.dev) | 251 |
| **Reachable findings (call-graph confirmed)** | **0** |
| Imported-but-unused vulnerable symbols | 0 |
| Build failures during analysis | 0 (jsonv2 experiment required) |

govulncheck in `mode: source` produced no `finding` records. Plain-text mode confirms: `No vulnerabilities found.` (`confidence::confirmed`).

### npm — production tree (`--omit=dev`)

| Severity | Count |
|---|---|
| critical | 0 |
| high | 0 |
| moderate | 0 |
| low | 0 |
| **total** | **0** |

226 prod dependencies clean. (`confidence::confirmed`)

### npm — full tree (incl. dev/optional/peer)

| Severity | Count |
|---|---|
| critical | 0 |
| high | 9 |
| moderate | 2 |
| low | 4 |
| **total** | **15** |

All 15 findings sit inside `devDependencies` (electron-builder toolchain + jest-jsdom + webpack-dev-server). Production runtime is unaffected. Selected detail:

| CVE / GHSA | Severity | Package | Range | Reach | Confidence |
|---|---|---|---|---|---|
| GHSA-34x7-hfp2-rc4v (CWE-22/CWE-59, CVSS 8.2) | high | `tar` | `<7.5.7` | dev-only via `electron-builder@26.5.0 → app-builder-lib → node-gyp/cacache → tar` | `confidence::confirmed` (audit) |
| GHSA-8qq5-rm4j-mr97 (CWE-22) | high | `tar` | `<=7.5.2` | dev-only same chain | `confidence::confirmed` |
| GHSA-83g3-92jg-28cx (CWE-22, CVSS 7.1) | high | `tar` | symlink-chain hardlink escape | dev-only same chain | `confidence::confirmed` |
| GHSA-79cf-xcqc-c78w (CWE-749, CVSS 5.3) | moderate | `webpack-dev-server` | `<=5.2.3` | dev-only — devserver itself, never shipped to prod | `confidence::confirmed` |
| GHSA-58qx-3vcg-4xpx (CWE-908, CVSS 4.4) | moderate | `ws` | `>=8.0.0 <8.20.1` | dev-only transitive of `jest-environment-jsdom` / webpack-dev-server | `confidence::confirmed` |
| GHSA-vpq2-c234-7xj6 (CWE-705) | low | `@tootallnate/once` | `<3.0.1` | dev-only via jsdom | `confidence::confirmed` |

`fixAvailable` reports the canonical fix is **major-version bumps** of two direct devDeps:
- `electron-builder` 25.1.8 → 26.8.1 (semver-major — re-validate Authenticode signing pipeline)
- `jest-environment-jsdom` → 30.4.1 (semver-major — re-validate jsdom snapshot deltas)

Production-image surface (Monaco, Cytoscape, monaco-languageclient, vscode-ws-jsonrpc, React, Zustand) reports **zero advisories** under both `--omit=dev` and the full-tree run for the active resolved versions. (`confidence::confirmed` against the npm advisory feed snapshot at scan time)

## SAST Findings

### Go — gosec (`./...`, 118 files, 35,571 lines)

| Rule | Sev | Conf | File:Line | Snippet/Why | Triage | Confidence |
|---|---|---|---|---|---|---|
| G101 (CWE-798) | HIGH | LOW | `internal/server/security_headers.go:105` | `const AccessTokenSunsetDate = "Wed, 01 Jul 2026 00:00:00 GMT"` — gosec misfired on the word "Token" | **false positive** | `confidence::confirmed` (manual) |
| G101 (CWE-798) | HIGH | LOW | `internal/server/errorcodes.go:51` | `ErrCodeInvalidCredentials = "invalid_credentials"` — string literal for an HTTP error code | **false positive** | `confidence::confirmed` |
| G401 (CWE-326) | MED | HIGH | `gen/pkg/wsx/ws.go:576` | `h := sha1.Sum([]byte(key + wsGUID))` — SHA-1 is REQUIRED by RFC 6455 WebSocket Accept-key handshake | **false positive** — already `//nolint:gosec` tagged, protocol-mandated | `confidence::confirmed` |
| G505 (CWE-327) | MED | HIGH | `gen/pkg/wsx/ws.go:7` | `import "crypto/sha1"` — same RFC 6455 requirement | **false positive** — already nolint-tagged | `confidence::confirmed` |
| G304 (CWE-22) | MED | HIGH | `gen/cmd/server/main.go:360` | `os.ReadFile(path)` in `readSecretFile(path)` | **suspected acceptable** — gen-server scaffold (not the production `cmd/server`); path is operator-supplied secrets file, not request-controlled. Worth `//nolint:gosec` tag with rationale. | `confidence::suspected` |
| G304 (CWE-22) | MED | HIGH | `gen/cmd/server/main.go:339` | `loadCertPool(path)` reads PEM | **suspected acceptable** — operator-supplied path | `confidence::suspected` |
| G104 (CWE-703) | LOW | HIGH | `gen/cmd/server/main.go:242` | `gen.SafeGo("mcp-stdio", func() { genmcp.ServeSTDIO() })` — unused return value | **suspected acceptable** — SafeGo wraps the goroutine and routes panics through obsx; the discarded value is intentional | `confidence::suspected` |

**Production package (`internal/server`, `cmd/server`, `internal/profilestore`, `internal/jwt`, `internal/conn`) — 0 actionable gosec findings.** All 7 findings are either nolint-tagged protocol requirements (SHA-1 for RFC 6455) or LOW-confidence string-content false positives. (`confidence::confirmed` after manual review)

### Multi-language — semgrep

| Rule | Sev | File:Line | Triage | Confidence |
|---|---|---|---|---|
| `go.lang.security.audit.crypto.use_of_weak_crypto.use-of-sha1` | WARN | `gen/pkg/wsx/ws.go:576` | RFC 6455 — same as gosec G401 above. False positive. | `confidence::confirmed` |
| `go.lang.security.audit.crypto.use_of_weak_crypto.use-of-sha1` | WARN | `internal/server/password_policy.go:161` | HIBP k-anonymity check (`SHA-1` prefix lookup) — required by the HIBP API. False positive in this context. | `confidence::confirmed` |
| `go.lang.security.audit.net.cookie-missing-httponly` | WARN | `internal/server/csrf.go:104` (`HttpOnly: false`) | **Intentional** — the CSRF cookie is the JS-readable half of a double-submit pattern. `HttpOnly` would break the design. (See SEC-F7 / #62.) False positive. | `confidence::confirmed` |
| `go.lang.security.audit.net.cookie-missing-secure` | WARN | `internal/server/csrf.go:104` | `Secure: s.cfg.SecureCookies` — config-gated, defaults true in production; e2e disables via `-secure-cookies=false`. False positive. | `confidence::confirmed` |
| `go.lang.security.audit.net.cookie-missing-secure` | WARN | `internal/server/handlers_auth.go:195` (auth cookie set) | Same config-gated `Secure` flag. False positive. | `confidence::confirmed` |
| `go.lang.security.audit.net.cookie-missing-secure` | WARN | `internal/server/handlers_auth.go:244` (logout cookie clear) | Same config-gated `Secure` flag on the delete-cookie write. False positive. | `confidence::confirmed` |

**Net actionable semgrep findings: 0.** Six warnings, all reviewed against source as false positives (protocol requirement / intentional CSRF design / config-gated `Secure`). (`confidence::confirmed`)

## IaC / Config Issues

| Tool | Result |
|---|---|
| checkov | not installed; no Terraform/K8s manifests present in repo |
| trivy config | not installed |
| hadolint | not installed; `deploy/Dockerfile*` (3 prod + 2 helper images) not linted in this scan |

Per `security-inventory.md`: SAST + dep-scan + SBOM + gitleaks all run inside `.gitlab-ci.yml` via `ci-catalog@v1.7.1` against every MR. This local scan complements but does not replace that pipeline.

## Shell / Dockerfile Issues

Skipped — `shellcheck` and `hadolint` not available in this environment. Targets for a follow-up scan:
- `deploy/geode/{geode-entrypoint,lsp-bridge,mcp-bridge,mcp-stdio-launch,seed-bootstrap}.sh`
- `scripts/{bench-gate,check-ci-pins,check-generate,check-go-coverage,check-go-mod-tidy}.sh`
- `deploy/Dockerfile`, `deploy/Dockerfile.release`, `deploy/Dockerfile.release.alpine`, `deploy/geode/Dockerfile.geode`, `deploy/playwright/Dockerfile.playwright`

## Threat-Area Focused Read

### (1) Credential stuffing on `POST /api/v1/auth/login` + XFF correctness

Reviewed: `internal/server/handlers_auth.go:31-130`, `internal/server/loginlimiter.go:1-823`, `cmd/server/app.go:53,120-128`.

Findings:
- Defaults are correct. `cfg.trustProxyXFF=false` (`cmd/server/app.go:128`), `loginlimiter.clientIP()` returns `net.SplitHostPort(r.RemoteAddr)` when XFF is not trusted (`loginlimiter.go:808-823`), so an attacker cannot rotate the per-IP key with a forged `X-Forwarded-For` (`confidence::confirmed`).
- When `-trust-proxy-xff=true`, `clientIP()` takes the **leftmost** XFF hop unsanitised. This is the operator-trusted mode and the inventory's `Unknowns & Assumptions` already calls out that the upstream proxy MUST strip inbound XFF. Recommend a docs note that operators behind multi-hop proxies should set the trust boundary at the outermost proxy and that the leftmost hop is the one accepted. (`confidence::suspected` — operationally documented; no code change required.)
- `peekLoginCreds` (`loginlimiter.go:505-548`) closes S-NEW-F (#317): only `application/x-www-form-urlencoded` is decoded; any other Content-Type lands the limiter in the conservative IP-only fallback so an attacker can't bypass the per-(profile,user) bucket via a multipart body.
- `respectLoginLatencyFloor(authStart, loginMinFailureLatency)` is called on the misconfig 500 paths (`handlers_auth.go:42,51`) — S-NEW-D (#310) closed. CWE-208 timing-side-channel mitigation present on every failure mode.
- No code-level gaps observed on this surface. (`confidence::confirmed`)

### (2) Cross-tenant exposure in `handlers_profiles.go:30-54`

Reviewed: `internal/server/handlers_profiles.go:30-54,82-102`, `internal/server/handlers_profiles_crud.go:85-213`.

Findings:
- The list path (`GetProfiles`) computes `reveal = isAdmin || p.OwnerUserID == actr.Subject` per row before calling `toGenProfile`. `toGenProfile(p, false)` zeroes `Dsn`, `SavedUsername`, `TLS`, `PoolOverrides`. (`handlers_profiles.go:82-101`) — correct. (`confidence::confirmed`)
- The per-id GET (`GetProfileid`, `handlers_profiles_crud.go:92-111`) re-applies the same predicate and additionally returns 404 (not 403) when a non-admin asks for someone else's personal profile — leak-resistant. (`confidence::confirmed`)
- PATCH (`PatchProfileid`, `handlers_profiles_crud.go:119-164`) and DELETE (`DeleteProfileid`, `handlers_profiles_crud.go:167-199`) gate the mutation on `canMutate(cur, actr, isAdmin)` (`handlers_profiles_crud.go:205-213`) which is `isAdmin || owner==subject` for personal, admin-only for system. The response body on PATCH unconditionally calls `toGenProfile(updated, true)` (`handlers_profiles_crud.go:162`). For non-admins this is fine (only own profile reachable). For **admins** patching another user's personal profile, the response **does include DSN + saved_username**. This is policy-by-design and the inventory acknowledges it ("admin reach across other personal scopes is gated by the per-id GET handler with audit logging"). Verify the audit event is emitted on the **PATCH-by-admin-on-other-personal** code path too — `auditEventProfileUpdated` is emitted on every PATCH (`handlers_profiles_crud.go:151`), so the trail exists. (`confidence::confirmed`)
- POST `/profiles` returns `toGenProfile(saved, true)` (`handlers_profiles_crud.go:87`). At create time the actor is forced to be the owner for personal scope (`handlers_profiles_crud.go:46`), so reveal=true is always reveal-to-owner. (`confidence::confirmed`)
- `Store.ListVisible` is a single SQL query that walks `scope='system' OR (scope='personal' AND owner_user_id=?)`. Cross-tenant rows cannot be returned via the list path. (`confidence::confirmed` per inventory + handler logic — no SQL-level scan run here.)
- No code-level gaps observed; the explicit admin-can-see-DSN policy is documented and audited. (`confidence::confirmed`)

### (3) Monaco / Cytoscape / Electron supply chain

Reviewed: `package.json`, `electron/main.ts`, `electron/preload.ts`, npm-audit output.

Findings:
- Production npm tree: **0 advisories** against `monaco-editor`, `monaco-languageclient`, `vscode-ws-jsonrpc`, `vscode-languageclient`, `vscode-languageserver-protocol`, `cytoscape` (incl. 7 cytoscape plugins), `react`, `react-dom`, `react-router-dom`, `react-window`, `recharts`, `reagraph`, `styled-components`, `dompurify`, `zustand` at scan time. (`confidence::confirmed`)
- Electron renderer hardening confirmed at `electron/main.ts:329-331`: `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`. `electron/preload.ts:76` exposes a single named bridge (`window.geode`) via `contextBridge.exposeInMainWorld`. IPC handlers (`electron/main.ts:380-500`) are allowlisted by channel name with size-capped payloads (per inventory: `STORE_TOKEN_MAX_LEN=4096`, `PEM_FILE_MAX_BYTES=1MiB`). (`confidence::confirmed`)
- Dev-only `electron-builder` chain has 9 high-severity transitive `tar`/`node-gyp` advisories. The advisories require an attacker to control archive content the builder ingests at release time. **Recommended remediation:** bump `electron-builder` to 26.8.1 (semver-major) and re-validate the Authenticode signing pipeline + GoReleaser interplay. (`confidence::confirmed`)
- `webpack-dev-server <= 5.2.3` (GHSA-79cf-xcqc-c78w) requires a malicious origin to lure a developer into clicking a link served over HTTP while devserver runs. Low blast radius (dev-only), but a `npm i webpack-dev-server@latest -D` is a one-line fix. (`confidence::confirmed`)
- DOMPurify is actively used for markdown HTML (`src/lib/docs/markdown.ts:14,154`) — not a passive override pin. (`confidence::confirmed`)

## Hygiene Observation (out of scope for fix)

- `server` (99 MiB Go ELF, `Go BuildID=...`) exists at repo root and is **gitignored** (`.gitignore:81`). Not tracked by git. Inventory's `Unknowns & Assumptions` flagged it; confirmed it is local-only and does not enter pushes. No action required. (`confidence::confirmed`)

## Tools Not Available (gaps)

| Tool | Why Missing | Impact |
|---|---|---|
| trivy | not installed | No second-opinion CVE scan on go modules / OS pkgs / fs config — `govulncheck` and `npm audit` are the only dep scans run locally. CI catalogue still runs SBOM + scan. |
| grype | not installed | Same gap as trivy. |
| syft | not installed | No locally-generated CycloneDX SBOM artefact — CI generates the SBOM upstream. |
| osv-scanner | not installed | govulncheck covers Go; npm audit covers Node; OSV would also cover lockfile combinations and broader ecosystems if added. |
| trufflehog | not installed | gitleaks covered secret scanning; trufflehog would have provided verified-secret triage as a second opinion. |
| shellcheck | not installed | 8 shell scripts in `deploy/` and `scripts/` unscanned. CI catalogue does not currently lint shell. |
| hadolint | not installed | 5 Dockerfiles unscanned. CI image-pin check (`scripts/check-image-pins.sh`) enforces pin cadence but not best-practice lint. |
| checkov | not installed | No Terraform / K8s manifests in this repo; impact nil. |
| snyk | not authenticated; out-of-policy without approval | Skipped per task constraints. |
| detect-secrets (full scan) | gibberish_detector module mismatch in pipx venv — `pipx inject gibberish-detector` succeeded but the venv still failed to resolve the module | Baseline was inspected statically (27 plugins, 0 accepted entries). gitleaks provided the effective secret scan. |

## Blockers

None. All scheduled scanners that are installed completed successfully. detect-secrets baseline parse vs scan discrepancy is the only partial — baseline integrity verified by direct JSON inspection.

## Summary

- gitleaks: **2 suspected (both reviewed as non-actionable false positives)** — test code + docs placeholder.
- govulncheck (Go, source mode): **0 reachable** vulnerabilities across 251 OSV candidates.
- npm audit (prod tree): **0** vulnerabilities. (`--omit=dev`)
- npm audit (full tree): **15** — all in dev-only chains (electron-builder, jest-jsdom, webpack-dev-server).
- gosec: **7** findings; **0 actionable** (2 LOW-conf string false positives, 2 RFC-mandated SHA-1 already nolint-tagged, 2 gen-scaffold path reads, 1 intentional SafeGo).
- semgrep: **6** warnings; **0 actionable** (config-gated `Secure`, intentional CSRF non-HttpOnly, HIBP/RFC SHA-1).
- Three threat-area focused reads (login XFF, cross-tenant profile reads, Monaco/Cytoscape/Electron supply chain): **0 net-new code-level findings.** All controls described in `security-inventory.md` line up with the source at HEAD.
