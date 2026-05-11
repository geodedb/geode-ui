# Gap Analysis -- Resolved (geode-ui)

- **Project:** devnw/codepros/geode/geode-ui
- **Last updated:** 2026-05-11
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
- **2026-05-10 (gap-close pass — 16 closed + 5 deferred):** Requirements #6, #7. Quality Q3 (#31), Q6 (#36), Q7 (#37), Q9 (#41), Q10 (#42). Security N1 (#63), N4 (#72), N5 (#74), N10 (#76), F8-sec (#68), F11 (#77), F6+N6 (#67). Performance F7 (#51), F8 (#52). Deferred (tracked at `genapi#215`/`genapi#216`): F3 (#25), F13 (#57), N7-remainder (#66), Q5 (#34), Q8 (#38).
- **2026-05-11 (follow-up batch — 9 closed + 1 won't-do):** Performance F10 (#54), F12 (#56), F13 (#57, genapi `fd31bbc`), PSR-F5 (#103), PSR-F15 (#112). Quality Q5 (#34), Q8 (#38). Security N2 (#64), N7-remainder (#66, genapi `fd31bbc`). Won't-do: F18 (#61). 9 geode-ui commits + 3 genapi commits (`fd31bbc`, `5dd5f61`, `7eaf8a1`; genapi pushed to origin). Still deferred (not moved): F3 (#25), tracked at `genapi#216`.
- **2026-05-11 (N2 durability follow-up):** SEC-N2 JWT revocation store upgraded from in-memory to SQLite-backed — `RevocationSet` is now an in-memory read-through cache over a `revoked_jti`/`password_changed_at` table pair in the profile-store DB (shared file via the new `profilestore.DBHandleProvider`; `RevocationSet.AttachSQLite`). Survives a process restart; the validation path stays zero-DB-query. 1 geode-ui commit (`fix: durable SQLite-backed JWT revocation store (N2 follow-up)`).

---

### 2026-05-10 closure run -- gap-close pass (16 closed + 5 deferred, 17 commits)

Verifier returned GREEN: `make ci` passes end-to-end; Go: 17 packages OK with `internal/server` coverage 74.5% -> 75.7% (+1.2 pp); Jest 375/375 passing; tsc / golangci-lint / eslint clean; `gosec G115` reports 0 (was >=1 pre-F11). One bookkeeping commit consolidates the doc updates.

#### Requirements (2)

##### GAP-006 (#6): e2e job runtime status in CI not verified [RESOLVED]

- **Issue:** [#6](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/6) (closed)
- **Domain:** Requirements / CI verification
- **Severity at close:** Low
- **Closure commit(s):** `4a7ad51`
- **Resolution:** Latest `main` pipeline sampled and URL recorded in `docs/GAP_ANALYSIS.md` row (`pipeline #2514181822` on sha `f815d1a`, 2026-05-10).
- **Evidence:** `docs/GAP_ANALYSIS.md` GAP-006 row + Detailed Gap Records section.
- **Resolved date:** 2026-05-10

##### GAP-007 (#7): docker-compose stack-up smoke not executed [RESOLVED]

- **Issue:** [#7](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/7) (closed)
- **Domain:** Requirements / Verification
- **Severity at close:** Low
- **Closure commit(s):** `ec270f9`
- **Resolution:** e2e stack smoke executed; `/healthz` -> `200 {"status":"ok","version":"v0.1.0"}`; `/api/v1/profiles/public` -> `200` with one profile. Evidence recorded in `docs/GAP_ANALYSIS.md`.
- **Evidence:** `docs/GAP_ANALYSIS.md` GAP-007 row.
- **Resolved date:** 2026-05-10

#### Quality (5)

##### Q3 (#31): Rename `user*` helpers to drop misleading prefix [RESOLVED]

- **Issue:** [#31](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/31) (closed)
- **Domain:** Quality
- **Severity at close:** High (PriorityScore 80)
- **Closure commit(s):** `dfbe67a`
- **Resolution:** Package-wide rename: `userDB`->`connDB`, `userErr`->`wireErr`, `userResponseErr`->`respondErr`, `userRowToMap`->`rowToMap`. Stable HTTP `code` field `user_admin_error` preserved. `userFromRow` and `userFromContext` intentionally kept (genuinely user-typed). The rename was discovered to be package-wide (touches users / policies / migrations / backups / roles), not file-local as originally framed.
- **Evidence:** `internal/server/{errors,handlers_users,handlers_backups,handlers_grants,handlers_policies,handlers_migrations,handlers_roles}.go`; `make go-test` and `make go-lint` clean.
- **Resolved date:** 2026-05-10

##### Q6 (#36): Typed errors for `isWireFeatureMissing` [RESOLVED]

- **Issue:** [#36](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/36) (closed)
- **Domain:** Quality
- **Severity at close:** Medium (PriorityScore 48)
- **Closure commit(s):** `c949e8a`
- **Resolution:** Three-tier detection: (1) `errWireFeatureMissing` sentinel callers wrap via `%w`, (2) typed `statusClasser.StatusClass()=="42000"` via `errors.As`, (3) pinned-substring fallback. Accepted substrings live in `wireFeatureMissingSubstrings`; new `internal/server/errors_test.go` exhaustively pins each entry.
- **Evidence:** `internal/server/errors.go:88-172`; `internal/server/errors_test.go`.
- **Resolved date:** 2026-05-10

##### Q7 (#37): `safeEmitAudit` policy across handler sites [RESOLVED]

- **Issue:** [#37](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/37) (closed)
- **Domain:** Quality
- **Severity at close:** Medium (PriorityScore 48)
- **Closure commit(s):** `3c5c8fe`
- **Resolution:** Policy chosen: best-effort log+continue. `emitAudit` keeps `void` return; policy sealed inside the helper via `defer recover()` that writes a one-line `AUDIT EMISSION FAILED ...` warning directly to `os.Stderr` (NOT via slog/log -- Go 1.21+ routes both through slog and would re-panic on a broken handler). Test `TestEmitAudit_LogContinuePolicy` proves the policy with an injecting `panicHandler` slog sink.
- **Evidence:** `internal/server/audit.go`; `TestEmitAudit_LogContinuePolicy`.
- **Resolved date:** 2026-05-10

##### Q9 (#41): Extract `withConnDBAndIdent` helper [RESOLVED]

- **Issue:** [#41](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/41) (closed)
- **Domain:** Quality
- **Severity at close:** Medium (PriorityScore 40)
- **Closure commit(s):** `1b227da`
- **Resolution:** `withConnDBAndIdent(ctx, name, fn)` extracted in `handlers_users.go`; the 8 handler sites that pair `connDB` with `quoteIdent` (PostUsers, GetUsername, PatchUsername, DeleteUsername, Password, PostUsernameRoles, Permissions, toggleUser) now route through it. `GetUsers` retains the bare `connDB` call.
- **Evidence:** `internal/server/handlers_users.go`; `TestWithConnDBAndIdent_TableDriven` (happy, missing-active-connection 502, invalid-identifier 400).
- **Resolved date:** 2026-05-10

##### Q10 (#42): Add `docs/adr/` skeleton + `internal/server/README.md` [RESOLVED]

- **Issue:** [#42](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/42) (closed)
- **Domain:** Quality / Docs
- **Severity at close:** Low (PriorityScore 24)
- **Closure commit(s):** `bceb198`
- **Resolution:** ADR meta-record added under `docs/adr/` (Nygard convention, four-section template, supersession protocol documented); `internal/server/README.md` documents per-file layout, audit/rate-limit conventions, generated-code policy, and the `GOEXPERIMENT=jsonv2` build-env requirement.
- **Evidence:** `docs/adr/0000-record-architecture-decisions.md`; `internal/server/README.md`.
- **Resolved date:** 2026-05-10

#### Security (8)

##### N1 (#63): Adversarial `quoteString` corpus [RESOLVED]

- **Issue:** [#63](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/63) (closed)
- **Domain:** Security
- **Severity at close:** Medium (Risk 24)
- **Closure commit(s):** `8a4e96d`
- **Resolution:** New `internal/server/quoting_test.go` adds an adversarial corpus covering classic SQL-injection shapes, the full ASCII control set, unicode lookalikes (RTL-override, smart quote, ZWSP, combining marks), and length stress (64 KiB). Invariant pinned for `quoteString`: every run of consecutive single quotes in the body is even-length. `quoteIdent` invariant: no interior backtick survives. Existing helpers passed every adversarial input without modification -- no escape gap surfaced.
- **Evidence:** `internal/server/quoting_test.go`.
- **Resolved date:** 2026-05-10

##### N4 (#72): Server-side password policy (12+ chars) [RESOLVED]

- **Issue:** [#72](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/72) (closed)
- **Domain:** Security
- **Severity at close:** Low (Risk 24)
- **Closure commit(s):** `6765e64`
- **Resolution:** `validatePassword(ctx, pw, username, policy)` enforces: (1) `len(pw) >= 12`, (2) reject all-same-char or all-ASCII-digit strings, (3) reject passwords whose lower-cased form contains the lower-cased username when username is >=4 chars, (4) optional HIBP k-anonymity lookup gated behind `Config.PasswordPolicy.HIBPCheck` (default OFF for hermetic tests + air-gap deployments). Stable 400 codes: `password_too_short` / `password_too_weak` / `password_contains_username` / `password_pwned`.
- **Evidence:** `internal/server/password_policy.go`, `internal/server/password_policy_test.go`.
- **Resolved date:** 2026-05-10

##### N5 (#74): Reject wildcard CORS at startup [RESOLVED, genapi-paired]

- **Issue:** [#74](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/74) (closed)
- **Domain:** Security
- **Severity at close:** Low (Risk 16)
- **Closure commit(s):** `0fbccc6` (regen) + genapi `df654de`
- **Resolution:** Genapi adds `httpx.ValidateConfig` and `ErrCORSWildcardWithCredentials`; `WrapHandler` panics and `Serve` returns the error when `CORSEnabled && CORSOrigins` contains `"*"`. CI catches the misconfiguration at startup instead of shipping silent wildcard CORS.
- **Evidence:** `gen/pkg/httpx/server.go` (regenerated); genapi `df654de`.
- **Resolved date:** 2026-05-10

##### N10 (#76): Constant-time auth-failure path [RESOLVED]

- **Issue:** [#76](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/76) (closed)
- **Domain:** Security
- **Severity at close:** Low (Risk 24)
- **Closure commit(s):** `502a865`
- **Resolution:** Three combined defences: (1) `performDummyCompare` runs a SHA-256+constant-time-compare on every failure so a "user not found" path spends comparable CPU to a "wrong password" path; (2) `respectLoginLatencyFloor` waits out a 250 ms minimum-latency window on every failure to absorb upstream timing diffs; (3) `errorBody` struct replaces the `map[string]any` body so Go's map-iteration randomisation can't reorder JSON keys across responses. Audit log still distinguishes `reason=upstream_error` vs `invalid_credentials` for operator diagnostics.
- **Evidence:** `internal/server/handlers_auth.go`, `internal/server/errors.go`; `TestLogin_FailureBodyIsIdentical_AcrossModes`, `TestLogin_LatencyFloor`.
- **Resolved date:** 2026-05-10

##### F8-sec (#68): `dompurify` resolves to >= 3.4 via `npm.overrides` [RESOLVED]

- **Issue:** [#68](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/68) (closed)
- **Domain:** Security / Supply chain
- **Severity at close:** Medium (Risk 16)
- **Closure commit(s):** `edbd1d9`
- **Resolution:** `package.json` declares `"overrides": { "dompurify": "^3.4.0" }`; `npm ls dompurify --all` resolves the transitive (under `monaco-editor@0.55.1`) to `dompurify@3.4.2 overridden`, satisfying the `>= 3.4` floor and closing the 6+ XSS advisories. Cross-closed by S-NEW-8.
- **Evidence:** `package.json::overrides`.
- **Resolved date:** 2026-05-10

##### F11 (#77): gosec G115 fixed in genapi [RESOLVED, genapi-paired]

- **Issue:** [#77](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/77) (closed)
- **Domain:** Security
- **Severity at close:** Low (Risk 4)
- **Closure commit(s):** `8336a43` (regen) + genapi `1033c50`
- **Resolution:** Genapi replaces the `//nolint:gosec` suppression with a real `uint64 > maxWSFrameBytes` bounds check before the int64 cast in `pkg/gqlx/subscription.go:readWSFrame`. Regenerated; `gosec -include=G115 ./gen/...` reports 0 issues (was >=1 pre-fix).
- **Evidence:** `gen/pkg/gqlx/subscription.go` (regenerated); genapi `1033c50`.
- **Resolved date:** 2026-05-10

##### F6+N6 (#67): Centralised audit redaction [RESOLVED, genapi-paired]

- **Issue:** [#67](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/67) (closed)
- **Domain:** Security
- **Severity at close:** Medium (Risk 36)
- **Closure commit(s):** `cea4fbd` (regen + audit.go refactor) + genapi `e100aed`
- **Resolution:** Genapi adds `obsx.RedactSensitiveKeys` + `obsx.DefaultSensitiveKeyFragments`; `obsx.LogAudit` now redacts before emission. `internal/server/audit.go` extends the central list with geode-ui-specific keys (`saved_password`, `tls_client_*`, `tls_server_*`, `tls_password`, `url`, `connection_string`, `access_token`, `refresh_token`, `session_id`) and delegates `isSensitive` to `obsx.IsSensitiveKey`.
- **Evidence:** `internal/server/audit.go`; `gen/pkg/obsx/log.go` (regenerated); genapi `e100aed`.
- **Resolved date:** 2026-05-10

#### Performance (2)

##### F7 (#51): `projectColumns` single-pass inference [RESOLVED]

- **Issue:** [#51](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/51) (closed)
- **Domain:** Performance
- **Severity at close:** P2 medium (PerfScore 48)
- **Closure commit(s):** `7f371fe`
- **Resolution:** Collapsed the per-column `discoverPlan` loop (N independent passes over the row set) into a single row-major sweep that updates a `PlanState` for every column in lockstep. Total row visits dropped from N+1 to exactly 2 regardless of column count.
- **Evidence:** `src/components/results/projectColumns.ts`; `F7 single-pass: each row visited once during inference` (Proxy-based access counter) and `F7 single-pass: declared NODE/EDGE type drives output even for empty rows` regression.
- **Resolved date:** 2026-05-10

##### F8 (#52): SchemaExplorer AbortController + per-graph cache [RESOLVED]

- **Issue:** [#52](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/52) (closed)
- **Domain:** Performance
- **Severity at close:** P3 low (PerfScore 32)
- **Closure commit(s):** `975cc59`
- **Resolution:** (1) `AbortController` per active-graph fetch pair stored in a `useRef` so the prior controller's `abort()` is called immediately on graph switch -- late-resolving responses for the prior graph no longer stomp the new selection; (2) `createSchemaExplorerCache(maxEntries=8)` module-level + props-injectable per-graph cache. Cached re-selection serves indexes+constraints synchronously with zero wire calls. LRU eviction promotes hits to most-recent.
- **Evidence:** `src/components/schema/SchemaExplorer.tsx`; tests for abort-on-switch, cached re-select skips wire, LRU eviction.
- **Resolved date:** 2026-05-10

---

#### Notes on this run

- **Genapi-paired closures (3):** F11 (`1033c50`), N5 (`df654de`), F6+N6 (`e100aed`). Each is a regen-only commit on the geode-ui side; the substantive fix lives in `~/src/devnw/go/genapi`.
- **Deferred genapi work (5):** F3 (#25), F13 (#57), N7-remainder (#66), Q5 (#34), Q8 (#38). All require a separate genapi work cycle; rollup commit `77ac64d` marks them Deferred in their tracking files with specific prerequisites. Tracked at `genapi#215` / `genapi#216`.
- **F8 follow-up:** The generated client doesn't accept an external `signal` so cancellation is enforced at the React-effect layer via `signal.aborted` checks; structural fix (signal propagation through `fetchImpl`) tracked as a follow-up on the genapi side.

---

### 2026-05-11 closure run -- follow-up batch (9 closed + 1 won't-do, 9 geode-ui commits + 3 genapi commits)

Follow-up to the 2026-05-10 run; cleared four of the five items that were deferred-to-genapi in that pass (F13 #57, N7-remainder #66, Q5 #34, Q8 #38) plus five standalone perf/quality/security items, and closed F18 (#61) won't-do after a benchmark refuted its premise. Verifier returned GREEN: `make build` (webpack entrypoint **454 KiB**, was 12.8 MiB), `make go-test` (`internal/server` 77.2%, `internal/jwt` 88.1%, `gen/pkg/httpx` 67.6%, `internal/conn` 83.2%, `internal/ui` 86.1%), Jest 378/378, tsc / golangci-lint / eslint clean, `gosec G120` cleared. genapi was pushed to origin (the 2026-05-10 commits `1033c50` / `df654de` / `e100aed` are now pushed too). The remaining deferral — F3 (#25), the streaming-response template work — is **not** moved here; it stays in `docs/PERF_GAP_ANALYSIS.md` tracked at `genapi#216`. One bookkeeping commit consolidates these doc updates.

#### Performance (4)

##### F10 (#54): Monaco and Cytoscape lazy code-split [RESOLVED]

- **Issue:** [#54](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/54) (closed)
- **Domain:** Performance
- **Severity at close:** P2 medium (PerfScore 48)
- **Closure commit(s):** `130e413`
- **Resolution:** `GqlEditor` (Monaco) and `GraphView` (Cytoscape) are now `React.lazy(() => import(...))` behind `<Suspense>` boundaries in `QueryPage.tsx`; the `import './monaco-bootstrap'` side-effect moved out of `src/index.tsx` into `src/components/editor/GqlEditor.tsx` so it rides the lazy editor chunk. `webpack.common.js` scopes the `vendors` cacheGroup to `chunks: 'initial'` so async-only vendor code (monaco/cytoscape) stays inside the async chunk. `webpack.prod.js` re-tightened: `hints: 'error'`, `maxAssetSize: 1 MiB`, `maxEntrypointSize: 1.5 MiB` (source maps, fonts/icons, monaco workers, and async code-split chunks excluded from the accounting). Also corrected the `docs/QUALITY_GAP_ANALYSIS.md` Q-NEW-T2 row, which since 2026-05-08 falsely claimed the budget was already wired (the file still carried `hints: 'warning'` + 16 MiB caps until this commit).
- **Evidence:** webpack entrypoint `main` total 12.8 MiB → **454 KiB**; `vendors.js` ~12.5 MiB → ~290 KiB; monaco/cytoscape now ~6.7 MiB + ~3.8 MiB on-demand async chunks; build passes the `hints: 'error'` budget. `src/pages/QueryPage.test.tsx` — Suspense fallback shows then the lazy editor mounts; QueryPage source has no static editor/graph import; `src/index.tsx` no longer imports `monaco-bootstrap`.
- **Resolved date:** 2026-05-11

##### F12 (#56): uncap WS WriteTimeout and document per-frame deadlines [RESOLVED]

- **Issue:** [#56](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/56) (closed)
- **Domain:** Performance
- **Severity at close:** P1 high (PerfScore 64)
- **Closure commit(s):** `13b7d5c`
- **Resolution:** Investigation found the server-wide `WriteTimeout` was *dead config* — `cmd/server/main.go` builds its own `*http.Server` and only set `ReadHeaderTimeout`, and `httpx.WrapHandler` consumes only `MaxBodyBytes`/CORS from its `Config` — so WS streams >60s were not in fact being killed. The footgun is closed: a new `wsExemptTimeoutHandler` wraps the REST + SPA surface in a 60s `http.TimeoutHandler` and routes requests under `/ws/` *around* it (`http.TimeoutHandler` buffers the whole response and drops `http.Hijacker`, both fatal for a streaming upgrade); `httpSrv.WriteTimeout` is left at 0 with a comment, `httpSrv.IdleTimeout` is wired so an idle WS conn is still reaped. Per-frame deadlines were *already* enforced — `wsx.Conn.{ReadMessage,WriteMessage}` call `SetReadDeadline`/`SetWriteDeadline` before every frame using the per-path 30s `wsx.Options` set by `gen/ws/ws_handlers.gen.go` — and that contract is now documented in `internal/server/ws_query.go`'s `Query` doc comment and pinned by a registration regression test.
- **Evidence:** `cmd/server/main_test.go` — `TestWSExemptTimeoutHandler_RESTIsCappedWSIsNot` (REST 503 after timeout, `/ws/query` runs to completion, a path that merely contains "ws" is still capped), `TestWSExemptTimeoutHandler_FastRequestPassesThrough`, `TestWSQueryHasPerFrameWriteDeadline`.
- **Resolved date:** 2026-05-11

##### F13 (#57): gzip middleware in genapi httpx [RESOLVED genapi-paired]

- **Issue:** [#57](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/57) (closed)
- **Domain:** Performance
- **Severity at close:** P3 low (PerfScore 36)
- **Closure commit(s):** `58b285f` (geode-ui wiring) + genapi `fd31bbc`
- **Resolution:** genapi adds `pkg/httpx.Gzip` middleware — transparent gzip of text-ish JSON ≥ 1 KiB when the client sends `Accept-Encoding: gzip`; skips already-`Content-Encoding`'d responses, images/video/audio, and tiny bodies; adds `Vary: Accept-Encoding`; drops the stale `Content-Length`; pools `*gzip.Writer` at `BestSpeed`; passes `Hijack` through so WS upgrades survive. Wired via `httpx.Config{EnableCompression: true, ...}` in `cmd/server/main.go` + `server.enable_compression: true` in `geode.json`. pprof was *already* gated behind `Observability.EnableDebug` with an `authSurface` gate in the generated server template (no change needed). The jsontext encode path writes directly to the `ResponseWriter` via `json.MarshalWrite` — no intermediate buffer to pool without restructuring; that sub-item is dropped (noted in the genapi commit).
- **Evidence:** `gen/pkg/httpx/compress_test.go`; genapi `fd31bbc`.
- **Resolved date:** 2026-05-11

##### PSR-F5 (#103): on-the-fly gzip for embedded SPA assets [RESOLVED]

- **Issue:** [#103](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/103) (closed)
- **Domain:** Performance
- **Severity at close:** PerfScore +3
- **Closure commit(s):** `d5126ad`
- **Resolution:** `ui.Handler()` now gzip-compresses compressible text bundles (.js/.css/.map/.svg/.html/.json/.webmanifest/.txt) ≥ 1 KiB on the fly when the client advertises `Accept-Encoding: gzip`; the response carries `Content-Encoding: gzip` + `Vary: Accept-Encoding` and the uncompressed `Content-Length` is dropped so net/http streams chunked. `gzip.Writer`s are recycled via a `sync.Pool` (BestSpeed — bundles are already minified) so there is no allocation churn on the hot path. Already-compressed binary types (images except SVG, fonts, video/audio, wasm, zip/gzip) and tiny files are served verbatim; HEAD and 304/204/4xx never get a gzip body. The existing `index.html` no-cache vs hashed-asset-immutable behaviour is preserved.
- **Evidence:** `internal/ui/embed.go`; `TestHandlerGzipsLargeJSAsset` (decompressed body byte-matches the embedded asset, no stale Content-Length), `TestHandlerNoGzipWithoutAcceptEncoding`, `TestHandlerNoGzipForBinaryAsset`, `TestAcceptsGzip`. internal/ui coverage 86.1%.
- **Resolved date:** 2026-05-11

##### PSR-F15 (#112): precompute zero-value tls and pool_overrides wire encodings [RESOLVED]

- **Issue:** [#112](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/112) (closed)
- **Domain:** Performance
- **Severity at close:** PerfScore +2
- **Closure commit(s):** `7e611a2`
- **Resolution:** `GetProfiles` marshals one `tls` + one `pool_overrides` JSON object per revealed profile (every row for an admin). The wire shapes for the zero `conn.TLSMaterial` / `conn.PoolOverrides` — the common case, since most profiles carry neither — are now precomputed once at package init (`zeroTLSWire`, `zeroPOWire`) and returned directly, skipping a `json.Marshal` (and its scratch-buffer allocation) per zero-valued profile on the list path. The precomputed bytes are byte-identical to a fresh marshal, so the wire output is unchanged; they are read-only for all callers (they flow straight into the response codec).
- **Evidence:** `internal/server/handlers_profiles.go` (`toGenProfile` → `marshalTLS`/`marshalPoolOverrides`); `TestMarshalProfileWire_ZeroFastPath` (shared backing array via pointer identity; `bytes.Equal` vs a fresh marshal; non-zero path still encoder-driven, no aliasing of the shared constant).
- **Resolved date:** 2026-05-11

#### Quality (2)

##### Q5 (#34): typed multipart upload endpoints [RESOLVED]

- **Issue:** [#34](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/34) (closed)
- **Domain:** Quality
- **Severity at close:** Medium (PriorityScore 48)
- **Closure commit(s):** `2046289` — no genapi change needed (existing multipart `"type": "file"` support)
- **Resolution:** Declared `POST /api/v1/backups/upload` + `POST /api/v1/migrations/upload` in `geode.json` with `BackupUploadReq` / `MigrationUploadReq` (`{"file": {"type": "file", "maxSize": 67108864}}`) → `UploadResp`, using genapi's existing multipart support (React client emits a `FormData` builder + `multipart` bodyMode; the Go handler template wires `r.ParseMultipartForm` + `r.FormFile` + the per-file `maxSize` check upstream of the typed handler). The hand-rolled `mux.HandleFunc` calls are gone from `cmd/server/main.go`; `internal/server/handlers_uploads.go` implements the generated `BackupUpload` / `MigrationUpload` methods (JWT auth + admin-role + 64 MiB cap + multipart parsing now come from the genapi wrapper; the handler owns only filename sanitisation, atomic write, the 503-when-no-upload-dir, and the audit event). `MigrationsPage.tsx` / `RestorePage.tsx` call `client.migrationUpload({file: {blob, filename, contentType}})` / `client.backupUpload(...)` instead of raw `fetch`/`FormData`. Orphaned `errors.uploadFailed` locale key removed.
- **Evidence:** `internal/server/handlers_uploads_test.go` (rewritten to drive the typed handlers); `e2e/specs/09-ops.spec.ts` exercises the upload flow over the same HTTP path.
- **Resolved date:** 2026-05-11

##### Q8 (#38): typed User and Permission list responses [RESOLVED]

- **Issue:** [#38](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/38) (closed)
- **Domain:** Quality
- **Severity at close:** Medium (PriorityScore 48)
- **Closure commit(s):** `2046289` — no genapi change needed (existing `"items": {"$ref": "Schema"}` typed-list support)
- **Resolution:** `geode.json` now declares `UserList.users` as `array<User>` and adds a `Permission` schema (`permission`/`resource`/`scope`) with `PermissionList.permissions` as `array<Permission>` — so `gen/types/types.gen.go` emits `UserList.Users []User` / `PermissionList.Permissions []Permission` and the React client gets typed `User[]` / `Permission[]`. `GetUsers` / `Permissions` in `handlers_users.go` build the typed slices via `userFromRow` / new `permissionFromRow`, which project the runtime-discovered `SHOW USERS` / `SHOW PERMISSIONS FOR USER` columns onto the known fields and drop unknowns with a once-per-process `warnRowDrift` log. `src/components/admin/UsersPage.tsx` imports `User` from `@api` instead of re-declaring a structural shadow + casting `Array<unknown>`.
- **Evidence:** `internal/server/handlers_users_test.go` (typed list happy-path, drift-drops-unknown-column, typed Permissions).
- **Resolved date:** 2026-05-11

#### Security (2)

##### N2 (#64): JWT revocation and session invalidation on password change [RESOLVED]

- **Issue:** [#64](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/64) (closed)
- **Domain:** Security
- **Severity at close:** Medium (Risk 36)
- **Closure commit(s):** `ed9e69c` (initial in-memory); SQLite-backed follow-up landed 2026-05-11 — `fix: durable SQLite-backed JWT revocation store (N2 follow-up)`.
- **Resolution:** (1) Every issued JWT now carries a `jti` (RFC 7519 `ID` claim) — 128 bits from `crypto/rand`, hex-encoded — set in `jwt.Issuer.Issue`. (2) `internal/jwt/revocation.go` provides a `*RevocationSet` (one per `Issuer`, via `Issuer.Revocation()`): a `sync.Map[jti]→expiry` for per-token `Revoke`, a `sync.Map[username]→passwordChangedAt` for per-user `RevokeUser` (geode-ui has no user-attribute store of its own — users live upstream in Geode — so the "password-changed instant" map is the pragmatic equivalent of a per-user token-generation counter), `IsRevoked(*Claims)` checking both, a `Sweep(maxTokenAge)`, and `StartSweeper(ctx, interval, maxTokenAge)` (wired in `cmd/server/main.go` on a 10-minute cadence). `Issuer.Parse` consults the set after signature + standard-claim validation and returns the sentinel `jwt.ErrRevoked`; because `internal/server/auth.go` validates via `Issuer.Parse`, revocation is enforced on every REST and WS request. (3) On a successful password change — `POST /users/{u}/password` and `PATCH /users/{u}` with a `password` field — the handler calls `s.cfg.JWT.Revocation().RevokeUser(<targetUsername>)`. Clears `gosec G120`.
- **Durable backing (follow-up, 2026-05-11):** `RevocationSet.AttachSQLite(*sql.DB)` (new `internal/jwt/revocation_sqlite.go`) makes the two `sync.Map`s an in-memory **read-through cache** over a `revoked_jti(jti TEXT PRIMARY KEY, exp INTEGER)` / `password_changed_at(username TEXT PRIMARY KEY, changed_at INTEGER)` table pair that lives in the **profile-store SQLite file** — a new table pair in the existing DB, NOT a second file. The `*sql.DB` handle is obtained via the new `profilestore.DBHandleProvider` optional interface (`DBHandle() *sql.DB` on `sqliteStore`; deliberately kept off the `profilestore.Store` interface so the in-memory handler-test fakes don't need it), wired in `cmd/server/main.go` immediately after the profile store opens — no new flag, it piggybacks on `-profile-store` (so `:memory:` works for tests). At startup `AttachSQLite` runs `CREATE TABLE IF NOT EXISTS`, `SELECT`s every still-relevant row into the cache (skipping already-expired jti rows), then `DELETE`s the stale `revoked_jti` rows. `Revoke`/`RevokeUser` are write-through (SQLite first, then the cache; a SQLite write failure is logged, not fatal — the in-memory revoke still takes effect for the process lifetime). `Sweep` deletes expired rows from both layers. The hot path — `IsRevoked` — reads the cache only and issues **zero SQL per request** (verified by a backend query counter in the test suite). Net: a token revoked before a process restart stays revoked afterward, while the validation path keeps in-memory latency.
- **Evidence:** `internal/jwt/revocation_test.go` (in-memory backend regression suite — jti present + distinct, baseline validate, per-jti revoke fails / other token unaffected, expired-revoke-entry harmless + pruned, RevokeUser revokes prior tokens / not the post-change one / not other subjects, monotonic RevokeUser, Sweep prunes the right entries, sweeper stops on ctx cancel, nil-safe); `internal/jwt/revocation_sqlite_test.go` (SQLite backend: Revoke-then-IsRevoked round-trip; jti survives restart against the same db file; expired jti not re-hydrated + GC'd on restart; RevokeUser round-trip + restart-survival + post-change token still validates; Sweep removes from both the cache and SQLite; **hot-path zero-SQL-query** assertion across all `IsRevoked` branches via the backend query counter; Issuer end-to-end including a rebuilt revocation set on the same db file); `internal/server/handlers_users_test.go` (`TestUsers_ChangePassword_RevokesExistingTokens`, `TestUsers_PatchPassword_RevokesExistingTokens` incl. the email-only-PATCH-does-not-revoke regression); `internal/server/handlers_users_revocation_restart_test.go` (`TestUsers_ChangePassword_RevocationSurvivesRestart`: password-change handler → pre-change token rejected → "restart" against the same SQLite file → still rejected → post-change re-login validates). `make go-test ./internal/jwt/... ./internal/server/... ./internal/profilestore/... ./cmd/...` green; `make go-lint` clean; `make build` OK.
- **Resolved date:** 2026-05-11

##### N7-remainder (#66): global per-IP rate limiter in genapi httpx [RESOLVED genapi-paired]

- **Issue:** [#66](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/66) (closed) — supersedes the 2026-05-07 `8e9f5d2` partial
- **Domain:** Security
- **Severity at close:** Medium (Risk 32)
- **Closure commit(s):** `bc10708` (geode-ui wiring) + genapi `fd31bbc`
- **Resolution:** genapi adds `pkg/httpx.PeerLimiter` — a token bucket partitioned by client IP, applied to *every* route as a coarse abuse ceiling underneath the tighter per-route limiters (`loginlimiter.go` 5 rps/IP on `/auth/login`; `profilelimiter.go` 30 req/min per JWT subject on profile CRUD). Idle buckets are swept periodically so a flood of unique source addresses cannot pin memory. Key source is configurable via `security.rate_limit.per_ip_source` (`remote_addr` default / `x-forwarded-for` / `x-real-ip` / `tls-subject`); `per_ip_rps` of `0` disables it. 429 responses carry `Retry-After` + a `{code,description,reason}` body matching the per-route limiters. Wired via `httpx.Config{PerIPRPS: 50, PerIPBurst: 100, PerIPSource: httpx.IPSourceRemoteAddr}` in `cmd/server/main.go` + `security.rate_limit.per_ip_rps/per_ip_burst/per_ip_source` in `geode.json` (keyed on `RemoteAddr` — this server is not behind a trusted proxy that rewrites `X-Forwarded-For`).
- **Evidence:** `gen/pkg/httpx/peerlimit_test.go`; genapi `fd31bbc`. gen/pkg/httpx coverage 67.6%.
- **Resolved date:** 2026-05-11

#### Won't-do (1)

##### F18 (#61): driver re-parse stmt cache [WONT DO]

- **Issue:** [#61](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/61) (closed — won't-do)
- **Domain:** Performance
- **Severity at close:** P3 low (PerfScore 24)
- **Closure commit(s):** `06e98f1` (benchmark + doc update)
- **Reason:** Hypothesis was that the driver re-parses identical parameterised statements, so an LRU `*sql.Stmt` cache in `pool.go` would amortise that parse. Benchmark `internal/conn/pool_bench_test.go` (`BenchmarkParseVsExecute`, `BenchmarkParseFraction`) refutes the premise: (1) parse is ~10% of a modelled round-trip — under the ~20% threshold the AC set for landing the cache; and (2) more decisively, the geode driver has **no server-side prepared statements** — `geode.Conn.PrepareContext` does no round-trip and just stashes the query text, and `geode.Stmt.QueryContext` re-sends that text via `conn.QueryContext(ctx, s.query, args)`, i.e. the server re-parses on every call regardless of whether a `*sql.Stmt` was used. A stmt cache has nothing to amortise. Bench numbers: `PerQueryContext` ≈ 85–107 µs/op vs `PreparedStmtReuse` ≈ 96–107 µs/op (within noise; `PreparedStmtReuse` carries 2 extra allocs/op from the `database/sql` Stmt machinery). Re-open only if the geode driver gains real server-side prepare/parse-cache support.
- **Resolved date:** 2026-05-11

---

#### Notes on this run

- **Genapi-paired closures (2):** F13 (#57) and N7-remainder (#66), both via genapi `fd31bbc` (`pkg/httpx.Gzip` + `pkg/httpx.PeerLimiter`); the geode-ui side is config wiring + regen (`58b285f`, `bc10708`). genapi also got `5dd5f61` (plugin docs/commands/hooks refresh + sample-output regen — pre-existing in-progress work) and `7eaf8a1` (sample-output regen for the gzip + per-IP changes). genapi was **pushed to origin** (the 2026-05-10 commits `1033c50` / `df654de` / `e100aed` are now pushed too).
- **No genapi change for Q5 / Q8:** both turned out to need only `geode.json` config — multipart `"type": "file"` request schemas and `"items": {"$ref": "Schema"}` typed list items already exist upstream.
- **F12 was a footgun, not a live bug:** the server-wide `WriteTimeout` was dead config and never killed WS streams; the closure removes the dead config and adds an explicit `wsExemptTimeoutHandler` that caps REST/SPA at 60s while routing `/ws/` around it. Per-frame WS deadlines were already enforced via `wsx.Conn` + the 30s `wsx.Options`.
- **F10 entrypoint dropped 96%:** 12.8 MiB → 454 KiB. The closure also corrected the `docs/QUALITY_GAP_ANALYSIS.md` Q-NEW-T2 row, which had falsely claimed the webpack budget was already wired since 2026-05-08.
- **Still deferred (not moved here):** F3 (#25) — the streaming-response template work, the heaviest of the five 2026-05-10 deferrals (per-endpoint streaming-template design: schema flag + changed handler signature + flush wiring in `api.go.tmpl` + adapting `handlers_query.go`); design notes intact in `docs/PERF_GAP_ANALYSIS.md`, tracked at `genapi#216`.
- **Backlog status after this run:** PERF — only F3 left (deferred). QUALITY — clean (all Q-series closed; Q-NEW-T1/T3/T4 are adoption-decision-blocked tooling gaps, not engineering gaps). SECURITY — clean (all N-series closed; S-NEW-1/6 are release-eng/ops-blocked).
