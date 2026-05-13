# Gap Analysis -- Resolved (geode-ui)

- **Project:** devnw/codepros/geode/geode-ui
- **Last updated:** 2026-05-13 (gap-close pipeline run — 8 closures appended: S-NEW-5 #201, Bundle B #220/#223/#103, Bundle C #194/#195/#196, Bundle D #192; audit Phase 4 sync — GAP-028 verified-wired query history moved here from `GAP_ANALYSIS.md`)
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
- **2026-05-11 (follow-up batch — 9 closed + 1 won't-do):** Performance F10 (#54), F12 (#56), F13 (#57, genapi `fd31bbc`), PSR-F5 (#103), PSR-F15 (#112). Quality Q5 (#34), Q8 (#38). Security N2 (#64), N7-remainder (#66, genapi `fd31bbc`). Won't-do: F18 (#61). 9 geode-ui commits + 3 genapi commits (`fd31bbc`, `5dd5f61`, `7eaf8a1`; genapi pushed to origin). Still deferred at the time: F3 (#25), tracked at `genapi#216`.
- **2026-05-11 (same-day follow-up — F3 closed + N2 durable upgrade + 2 operational follow-ups):** Performance F3 (#25, genapi `38c3c1e`) — streaming `/api/v1/query` response. Security N2 (#64) durable-upgraded — JWT revocation store moved from in-memory to SQLite-backed (`internal/jwt/revocation_sqlite.go`, `RevocationSet.AttachSQLite`, `502e34f`/`3059710`); survives a process restart, validation path stays zero-DB-query. Operational follow-ups (no gap ID): genapi tsc `moduleResolution=node10` deprecation test fix (genapi `a192022` — `ignoreDeprecations "5.0"→"6.0"` in the React-runtime test scaffold; no geode-ui change); gosec G302/G304 false-positive on the upload temp file annotated (`502e34f` — `// #nosec G302 G304` + rationale; recorded as a Confirmed-Safe row in `SECURITY_GAP_ANALYSIS.md`). 4 geode-ui commits (`502e34f`, `3059710`, `bb8319d`, + the bookkeeping commit) + 2 genapi commits (`a192022`, `38c3c1e`; pushed to origin). With F3 closed, the PERF backlog's original F-series is now fully clear — no F-item left open or deferred.
- **2026-05-12 (genapi + medium-cohort batch — 9 closed + #159 deferred):** Security F-AUTH-1 (#132, `4002c6f`+genapi `e01b2de`), F-AUTH-2 (#135, `1ec9889`+genapi `30fad5d`). Performance PERF-2026-05-11-03 (#133, `8af76ca`+genapi `09d4ac8`), -06 (#142, `203a454`), -09 (#150, `9c39d57`), -10 (#154, `6e6db14`), -11 (#156, `e877465`). Quality Q02/GAP-020 (#90, `9b0a423`+genapi `55c79d2`), Q27 (#173, `2aaaebc`). Deferred: #159 (on product). 9 geode-ui commits + 1 docs-tracking + 5 genapi commits (unpushed; breaking `mcpx`/`SetAuthVerifier` API → minor bump).
- **2026-05-12 (top-10 quality/perf/CI batch — 13 issues + 1 no-issue follow-up):** Quality Q9 (#125, `a42a792`), Q39 (#134, `a42a792`), Q23 (#126, `df3fd51`), Q41 (#136, `1fea7ba`), Q10 (#144, `6abde32`), Q12 (#146, `e510cb5`), Q13 (#149, `0d629bf`), Q40 (#151, `0d629bf`), Q22 (#168, `03b6ec1`), Q38 (#180, `ea3f681`), Q32 (#127, `d35d3c7`). Performance PERF-2026-05-11-07 (#145, `a42a792`; `bench-baseline.txt` refreshed `6c14368`). Security F-SUP-3 (#153, `d35d3c7`), F-INPUT-2 (#143, `ea3f681`). No-issue follow-up: `createProfile` `as any` body cast removed (#— , `2c5895d`). Deviation: `codesign-windows-ssl@~latest` pin pending an upstream ci-catalog release (tracked via the `# ci-pins-allow:` marker + #127's `TODO`). 11 geode-ui implementation commits + 1 docs-tracking, **unpushed**.
- **2026-05-12 (errorcode cross-check + #159 — 1 issue + 1 no-issue follow-up):** Performance PERF-2026-05-11-12 (#159, `f1c6064`; pinned `eefd896`; documented `1a2016f`+`5a5e89c`) — `/api/v1/query` `rateLimit` 200→2000. No-issue follow-up: frontend↔`internal/server/errorcodes.go` error-code cross-check (no GitLab issue — was an untracked note in `QUALITY_GAP_ANALYSIS.md`; `41ed5fa`/`312eee2`/`5598434`/`1660908`). Latent genapi gap noted (not ticketed at the time): `APIOptions.GlobalRate` set-but-unused in `RegisterGeneratedAPI` — **resolved** in the GlobalRate run below. 8 implementation commits + 1 plan-doc + 1 docs-tracking, **unpushed**.
- **2026-05-12 (GlobalRate cross-route aggregate limiter — 0 GitLab issues, 1 no-issue latent gap):** the previously-noted "`APIOptions.GlobalRate`/`global_rps` set-but-unused" latent genapi gap — resolved via option A (wire it as a real aggregate ceiling): genapi `2eabc11` (template + doc + tests + self-hosted regen) + `b1ac670` (review fix: Snapshot/Allow ordering aligned + template test tightened), recommended tag `v0.3.1`; geode-ui `949d705` (regen + `internal/server/global_ratelimit_test.go` + `docs/ARCHITECTURE.md`) + `2f3c695` (regen with the aligned ordering). No GitLab issue ever existed (`glab issue list --search "GlobalRate"/"global_rps"/"aggregate rate"` → nothing). Review APPROVE-WITH-MINOR-NITS → both nits fixed in `b1ac670`/`2f3c695`. 2 geode-ui implementation commits + 1 docs-tracking, **unpushed**; genapi `main` 2 commits ahead of origin (needs push + `v0.3.1` tag).
- **2026-05-13 (audit verification — 0 GitLab issues, 1 verified-wired GAP):** GAP-028 (`useQueryHistory` recording on every query completion) verified-wired at `src/pages/QueryPage.tsx:11,19,159-191,228-237`. Recorded below (not a closure-via-commit — the feature shipped earlier in `a90cb62`/`c07668b`/`ce40930`; this audit row simply confirms the wiring against HEAD `c07668b`).
- **2026-05-13 (gap-close pipeline run — 8 issues + 13 commits):** Security S-NEW-5 (#201, `6f75a74`). Performance PERF-2026-05-13-06 (#220, `cca498b` — ~81×/131× faster limiters), PERF-2026-05-13-07 (#223, `04a199e` — ~4.3× faster schema_cache), PERF-2026-05-13-02 / GAP-022 / PSR-F5 (#103, `a3c9552` — -2 allocs/op on embed static hits; doc fixup `7e5c008`). Quality Q47 (#194, `1c57b0c` + `a562788` follow-up), Q52 (#195, `1c57b0c`), Q51 (#196, `1c57b0c`), Q48 (#192, `ac486ad`/`ff130d2`/`9c46ae8`/`0a4f36b`/`eb3a910`/`6b45ac5` — GraphView 1982→396 LOC). Verifier PASS on all 8 closures. Coverage: server +0.5pp, ui +1.5pp; jest 540/540. **13 commits on `main`, unpushed.** Full record in the "Closure batch 2026-05-13" section below.

---

### 2026-05-13 audit run — verified-wired query history

#### GAP-028: `useQueryHistory` recording on every query completion [VERIFIED]

- **Issue:** — (no GitLab issue; surfaced by the 2026-05-13 audit Phase 3 gap-detector as a potential gap, then **verified wired** in the same pass and never filed)
- **Domain:** Feature / Requirement
- **Severity at close:** n/a (verification, not a defect)
- **Closure commit(s):** `a90cb62` (feat: workspace + dashboard with persisted query history), `c07668b` (responsive sidebar + matrix view), `ce40930` (e2e: dashboard renders cards and surfaces recent queries) — shipped earlier; **verified in this audit run**, not closed by it
- **Resolution:** The `useQueryHistory` zustand store (`src/lib/useQueryHistory.ts`) is wired into `QueryPage` for **all three terminal paths**: (1) stream-run terminal status (`stream.status === 'done' | 'error'`) records once per terminal transition, keyed on `runStmtRef.current` so a later edit to `stmt` can't drift the entry; (2) sync-run success records on a 2xx response with `r.row_count ?? r.rows.length`; (3) sync-run error records with `rowCount: null, ok: false`. The dashboard's "Recent queries" card reads from the same persisted store and prefills the editor on click via `/?statement=<encoded>`, which `QueryPage` consumes mount-only via `useSearchParams` and strips immediately on read.
- **Evidence:**
  - `src/pages/QueryPage.tsx:11` — `useSearchParams` import.
  - `src/pages/QueryPage.tsx:19` — `useQueryHistory` import.
  - `src/pages/QueryPage.tsx:159-167` — mount-only `?statement=` consumer (`setStmt(s)` + `setSearchParams(next, { replace: true })`).
  - `src/pages/QueryPage.tsx:180-191` — terminal-status `useQueryHistory.getState().record({ statement: runStmtRef.current, rowCount: stream.status === 'done' ? stream.rowCount || stream.rows.length : null, ok: stream.status === 'done' })`.
  - `src/pages/QueryPage.tsx:228-237` — sync-run success + error `record(...)` calls.
- **Resolved date:** 2026-05-13 (verified; feature shipped earlier between 2026-05-12 and 2026-05-13)

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

##### PSR-F5 (#103): on-the-fly gzip for embedded SPA assets [PARTIAL — RE-OPENED 2026-05-11]

> **2026-05-11 audit Phase 3 correction:** This entry was mis-credited as a full closure. Commit `d5126ad` added gzip middleware to `ui.Handler()`, but the original PSR-F5 hot-path issue — `fs.Stat(sub, clean)` called per request at `internal/ui/embed.go:112,120` — is **not** addressed by that commit. The gzip work is genuine, but the precompute-asset-path-set acceptance criterion was never met. Issue [#103](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/103) is **kept open** under the new identifier **GAP-022**; the gzip improvement is recorded below as a partial closure for traceability. Decision pending: either (a) precompute the asset path set at init (original PSR-F5 acceptance criterion), or (b) reclassify as won't-do because `fs.Stat` on `embed.FS` is in-memory and not measurably hot.

- **Issue:** [#103](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/103) (**re-opened — partial only**)
- **Domain:** Performance
- **Severity at close:** PerfScore +3
- **Partial-closure commit(s):** `d5126ad` (gzip layer landed; hot-path precompute remains open)
- **What this commit closed:** `ui.Handler()` gzip-compresses compressible text bundles (.js/.css/.map/.svg/.html/.json/.webmanifest/.txt) ≥ 1 KiB on the fly when the client advertises `Accept-Encoding: gzip`; the response carries `Content-Encoding: gzip` + `Vary: Accept-Encoding` and the uncompressed `Content-Length` is dropped so net/http streams chunked. `gzip.Writer`s are recycled via a `sync.Pool` (BestSpeed — bundles are already minified) so there is no allocation churn on the hot path. Already-compressed binary types (images except SVG, fonts, video/audio, wasm, zip/gzip) and tiny files are served verbatim; HEAD and 304/204/4xx never get a gzip body. The existing `index.html` no-cache vs hashed-asset-immutable behaviour is preserved.
- **Still open:** `internal/ui/embed.go:112` and `embed.go:120` still call `fs.Stat(sub, clean)` per request. The "precompute the asset path set at init" acceptance criterion is unmet.
- **Evidence (gzip half):** `internal/ui/embed.go`; `TestHandlerGzipsLargeJSAsset` (decompressed body byte-matches the embedded asset, no stale Content-Length), `TestHandlerNoGzipWithoutAcceptEncoding`, `TestHandlerNoGzipForBinaryAsset`, `TestAcceptsGzip`. internal/ui coverage 86.1%.
- **Tracking:** Open as GAP-022 in `docs/GAP_ANALYSIS.md`.
- **Resolved date:** N/A (partial only)

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
- **Closure commit(s):** `ed9e69c` (initial in-memory); SQLite-backed durable follow-up landed 2026-05-11 (same-day follow-on) — `3059710` *fix: durable SQLite-backed JWT revocation store (N2 follow-up)* (the `internal/profilestore.DBHandle()`/`DBHandleProvider` plumbing it depends on is in the same commit).
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
- **Still deferred at the time (closed the same day in the follow-up below):** F3 (#25) — the streaming-response template work, the heaviest of the five 2026-05-10 deferrals; closed 2026-05-11 same-day follow-up via genapi `38c3c1e`. See the follow-up section below.
- **Backlog status after this run:** PERF — only F3 left (deferred — closed same day). QUALITY — clean (all Q-series closed; Q-NEW-T1/T3/T4 are adoption-decision-blocked tooling gaps, not engineering gaps). SECURITY — clean (all N-series closed; S-NEW-1/6 are release-eng/ops-blocked).

---

### 2026-05-11 closure run -- same-day follow-up (1 GAP closed + 1 GAP durable-upgraded + 2 operational follow-ups, 4 geode-ui commits + 2 genapi commits)

Same-day follow-on to the 2026-05-11 follow-up batch above. Clears the last 2026-05-10 deferral (F3 #25, the streaming-response template work tracked at `genapi#216`); durable-upgrades N2 (#64, already RESOLVED above as in-memory) to a SQLite-backed store; plus two operational follow-ups with no gap ID (a genapi tsc-deprecation test fix and a gosec false-positive annotation). Verifier returned GREEN: `make build` (webpack entrypoint **454 KiB** — F10 not regressed; `main.js` ~50 KB served gzip-encoded on the rebuilt e2e image, F13 working live), `make go-test` (`internal/jwt` 81.3%, `internal/server` 76.6%, `internal/profilestore` 80.9%), Jest 378/378, tsc / golangci-lint / eslint clean, gosec clean for this batch's code (G302/G304 on `handlers_uploads.go` suppressed with rationale; the higher absolute count vs prior is the gosec "dev" build's expanded ruleset, not a regression), e2e docker stack healthy + `/healthz` 2xx + full suite green (60 passed / 2 flaky-but-recovered / 5 skipped). genapi pushed to origin. One bookkeeping commit consolidates these doc updates.

#### Performance (1)

##### F3 (#25): handlers_query fully sync, TTFB == TTLB [RESOLVED genapi-paired]

- **Issue:** [#25](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/25) (closed) — was deferred-to-genapi in the 2026-05-10 run (tracked at `genapi#216`); closed in the 2026-05-11 same-day follow-up.
- **Domain:** Performance
- **Severity at close:** P1 high (PerfScore 60)
- **Closure commit(s):** `bb8319d` (geode-ui — `geode.json` streaming flag, regen, `handlers_query.go` rewrite) + genapi `38c3c1e` (per-endpoint `"streaming": true` template support)
- **Resolution:** genapi gained a per-route `"streaming": true` schema flag. For a streaming route the generated user-handler signature becomes `func(http.ResponseWriter, *http.Request, *ReqType) error` and the handler owns the entire 200 response — status, `Content-Type`, body, and flushing via `http.Flusher`. The generated wrapper still runs **every pre-handler concern** (auth/role/scope, rate limiting, body-size limit, request parsing/validation) and emits the standard `{error,error_description}` envelope for any *pre-handler* failure (incl. 501 for `ErrNotImplemented`), then flushes after the handler returns. Streaming error contract: a non-nil error returned *before any bytes are written* gets the standard envelope; an error returned *after* bytes are on the wire is logged (`http_handler_err` audit) but cannot change the status — the handler signals the failure in-band by truncating the stream. `catchAllServer` adapters dispatch streaming routes via a new `callCatchAllStream` helper; non-streaming routes are byte-identical after regen (only additive comments + the helper land in `gen/`). The genapi commit also fixed the pre-existing `TestGenerated_UsesJSONV2Imports` failure (introduced by the prior `fd31bbc` per-IP work) by switching the generated `pkg/httpx/peerlimit_test.go` to import `encoding/json/v2`. **geode-ui side:** `geode.json` marks `/api/v1/query` `"streaming": true` (just that route); `make generate` flips the `Query` signature in `gen/api/handlers_gen.go` to the streaming form; `internal/server/handlers_query.go`'s `Query` is rewritten to (1) run every pre-write step (pool check, profile selection, params parse, statement submission, column inspection) and on any such failure write the structured error envelope itself and return nil; (2) once the column descriptors are in hand, write the `{"columns":[...],"rows":[` head and **flush** — TTFB is now time-to-first-rows-arrive, not time-to-all-rows; (3) stream each row from the driver cursor as a JSON array element, flushing every 64 rows (`streamFlushEvery`), folding the graph summary inline exactly like the buffered codec, then close the document with the `row_count`/`elapsed_ms`/`graph_summary` trailer. A mid-stream `rows.Scan`/`rows.Err` failure returns the error with the body left intentionally truncated. The buffered codepath (`handleQuery`, MCP `query` tool) is unchanged — both share a new `runQuery` setup helper. **Wire shape unchanged**: still a JSON object with keys `columns`, `rows`, `row_count`, `elapsed_ms`, `graph_summary`; clients consume via `res.json()`, so the only observable change is bytes arriving sooner and a chunked (no `Content-Length`) response. No SPA change.
- **Evidence:** `internal/server/result_codec_stream_test.go` — `TestStreamQueryResult_WireShape` (200 + `application/json`, ≥1 Flush, body parses to the QueryResp keys, each streamed row decodes to the same value the buffered codec produced, graph summary matches), `TestStreamQueryResult_EmptyResult`, `TestStreamQueryResult_MidStreamError` (head already on the wire ⇒ status stays 200, body truncated/unparseable, error returned). genapi side pinned upstream by `cmd/genapi/streaming_template_test.go` (`TestStreamingRoute_GeneratesStreamingSignature`, `TestStreamingRoute_DefaultsOff`) and `TestGenerated_UsesJSONV2Imports` (now passing). E2E: the geode-ui e2e docker image was rebuilt and the query specs (`03-query-sync`, `04-query-stream`, `12-multi-request`) all pass against the streaming handler — 8/8 green; full suite 60 passed / 2 flaky-but-recovered / 5 skipped.
- **Resolved date:** 2026-05-11 (same-day follow-up)

#### Security (1 — durable upgrade of an already-RESOLVED item)

##### N2 (#64): JWT revocation store — durable SQLite backing [RESOLVED — durable upgrade]

This is an **amendment** to the N2 RESOLVED entry above (which closed N2 with an in-memory `RevocationSet` in the 2026-05-11 follow-up batch). The same day, N2 was durable-upgraded:

- **Closure commit(s):** `502e34f` (gosec annotation on the same file, separate concern) + `3059710` (the durable store + `profilestore.DBHandle()`/`DBHandleProvider` plumbing + `cmd/server/main.go` wiring).
- **What changed:** `internal/jwt/revocation_sqlite.go` — `RevocationSet.AttachSQLite(*sql.DB)` makes the two `sync.Map`s an in-memory **read-through cache** over a `revoked_jti(jti TEXT PRIMARY KEY, exp INTEGER)` / `password_changed_at(username TEXT PRIMARY KEY, changed_at INTEGER)` table pair that lives in the **existing profile-store SQLite file** (a new table pair in the existing DB, NOT a second file). The `*sql.DB` handle is obtained via the new `profilestore.DBHandleProvider` optional interface (`DBHandle() *sql.DB` on `sqliteStore` — deliberately kept off the `profilestore.Store` interface so the in-memory handler-test fakes don't need it), wired in `cmd/server/main.go` immediately after the profile store opens — no new flag, it piggybacks on `-profile-store` (`:memory:` shares the in-memory SQLite for tests). At startup `AttachSQLite` runs `CREATE TABLE IF NOT EXISTS`, `SELECT`s every still-relevant row into the cache (skipping already-expired jti rows), then `DELETE`s the stale `revoked_jti` rows. `Revoke`/`RevokeUser` are write-through (SQLite first, then the cache; a SQLite write failure is logged, not fatal — the in-memory revoke still takes effect for the process lifetime). `Sweep` deletes expired rows from both layers. The hot path — `IsRevoked` — reads the cache only and issues **zero SQL per request** (verified by an `atomic.Int64` backend query counter: 1200 `IsRevoked` calls = 0 queries after startup). Net: a token revoked before a process restart stays revoked afterward, while the validation path keeps in-memory latency. The 2026-05-11 N2 doc caveat ("in-memory; lost on restart") is removed.
- **Evidence:** `internal/jwt/revocation_sqlite_test.go` (Revoke-then-IsRevoked round-trip; jti survives "restart" against the same db file with a fresh `RevocationSet`; expired jti not re-hydrated + GC'd on restart; RevokeUser round-trip + restart-survival + post-change token still validates; `Sweep` removes from both the cache and SQLite; **hot-path zero-SQL-query** assertion across all `IsRevoked` branches via the backend query counter; Issuer end-to-end including a rebuilt revocation set on the same db file). `internal/server/handlers_users_revocation_restart_test.go` (`TestUsers_ChangePassword_RevocationSurvivesRestart`). `make go-test ./internal/jwt/... ./internal/server/... ./internal/profilestore/... ./cmd/...` green.
- **Resolved date:** 2026-05-11 (same-day follow-up — durable upgrade of the same-day in-memory close)

#### Operational follow-ups (no gap ID)

These are not GAP-* items — they are operational follow-ups recorded here for traceability:

- **genapi tsc `moduleResolution=node10` deprecation test failures** — genapi `a192022`: bumped `ignoreDeprecations` `"5.0"` → `"6.0"` in genapi's React-runtime test scaffold (`cmd/genapi/client_examples_integration_test.go`, `reactRuntimeTSConfig` const). The 3 `TestGeneratedClients_*` tests now pass. No geode-ui change — genapi doesn't ship a tsconfig in its generated React client.
- **gosec G302/G304 false-positive on the upload temp file** — geode-ui `502e34f`: added `// #nosec G302 G304` + `//nolint:gosec` with rationale to the `os.OpenFile(..., 0o640)` in `internal/server/handlers_uploads.go`. `sanitiseUploadName` enforces a `^[A-Za-z0-9._-]+$` allowlist + rejects `/`/`\`/`.`/`..` + re-checks `filepath.Base(name)==name`; `0o640` is intentional (group-readable for the backup-restore worker). Recorded as a "Confirmed-Safe" row in `docs/SECURITY_GAP_ANALYSIS.md` — not a gap.

#### Notes on this run

- **Genapi-paired closure (1):** F3 (#25) via genapi `38c3c1e` (`"streaming": true` per-route template support + the `TestGenerated_UsesJSONV2Imports` fix); the geode-ui side is `geode.json` config + regen + `handlers_query.go` rewrite (`bb8319d`). genapi also got `a192022` (the tsc-deprecation test-scaffold fix). genapi was **pushed to origin**.
- **N2 durable store is zero-DB-query on the hot path** — the `RevocationSet` cache is read-through, so `IsRevoked` (called on every authenticated REST/WS request) never touches SQLite; only `Revoke`/`RevokeUser`/`Sweep`/startup-hydration do. Restart-survival is the only behavioural change.
- **The gosec count jump is a tooling-version artifact** — the higher absolute finding count vs the prior batch is the gosec "dev" build's expanded ruleset, not a regression; no new findings come from this batch's code (the G302/G304 pair on `handlers_uploads.go` is annotated/suppressed with rationale).
- **F13 gzip confirmed live** — `main.js` (~50 KB) is served with `Content-Encoding: gzip` on the rebuilt e2e image; sub-1KiB JSON is correctly skipped.
- **Backlog status after this run:** PERF — **F-series fully clear** (F3 was the last open/deferred F-item). QUALITY — clean (all Q-series closed; Q-NEW-T1/T3/T4 adoption-decision-blocked tooling gaps). SECURITY — clean (all N-series closed, N2 now durable; S-NEW-1/6 release-eng/ops-blocked). The only remaining tracked-but-not-actionable items are the upstream-Geode-blocked GAP-002..005 and the product/release-eng deferrals (GAP-011/012, Q-NEW-T*, S-NEW-1/6).

### 2026-05-11 closure run -- audit-cohort batch (12 closed + 3 deferred-upstream, 10 geode-ui commits + 1 sibling-repo commit)

A `/codepros:gap-close` run against the 2026-05-11 audit cohort (the `F-AUTH-*`/`F-INPUT-*`/`F-SUP-*` security findings, the `PERF-2026-05-11-*` findings, and the `Q*` quality findings). The verifier ACCEPTED — full Go + frontend suites green, `cmd/server` coverage 4.0% → 65.3%, frontend 415 → 426 tests, `govulncheck ./...` clean. None of these carry a `GAP-NNN` ID in `GAP_ANALYSIS.md`; they are tracked by domain ID + GitLab issue, but recorded here for the resolved-record. Commits sit on `main` unpushed at the time of this entry.

#### Security (3)

##### F-SUP-1 (#148): Go toolchain go1.26.2 → go1.26.3 — closes 4 CALLED stdlib CVEs [RESOLVED]

- **Closure commit(s):** `d464fe6` (geode-ui) + `a7d63f3` (sibling `../geode-client-go`, branch `codex/client-parity-sync` — separate PR/merge there still pending).
- **Resolution:** all 5 repo refs bumped — `Makefile:3`, `scripts/run-go.sh:9`, `scripts/check-go-mod-tidy.sh:10`, `.gitlab-ci.yml:242`, `deploy/Dockerfile:45` — now `go1.26.3`; the sibling `go.mod` now `toolchain go1.26.3`. `govulncheck ./...` → "No vulnerabilities found": GO-2026-4980 / 4982 (HTML escaper bypass ×2), GO-2026-4918 (HTTP/2 SETTINGS infinite loop), GO-2026-4971 (`net.Dial` NUL panic) are no longer CALLED. Release-blocker → cleared.
- **Evidence:** `govulncheck ./...` clean; full Go test suite green at `d464fe6`.
- **Resolved date:** 2026-05-11

##### F-INPUT-1 (#140): `quoteString` escapes backslash to match the authoritative GQL escaper [RESOLVED]

- **Closure commit(s):** `454d0ba`
- **Resolution:** `internal/server/quoting.go:78-79` now escapes `\` → `\\` *before* `'` → `''`, matching `../geode-client-go/conn.go:849-861 gqlStringEscaper`. Control characters are still rejected outright (stricter than the authoritative escaper, which permits them).
- **Evidence:** `internal/server/quoting_test.go:149-181 TestQuoteString_BackslashEscape` (9 cases).
- **Resolved date:** 2026-05-11

##### F-SUP-4 (#160): electron / electron-builder pulled into devDependencies; electron-tsc is a real CI gate [RESOLVED]

- **Closure commit(s):** `f444c70` (also closes Q25 / #170)
- **Resolution:** `package.json` devDeps gain `electron@^42.0.1` + `@types/node@^22.19.19`; `package-lock.json` updated; `.gitlab-ci.yml electron-typecheck` job no longer `allow_failure`; `npm run electron:tsc` exits 0 with no source changes needed. **Caveat:** `pnpm-lock.yaml` was NOT regenerated — pnpm refuses in this repo (`packageManager: npm`); the dual-lockfile cleanup remains tracked separately as GAP-017 / #44.
- **Evidence:** `npm run electron:tsc` → exit 0; CI `electron-typecheck` is now blocking.
- **Resolved date:** 2026-05-11

#### Performance (4)

##### PERF-2026-05-11-01 (#128): server-side schema-discovery cache (Labels / EdgeTypes) [RESOLVED]

- **Closure commit(s):** `c4ef58c`
- **Resolution:** new `internal/server/schema_cache.go` — 120s TTL, `singleflight` coalescing, key `{profile, graph, kind}`. `handlers_schema.go`'s Labels / EdgeTypes routes now read through the cache; profile create/update/delete invalidates all entries (`handlers_profiles_crud.go:85,160,196`). Renderer-side cache (#154) was NOT in scope and remains open (pairs with this finding as the "schema-explorer story" bundle in `PERF_GAP_ANALYSIS.md`).
- **Evidence:** `internal/server/handlers_schema_cache_test.go` — 6 cache tests + `BenchmarkLabels` / `BenchmarkEdgeTypes`.
- **Resolved date:** 2026-05-11

##### PERF-2026-05-11-02 / -04 / -08 (#130 / #137 / #147): collapse the streaming render storm — single-render-storm bundle [RESOLVED]

- **Closure commit(s):** `4698645` (one commit, all three findings)
- **Resolution:** (02 / #130) `src/pages/QueryPage.tsx:313 streamStateToResp` wrapped in `useMemo` so its identity is stable across frames — `projectColumns` no longer recomputes per row. (04 / #137) `src/lib/queryStream.ts:82-83` dispatches one `rowBatch` action per WS frame; `src/pages/queryStreamReducer.ts:89` adds the `rowBatch` case (one `rowsVersion` bump per frame instead of one per row) — server batching is no longer defeated by per-row demux. (08 / #147) `src/components/results/JsonView.tsx:33,37` `React.memo` + `useMemo(JSON.stringify)` so the response is re-stringified only when it actually changes.
- **Evidence:** updated `queryStream.test.ts`; new `JsonView.test.tsx`, `QueryPage.streamMemo.test.tsx`, `queryStreamReducer.test.ts` cases. Frontend suite 415 → 426 tests, all green.
- **Resolved date:** 2026-05-11

#### Quality (5)

##### Q35 (#129): `build` CI job gated on typecheck / unit-tests / audit-ratchets [RESOLVED]

- **Closure commit(s):** `790cdcb`
- **Resolution:** `.gitlab-ci.yml` `build:` `needs:` now includes `typecheck`, `unit-tests`, `audit-ratchets` (plus `install`, `eslint`) — the build can no longer ship while those jobs are red.
- **Evidence:** `.gitlab-ci.yml` `build:` `needs:` block; pipeline DAG.
- **Resolved date:** 2026-05-11

##### Q36 (#131): `go.mod` uses a relative `replace` path for `geode-client-go` [RESOLVED]

- **Closure commit(s):** `210133e`
- **Resolution:** `go.mod:5` now `replace geodedb.com/geode => ../geode-client-go` (relative, portable); `make go-test` / `go-build` resolve it; CI's `go mod edit -replace` step still works (now functionally redundant).
- **Evidence:** `make go-test` green; `go.mod:5`.
- **Resolved date:** 2026-05-11

##### Q25 (#170): `electron:tsc` is a real CI gate [RESOLVED]

- **Closure commit(s):** `f444c70` (same commit closes F-SUP-4 / #160 — see the security entry above for details)
- **Resolution:** `allow_failure` removed from the `electron-typecheck` job; `electron` + `@types/node` added to devDependencies; `npm run electron:tsc` exits 0. Crossover with `GAP-009` (electron CI job) — that entry is hardened by this same commit.
- **Resolved date:** 2026-05-11

##### Q16 / Q26 (#158 / #172): decompose the `cmd/server/main.go` god-main + bootstrap unit tests [RESOLVED]

- **Closure commit(s):** `adf6b6f`
- **Resolution:** `cmd/server/main.go` is now a 12-line shim; the logic moved to new `cmd/server/app.go` (`appConfig` / `parseFlags` / `newApp` / `(*app).serve` / `run`) + new `cmd/server/profileseed.go`; `internal/profilestore.NewCipherFromEnvFunc` added. New `cmd/server/app_test.go` (6 tests incl. `TestRun_MissingJWTSecret_ExitsNonZero`, `TestNewApp_HappyPath` healthz=200, `TestNewApp_WiresMCPAuthVerifier`). `cmd/server` coverage **4.0% → 65.3%**. Side effect: Q38 (#180, shutdown error swallowed) is now a trivial follow-up — `(*app).serve` already returns the shutdown error; left open.
- **Evidence:** `cmd/server/app_test.go`; `go test -cover ./cmd/server/...` → 65.3%.
- **Resolved date:** 2026-05-11

#### Deferred to upstream genapi (NOT closed — kept open with documented unblock steps)

- **F5 / PERF-2026-05-11-03 (#133)** — obsx audit-log per-call allocations. Fix lives in `~/src/devnw/go/genapi/obsx`: combine the JSON payload + trailing newline into a single `Write`; wrap stdout in a `bufio.Writer`; skip the `RedactSensitiveKeys` map clone when there are no sensitive keys; pool the per-call map; add `BenchmarkLogAudit`; then `make generate` in geode-ui to pick up `gen/pkg/obsx/log.go`. Issue kept open with the `upstream::genapi` label; cross-link the genapi tracker once filed.
- **F-AUTH-2 (#135)** — MCP per-tool role enforcement. Fix in `~/src/devnw/go/genapi`: emit a per-tool `required_roles` table alongside `NewTools` (the analogue of REST's per-route role gate), consulted between auth-verify and dispatch. **Depends on F-AUTH-1's context-threading landing upstream first.** Kept open; `upstream::genapi`.
- **F-AUTH-1 full fix (#132)** — the in-repo mitigation is committed (`c46e77e`): `internal/server/mcp.go`'s `MCPServer.Query` now reads a JWT-enriched context stashed per-goroutine by `MCPAuthVerifier` / `WrapMCPHTTP` (wired in `cmd/server/app.go:298-299`), with a fail-safe fallback to `context.Background()` → "default" only for non-HTTP transports; pinned by `internal/server/mcp_profile_test.go` (+4 incl. `TestMCPQuery_CrossProfileIsolation`). The *full* fix threads `context.Context` natively through `MCPServerInterface.Query` / `mcpx.Tool` / `mcpx.SetAuthVerifier` in the genapi MCP template. **#132 stays OPEN** until the generated MCP path carries the request context natively; do not close before then.

#### Notes on this run

- **Sibling-repo merge pending:** F-SUP-1's cross-module commit (`a7d63f3` in `../geode-client-go`) landed on branch `codex/client-parity-sync`, not `main` — a separate PR/merge there is still outstanding.
- **`pnpm-lock.yaml` deliberately not regenerated** — `packageManager: npm` makes pnpm refuse; the dual-lockfile cleanup stays tracked at GAP-017 / #44.
- **#154 (renderer-side schema cache) NOT in scope** — the server-side half (#128) closed; the renderer cache + AbortController half stays open, partly mitigated by the new 120s server cache.
- **#180 (Q38, shutdown error)** — now a trivial follow-up after `adf6b6f`; left open.
- **Commits unpushed:** the 10 geode-ui implementation commits + the docs-tracking commit sit on `main` unpushed at the time of this entry; the user pushes.

### 2026-05-12 closure run -- genapi + medium-cohort batch (9 closed + #159 deferred; 9 geode-ui commits + 5 genapi commits)

A `/codepros:gap-close` run that landed the **upstream genapi follow-ups** deferred from the 2026-05-11 run (F-AUTH-1 #132, F-AUTH-2 #135, F5/PERF-2026-05-11-03 #133, Q02/#90 -- all needed a genapi change) plus a **medium in-repo cohort** (PERF-2026-05-11-06 #142, -09 #150, -10 #154, -11 #156; Q27 #173). The verifier ACCEPTED -- full Go + frontend suites green in both repos (`make go-test -race`, `make go-lint`, `make generate` clean, `npm test` 453/453, `make bench-gate`), no regressions. Only `GAP-020` (Q02/#90) carries a `GAP-NNN` ID in `GAP_ANALYSIS.md`; the rest are tracked by domain ID + GitLab issue, recorded here for the resolved-record. Commits sit on `main` unpushed at the time of this entry; the 5 genapi commits sit on genapi `main` unpushed (user decides on pushing/tagging genapi).

> ⚠️ **genapi API break:** genapi `e01b2de` + `30fad5d` change `mcpx.Tool` / `MCPServerInterface` / `SetAuthVerifier` -> the next genapi release should be a **minor bump**. Other genapi consumers (notably `devnw.dev/oidc`) must regenerate, update their `MCPServerInterface` impls to the new `ctx`-carrying signatures, and add `defer obsx.FlushLogs()` on shutdown (genapi `09d4ac8`).

#### Security (2)

##### F-AUTH-1 (#132): MCP `query` tool reads JWT profile claim via natively-threaded context -- per-goroutine stash removed [RESOLVED]

- **Issue:** [#132](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/132) (closed)
- **Domain:** Security
- **Severity at close:** High (RiskScore 20; was a release-blocker)
- **Closure commit(s):** `4002c6f` (geode-ui) + genapi `e01b2de` (+ `1ffa8eb` precursor)
- **Resolution:** genapi threads `context.Context` natively through the MCP tool path: `mcpx.Tool` takes a `ctx` param; `MCPServerInterface.Query(ctx, params)`; `mcpx.SetAuthVerifier` takes `func(*http.Request)(context.Context,error)`. geode-ui regen'd `gen/mcp/tools.gen.go` (`Query(ctx, ...)`) + `gen/pkg/mcpx/engine.go`; `internal/server/mcp.go`'s `MCPServer.Query(ctx, params)` -> `handleQuery(ctx, params)`; the per-goroutine stash (`mcpQueryContext`/`mcpRequestCtx`/`goID`/`WrapMCPHTTP`) is deleted; `MCPAuthVerifier func(*http.Request)(context.Context,error)` runs `AuthJWT` (mutates `*r` so `r.Context()` carries `profileCtxKey`/`rolesCtxKey`) and returns `r.Context()`. The in-repo mitigation `c46e77e` is fully superseded.
- **Evidence:** `internal/server/mcp_profile_test.go` -- `TestMCPQuery_CrossProfileIsolation`, `TestMCPQuery_AppliesProfileClaim`, `TestMCPQuery_AuditAttributedToJWTProfile`, `TestMCPQuery_NoTokenFallsBackToDefault` (all against the native path); full Go suite green; `make generate` clean.
- **Resolved date:** 2026-05-12

##### F-AUTH-2 (#135): MCP per-tool role enforcement mechanism; `query` keeps no-role policy [RESOLVED]

- **Issue:** [#135](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/135) (closed)
- **Domain:** Security
- **Severity at close:** Medium (RiskScore 12)
- **Closure commit(s):** `1ec9889` (geode-ui) + genapi `30fad5d`
- **Resolution:** genapi adds `mcpx.ContextWithRoles`/`RolesFromContext`/`SetToolRoles` + a `handleRaw` gate (no roles in ctx + tool requires a role -> audit + JSON-RPC `-32000 "insufficient role"`, tool body never runs) + `mcpToolRoles` template emission. geode-ui's `geode.json` `query` tool deliberately declares **NO** required role (matches the `POST /api/v1/query` REST route, which has none) so behavior is unchanged; `internal/server/mcp.go` re-publishes JWT roles via `mcpx.ContextWithRoles(ctx, rolesFromContext(ctx))`. Upstream genapi tests cover sufficient / insufficient / none-declared.
- **Evidence:** upstream genapi role-gate tests; geode-ui Go suite green; `geode.json` `query` tool has no `required_roles` (intentional).
- **Resolved date:** 2026-05-12

#### Performance (5)

##### PERF-2026-05-11-03 / F5 (#133): obsx.LogAudit -- buffered single-write audit log + pooled redaction + skip-clone-when-clean [RESOLVED]

- **Issue:** [#133](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/133) (closed)
- **Domain:** Performance
- **Severity at close:** P1 (PerfScore 60)
- **Closure commit(s):** `8af76ca` (geode-ui regen + wiring) + genapi `09d4ac8`
- **Resolution:** genapi `pkg/obsx/log.go` -- `bufio.Writer` 64 KiB over stdout, `FlushLogs()` exported, 100 ms flush ticker, single `Write` per record under `logMu`, pre-scan skips the redact-clone when no sensitive key (crash-loss tradeoff commented) -- + `log_hooks.go` (pooled `[]any` slog args) + `bench_test.go` (`BenchmarkLogAudit`: 8->7 allocs/op, ~23% smaller B/op on the clean case) + `templates/server.go.tmpl` (generated `Serve()` defers `obsx.FlushLogs()`). geode-ui regen `gen/pkg/obsx/`; `cmd/server/app.go` `defer obsx.FlushLogs()` in `run` + eager flush on fatal-init/serve-error paths. 355 `obsx.LogAudit` call sites unchanged. **Out of scope:** pooling the caller-built `map[string]any` literals at those 355 sites (needs an obsx API change).
- **Evidence:** genapi `pkg/obsx/bench_test.go BenchmarkLogAudit` (allocs/op + B/op deltas); geode-ui Go suite green; `make generate` clean.
- **Resolved date:** 2026-05-12

##### PERF-2026-05-11-06 (#142): audit-ring snapshot -- right-size allocation (count-then-copy under lock), encode outside lock [RESOLVED]

- **Issue:** [#142](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/142) (closed)
- **Domain:** Performance
- **Severity at close:** P2 (PerfScore 45)
- **Closure commit(s):** `203a454`
- **Resolution:** `internal/server/audit.go` `snapshot` rewritten to a two-pass count-then-copy (`cap == matchCount`, not `cap == r.count` -- saves ~560 KiB per `/api/v1/audit` poll on a near-full 10k ring); `handlers_audit.go` already marshals JSON after `snapshot` returns. Did **not** shard -- the bench showed append latency is mutex-handoff-bound, not alloc-bound.
- **Evidence:** `internal/server/audit_test.go` -- `TestAuditRing_SnapshotSinceExact`, `TestAuditRing_SnapshotSinceUnderConcurrentAppend` (`-race`), `BenchmarkAuditRing_ConcurrentAppendSnapshot` (~25% less per-op churn from the background snapshot).
- **Resolved date:** 2026-05-12

##### PERF-2026-05-11-09 (#150): split a read-only WAL `*sql.DB` for JWT revocation reads [RESOLVED]

- **Issue:** [#150](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/150) (closed)
- **Domain:** Performance
- **Severity at close:** P2 (PerfScore 36)
- **Closure commit(s):** `9c39d57`
- **Resolution:** `internal/profilestore/sqlite.go` opens a second `*sql.DB` on the same file (`file:<path>?mode=ro&_pragma=busy_timeout(5000)`, `SetMaxOpenConns/IdleConns = max(2, GOMAXPROCS)`); `DBHandleRO()` added to `DBHandleProvider`; `Close()` closes both (aliases to the writer for in-memory DBs); `internal/jwt/revocation.go` `AttachSQLiteRW(rw, ro)` (writes via rw, hydration SELECTs via ro; `AttachSQLite(db)` preserved as `AttachSQLiteRW(db, db)`); `cmd/server/app.go` wires `DBHandle()` + `DBHandleRO()`. `mode=ro` enforced (test asserts the RO handle rejects writes).
- **Evidence:** `internal/profilestore` / `internal/jwt` `-race` concurrency tests (8xN RO reads vs CRUD/Revoke churn -- no deadlock); RO-handle-rejects-writes test; `BenchmarkRevocationReloadUnderWrite`.
- **Resolved date:** 2026-05-12

##### PERF-2026-05-11-10 (#154): shared schema cache + AbortController for LabelList/EdgeTypeList [RESOLVED]

- **Issue:** [#154](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/154) (closed)
- **Domain:** Performance
- **Severity at close:** P2 (PerfScore 30)
- **Closure commit(s):** `6e6db14`
- **Resolution:** new `src/components/schema/schemaCache.ts` (bounded LRU keyed `kind:graph`, shared by all four schema reads); `SchemaExplorer.tsx` migrated onto it via a pair-accessor shim (its F8 tests still pass); `LabelList.tsx`/`EdgeTypeList.tsx` cache-hit synchronously + arm a fresh `AbortController` per graph change (gating `setState` on `signal.aborted`). Comment cites the #128 server-side cache as the cold-miss backstop.
- **Evidence:** `LabelList.test.tsx` / `EdgeTypeList.test.tsx` (+6 cases: re-select zero wire calls, mid-flight abort, LRU eviction); frontend suite green.
- **Resolved date:** 2026-05-12

##### PERF-2026-05-11-11 (#156): CI perf gate + documented SLOs [RESOLVED]

- **Issue:** [#156](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/156) (closed)
- **Domain:** Performance
- **Severity at close:** P2 (PerfScore 30; foundational)
- **Closure commit(s):** `e877465`
- **Resolution:** `Makefile` `bench-gate`/`bench-baseline`/`bench-record` targets; `scripts/bench-gate.sh` (benchstat gate, `-bench=. -benchmem -run='^$' -benchtime=100ms -count=6` over the curated bench-bearing packages, fails on >10% regression in any metric -- self-verified via perturb-and-fail); `.gitlab-ci.yml` `bench-gate` job (`allow_failure: true`, informational-leaning given CI noise); `bench-baseline.txt` committed at repo root (generated post-#142/#150); `docs/ARCHITECTURE.md` "Performance SLOs (assumed, pending real telemetry)" section (~2000 rps `/api/v1/query`, ~400 burst, result-set distribution, upstream p50 ~10 ms, 400+-node graph, webpack bundle budget -- all marked assumed-not-measured) + the **#159 open question** (`/api/v1/query rateLimit=200` vs ~2000-rps target -- deliberately NOT changed; awaiting product decision) + a pprof-gated-behind-`Observability.EnableDebug` note + baseline-refresh instructions. `geode.json rateLimit` unchanged.
- **Evidence:** `make bench-gate` green in the verifier run; `scripts/bench-gate.sh` perturb-and-fail self-check; `docs/ARCHITECTURE.md` "Performance SLOs" section.
- **Resolved date:** 2026-05-12

#### Quality (2)

##### Q02 / GAP-020 (#90): `as unknown as` path-param casts in `src/api/profiles.ts` removed [RESOLVED]

- **Issue:** [#90](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/90) (closed); upstream root cause [genapi#216](https://gitlab.com/devnw/apps/genapi/-/work_items/216)
- **Domain:** Quality
- **Severity at close:** High (PriorityScore -- api-contract; `GAP-020` Medium)
- **Closure commit(s):** `9b0a423` (geode-ui) + genapi `55c79d2`
- **Resolution:** genapi `client_templates.go` + `client_react.ts.tmpl` + `client_go_rest.go.tmpl` -- `expandPath`/`expandRoute` now map URL path tokens to snake_case schema keys (`[["profileId","profile_id"]]`), read `payload[schemaKey]`, substitute `{token}` (still `encodeURIComponent`'d), `delete payload[schemaKey]` before sending the body. geode-ui `geode.json` `UpdateProfileReq` gains required `profile_id`; regen `gen/`; `src/api/profiles.ts` `updateProfile`/`deleteProfile` call the typed client directly (no cast). **Note:** `createProfile`'s `as any` body-shape cast is a *different* cast and remains -- out of scope; tracked as a small follow-up in `QUALITY_GAP_ANALYSIS.md`.
- **Evidence:** upstream `cmd/genapi/path_params_test.go` cases added; geode-ui frontend suite green; `make generate` clean; `grep "as unknown as" src/api/profiles.ts` -> 0 hits.
- **Resolved date:** 2026-05-12

##### Q27 (#173): tests for `src/components/ops` destructive pages [RESOLVED]

- **Issue:** [#173](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/173) (closed)
- **Domain:** Quality
- **Severity at close:** High (PriorityScore 12)
- **Closure commit(s):** `2aaaebc`
- **Resolution:** new `BackupPage.test.tsx` (8) / `MigrationsPage.test.tsx` (9) / `RestorePage.test.tsx` (6) -- confirm-modal flows, error-envelope rendering in `role="alert"`, wire-feature-missing 501 banner + disabled controls, happy/empty list states. `src/components/ops` line coverage **28% -> 91.87%** (Backup 92.5%, Migrations 95.3%, Restore 100%). No coverage gate added -- Q14/#48 owns that (separate, still open).
- **Evidence:** `BackupPage.test.tsx` / `MigrationsPage.test.tsx` / `RestorePage.test.tsx`; `npm test` 453/453 green; coverage report 91.87% for `src/components/ops`.
- **Resolved date:** 2026-05-12

#### Still open after this run

- **#159 (PERF-2026-05-11-12)** -- `/api/v1/query` per-route `rateLimit=200` vs the documented ~2000-rps target. **Deliberately unchanged**; now documented in `docs/ARCHITECTURE.md` as an explicit open question. Awaiting a product decision on whether 2000 rps is the budget for `/query` specifically. **Not closed.**
- **`createProfile`'s `as any` body cast** (`src/api/profiles.ts`) -- a different cast from the path-param casts Q02 closed; small follow-up, not yet ticketed.

#### Notes on this run

- **genapi commits unpushed:** the 5 genapi commits (`1ffa8eb` artifact refresh, `e01b2de` #132 mcpx ctx threading, `30fad5d` #135 mcpx role gate, `09d4ac8` #133 obsx buffered logging, `55c79d2` #90 client/react expandPath) sit on genapi `main` ahead of origin -- the user decides on pushing/tagging genapi. They are **breaking** for other genapi consumers (`mcpx.Tool`/`MCPServerInterface`/`SetAuthVerifier`) -> next genapi release should be a minor bump; `devnw.dev/oidc` must regenerate + update its `MCPServerInterface` impls + add `defer obsx.FlushLogs()` on shutdown.
- **geode-ui commits unpushed:** the 9 geode-ui implementation commits (`4002c6f`, `1ec9889`, `8af76ca`, `9b0a423`, `203a454`, `9c39d57`, `6e6db14`, `2aaaebc`, `e877465`) + the docs-tracking commit sit on `main` unpushed at the time of this entry; the user pushes.
- **In-repo mitigation `c46e77e` superseded:** the per-goroutine MCP-context stash is deleted by `4002c6f` -- F-AUTH-1's full fix replaces the 2026-05-11 mitigation entirely.

---

### 2026-05-12 closure run -- top-10 quality / perf / CI batch (13 issues + 1 no-issue follow-up; 11 geode-ui commits + 1 docs-tracking, unpushed)

A second `/codepros:gap-close` run on 2026-05-12 landing the top-priority quality backlog (`streamQueryResult` cleanup, error-code taxonomy, `CONVENTIONS.md`, `IsRevoked` flatten, `Login` decomposition, `WSServer.Query` decomposition + cancel-reader lifetime, list-endpoint empty-result rule, graceful-shutdown error propagation, CI tool-ref pinning) plus one perf quick-win (per-row `MarshalWrite`) and one security item (ciphertext truth-table). Verifier returned **ACCEPT-WITH-NOTES** -- full suite green (`make go-test -race`, `make go-lint`, `make generate` clean, `make bench-gate`, `npm test` 453/453); coverage up on every touched package (`internal/server` 77.1→78.2%, `internal/jwt` 81.0→82.5%, `internal/profilestore` 80.7→81.0%, `cmd/server` 65.3→70.7%); no regressions. The one note (was `genapi@v0.3.0` the exact tag `gen/` was generated against?) is **resolved**: `git rev-parse v0.3.0^{commit}` in `~/src/devnw/go/genapi` == `55c79d2` == genapi `main` HEAD == the working copy `gen/` was regenerated against -- so the CI pin is correct. None of these carry a `GAP-NNN` ID in `GAP_ANALYSIS.md`; they are tracked by domain ID + GitLab issue, recorded here for the resolved-record. The 11 implementation commits + the docs-tracking commit sit on `main` **unpushed** at the time of this entry; the user pushes.

#### Quality (11)

##### Q9 (#125) + Q39 (#134): `streamQueryResult` cleanup -- `errWriter` shim, mid-stream-abort logging, per-row `MarshalWrite` [RESOLVED]

- **Issue:** [#125](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/125) (closed) + [#134](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/134) (closed)
- **Domain:** Quality (also closes Perf #145 -- see Performance section below)
- **Severity at close:** PriorityScore 20 (#125) / 15 (#134)
- **Closure commit(s):** `a42a792`
- **Resolution:** `internal/server/result_codec.go`: `errWriter` first-error-latching shim; `streamQueryResult` flattened (gocognit < ~20; golangci-lint 0 issues); `midStreamAbort()` emits `slog.Warn` on every post-head error path (`stage`/`rows_sent`/`elapsed_ms`/`err`); `writeTrailer()` helper; per-row `json.MarshalWrite(bw, row)` replaces the per-row `json.Marshal`→`bw.Write` (one `[]byte`/row removed -- 256-row box 3646→3389 allocs/op, 183648→147212 B/op). `scripts/bench-gate.sh` now skips the `geomean` summary row in its regression check.
- **Evidence:** `internal/server/result_codec_test.go` + `BenchmarkStreamQueryResult_PerRowAlloc`; `result_codec_stream_test.go` +slog-capture assertion in `TestStreamQueryResult_MidStreamError`. `bench-baseline.txt` refreshed in `6c14368`.
- **Resolved date:** 2026-05-12

##### Q23 (#126): centralise error-code taxonomy in `internal/server/errorcodes.go` [RESOLVED]

- **Issue:** [#126](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/126) (closed)
- **Domain:** Quality
- **Severity at close:** PriorityScore 15
- **Closure commit(s):** `df3fd51`
- **Resolution:** new `internal/server/errorcodes.go` -- 62 `ErrCode*` constants grouped by area + `allErrorCodes`/`errorCodeSet`. ~100 literal occurrences (38 distinct codes) migrated across 17 handler/helper files; **wire values byte-identical** (verified `ErrCodeInvalidCredentials == "invalid_credentials"` etc., no drift).
- **Evidence:** new `internal/server/errorcodes_test.go` -- dep-free `go/ast` golden test asserting every `code:`/`Code:`-position literal is an `ErrCode*` constant + no dead constants (verified it catches a planted straggler); full Go suite green.
- **Resolved date:** 2026-05-12

##### Q41 (#136): add `internal/server/CONVENTIONS.md` [RESOLVED]

- **Issue:** [#136](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/136) (closed)
- **Domain:** Quality
- **Severity at close:** PriorityScore 15
- **Closure commit(s):** `1fea7ba`
- **Resolution:** new `internal/server/CONVENTIONS.md` -- 6 sections, each `file`-cited: error-code taxonomy → `errorcodes.go`; empty-result rule + the single-resource-404 split; wire-feature-missing fallback + `errWireFeatureMissing` sentinel; per-row dual-key forward-compat in `policyFromRow`/`roleFromRow`; `auditEvent*` naming + `emitAudit` best-effort + substring redaction; the `withConnDBAndIdent`/`writeEndpointError`/`badRequest` envelope helpers + the JWT→connDB→quoted-ident admin-RBAC skeleton. `README.md` pointer added.
- **Evidence:** `internal/server/CONVENTIONS.md` present; markdownlint clean; `README.md` links it.
- **Resolved date:** 2026-05-12

##### Q10 (#144): flatten `IsRevoked` hot path -- extract `jtiRevoked` / `subjectRevokeAll` [RESOLVED]

- **Issue:** [#144](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/144) (closed)
- **Domain:** Quality
- **Severity at close:** PriorityScore 15
- **Closure commit(s):** `6abde32`
- **Resolution:** `internal/jwt/revocation.go` -- extracted `jtiRevoked(jti, now) bool` (preserves lazy-GC of expired entries + fail-closed non-`time.Time`→revoked) and `subjectRevokeAll(sub, iat) bool` (preserves `!iat.After(changedAt)`); `IsRevoked` flattened to two `if`s.
- **Evidence:** `internal/jwt/revocation_test.go` +`TestIsRevoked_DefensiveNonTimeEntries`; `internal/jwt` coverage 81.0% → **82.5%**.
- **Resolved date:** 2026-05-12

##### Q12 (#146): decompose `Login` handler -- `denyLogin` / `mintAndSetAuthCookie` / `adminRolesFor` [RESOLVED]

- **Issue:** [#146](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/146) (closed)
- **Domain:** Quality
- **Severity at close:** PriorityScore 15
- **Closure commit(s):** `e510cb5`
- **Resolution:** `internal/server/handlers_auth.go` -- extracted `denyLogin(w, authStart, reason, username, password, profile)` (SEC-N10 constant-time path: `performDummyCompare`→`emitAudit`→`respectLoginLatencyFloor`→`writeEndpointError(401)` order + arithmetic byte-preserved; `authStart` captured at the same point), `mintAndSetAuthCookie(w, token, exp) int64` (SEC-F7 cookie attrs + `expires_in>=1` clamp, returns the clamped value), `adminRolesFor(username, upstreamRoles) []string`. Security-reviewed: no timing-profile change between success/failure paths.
- **Evidence:** `internal/server/handlers_auth_test.go` +`TestAdminRolesFor`, +`TestMintAndSetAuthCookie`; pinning tests (`TestLogin_FailureBodyIsIdentical_AcrossModes`, `TestLogin_LatencyFloor`, …) + `loginlimiter_test.go` + `auth_test.go` pass unchanged.
- **Resolved date:** 2026-05-12

##### Q13 (#149) + Q40 (#151): decompose `WSServer.Query` + fix cancel-reader goroutine lifetime [RESOLVED]

- **Issue:** [#149](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/149) (closed) + [#151](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/151) (closed)
- **Domain:** Quality
- **Severity at close:** PriorityScore 15 (#149) / 8 (#151)
- **Closure commit(s):** `0d629bf`
- **Resolution:** `internal/server/ws_query.go` -- extracted `startCancelReader(conn, cancel, done) <-chan struct{}` (coordinator + bounded relay; selects on `<-done` so it exits on the happy path) and `streamRowsOverWS(conn, rows, cols, batcher) (int64, error)`. `Query` now `defer close(done)`s and is a thin sequencer. Test-only `onCancelReaderExit func()` hook; `errStreamAborted` sentinel (terminal error frame written ≠ transport failure). The cancel-reader goroutine no longer outlives the handler.
- **Evidence:** `internal/server/ws_query_test.go` +`TestStartCancelReader_ExitsOnDone`, +`TestStartCancelReader_CancelsOnError`; verified `-race` clean, no goroutine leak.
- **Resolved date:** 2026-05-12

##### Q22 (#168): pin the list-endpoint empty-result / wire-feature-missing rule with tests [RESOLVED]

- **Issue:** [#168](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/168) (closed)
- **Domain:** Quality
- **Severity at close:** PriorityScore 12
- **Closure commit(s):** `03b6ec1`
- **Resolution:** new `internal/server/list_handlers_test.go` -- asserts every list endpoint (`GetRoles`/`GetPolicies`/`GetBackups`/`GetUsers`/`GetMigrations`, schema lists, `Audit`) returns non-nil empty slices and renders `[]`/`{"...":[]}` not `null` -- both on empty result and on an `isWireFeatureMissing` upstream. **No production code changed:** all handlers already satisfied the invariant (audited + verified the test fails when a regression is introduced).
- **Evidence:** `internal/server/list_handlers_test.go`; full Go suite green; perturb-and-fail self-check.
- **Resolved date:** 2026-05-12

##### Q38 (#180): propagate + log the graceful-shutdown error [RESOLVED]

- **Issue:** [#180](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/180) (closed)
- **Domain:** Quality
- **Severity at close:** PriorityScore 4
- **Closure commit(s):** `ea3f681` (same commit as SEC F-INPUT-2 #143)
- **Resolution:** `cmd/server/app.go` -- `errGracefulShutdown` sentinel + configurable `shutdownBudget` field (default 5s); `serve` wraps the `Shutdown` error (not discarded); `run` logs **WARN** for the shutdown-timeout case, ERROR for fatal listener errors. Verified no `_ = httpSrv.Shutdown(...)` anywhere.
- **Evidence:** `cmd/server/app_test.go` +`TestServe_GracefulShutdownErrorPropagates`; `cmd/server` coverage 65.3% → **70.7%**.
- **Resolved date:** 2026-05-12

##### Q32 (#127): pin CI tool & catalog refs to immutable tags [RESOLVED]

- **Issue:** [#127](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/127) (closed); also closes SEC F-SUP-3 [#153](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/153) (closed)
- **Domain:** Quality (+ Security supply-chain)
- **Severity at close:** PriorityScore 15 (#127) / RiskScore 9 (#153)
- **Closure commit(s):** `d35d3c7`
- **Resolution:** `.gitlab-ci.yml`: `genapi@v0.3.0` (verified == genapi `main` HEAD `55c79d2`, the tree `gen/` was generated against), `golangci-lint@v2.12.2`, `benchstat@v0.0.0-20260409210113-…`. `codesign-windows-ssl@~latest` left unpinned with a `# ci-pins-allow:` marker + `TODO(#127)` -- **deviation**: no tagged ci-catalog release ships that component yet (it's only on the catalog's `main`; pre-existing -- `glab ci lint` failed on that line before this change too). New `scripts/check-ci-pins.sh` guard wired into `.pre-commit-config.yaml` + a `ci-pins-check` CI lint job (still catches *new* `@latest` regressions). The codesign-pin follow-up rides on the marker + #127's `TODO`.
- **Evidence:** `.gitlab-ci.yml` shows immutable tags for the 3 pinned refs; `scripts/check-ci-pins.sh` present + wired; `ci-pins-check` job in `.gitlab-ci.yml`; full suite green.
- **Resolved date:** 2026-05-12

#### Performance (1)

##### PERF-2026-05-11-07 (#145): `streamQueryResult` per-row `json.MarshalWrite` [RESOLVED]

- **Issue:** [#145](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/145) (closed)
- **Domain:** Performance
- **Severity at close:** P2 (PerfScore 45)
- **Closure commit(s):** `a42a792` (same commit as Q9 #125 / Q39 #134); `6c14368` (bench-baseline refresh)
- **Resolution:** `internal/server/result_codec.go` -- per-row `json.MarshalWrite(bw, row)` replaces the per-row `json.Marshal`→`bw.Write` (one `[]byte`/row removed): 256-row box **3646→3389 allocs/op, 183648→147212 B/op**. `scripts/bench-gate.sh` now skips the `geomean` summary row in its regression check; `bench-baseline.txt` regenerated (`-count=6`) in `6c14368` so `make bench-gate` baselines on the new numbers.
- **Evidence:** `BenchmarkStreamQueryResult_PerRowAlloc`; `result_codec_test.go`; `make bench-gate` green against the refreshed baseline.
- **Resolved date:** 2026-05-12

#### Security (1)

##### F-INPUT-2 (#143): `unsealBytes` fails loud on ciphertext without a configured cipher [RESOLVED]

- **Issue:** [#143](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/143) (closed)
- **Domain:** Security
- **Severity at close:** Low (RiskScore 4; A04 / CWE-665)
- **Closure commit(s):** `ea3f681` (same commit as Q38 #180)
- **Resolution:** `internal/profilestore/sqlite.go` -- `unsealBytes`'s `cipher == nil` branch now `if IsCiphertext(raw) { return "", fmt.Errorf("profilestore: ciphertext present but no cipher configured") }`; plaintext + empty pass through unchanged; the 4 sensitive-column reads still work; the prior #150 `dbRO` path unaffected. Defense-in-depth -- production still fail-fasts on a missing `GEODE_PROFILESTORE_KEY` at store construction.
- **Evidence:** `internal/profilestore/sqlite_test.go` +`TestUnsealBytes_FailsLoudWithoutCipher`; `internal/profilestore` coverage 80.7% → **81.0%**.
- **Resolved date:** 2026-05-12

(F-SUP-3 #153 is recorded under Q32 #127 above -- it was closed by the same commit and is the security framing of the same `.gitlab-ci.yml` ref-pinning work.)

#### Closed-no-issue follow-up

##### `createProfile` `as any` request-body cast removed [RESOLVED]

- **Issue:** none (closed-no-issue follow-up; loose end noted in the 2026-05-12 genapi-batch entry above)
- **Domain:** Quality (api-contract)
- **Closure commit(s):** `2c5895d`
- **Resolution:** `src/api/profiles.ts` -- `toWireCreateRequest` return type → `CreateProfileReq` (imported from `@api`); the `as any` removed at `client.postProfiles(...)`. The other `listProfiles`/`fromWireProfile` casts (tracked under Q2/#90) deliberately left alone.
- **Evidence:** `grep "as any" src/api/profiles.ts` → only the still-tracked-elsewhere casts remain; `npm test` 453/453 green; `tsc --noEmit` clean.
- **Resolved date:** 2026-05-12

#### Still open / follow-ups after this run

- ~~**`src/lib/errors.ts` ↔ `internal/server/errorcodes.go` cross-check**~~ -- **RESOLVED 2026-05-12** in the errorcode-crosscheck run below (`41ed5fa`/`312eee2`/`5598434`/`1660908`). Note: there was never a `src/lib/errors.ts` -- the coupling lived in `src/api/capabilities.ts`. No GitLab issue ever existed for it.
- **`codesign-windows-ssl` pin** -- still `@~latest` with a `# ci-pins-allow:` marker + `TODO(#127)`; pin to an immutable ci-catalog tag once one ships that component (today it's only on the catalog's `main`).
- ~~**#159 (PERF-2026-05-11-12)**~~ -- **RESOLVED 2026-05-12** in the errorcode-crosscheck + #159 run below (`f1c6064` -- `/api/v1/query rateLimit` 200→2000; pinned `eefd896`; documented `1a2016f`+`5a5e89c`).

#### Notes on this run

- **geode-ui commits unpushed:** the 11 implementation commits (`d35d3c7`, `2c5895d`, `a42a792`, `0d629bf`, `e510cb5`, `6abde32`, `ea3f681`, `df3fd51`, `03b6ec1`, `1fea7ba`, `6c14368`) + the docs-tracking commit sit on `main` ahead of origin -- the user decides on `git push origin main`. No genapi change in this run.
- **Verifier note resolved:** the only verifier note (CI pin == the tag `gen/` was generated against?) was confirmed -- `git rev-parse v0.3.0^{commit}` in `~/src/devnw/go/genapi` == `55c79d2` == genapi `main` HEAD == the working copy `gen/` was regenerated against. No follow-up needed there.

---

### 2026-05-12 closure run -- errorcode cross-check + #159 rate-limit alignment (1 GitLab issue + 1 no-issue follow-up; 8 implementation commits + 1 plan-doc + 1 docs-tracking)

A `superpowers`-plan-driven run (plan: `docs/superpowers/plans/2026-05-12-errorcode-crosscheck-and-query-ratelimit.md`) that landed two threads: a frontend↔server error-code seam + automated cross-check (closes the previously-untracked follow-up that lived only in `QUALITY_GAP_ANALYSIS.md` text -- no GitLab issue ever existed for it), and the #159 `/api/v1/query` rate-limit alignment (deferred-on-product in the prior 2026-05-12 runs -- a product decision is now reflected: the documented ~2000-rps SLO is the budget for `/query`). Both reviewers ran on each thread: Thread A APPROVE-WITH-MINOR-NITS (nits fixed in `1660908`); Thread B NEEDS-FIXES (one doc-accuracy issue, fixed in `5a5e89c`). Full suite green -- `make go-test` / `make go-lint` / `make generate` (clean) / `make go-build` / `npm test` (455/455) / `npm run test:ts` / `npm run lint` / `npm run prettier:check` / `node --test scripts/check-error-codes.test.mjs` (4/4) / `node scripts/check-error-codes.mjs` (OK, 62 server codes). `make bench-gate` was flagged flaky under machine load (it flagged unrelated JWT/profile benchmarks during a noisy run, then passed clean on a quiet run; `bench-baseline.txt` not modified -- it is `allow_failure` in CI and orthogonal to a config-int change). The 8 implementation commits + the plan-doc commit + the docs-tracking commit sit on `main` unpushed at the time of this entry; the user pushes.

#### Performance (1)

##### PERF-2026-05-11-12 (#159): `/api/v1/query` per-route rate limit aligned to the documented 2000-rps SLO [RESOLVED]

- **Issue:** [#159](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/159) (closed)
- **Domain:** Performance
- **Severity at close:** P1 (PerfScore 25; was `customer::needs-information`)
- **Closure commit(s):** `f1c6064` (config + regen); `eefd896` (pinning test, committed intentionally failing); `1a2016f` + `5a5e89c` (ARCHITECTURE.md)
- **Resolution:** `geode.json` `/api/v1/query` `rateLimit` set to `2000` (the documented SLO; query route only) -- `gen/api/handlers_gen.go` regenerated (`bkt_post_Query = securex.NewBucket(2000, opts.GlobalBurst)`) + `gen/cmd/server/spec.json`. `docs/ARCHITECTURE.md`'s `### Open question — per-route rate limit vs throughput target (#159)` subsection replaced by a `### Per-route rate limit on /api/v1/query` resolution subsection (`1a2016f`); `5a5e89c` corrected an inaccurate "lowering `GlobalRate` at runtime throttles" claim -- `APIOptions.GlobalRate` is **set-but-unused** in `RegisterGeneratedAPI`, so the doc now accurately states: the per-route token bucket is a *ceiling* on this route; `GlobalRate`/`global_rps` is **not** wired as a cross-route aggregate limiter by the genapi handlers; the only other server-side throttle is the per-IP limiter. F11 pool sizing (64/16) is now consistent with the 2000-rps cap.
- **Evidence:** `internal/server/query_ratelimit_test.go` -- `TestGeodeJSONQueryRateLimit` (reads `../../geode.json`, parses the `api` array, asserts `POST /api/v1/query` `rateLimit == 2000`); `make go-test` green; `make generate` clean; `gen/api/handlers_gen.go` `bkt_post_Query` == `securex.NewBucket(2000, …)`; `docs/ARCHITECTURE.md` `### Per-route rate limit on /api/v1/query` section.
- **Resolved date:** 2026-05-12

#### Closed-no-issue follow-up

##### Frontend ↔ `internal/server/errorcodes.go` error-code cross-check [RESOLVED]

- **Issue:** none (closed-no-issue follow-up; was an untracked note in `QUALITY_GAP_ANALYSIS.md` text -- a `glab issue list --search "error code" / "errorcodes" / "cross-check"` turned up nothing, confirming no issue ever existed). The note originally said `src/lib/errors.ts` -- there is **no such file**; the real coupling lived in `src/api/capabilities.ts` (hard-coded the literal `'wire_feature_missing'` twice).
- **Domain:** Quality
- **Closure commit(s):** `41ed5fa`, `312eee2`, `5598434`, `1660908`
- **Resolution:** new `src/api/serverErrorCodes.ts` (exports `WIRE_FEATURE_MISSING = 'wire_feature_missing'`) + `src/api/serverErrorCodes.test.ts` (`41ed5fa`); `src/api/capabilities.ts` branches wire-feature-missing detection off the seam constant instead of the raw literal (`312eee2`); `src/components/admin/UsersPage.test.tsx` fixtures use `WIRE_FEATURE_MISSING` instead of raw literals (`1660908`); new `scripts/check-error-codes.mjs` (pure `checkErrorCodes(root)` + `main()`) cross-checks the seam against `internal/server/errorcodes.go` + `scripts/check-error-codes.test.mjs` (`node --test`, 4 subtests); `check-error-codes` local pre-commit hook in `.pre-commit-config.yaml` + `error-codes-check` lint job in `.gitlab-ci.yml` (the CI job also runs `node --test scripts/check-error-codes.test.mjs` before the guard) (`5598434`, `1660908`); corrected the inaccurate "the SPA keys i18n messages off it" header comment in `internal/server/errorcodes.go` (`5598434`).
- **Evidence:** `src/api/serverErrorCodes.test.ts` (jest); `scripts/check-error-codes.test.mjs` (`node --test`, 4/4); `node scripts/check-error-codes.mjs` -> OK (62 server codes); `npm test` 455/455 green; `npm run test:ts` / `npm run lint` / `npm run prettier:check` clean.
- **Resolved date:** 2026-05-12

#### Latent gap surfaced (noted, not ticketed) -- later RESOLVED

- ~~**`APIOptions.GlobalRate` set-but-unused (genapi generator)**~~ -- **RESOLVED 2026-05-12** in the "GlobalRate cross-route aggregate limiter" run below (genapi `2eabc11`+`b1ac670`, recommended tag `v0.3.1`; geode-ui `949d705`+`2f3c695`). The generated `RegisterGeneratedAPI` previously accepted `APIOptions.GlobalRate` / a `global_rps` config knob but never wired it as a cross-route aggregate limiter (per-route buckets and the per-IP limiter were the only server-side throttles); it is now a wired server-wide aggregate ceiling. No GitLab issue was ever filed -- it was an untracked note.

#### Still open / follow-ups after this run

- **`codesign-windows-ssl` pin** -- unchanged: still `@~latest` with a `# ci-pins-allow:` marker + `TODO(#127)`; pin to an immutable ci-catalog tag once one ships that component.
- **`make bench-gate` flakiness under load** -- noted: it can flag unrelated benchmarks as regressions during a noisy run, then pass clean on a quiet one. It is `allow_failure: true` in CI. Not a gap per se; recorded so future runs don't chase a phantom regression.

#### Notes on this run

- **geode-ui commits unpushed:** the 8 implementation commits (`41ed5fa`, `312eee2`, `5598434`, `1660908`, `eefd896`, `f1c6064`, `1a2016f`, `5a5e89c`) + the plan-doc commit + the docs-tracking commit sit on `main` ahead of origin -- the user decides on `git push origin main`. No genapi change in this run (the `GlobalRate` gap was left unfiled at the time -- it was subsequently resolved in the run below).

---

### 2026-05-12 closure run -- GlobalRate cross-route aggregate limiter (0 GitLab issues; 1 previously-noted latent genapi gap; 2 geode-ui commits + 1 docs-tracking; genapi `main` +2 unpushed)

A `/codepros:gap-close` run on the previously-untracked "`APIOptions.GlobalRate`/`global_rps` set-but-unused" latent genapi gap (recorded only in `GAP_ANALYSIS.md` / `GAP_ANALYSIS_RESOLVED.md` text + `docs/ARCHITECTURE.md` -- no GitLab issue ever existed; `glab issue list --search "GlobalRate" / "global_rps" / "aggregate rate"` → nothing). **Resolved via option A -- wire `GlobalRate` as a real cross-route aggregate ceiling** (rather than dropping the unused option or leaving the doc as-is): the genapi `configx.RateLimitConfig` doc comment claimed a global limiter that didn't exist, so an operator setting `global_rps: 500` expecting a server-wide cap got nothing. Review: **APPROVE-WITH-MINOR-NITS** → both nits (Snapshot/Allow ordering inconsistency + template-test ordering-assertion gap) fixed in `b1ac670`/`2f3c695`. Full geode-ui suite green (see "Tests executed" below).

#### Closed-no-issue follow-up

##### `APIOptions.GlobalRate` / `global_rps` wired as a cross-route aggregate rate limiter [RESOLVED]

- **Issue:** none (closed-no-issue -- was an untracked note in `GAP_ANALYSIS.md` / `GAP_ANALYSIS_RESOLVED.md` text + `docs/ARCHITECTURE.md`; `glab issue list --search "GlobalRate" / "global_rps" / "aggregate rate"` confirmed no issue exists).
- **Domain:** Quality / Performance (config-knob correctness; latent operator footgun)
- **Closure commit(s):** genapi `2eabc11` + `b1ac670` (recommended tag `v0.3.1`, additive minor -- **not tagged, not pushed**); geode-ui `949d705` + `2f3c695`.
- **Resolution:** genapi `cmd/genapi/templates/api.go.tmpl` -- `RegisterGeneratedAPI` declares one `var globalRateBkt *securex.Bucket` initialized `if opts.GlobalRate > 0 && opts.GlobalBurst > 0`; every route handler checks it once per request, after auth/authz and before the per-route bucket, emitting the same 429 envelope (`securex.ErrRateLimited.Error()`, `http.StatusTooManyRequests`) / `securex.SetRateHeaders` / `obsx.LogAudit("http_ratelimited", …)` / `obsx.EmitRateLimitReject(…)` / span `codes.Error` as the per-route limiter; the aggregate check does `Snapshot()`+`SetRateHeaders` unconditionally then `Allow()` in the `if` (mirroring the per-route block -- per-route block wins on success by design, `b1ac670`). Purely additive (no `APIOptions` signature change); per-route + per-IP limiters and the per-route-default-rate fallback (`RateLit: "opts.GlobalRate"`) unchanged. Corrected genapi `pkg/configx/config.go`'s `RateLimitConfig` doc comment to describe the three-tier model (aggregate ceiling + per-route buckets + per-IP limiter; `global_rps: 0` disables the aggregate). Raised the shared `tests/integration/server_bootstrap_test.go` server's `GlobalBurst` 1→200 (test-config adjustment, not a semantics change -- the now-active aggregate bucket at burst 1 tripped spurious cross-route 429s in the shared acceptance suite). Regenerated genapi self-hosted artifacts (`gen/api/handlers_gen.go`, `gen/pkg/configx/config.go`, `gen/genapi-mcp/…`, `testgen/…`; the frozen legacy repo-root `api/handlers_gen.go` is not from `api.go.tmpl` -- untouched). geode-ui `make generate` with the new genapi → regenerated `gen/api/handlers_gen.go` (`globalRateBkt` + the per-handler aggregate check on all 52 routes) + `gen/pkg/configx/config.go`; `docs/ARCHITECTURE.md`'s "Per-route rate limit on /api/v1/query" subsection (which said `GlobalRate` is "currently not wired") replaced with "Rate limits: per-route, cross-route aggregate, and per-IP" -- the three layers in check-order, `geode.json` `global_rps: 2000`/`burst: 400`, `global_rps: 0` disables, landed via genapi `2eabc11` (recommended tag `v0.3.1`).
- **Evidence:** genapi `cmd/genapi/template_regression_test.go::TestGlobalRate_AggregateBucketEmitted` (verifies the `globalRateBkt` declaration + per-handler aggregate-check ordering -- splits the rendered output on `mux.HandleFunc(`); genapi `tests/integration/global_ratelimit_test.go::TestGlobalRate_CrossRouteAggregateCeiling` (low `GlobalRate`/`GlobalBurst`, hits two *different* routes, asserts the second 429s after the first consumed the budget) + `TestGlobalRate_DisabledWhenZero`; geode-ui `internal/server/global_ratelimit_test.go::TestGlobalRate_CrossRouteAggregateCeiling` (builds the geode-ui mux via `RegisterGeneratedAPI` with `GlobalRate: 2, GlobalBurst: 1`, stub `AuthJWT`, `GET /api/v1/capabilities` → 200 then `GET /api/v1/graphs` → 429 with `X-RateLimit-Limit` + rate-limit envelope, confirms the `http_ratelimited` audit fired on the second route) + `TestGlobalRate_DisabledWhenZero`; geode-ui `make go-test` (`-race`) green (`internal/server` 78.3%); `make generate` idempotent + `scripts/check-generate.sh` exit 0; genapi `GOEXPERIMENT=jsonv2 go test ./...` all pass; `docs/ARCHITECTURE.md` "Rate limits: per-route, cross-route aggregate, and per-IP" section.
- **Resolved date:** 2026-05-12

#### Tests executed

| Command | Result |
|---|---|
| geode-ui `make go-test` (`-race`) | PASS (`internal/server` 78.3%) |
| geode-ui `make go-lint` | PASS (0 issues) |
| geode-ui `make generate` | PASS (idempotent) |
| geode-ui `scripts/check-generate.sh` | PASS (exit 0) |
| geode-ui `make go-build` + `./bin/geode-ui -h` | PASS |
| geode-ui `make bench-gate` | PASS (`PERF GATE OK`) |
| geode-ui `npm test` | PASS (455/455) |
| geode-ui `npm run test:ts` / `lint` / `prettier:check` | PASS |
| genapi `GOEXPERIMENT=jsonv2 go build ./...` | PASS |
| genapi `GOEXPERIMENT=jsonv2 go test ./...` | PASS (all) |
| genapi `golangci-lint run` | PASS (0 issues) |

#### Notes on this run

- **genapi commits unpushed:** `2eabc11` + `b1ac670` sit on genapi `main` ahead of `origin/main` (`origin/main` == `55c79d2` == tag `v0.3.0`). **Recommended tag: `v0.3.1`** (additive minor). Not pushed, not tagged -- the user decides on both.
- **geode-ui commits unpushed:** `949d705` + `2f3c695` + the docs-tracking commit for this run sit on `main` ahead of origin, on top of all prior 2026-05-12 runs (~24+ commits total unpushed) -- the user decides on `git push origin main`.
- **`server_bootstrap_test.go` `GlobalBurst` 1→200** -- recorded in the `2eabc11` commit message: a test-config knob bump, not a semantics change; the shared acceptance server now has a non-trivial aggregate burst so cross-route requests in the suite don't trip the now-active aggregate bucket.

---

## Closure batch 2026-05-13 (gap-close pipeline run)

User-selected four-priority `/codepros:gap-close` pipeline run on 2026-05-13: (1) S-NEW-5 #201 (highest-risk security finding), (2) Bundle B quick-wins #220 / #223 / #103, (3) Bundle C tsconfig consolidation #194 / #195 / #196, (4) Bundle D `GraphView.tsx` decomposition #192. **Verifier returned PASS on all 8 closures across 13 commits**, all sitting on local `main` **unpushed**. Plan: [`docs/superpowers/plans/2026-05-13-gap-close-pipeline.md`](./superpowers/plans/2026-05-13-gap-close-pipeline.md) (if checked in; otherwise tracked in the completion report below).

### Headline metrics

- **Coverage:** `internal/server` 78.3% → 78.8% (+0.5pp), `internal/ui` 86.1% → 87.6% (+1.5pp); `internal/conn` / `internal/jwt` / `internal/profilestore` unchanged; jest 540/540 unchanged.
- **Benchmarks (Bundle B):** `LoginLimiter.Allow_Parallel` 800.9 → **9.84 ns/op (~81× faster)**; `ProfileLimiter.Allow_Parallel` 957.4 → **7.33 ns/op (~131× faster)**; `schema_cache.get` 404.1 → **92.93 ns/op (~4.3× faster)**; `EmbedHandler_StaticHit` 10355 → 9697 ns/op (-6.4%) with `-2 allocs/op`.
- **GraphView.tsx (Bundle D):** **1982 LOC → 396 LOC** across 11 new modules in `src/components/results/graph/`.
- **Tests:** `make go-test -race -count=10` clean on new race tests (`TestLoginLimiter_ConcurrentInsertRace`, `TestProfileLimiter_ConcurrentInsertRace`, `TestSchemaCache_ConcurrentReadersAndWriters`); jest 540/540; `GraphView.test.tsx` + `ResultPanel.test.tsx` pass unchanged.

### Closures (SHA → issue)

#### S-NEW-5 / #201 — XFF gating behind `-trust-proxy-xff` flag [SECURITY]

- **Issue:** [#201](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/201) — auth-bypass chain via XFF spoofing + DoS-by-lockout against arbitrary IPs (confidential).
- **Domain:** Security (A07 / CWE-290, CWE-348, CWE-799)
- **Severity at close:** High (risk score 20).
- **Closure commit:** `6f75a74` — `fix(security): close S-NEW-5 (#201) — gate XFF parsing behind -trust-proxy-xff flag`.
- **Resolution:** `clientIP()` no longer honors `X-Forwarded-For` by default. New `-trust-proxy-xff` boolean CLI flag (default `false`) threaded through `LoginLimiterConfig.TrustProxyXFF` + `ProfileLimiterConfig.TrustProxyXFF`. Both limiters key on `net.SplitHostPort(r.RemoteAddr)` unless the operator explicitly opts in for a trusted-proxy deployment.
- **Evidence:** `internal/server/loginlimiter.go:337-350` (`clientIP()` body); `TestClientIP_RemoteAddrOnly_WhenXFFNotTrusted` + `TestClientIP_HonorsXFF_WhenTrusted` in `internal/server/loginlimiter_test.go` (both pass under `-race`). README + `docs/SECURITY_GAP_ANALYSIS.md` updated.
- **Out of scope (deferred):** Trusted-proxy CIDR enforcement — flag is binary / operator-opt-in; deployments behind multi-hop proxies revisited if/when needed.
- **Resolved date:** 2026-05-13

#### PERF-2026-05-13-06 / #220 — 2-map limiter design [PERFORMANCE]

- **Issue:** [#220](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/220) — coarse `sync.Mutex` on read-mostly limiter maps; global lock on the hot path.
- **Domain:** Performance (P2 / PerfScore 6.00)
- **Closure commit:** `cca498b` — `perf: close #220 — 2-map limiter design removes global mutex from hot path`.
- **Resolution:** Per-IP and per-actor maps now use `atomic.Pointer[map[string]*bucket]` with copy-on-write inserts under a small writer mutex; per-bucket `tokens`/`last`/`count`/`lastFail` are guarded by a per-bucket `sync.Mutex`. The cache-hit fast path holds zero global locks.
- **Bench evidence:** `BenchmarkLoginLimiter_Allow_Parallel` 800.9 → **9.84 ns/op (~81× faster)**; `BenchmarkProfileLimiter_Allow_Parallel` 957.4 → **7.33 ns/op (~131× faster)**; 0 allocs/op both. `TestLoginLimiter_ConcurrentInsertRace` + `TestProfileLimiter_ConcurrentInsertRace` drive 64 goroutines × 200 iters under `-race -count=10` clean.
- **Files:** `internal/server/loginlimiter.go`, `internal/server/profilelimiter.go`, `internal/server/loginlimiter_test.go`, `internal/server/profilelimiter_test.go`, `internal/server/loginlimiter_bench_test.go`.
- **Resolved date:** 2026-05-13

#### PERF-2026-05-13-07 / #223 — schema_cache `RWMutex` [PERFORMANCE]

- **Issue:** [#223](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/223) — `Mutex` → `RWMutex` on read-heavy `schema_cache`.
- **Domain:** Performance (P3 / PerfScore 2.40)
- **Closure commit:** `04a199e` — `perf: close #223 — RWMutex on schema_cache for concurrent reads`.
- **Resolution:** `schemaCache.mu` is now `sync.RWMutex`. `get()` takes `RLock` on the hot path and only upgrades to `Lock` on the rare expiry-delete branch (with a re-check under the writer lock to avoid racing a concurrent `set()`). `set()` and `invalidateAll()` keep the writer lock.
- **Bench evidence:** `BenchmarkSchemaCache_Get_Parallel` 404.1 → **92.93 ns/op (~4.3× faster)**, 0 allocs/op. New `TestSchemaCache_ConcurrentReadersAndWriters` (32 readers / 4 writers / 1 invalidator × 500 iters) under `-race -count=10` clean.
- **Files:** `internal/server/schema_cache.go`, `internal/server/schema_cache_test.go`.
- **Known caveat (out of scope, tracked separately):** The pre-existing `TestSchemaCache_*HitDoesNotQueryDB` family has a process-scoped `sql.Register` that makes `-count>1` flaky regardless of cache locking — not caused by #223.
- **Resolved date:** 2026-05-13

#### PERF-2026-05-13-02 / GAP-022 / PSR-F5 / #103 — embed FS Stat cache [PERFORMANCE]

- **Issue:** [#103](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/103) — `fs.Stat` per static-asset request in `internal/ui/embed.go`. Same as GAP-022 in `GAP_ANALYSIS.md` (mis-credited as closed by the earlier gzip commit `d5126ad`).
- **Domain:** Performance (P1 / PerfScore 8.00) + GAP-022 cross-link
- **Closure commit:** `a3c9552` — `perf: close #103/GAP-022 — cache embed FS Stat for static asset hits`. Doc fixup: `7e5c008`.
- **Resolution:** `Handler()` now delegates to `handlerFS(fs.FS)` which closes over a per-handler `sync.Map` of cleaned-path → `fs.FileInfo`. **Positive results only:** 404 paths re-Stat every call (`TestEmbedHandler_DoesNotCache404` pins this so attacker-shaped URLs cannot grow the map unboundedly).
- **Bench evidence:** `BenchmarkEmbedHandler_StaticHit` (full `/favicon.ico` HTTP path): 10355 → 9697 ns/op (-6.4%); 3420 → 3388 B/op; **19 → 17 allocs/op (-2 allocs)** — exactly the per-request `fs.Stat(sub, clean)` round trip eliminated.
- **Pinning tests:** `TestEmbedHandler_CachesStat` injects an instrumented `countingFS` and asserts the second request adds zero new Stat calls; `TestEmbedHandler_DoesNotCache404`.
- **Files:** `internal/ui/embed.go`, `internal/ui/embed_test.go`, `internal/ui/embed_bench_test.go`.
- **Resolved date:** 2026-05-13

#### Q47 / #194 — `noImplicitAny:false` removed [QUALITY]

- **Issue:** [#194](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/194) — strict-mode defeat at `tsconfig.json:8` + `jest.config.cjs:9`.
- **Domain:** Quality (High, score 20)
- **Closure commits:** `1c57b0c` (Bundle C consolidation) + `a562788` (review follow-up annotating `Shell.tsx` + `gqlLanguage.ts` parameters to satisfy strict mode).
- **Resolution:** `noImplicitAny:false` deleted from `tsconfig.json`. Bundle C also extracted `tsconfig.base.json` (see #195) and moved ts-jest `isolatedModules` into inline tsconfig (see #196).
- **Files:** `tsconfig.base.json` (new), `tsconfig.json`, `jest.config.cjs`, `electron/tsconfig.json`, `e2e/tsconfig.json`, `src/components/Shell.tsx`, `src/lib/gqlLanguage.ts`.
- **Resolved date:** 2026-05-13

#### Q52 / #195 — tsconfig consolidation [QUALITY]

- **Issue:** [#195](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/195) — duplicated compiler-options across `tsconfig.json` / `electron/tsconfig.json` / `e2e/tsconfig.json`.
- **Domain:** Quality (High, score 18)
- **Closure commit:** `1c57b0c`.
- **Resolution:** New `tsconfig.base.json` carries the shared compiler options; web / electron / e2e configs `extends` the base. No drift surface.
- **Files:** `tsconfig.base.json` (new), `tsconfig.json`, `electron/tsconfig.json`, `e2e/tsconfig.json`.
- **Resolved date:** 2026-05-13

#### Q51 / #196 — ts-jest `isolatedModules` deprecation [QUALITY]

- **Issue:** [#196](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/196) — ts-jest v30 deprecation warning at `jest.config.cjs:9`.
- **Domain:** Quality (Med, score 15)
- **Closure commit:** `1c57b0c`.
- **Resolution:** Top-level `isolatedModules` removed from `ts-jest` transformer options; moved into inline tsconfig. ts-jest v30 deprecation warning eliminated.
- **Files:** `jest.config.cjs`.
- **Resolved date:** 2026-05-13

#### Q48 / #192 — `GraphView.tsx` decomposition [QUALITY]

- **Issue:** [#192](https://gitlab.com/devnw/codepros/geode/geode-ui/-/work_items/192) — `src/components/results/GraphView.tsx` was 1982 LOC (supersedes Q18 / #164's 1257-LOC framing).
- **Domain:** Quality (High, score 32)
- **Closure commits (6-commit seam):** `ac486ad` (`useGraphPathMode`), `ff130d2` (`useFillHeight`), `9c46ae8` (`GraphInspector`), `0a4f36b` (`GraphToolbar`), `eb3a910` (`GraphSidebar`), `6b45ac5` (`useGraphElements` + finalize <400 LOC orchestrator).
- **Resolution:** **`GraphView.tsx` 1982 LOC → 396 LOC.** Decomposed across **11 new modules** under `src/components/results/graph/`: `useGraphPathMode`, `useFillHeight`, `useGraphElements`, `useGraphActions`, `useGraphCytoscape`, `GraphInspector`, `GraphToolbar`, `GraphSidebar`, `GraphSidebarContents`, `layouts`, `explore`, `cyHelpers`, `styled`. Public contract preserved; `GraphView.test.tsx` + `ResultPanel.test.tsx` pass unchanged.
- **Files (new modules):** under `src/components/results/graph/` — see commits for the full list.
- **Resolved date:** 2026-05-13

### PR / branch context

- **Branch:** `main` — 13 commits ahead of `origin/main` (**not pushed**).
- **Verifier verdict:** PASS on all 8 closures (jest 540/540; `go test -race`; `make bench-gate`; `make go-lint`; `make generate` clean).
- **GitLab issues closed:** #201, #220, #223, #103, #194, #195, #196, #192 — all closed in the same run with evidence comments referencing the closure SHA(s).
- **Full report:** [`docs/gap-closure-reports/2026-05-13-gap-close-pipeline.md`](./gap-closure-reports/2026-05-13-gap-close-pipeline.md).
