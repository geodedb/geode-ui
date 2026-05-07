# Gap Analysis -- Resolved (geode-ui)

- **Project:** devnw/codepros/geode/geode-ui
- **Last updated:** 2026-05-07
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

## Index by closure date

- **2026-05-07:** #18, #21, #26, #27, #29, #32, #43, #53, #55, #58, #60, #62, #65 (cross-closed). Genapi follow-ups: `genapi#214`, `genapi#215`. #66 partially closed (open).
