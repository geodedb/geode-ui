# Gap Analysis -- Resolved (geode-ui)

- **Project:** devnw/codepros/geode/geode-ui
- **Last updated:** 2026-05-10
- **Sibling docs:** [GAP_ANALYSIS.md](./GAP_ANALYSIS.md) (open requirement gaps), [PERF_GAP_ANALYSIS.md](./PERF_GAP_ANALYSIS.md), [QUALITY_GAP_ANALYSIS.md](./QUALITY_GAP_ANALYSIS.md), [SECURITY_GAP_ANALYSIS.md](./SECURITY_GAP_ANALYSIS.md)
- **Source of truth:** GitLab issues in `devnw/codepros/geode/geode-ui`. This doc mirrors closed issues across the perf / quality / security tracking files.

This file collects gaps that have been resolved or invalidated. A new audit run moves entries here from the per-domain `*GAP_ANALYSIS.md` files once each gap's acceptance criteria are met and the corresponding GitLab issue is closed with evidence.

## Format

```markdown
### <ID>: <short title> [RESOLVED]
- **Issue:** <#IID> (closed)
- **Domain:** Performance / Quality / Security
- **Severity at close:** <Critical / High / Medium / Low>
- **Closure commit(s):** <SHA(s)>
- **Resolution:** <what was done>
- **Evidence:** <file:line, test name, command output>
- **Resolved date:** <YYYY-MM-DD>
```

## Resolved Gaps

### 2026-05-07 closure run -- top-10 batch (11 distinct issues, 15 commits)

Verifier returned ALL CLEAR; tracking docs and platform issues were updated together. Five Performance, four Quality, three Security; one cross-closed Medium (N3) and one partially closed Medium (N7) recorded for cross-reference.

---

### Performance (5)

#### F11 (#55): conn.Pool defaults too small for 2000 rps [RESOLVED]

- **Issue:** [#55](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/55) (closed)
- **Domain:** Performance
- **Severity at close:** P1 high (PerfScore 80)
- **Closure commit(s):** `3f23235`
- **Resolution:** Pool defaults bumped to 64/16 with `GEODE_POOL_MAX` / `GEODE_POOL_INIT` env override. Sized against the documented 2000 rps + 400 burst assumption.
- **Evidence:** `internal/conn/pool.go:25-29`; `TestPoolDefaults`.
- **Resolved date:** 2026-05-07

#### F1 (#18): result_codec single-pass [RESOLVED]

- **Issue:** [#18](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/18) (closed)
- **Domain:** Performance
- **Severity at close:** P1 high (PerfScore 80)
- **Closure commit(s):** `7ac1a43`
- **Resolution:** Graph-summary scan folded into the existing row scan; eliminates the second pass and the second buffer allocation.
- **Evidence:** `internal/server/result_codec.go:53-87`; codec tests still green.
- **Resolved date:** 2026-05-07

#### F2 (#21): ws_query batch frames + sync.Pool [RESOLVED]

- **Issue:** [#21](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/21) (closed)
- **Domain:** Performance
- **Severity at close:** P1 high (PerfScore 80)
- **Closure commit(s):** `278452a`
- **Resolution:** Per-row Marshal+WriteMessage replaced with a `sync.Pool`-backed batch frame; one frame per N rows on the wire.
- **Evidence:** `internal/server/ws_query.go:133-145,199-205`; ws_query tests cover batched frame shape.
- **Resolved date:** 2026-05-07

#### F9 (#53): GraphView Cytoscape rebuild gate [RESOLVED]

- **Issue:** [#53](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/53) (closed)
- **Domain:** Performance
- **Severity at close:** P0 critical (PerfScore 80)
- **Closure commit(s):** `82e1216`
- **Resolution:** Cytoscape rebuild gated on `resp.status === 'done'`; layout invocations dropped from N (one per streamed row) to 1.
- **Evidence:** `src/components/results/GraphView.tsx:39-62`; manual smoke against streamed `MATCH (n)` query.
- **Resolved date:** 2026-05-07

#### F4+F5+F6 (#26): TableView umbrella -- virtualize + memoize + mutable reducer [RESOLVED]

- **Issue:** [#26](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/26) (closed)
- **Domain:** Performance
- **Severity at close:** P0 critical (PerfScore 100)
- **Closure commit(s):** `c8bb007`
- **Resolution:** `react-window` virtualization on the result list, mutable-ref row reducer (no per-row React state churn), memoized `projectColumns(resp)`.
- **Evidence:** `src/pages/QueryPage.tsx:47`, `src/components/results/TableView.tsx:225,241-251`; component tests + manual perf observation on 1000- and 5000-row results.
- **Resolved date:** 2026-05-07

---

### Quality (4)

#### Q1 (#27): Split util.go [RESOLVED]

- **Issue:** [#27](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/27) (closed)
- **Domain:** Quality
- **Severity at close:** High (PriorityScore 80)
- **Closure commit(s):** `55b5e69`
- **Resolution:** 318-LOC catch-all split into `context.go` / `quoting.go` / `sqlexec.go` / `coerce.go`; errors-related helpers kept with their `errors_test.go` pinning.
- **Evidence:** `internal/server/{context,quoting,sqlexec,coerce}.go`; `go vet ./...` clean; existing tests still pass.
- **Resolved date:** 2026-05-07

#### Q4 (#32): PatchUsername transactional [RESOLVED]

- **Issue:** [#32](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/32) (closed)
- **Domain:** Quality
- **Severity at close:** High (PriorityScore 80) -- production-data risk
- **Closure commit(s):** `af74e47`
- **Resolution:** Email/Password/Roles statements wrapped in BEGIN/COMMIT with rollback-on-error; new tests cover partial-failure paths.
- **Evidence:** `internal/server/handlers_users.go:154-171`; `TestPatchUsernameAtomicity` (rollback on roles failure).
- **Resolved date:** 2026-05-07

#### Q11 (#43): Drop @types/cytoscape stub [RESOLVED]

- **Issue:** [#43](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/43) (closed)
- **Domain:** Quality
- **Severity at close:** Medium (PriorityScore 40) -- blocked `make web-build`
- **Closure commit(s):** `1fda90a` (drop), `0e22763` (follow-up tsc fixes)
- **Resolution:** `pnpm remove @types/cytoscape`; tsc errors uncovered by the removal fixed in the follow-up commit. `make web-build` now succeeds.
- **Evidence:** `package.json` devDependencies; `pnpm tsc --noEmit` clean; `make web-build` green.
- **Resolved date:** 2026-05-07

#### Q2 (#29): useApiResource hook + 6-page migration [RESOLVED]

- **Issue:** [#29](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/29) (closed)
- **Domain:** Quality
- **Severity at close:** High (PriorityScore 80)
- **Closure commit(s):** `2b28b85`
- **Resolution:** New `src/hooks/useApiResource.ts` owns AbortController + mounted/aborted guards. Migrated `UsersPage.tsx`, `RolesPage.tsx`, `PoliciesPage.tsx`, `BackupPage.tsx`, `MigrationsPage.tsx`, `AuditLogPage.tsx`. AuditLogPage poll gated on `document.visibilityState`. `RestorePage.tsx` had no on-mount fetch so was not migrated.
- **Evidence:** `src/hooks/useApiResource.ts`; six page diffs in `2b28b85`; Jest suite still green.
- **Resolved date:** 2026-05-07

---

### Security (3 high + 1 cross-closed + 1 partial)

#### F4 (#60) [confidential]: CSP/COOP/Permissions-Policy headers [RESOLVED]

- **Issue:** [#60](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/60) (closed, confidential)
- **Domain:** Security
- **Severity at close:** High (Risk 64)
- **Closure commit(s):** `1791a37`
- **Resolution:** `internal/server/security_headers.go` -- CSP + COOP on the SPA HTML response; Permissions-Policy global. Closes the dominant amplification surface for any future XSS or cross-origin embedding attempt.
- **Evidence:** `internal/server/security_headers.go`; `TestSecurityHeaders`.
- **Genapi follow-up:** `genapi#214` (move into `httpx.WrapHandler`).
- **Resolved date:** 2026-05-07

#### F2 (#58) [confidential]: per-IP/per-user login rate limit + lockout [RESOLVED]

- **Issue:** [#58](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/58) (closed, confidential)
- **Domain:** Security
- **Severity at close:** High (Risk 64)
- **Closure commit(s):** `8e9f5d2`
- **Resolution:** `internal/server/loginlimiter.go` -- per-IP token bucket (5 rps, burst 10) and per-(profile,username) lockout (5 failures / 15 min). Cross-closes N3 (#65) by canonicalising profile in both `handlers_auth.go` and the limiter. Partially closes N7 (#66) for the login surface only.
- **Evidence:** `internal/server/loginlimiter.go`; `TestLoginLimiterPerIP`, `TestLoginLimiterLockout`, `TestCanonicalProfile`.
- **Genapi follow-up:** `genapi#215` (per-IP global rate limit + per-route per-IP option).
- **Resolved date:** 2026-05-07

#### F7 (#62) [confidential]: JWT off localStorage -> cookie + CSRF [RESOLVED]

- **Issue:** [#62](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/62) (closed, confidential)
- **Domain:** Security
- **Severity at close:** High (Risk 48)
- **Closure commit(s):** `56d4e5f` (1/3 server cookie writer/reader), `21955c4` (2/3 CSRF double-submit middleware), `4eb3dcd` (3/3 SPA cookie-based auth + CSRF header)
- **Resolution:** Three-part split. Server reads JWT from `r.Cookie("...")` at `internal/server/auth.go:65`; CSRF double-submit middleware enforces a `X-CSRF-Token` header against a separate non-HttpOnly cookie; SPA stops writing to localStorage and submits the CSRF header on state-changing requests.
- **Evidence:** `internal/server/auth.go:65` (cookie read); `internal/server/csrf.go` (middleware); `src/api/auth.ts:30-36` (cookie-based flow); auth_test + csrf_test green.
- **Backout / dual-mode:** `?access_token=` query fallback retained on read for one minor; tracked separately at F5/#71 with a Deprecation header. Cookie write is the only write path.
- **Resolved date:** 2026-05-07

#### N3 (#65): Login profile canonicalisation [RESOLVED, cross-closed]

- **Issue:** [#65](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/65) (closed)
- **Domain:** Security
- **Severity at close:** Medium (Risk 36)
- **Closure commit(s):** `8e9f5d2` (same commit that closed #58)
- **Resolution:** `canonicalProfile()` applied in both `handlers_auth.go` and the rate-limiter so an empty profile no longer collapses silently to "default" outside the limiter's bookkeeping.
- **Evidence:** `internal/server/handlers_auth.go`, `internal/server/loginlimiter.go`; `TestCanonicalProfile`.
- **Resolved date:** 2026-05-07

---

### Partial closures (recorded for cross-reference; issue remains open)

#### N7 (#66): Per-IP global rate limiter [PARTIAL]

- **Issue:** [#66](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/66) (still open in geode-ui)
- **Domain:** Security
- **Severity at close:** Medium (Risk 32)
- **Partial closure commit(s):** `8e9f5d2`
- **Status:** Login surface covered by `loginlimiter.go`. Global per-IP across all routes deferred to `genapi#215` (httpx middleware). Issue stays open until the genapi rollout lands and we regenerate.
- **Resolved date:** N/A (partial only)

---

### 2026-05-10 closure run -- PSR top-13 batch (13 distinct issues, 9 commits)

Verifier returned SAFE-TO-CLOSE for all 9 commits. Three Security (1 cross-close), three Performance (epic + 2 standalone), four Quality (1 cross-close), three Gap (1 partial). One follow-up issue (#124) opened for the deferred PSR-G02 scalar-clear genapi work.

#### Security (3)

##### S1 (#114): Electron will-navigate openExternal allowlist [RESOLVED]

- **Issue:** [#114](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/114) (closed)
- **Domain:** Security
- **Severity at close:** High (Risk 30, release blocker)
- **Closure commit(s):** `debbeb3`
- **Resolution:** New `safeOpenExternal` helper in `electron/lib/safety.ts` funnels both `setWindowOpenHandler` and `will-navigate` through `isAllowedExternal` before `shell.openExternal`.
- **Evidence:** `electron/main.ts:303-308`; 25 new tests in `__tests__/electron-safety.test.ts`.
- **Resolved date:** 2026-05-10

##### S2 (#115): E2E backdoor stripped from production bundles [RESOLVED]

- **Issue:** [#115](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/115) (closed)
- **Domain:** Security
- **Severity at close:** High (Risk 22, release blocker)
- **Closure commit(s):** `8e8406d`
- **Resolution:** Webpack `DefinePlugin` substitutes `__E2E_ENABLED__` -> `false` in releases; Terser dead-code-eliminates the wrapped block in `src/index.tsx:33-41`. E2E variant Dockerfile sets `GEODE_E2E_BUILD=true`; release Dockerfiles deliberately omit it.
- **Evidence:** `grep GEODE_E2E_INITIAL_CONNECTIONS internal/ui/dist/main.*.js` -> 0 hits in release, 1 hit in e2e build. `src/__tests__/index-e2e-flag.test.tsx`.
- **Resolved date:** 2026-05-10

##### S6 (#119): Profile CRUD audit events with PEM/DSN redaction [RESOLVED, cross-closes PSR-G01]

- **Issue:** [#119](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/119) (closed)
- **Domain:** Security
- **Severity at close:** Medium (Risk 17, release blocker)
- **Closure commit(s):** `5d2fcff`
- **Resolution:** POST/PATCH/DELETE handlers emit `profile_created` / `profile_updated` / `profile_deleted` events. `internal/server/audit.go` redaction substring list extended with `dsn`, `pem`, `ca_pem`, `cert_pem`, `key_pem`, `tls_*_pem` (defense-in-depth).
- **Evidence:** `internal/server/handlers_profiles_crud.go:24,134,205`; `TestPostProfiles_EmitsAuditEvent`, `TestPatchProfileid_EmitsAuditEvent`, `TestDeleteProfileid_EmitsAuditEvent`, `TestEmitAudit_RedactsProfileStoreSecrets`, extended `TestIsSensitive`. internal/server coverage 70.4% -> 71.9%.
- **Cross-closes:** PSR-G01 (#78) -- duplicate framing; PSR-G08 (#85) audit-emission half.
- **Resolved date:** 2026-05-10

#### Performance (3)

##### F1 (#94): async single-flight maybeReload off the request critical path [RESOLVED]

- **Issue:** [#94](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/94) (closed)
- **Domain:** Performance
- **Severity at close:** PerfScore +8
- **Closure commit(s):** `d822bc0`
- **Resolution:** `maybeReload` now spawns reload in a goroutine; `singleflight.Group` coalesces concurrent triggers (1-2 Reloads per N triggers).
- **Evidence:** `internal/server/handlers_profiles_crud.go:401-490`, `internal/server/server.go:99-145`. Bench: POST 7.58 ms -> 0.23 ms (-97%); PATCH 7.17 ms -> 0.58 ms (-92%). `profile_reload_failed` audit preserved.
- **Resolved date:** 2026-05-10

##### F2 (#97): atomic Patch transaction; drop redundant mutex [RESOLVED]

- **Issue:** [#97](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/97) (closed)
- **Domain:** Performance + Correctness
- **Severity at close:** Correctness (perf bonus)
- **Closure commit(s):** `fb922fd`
- **Resolution:** `Patch` wraps Get + UPDATE in a single `sql.Tx`; redundant `sync.Mutex` removed (SetMaxOpenConns(1) already serializes); `RowsAffected==0` surfaces `ErrNotFound`.
- **Evidence:** `internal/profilestore/sqlite.go:163-263`. -race -cover green. internal/profilestore coverage 75.6% -> 78.6%.
- **Resolved date:** 2026-05-10

##### F6+F9+F13+F14 (#92, #106, #110, #111): secure-store coalescing epic [RESOLVED]

- **Issues:** [#92](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/92), [#106](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/106), [#110](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/110), [#111](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/111) (all closed)
- **Domain:** Performance
- **Severity at close:** PerfScore +10/+9/+8/+9 (epic)
- **Closure commit(s):** `4fea9c2` (single MR -- all 4 issues)
- **Resolution (joint):**
  - **F6:** `electron/lib/secure-store.ts` -- in-process memo + 250ms debounced flush + `flushSync` on `app.before-quit`.
  - **F9:** `src/api/connections.tsx` -- reducer carries `version: number`; persist effect deps on `[state.version]`; reducer only bumps on real shape changes.
  - **F13:** `src/components/layout/AddConnectionModal.tsx` -- four modal-open `useEffect`s collapsed; `Promise.all` batch.
  - **F14:** Saved-password lookup gated behind "Use saved password" toggle; 300ms debounce; renderer-local `(profile,username)->pw` cache; reset on modal close.
- **Evidence (representative reductions):**
  - Modal-open + 5-keystroke (toggle OFF): 5 IPCs -> 0 IPCs.
  - Modal-open + 5-keystroke (toggle ON, no cache hit): 5 decrypts + 5 reads -> 1 decrypt at end of debounce.
  - 5 sequential `add` dispatches: 5 encrypts + 5 atomic renames -> 1 encrypt + 1 atomic rename.
  - Reducer no-op transitions: N IPCs -> 0 IPCs.
- **Resolved date:** 2026-05-10

#### Quality (1)

##### Q4 (#93): Single-source GeodeBridge types in shared module [RESOLVED, cross-closes PSR-G07]

- **Issue:** [#93](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/93) (closed)
- **Domain:** Quality
- **Severity at close:** High (PriorityScore -- release blocker)
- **Closure commit(s):** `fc44a6b`
- **Resolution:** New `electron/shared/bridge-types.ts` is the single source of truth; `electron/preload.ts` and `src/types/electron.d.ts` both `import type` from it.
- **Evidence:** `__tests__/electron-bridge-types.test.ts` mutually assigns the two type aliases as a compile-time drift guard.
- **Cross-closes:** PSR-G07 (#84) -- duplicate framing.
- **Resolved date:** 2026-05-10

#### Gap (3)

##### PSR-G01 (#78): Profile CRUD audit emission [RESOLVED, cross-closed]

- **Issue:** [#78](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/78) (closed)
- **Closure commit(s):** `5d2fcff` (same commit as S6 / #119)
- **Resolution:** See S6 (#119).
- **Resolved date:** 2026-05-10

##### PSR-G03 (#80): Refresh CSRF after connectMore [RESOLVED]

- **Issue:** [#80](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/80) (closed)
- **Domain:** Gap (release blocker)
- **Closure commit(s):** `6b4d2ba`
- **Resolution:** `connectMore` now `await refreshCsrfToken()` immediately after `apiLogin`, mirroring `signIn`.
- **Evidence:** `src/auth/AuthProvider.tsx:135-159`; new jest case `PSR-G03: connectMore refreshes the CSRF token after apiLogin`.
- **Resolved date:** 2026-05-10

##### PSR-G07 (#84): GeodeBridge type single-source [RESOLVED, cross-closed]

- **Issue:** [#84](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/84) (closed)
- **Closure commit(s):** `fc44a6b` (same commit as Q4 / #93)
- **Resolution:** See Q4 (#93).
- **Resolved date:** 2026-05-10

##### PSR-G08 (#85): Audit on reload failure [RESOLVED, both halves]

- **Issue:** [#85](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/85) (closed)
- **Closure commit(s):** `5d2fcff` (audit emission), `d822bc0` (5xx-on-required-reload supplanted by F1 design)
- **Resolution:** `maybeReload` emits `profile_reload_failed` audit events with `actor` / `phase` / `error` keys. The original 5xx-on-required-reload escalation is structurally moot now that F1 redesigned reload as async + single-flight: there is no synchronous result on which to escalate, and operator visibility comes from the audit event + slog warning.
- **Evidence:** `TestMaybeReload_EmitsAuditOnReloadFailure`.
- **Resolved date:** 2026-05-10

#### Partial closures (recorded for cross-reference; follow-up open)

##### PSR-G02 (#79): mergeProfile clear semantics [PARTIAL]

- **Issue:** [#79](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/79) (closed; release-blocker portion shipped)
- **Domain:** Gap (release blocker)
- **Closure commit(s):** `97b8ed4`
- **What this commit closes:** Pointer-typed optionals on `profilestore.ProfilePatch`; `mergeProfile` rewritten to apply only non-nil fields; `&TLSMaterial{}` clears all PEM material; `&PoolOverrides{}` zeroes every override; SPA wire builders emit `tls: {}` / `pool_overrides: {}` for defined-but-empty inputs.
- **Evidence:** `internal/profilestore/store.go:18-49`, `sqlite.go:218-256`, `handlers_profiles_crud.go:165-310`, `src/api/profiles.ts:104-148`. `TestSQLitePatchClearsTLS`, `TestPatchProfileid_TLSClearViaEmptyObject`, `TestPatchProfileid_PoolOverridesClearViaEmptyObject`, `TestMergeProfile_OnlyAppliesNonNilFields` + 4 SPA cases.
- **Deferred (scalar-clear):** Clearing `description` / `saved_username` / `dsn` via PATCH requires genapi schema work (`*string` / `*bool` for nullable scalars) per the repo's never-edit-`gen/` rule. KNOWN-DEFERRED comment at `internal/server/handlers_profiles_crud.go:337`. Tracked at **#124** -- *[PSR-G02-followup] genapi schema: emit `*string` / `*bool` for nullable PATCH scalars*.
- **Resolved date:** 2026-05-10 (release-blocker half)

---

## Index by closure date

- **2026-05-07:** #18, #21, #26, #27, #29, #32, #43, #53, #55, #58, #60, #62, #65 (cross-closed). Genapi follow-ups: `genapi#214`, `genapi#215`. #66 partially closed (open).
- **2026-05-10 (PSR top-13):** #78, #79 (partial), #80, #84, #85, #92, #93, #94, #97, #106, #110, #111, #114, #115, #119. Follow-up opened: #124. Total: 9 commits, 13 + 2 (#114/#115 batched) issues fully closed, 1 partial.
