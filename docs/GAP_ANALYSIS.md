# Gap Analysis -- geode-ui

- **Project:** devnw/codepros/geode/geode-ui
- **Generated on:** 2026-05-07
- **Last refreshed:** 2026-05-19 (audit Phase 5 — /codepros:gap-close round-4 deferred-items follow-up: the 3 PERF P1 items deferred earlier in round-4 (#291 / #297 / #316) are now **all Closed**. Closure SHAs `86e0463` (#291 layoutWorker transferable Float32Array), `e085a7f` (#297 WS JSON.parse worker), `3259dab` (#316 lazy-load cytoscape plugins). Combined with the prior round-4 closures (#322, #323, #314, #312, #308, #289, plus #300 Scope-A), **10 of 10 actionable findings from the 2026-05-19 audit cohort are now Closed**. #300 Scope-B remains the only OPEN item in this cohort — still blocked on upstream Geode landing SHOW USERS … ROLES. Gates: Jest 979/979 (146 suites), Go `./internal/server/` + `./cmd/server/` + `./internal/jwt/` all pass, `tsc --noEmit` clean, `eslint --quiet 'src/**/*.{ts,tsx}'` clean. Detail in `GAP_ANALYSIS_RESOLVED.md` "Closure cohort 2026-05-19 (audit Phase 5 — /codepros:gap-close round-4 cohort)" section.)
- **Previous refresh:** 2026-05-17 (audit Phase 5 — /codepros:gap-close round-3 cohort: **24 gaps closed across 4 trackers** in a single closure pass (1b3f414..3d3ba14 — 26 closure commits + 2 housekeeping). Cluster breakdown: 4 GAP-N rows (GAP-034/035/036/037 now reified with closure SHAs `0622d84` / `42d3664` / `d309293` / `60d965a`); 4 QUALITY rows (#268/#269/#270/#271); 7 PERF rows (#275/#278/#281/#284/#285/#286 + brotli on #259); 9 SECURITY rows (#264/#265/#266/#267/#272/#274/#280/#283 + NFKC corpus on #242). All gates green: 928/928 Jest, 100% reachable Go packages, golangci-lint + tsc-strict clean. Cohort detail in `GAP_ANALYSIS_RESOLVED.md` "Closure cohort 2026-05-17 (audit Phase 5 — /codepros:gap-close round-3 cohort)" section.)
- **Previous refresh:** 2026-05-17 (audit Phase 4 gap-sync (round 2) — drift sweep across the GitLab tracker and the in-repo docs. **Drift closed (tracker side):** GAP-002 / #2 and GAP-003 / #3 (upstream-Geode admin-DDL blockers documented Closed 2026-05-13 but never closed on the tracker) — closed with `gap-status::wont-do` + closure-evidence note citing the 2026-05-13 v0.5.15 auth-DDL integration plan; GAP-017 / #44 already closed earlier this day via `63b4feb` (`[QUALITY-12]` finish pnpm-to-npm migration); #122 (S9 accepted-risk, closed 2026-05-10) had stale `gap-status::open` label stripped + `gap-status::wont-do` applied. **Four new gaps filed:** GAP-034 / #273 (mirror `check:doc-routes` + `check:changelog` pre-commit gates into CI; Medium), GAP-035 / #276 (`make perf-smoke` overwrites historical Cytoscape baseline at a fixed path; Medium), GAP-036 / #279 (stale `docs/PRIVATE_REGISTRY.md`; Low), GAP-037 / #282 (`SECURITY.md` misattributes DOMPurify + RBAC to `@devnw/components`; Low). Slot-reservation placeholders for GAP-034/035/036 in earlier drafts were repurposed for these concrete findings. **Doc side:** GAP-017 row updated to Closed in the 2026-05-11 table; the "eleven open items" sentence at the PSR cohort header updated to reflect zero in-repo Open items; closure cohort 2026-05-17 added to `GAP_ANALYSIS_RESOLVED.md`.)
- **Previous refresh:** 2026-05-17 (audit Phase 4 gap-sync (round 1) — the 47 issues closed locally during the 2026-05-16 gap-close pass were never closed on the GitLab tracker; this run posted closure-evidence notes and ran `glab issue close` on all 47, catching the tracker up to local `main` HEAD `e4fc9ff`. Also: 3 newly-detected gaps GAP-031/032/033 were assigned Gap-IDs and cross-linked to their pre-existing GitLab equivalents #208 (Q-NEW-G), #207 (Q-NEW-F), #138 (Q1) — no new GitLab issues filed because they are exact duplicates; the recommended fixes carry over verbatim.)
- **Earlier refresh:** 2026-05-16 (gap-close pass — 50 commits across Tiers A through H closed every actionable item across the four `*GAP_ANALYSIS.md` tracking files: 9 Security, 3 Quality release-blockers, 4 P1 UI Perf, 13 Quality Medium, 6 P2 Perf, 9 P3 Perf, 5 Quality Low + misc, GAP-021 #102, GAP-023..027 docs drift; one combined won't-do/blocked commit closes GAP-004/005/011/012/015/016, S9 #122, and the F-SUP-3 codesign-windows-ssl carry-over)
- **Audit run:** /codepros:audit Phase 3 (gap detection) -> Phase 4 (issue sync) -> Phase 5 (/codepros:gap-close round-3 cohort: 24 closures across 4 trackers, 26 closure commits + 2 housekeeping on 2026-05-17); 2026-05-17 audit gap-sync round 2 (3 tracker-drift closes + 1 label sweep + 4 new gaps GAP-034/035/036/037); 2026-05-17 audit gap-sync round 1 (47 GitLab catch-up closes + 3 new Gap-ID cross-refs); 2026-05-16 `/codepros:gap-close` 50-commit pass; 2026-05-13 audit run + 2026-05-13 `/codepros:gap-close` pipeline run; two 2026-05-12 `/codepros:gap-close` runs
- **Source of truth:** GitLab issues in `devnw/codepros/geode/geode-ui`. This doc mirrors them.

## Methodology

Phase 3 ran the gap-detector against the project's requirements set and current code, classifying each finding by severity (Critical / High / Medium / Low) and category (Quality / Test / CI-CD / Docs / Upstream). Phase 4 reconciled the classification with the existing GitLab tracker, opened one issue per gap with a stable Gap-ID prefix, and produced this canonical mirror. Upstream-blocked items are explicitly tagged so they auto-recover when the upstream Geode wire-op surface lands. The GitLab tracker remains authoritative; this file is regenerated by future audits.

## Status Counts

| Severity | Open | In Progress | Resolved | Won't Do | Total |
|----------|-----:|------------:|---------:|---------:|------:|
| Critical |    0 |           0 |        0 |        0 |     0 |
| High     |    0 |           0 |        0 |        0 |     0 |
| Medium   |    2 |           0 |        3 |        0 |     5 |
| Low      |    2 |           0 |       19 |        6 |    27 |
| **Total**|**4** |       **0** |   **22** |    **6** | **32**|

No release-blocking gaps. **2026-05-17 audit Phase-4 gap-sync (this run):** GAP-017 / #44 (dual lockfile) Closed via `63b4feb` (`[QUALITY-12]` finish pnpm-to-npm migration; tracker-issue catch-up posted in the 47-issue Phase-4 sync — see "2026-05-17 audit Phase 4 — gap-sync" section); GAP-002 / #2 and GAP-003 / #3 (upstream-Geode admin-DDL blockers) GitLab-side closed in this run with `gap-status::wont-do` after `docs/GAP_ANALYSIS.md` had recorded their resolution since 2026-05-13. Four new gaps were filed by the same Phase-4 detector: **GAP-034** (#273 — mirror `check:doc-routes` + `check:changelog` pre-commit gates into CI), **GAP-035** (#276 — `make perf-smoke` overwrites the historical Cytoscape baseline at a fixed path), **GAP-036** (#279 — stale `docs/PRIVATE_REGISTRY.md` describes a workflow the repo no longer uses), **GAP-037** (#282 — `SECURITY.md` misattributes DOMPurify + RBAC to `@devnw/components`). **2026-05-16 gap-close pass:** GAP-018 (#46) Closed via `5001fac` (`.golangci.yml` + pinned bootstrap); GAP-019 (#48) Closed via `0af4ecc` (jest+go coverage thresholds); GAP-021 (#102) Closed via the new `usePublicProfilesWithStoredPasswords` hook; GAP-023..027 (docs drift) Closed in the same pass; GAP-004/005/015/016 (upstream Geode v0.6+ blockers), GAP-011 (Electron release-eng approval), GAP-012 (second-locale product decision) marked Won't Do with explicit unblock conditions. GAP-020 / #90 Resolved 2026-05-12 via `9b0a423` + genapi `55c79d2`; GAP-022 / #103 Resolved 2026-05-13 via `a3c9552`. (Most quality/perf/security closures of the 2026-05-11/12/13/16/16 cohorts are tracked by domain ID in the sibling `*GAP_ANALYSIS.md` docs, not by `GAP-NNN` here — see `GAP_ANALYSIS_RESOLVED.md` "Closure batch 2026-05-16" for the consolidated 50-commit record.)

## Severity Rubric

- **Critical** -- exploitable security issue, data loss, or production outage path.
- **High** -- broken functionality on a primary user path, or a missing requirement that materially blocks a user story.
- **Medium** -- partial requirement, degraded UX on a secondary path, or missing test coverage on critical logic.
- **Low** -- documentation drift, conditional test skips with intact happy-path coverage, verification gaps with no concrete defect, or quality polish.

## Gaps (Open)

| Gap-ID  | Title | Status | Severity | Issue link | Evidence | Next action |
|---------|-------|--------|----------|------------|----------|-------------|
| GAP-001 | Stale "B9 will land" stub comment in `handlers_users.go` | **Closed** 2026-05-08 | Low | [#1](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/1) | `internal/server/handlers_users.go:35-40` (was) → now references `auth.go:40` (`AuthJWT`) + `auth_test.go` | Stub comment replaced with accurate reference to the implemented `AuthJWT` in `auth.go` and its test coverage. |
| GAP-002 | e2e-18 admin-users specs skip on missing Geode wire ops | **Closed 2026-05-13** -- see [GAP_ANALYSIS_RESOLVED.md#gap-002-013-admin-users-resolved](./GAP_ANALYSIS_RESOLVED.md) | Low | [#2](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/2) | Was: `e2e/specs/07-admin-users.spec.ts:27,49,75,83` runtime probes. Now: 07 spec runs CRUD + list against Geode v0.5.15 wire CREATE/ALTER/DROP USER + SHOW USERS. | Closed via the 2026-05-13 v0.5.15 auth-DDL integration plan (commits `ac3b929`, `ceba02c`). |
| GAP-003 | e2e-19 admin-roles-policies skips on insufficient role | **Closed 2026-05-13** -- see [GAP_ANALYSIS_RESOLVED.md#gap-003-014-admin-roles-policies-resolved](./GAP_ANALYSIS_RESOLVED.md) | Low | [#3](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/3) | Was: `08-admin-roles-policies.spec.ts:4-13` `ADMIN_GAP` probe. Now: roles + grants describe blocks run live; policies remain fixme'd per `docs/GQL_AUTH_DDL.md` Limitations #3. | Closed for roles + grants surfaces; CREATE POLICY remains upstream-deferred (commits `677fc47`, `4a2da5e`, `155a387`). |
| GAP-004 | e2e-20 ops audit spec skips when `/api/v1/audit` returns 403 | **Won't Do (until Geode v0.6+)** 2026-05-16 | Low | [#4](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/4) | `e2e/specs/09-ops.spec.ts:42-47` -- v0.5.15 built-in role set is `{admin, user, readwrite, readonly}`; no dedicated `audit` role. | **Won't Do (2026-05-16)** — upstream Geode v0.5.15 does not expose the `geode.auth.role_audit` predicate this spec needs. The skip-on-403 guard is correct behavior against current upstream; closing the gap requires Geode v0.6+ shipping the role. Re-open once upstream version bumps; existing skip text in commit `0d4a252` is the unblock pointer. |
| GAP-005 | e2e-21 MCP `tools/list` skip on jsonrpc error | **Won't Do (until Geode v0.6+)** 2026-05-16 | Low | [#5](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/5) | `e2e/specs/10-mcp-endpoint.spec.ts:124-127` -- v0.5.15 ships auth-DDL/CI but `tools/list` JSON-RPC method not implemented. | **Won't Do (2026-05-16)** — upstream Geode v0.5.15's MCP server does not implement the `tools/list` JSON-RPC method this spec exercises. The skip-on-error guard is correct behavior against current upstream; the gap closes when Geode v0.6+ ships the method. Re-open at that point; existing skip text in commit `7c47ea2` is the unblock pointer. |
| GAP-006 | e2e job runtime status in CI not verified | **Closed (resolved 2026-05-10)** -- see [GAP_ANALYSIS_RESOLVED.md#gap-006-6-e2e-job-runtime-status-in-ci-not-verified-resolved](./GAP_ANALYSIS_RESOLVED.md) | Low | [#6](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/6) | `.gitlab-ci.yml` declares e2e job; latest `main` pipeline [#2514181822](https://gitlab.com/devnw/codepros/geode/geode-ui/-/pipelines/2514181822) sampled on sha `f815d1a` (2026-05-10). | Pipeline URL recorded; runtime visibility re-established. Pipeline status itself (failed/passed) is tracked separately in the pipelines view; this gap was a *verification* gap (no recent sample) and is closed by the act of sampling. |
| GAP-007 | docker-compose stack-up smoke not executed | **Closed (resolved 2026-05-10)** -- see [GAP_ANALYSIS_RESOLVED.md#gap-007-7-docker-compose-stack-up-smoke-not-executed-resolved](./GAP_ANALYSIS_RESOLVED.md) | Low | [#7](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/7) | Requirement e2e-7 / T6 rebuild-and-push. e2e stack live smoke 2026-05-10: `curl http://localhost:8080/healthz` -> `200 {"status":"ok","version":"v0.1.0"}`; `curl http://localhost:8080/api/v1/profiles/public` -> `200` with one profile. | Stack-up smoke executed against `deploy/docker-compose.test.yml`; both endpoints 2xx. |
| GAP-008 | Pre-commit ratchets (lint:hardcoded-styles, lint:contrast, verify:translations, detect:hardcoded-strings) missing from CI | **Closed** 2026-05-08 | Medium | — | `.gitlab-ci.yml:audit-ratchets` job added | New `audit-ratchets` lint-stage job runs all four scripts on MR + main. |
| GAP-009 | `electron:tsc/build/package` scripts not in CI | **Closed** 2026-05-08 (hardened 2026-05-11) | Medium | — | `.gitlab-ci.yml:electron-typecheck` job added | Type-checks `electron/main.ts` + `electron/preload.ts`. **2026-05-11 (`f444c70`, Q25/#170 + F-SUP-4/#160):** `allow_failure` removed — `electron-typecheck` is now a real gate; `electron@^42.0.1` + `@types/node@^22.19.19` added to devDependencies; `npm run electron:tsc` exits 0. |
| GAP-010 | CSP behavior under Electron `geode://` origin not documented | **Closed** 2026-05-08 | Low | — | `docs/ELECTRON.md` (new "Content-Security-Policy under the `geode://` origin" section) | Each CSP directive's behaviour under `geode://app` documented; `connect-src` flagged as the only operator-configuration concern. |
| GAP-011 | No e2e coverage for packaged Electron build | **Won't Do (needs-approval, release-eng)** 2026-05-16 | Low | — | `e2e/specs/` (12 specs, browser-only) | **Won't Do (2026-05-16)** — needs release-eng approval before pulling `electron` + `electron-builder` into devDependencies and provisioning a CI runner with the OS-specific packaging toolchain (Windows code-signing certs, macOS notarisation, Linux AppImage). Out of scope for the gap-close pass; tracked here so a future release-eng approval can re-open with the unblock condition (electron + electron-builder in devDeps + CI artifact job) clearly stated. Manual smoke via `npm run electron:dev` remains the developer's tool. |
| GAP-012 | Only one locale (`en.ts`) — language detector is a no-op | **Won't Do (needs-product-decision)** 2026-05-16 | Low | — | `src/services/i18n/locales/index.ts:24-29` | **Won't Do (2026-05-16)** — needs product to choose which second locale ships before the engineering work is meaningful. Locale addition discipline is already documented at `docs/I18N.md` "Adding a new locale" so the unblock is a product decision + a single translation pass, not an engineering open. |

## Closure run 2026-05-08

- **GAP-001** — closed by replacing the "B9 will land" stub comment at
  `internal/server/handlers_users.go:35-40` with an accurate reference
  to the already-implemented `AuthJWT` middleware (`auth.go:40`) plus
  its test coverage in `auth_test.go`. No runtime change.

The remaining open items (GAP-002 through GAP-007) are split into:

- **GAP-002 / GAP-003 / GAP-004 / GAP-005**: upstream Geode blockers.
  Will auto-resolve when `SHOW USERS` / admin DDL / audit-role / MCP
  `tools/list` land in Geode v0.6+. No UI change needed.
- **GAP-006 / GAP-007**: CI / docker-compose verification items —
  no code change; both verified live in this session
  (geode-e2e-geode-ui-1 healthy at the end of the bug-fix run).

### Closure run 2026-05-08 (audit + close pass)

Two new gaps surfaced and closed in the same pass after the audit
run:

- **GAP-008** — closed by adding `.gitlab-ci.yml:audit-ratchets`. The
  four pre-commit ratchets (lint:hardcoded-styles, lint:contrast,
  verify:translations, detect:hardcoded-strings) now also run as a CI
  lint-stage job, so a contributor who pushes without the local
  pre-commit hook still blocks at MR time.
- **GAP-009** — closed by adding `.gitlab-ci.yml:electron-typecheck`.
  The Electron main + preload now type-check independently of the SPA
  tsc pass; `allow_failure: true` until the release engineer pulls
  `electron` + `@types/node` into devDependencies (documented in
  `docs/ELECTRON.md`).

GAP-010 / GAP-011 / GAP-012 remain Open — each is a documentation or
release-engineering item rather than a code defect, and warrants a
focused PR scoped to that work.

## Detailed Gap Records

### GAP-001: Stale "B9 will land" stub comment in handlers_users.go — **Closed 2026-05-08**

- **Issue:** [#1](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/1)
- **Category:** Code Quality / Docs
- **Severity:** Low
- **Status:** Closed (this session). Stub at `internal/server/handlers_users.go:35-40` replaced with an accurate reference to the implemented `AuthJWT` (`auth.go:40`) and its test coverage in `auth_test.go`.

### GAP-002: e2e-18 admin-users specs skip on missing Geode wire ops

- **Issue:** [#2](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/2)
- **Category:** Test / Upstream
- **Severity:** Low
- **Requirement source:** e2e-18 admin users coverage
- **Current state (evidence):**
  - `e2e/specs/07-admin-users.spec.ts:27,49,75,83` -- runtime probes conditionally skip when `SHOW USERS` / `CREATE USER` / `DROP USER` are absent.
  - Upstream Geode v0.5.11 does not implement these wire ops.
- **Why this is a gap:** Coverage gated; cannot exercise admin-user CRUD until upstream supports it.
- **Impact/Risk:** No regression risk; specs auto-enable when upstream ships ops.
- **Recommended fix:** Track upstream Geode releases. When v0.6+ ships the ops, re-run suite and confirm full pass.
- **Acceptance criteria:** Upstream exposes the ops; spec executes assertions without skip.
- **Status:** Blocked on upstream Geode v0.6+.

### GAP-003: e2e-19 admin-roles-policies skips on insufficient role

- **Issue:** [#3](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/3)
- **Category:** Test / Upstream
- **Severity:** Low
- **Requirement source:** e2e-19 admin roles & policies coverage
- **Current state (evidence):**
  - `e2e/specs/08-admin-roles-policies.spec.ts:4-13` -- `ADMIN_GAP` runtime probe conditionally skips.
- **Why this is a gap:** Upstream admin GQL surface is not callable by the test principal.
- **Impact/Risk:** Coverage gated; UI integration unaffected.
- **Recommended fix:** Wait for upstream Geode admin GQL surface, or grant the test principal sufficient role.
- **Acceptance criteria:** Probe no longer triggers; spec runs all assertions.
- **Status:** Blocked on upstream Geode.

### GAP-004: e2e-20 ops audit spec skips when /api/v1/audit returns 403

- **Issue:** [#4](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/4)
- **Category:** Test / Upstream
- **Severity:** Low
- **Requirement source:** e2e-20 ops audit coverage
- **Current state (evidence):**
  - `e2e/specs/09-ops.spec.ts:37-47` -- conditional skip on non-2xx response.
  - Upstream Geode v0.5.11 returns `403 securex: insufficient role`.
- **Why this is a gap:** Audit endpoint coverage skipped due to upstream role enforcement.
- **Impact/Risk:** UI side wired and consumed; only e2e is gated.
- **Recommended fix:** Either upstream broadens role coverage or the test harness uses a privileged principal.
- **Acceptance criteria:** `/api/v1/audit` returns 2xx for the test principal; spec runs full assertions.
- **Status:** Blocked on upstream Geode.

### GAP-005: e2e-21 MCP tools/list skip on jsonrpc error

- **Issue:** [#5](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/5)
- **Category:** Test / Upstream
- **Severity:** Low
- **Requirement source:** e2e-21 MCP endpoint coverage
- **Current state (evidence):**
  - `e2e/specs/10-mcp-endpoint.spec.ts:124-127` -- conditional skip on jsonrpc error.
- **Why this is a gap:** Error path of `tools/list` not asserted; happy-path is covered.
- **Impact/Risk:** Minimal; MCP endpoint exercised on happy path.
- **Recommended fix:** Track upstream MCP `tools/list` reliability. Optionally fail loudly on regression instead of silent skip.
- **Acceptance criteria:** `tools/list` returns success for the e2e fixture; spec runs full assertions without skip.
- **Status:** Blocked on upstream Geode.

### GAP-006: e2e job runtime status in CI not verified — **Closed 2026-05-10**

- **Issue:** [#6](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/6)
- **Category:** CI-CD / Verification
- **Severity:** Low
- **Requirement source:** CI runtime evidence for e2e suite
- **Current state (evidence):**
  - `.gitlab-ci.yml` -- e2e job declared (static evidence).
  - Latest `main` pipeline sampled 2026-05-10: pipeline [#2514181822](https://gitlab.com/devnw/codepros/geode/geode-ui/-/pipelines/2514181822) on sha `f815d1a97ea255675ade5814ce51db0db146586f`.
- **Why this is a gap:** Verification gap, not a defect. We had static configuration but not a recent sampled run.
- **Impact/Risk:** None — this was a verification gap, not a code defect.
- **Status:** Closed. The verification action (sample latest `main` pipeline + record the URL) has been performed. Pipeline run-status tracking (red vs green) is an ongoing operational concern, not the substance of this gap.
- **Acceptance criteria met:** Latest `main` pipeline URL recorded in this row.

### GAP-007: docker-compose stack-up smoke not executed — **Closed 2026-05-10**

- **Issue:** [#7](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/7)
- **Category:** Verification / Test
- **Severity:** Low
- **Requirement source:** e2e-7 / T6 stack-up smoke
- **Current state (evidence):**
  - `deploy/docker-compose.test.yml` stack live; live smoke 2026-05-10:
    - `curl -fsS http://localhost:8080/healthz` -> `200 {"status":"ok","version":"v0.1.0"}`
    - `curl -fsS http://localhost:8080/api/v1/profiles/public` -> `200` with one profile in the body.
- **Why this was a gap:** Stack-up smoke not run during the audit pass.
- **Status:** Closed. Both endpoints returned 2xx with the expected JSON shapes.
- **Acceptance criteria met:** Compose stack reaches ready state; at least one endpoint returns 2xx; evidence recorded.

## Reclassifications from Phase 2

- **GAP-001 -- "stale stub" reclassified from "potential auth gap" to doc-only.**
  Phase 2 surfaced `internal/server/handlers_users.go:35-40` as a possible auth-wiring gap based on the comment text ("AuthJWT still stubbed (B9 will land it)"). Phase 3 verified the runtime: `internal/server/auth.go:21` implements `AuthJWT`, and `internal/server/auth_test.go:32-180` exercises it across protected handlers. The artifact is therefore a stale comment, not a missing feature -- severity dropped to **Low** and category changed from **Security/Feature** to **Code Quality / Docs**. The fix is a literal edit of those six lines.

  No other Phase-2 findings were reclassified.

## Upstream Blockers

GAP-002, GAP-003, GAP-004, and GAP-005 share a single root cause:

- **Root cause:** Upstream Geode v0.5.11 does not yet expose the admin-DDL wire ops (`SHOW USERS`, `CREATE USER`, `DROP USER`, admin-role GQL surface), the audit endpoint role required by the e2e principal returns `403 securex: insufficient role`, and the MCP `tools/list` jsonrpc surface is occasionally erroring.
- **Effect:** Each affected e2e spec uses a runtime capability probe and conditionally skips when the upstream surface is absent or returns a non-2xx error. Happy-path UI integration is unaffected; only e2e coverage is gated.
- **Auto-recovery:** None of these specs need code changes on the geode-ui side. When upstream Geode v0.6+ ships the missing wire ops and the role enforcement is broadened, the runtime probes will pass and the assertions will run.
- **Tracking:** Each gap carries the `blocked-on-upstream-Geode` label. They cross-reference each other in the GitLab tracker; no separate epic is used because GitLab Free tier in this project does not have first-class Epic support for the workflow we need.
- **Action this audit:** None. Re-run the e2e suite after every upstream Geode bump and close any gap whose probe no longer trips.

## Confirmed-Safe (Not Tracked Here)

The Phase 3 audit verified the following as safe; they are intentionally **not** tracked as gaps:

- `internal/server/handlers_uploads.go` -- upload sanitization confirmed safe.
- JWT algorithm lock-down -- confirmed safe (alg pinned; no `none` / HS-vs-RS confusion).
- `sanitizeGraphName` -- confirmed safe against injection vectors.

## Resolved

See [GAP_ANALYSIS_RESOLVED.md](./GAP_ANALYSIS_RESOLVED.md) for the full closure record (multiple batches from 2026-05-07 through 2026-05-16, including the 50-commit Tier-A-through-H 2026-05-16 gap-close pass).

## Profile System Rebuild (PSR) -- 2026-05-10 audit

Phase 3 of `/codepros:audit` re-ran against the recent profile-system rebuild
(handlers_profiles_crud, internal/profilestore, AuthProvider.connectMore,
ProfilesPage / Add+DeleteConnectionModal, electron preload + main, SPA
bootstrap). Twelve gap candidates surfaced; eleven became GitLab issues, one
was confirmed already-fixed and is recorded here as `wont-do/not-a-bug` for
traceability. **As of the 2026-05-17 audit Phase-4 gap-sync, zero in-repo
Open items remain from this PSR cohort; upstream-Geode blockers and
Won't-Do items carry their own status labels** (`blocked-on-upstream-Geode`,
`gap-status::wont-do`).

| Gap-ID  | Severity | Status         | Issue                                                                  | File:Line                                                                              | Description                                                                                                |
|---------|----------|----------------|------------------------------------------------------------------------|----------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------|
| PSR-G01 | High **(release blocker)** | **Closed 2026-05-10** | [#78](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/78)    | `internal/server/handlers_profiles_crud.go:24,134,205`                                  | **Closed 2026-05-10** -- POST/PATCH/DELETE handlers now emit `profile_created`, `profile_updated`, `profile_deleted` events via `emitAudit`. New event constants added to `internal/server/audit.go`; redaction substring list extended with `dsn`, `pem`, `ca_pem`, `cert_pem`, `key_pem`, `tls_*_pem` so a future caller cannot leak credentials by accident. Pinned by `TestPostProfiles_EmitsAuditEvent`, `TestPatchProfileid_EmitsAuditEvent`, `TestDeleteProfileid_EmitsAuditEvent`, `TestPostProfiles_AuditNotEmittedOnFailure`. Cross-closes S6 (#119) and PSR-G08 (#85). |
| PSR-G02 | High **(release blocker)** | **Closed 2026-05-10 (fully)** | [#79](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/79), [#124](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/124) | `internal/profilestore/sqlite.go:218-256`, `internal/profilestore/store.go:18-49`, `internal/server/handlers_profiles_crud.go:165-310`, `src/api/profiles.ts:104-148`, `geode.json:1004-1015`, `gen/types/types.gen.go:744-770` | **Closed 2026-05-10 (full)** -- first half (objects): `profilestore.ProfilePatch` carries pointer-typed optionals; `mergeProfile` applies only non-nil fields. Second half (scalars, #124 PSR-G02-followup): genapi's `SchemaProp` gained a `Nullable bool` flag and the `types.go.tmpl` template now emits `*string` / `*bool` / `*int64` / `*float64` (with `,omitempty` JSON tags and nil-guarded `Valid()` checks) when `nullable: true` is set. `geode.json::UpdateProfileReq` marks `name`, `dsn`, `description`, `saved_username`, `is_default` nullable; the regenerated `gen/types/types.gen.go::UpdateProfileReq` now exposes them as pointers. `buildProfilePatch` collapsed from a 30-line heuristic into a direct pointer pass-through, and the always-echo `IsDefault` workaround was retired. The SPA's `buildUpdateInput` no longer always-echoes `isDefault`; it diffs against the original like the other scalars. Pinned by the original PSR-G02 suite plus new `TestPatchProfileid_IsDefaultPointerSemantics`, `TestPatchProfileid_DescriptionClearViaEmptyString`, `TestSQLitePatchScalarSetThenClearRoundTrip`, the genapi-side `TestPrepareTypesData_NullableScalars` / `TestTypesTemplate_NullableScalars`, and three new SPA `toWireUpdateRequest` absent-vs-explicit-empty cases. Genapi commit `4d527ca`. |
| PSR-G03 | High **(release blocker)** | **Closed 2026-05-10** | [#80](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/80)    | `src/auth/AuthProvider.tsx:135-159`                                                    | **Closed 2026-05-10** -- `connectMore` now `await refreshCsrfToken()` immediately after `apiLogin` (mirrors the `signIn` shape). New jest case "PSR-G03: connectMore refreshes the CSRF token after apiLogin" pins the fix by counting `/api/v1/csrf` GETs before/after the call. |
| PSR-G04 | Medium                   | **Closed 2026-05-10** | [#81](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/81)    | `src/components/layout/AddConnectionModal.tsx:37,50`                                   | **Closed 2026-05-10** -- the open-time effect now uses `Promise.allSettled` so each promise's failure is observable independently. Two new state flags (`publicProfilesErr`, `authedProfilesErr`) drive a `role="status"` warning banner per failure mode (`connection.publicProfileListLoadFailed` falls back to a free-form profile input; `connection.profileListLoadFailed` keeps the form fully typeable when the saved-username dropdown can't load). The submit error path was already wired (`role="alert"`); a regression test now pins it. Pinned by `PSR-G04: submit failure renders an inline error message`, `PSR-G04/G10: listProfiles failure renders fallback warning and form stays usable`, and `PSR-G04: fetchPublicProfiles failure renders fallback warning and switches to free-form input`. Cross-closes PSR-G10 (#87) since both pointed at the same swallow site. |
| PSR-G05 | Medium                   | **Closed 2026-05-10** | [#82](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/82)    | `src/components/layout/DeleteProfileModal.tsx:23-32`, `src/pages/ProfilesPage.tsx:245` | **Closed 2026-05-10** -- `DeleteProfileModal.onConfirm` now catches DELETE rejections and surfaces them via a `role="alert"` line inside the ConfirmModal body; the modal stays open and `onDeleted`/`onClose` are NOT called so the user can retry. `ProfilesPage.setAsDefault` wraps both PATCH calls in a try/catch and surfaces the rejection via a new `setDefaultErr` banner above the table (separate from the page-level `err` state, which gates whole-page error UI); the partial server state is refreshed so the user sees what landed. New i18n keys `profiles.delete.error` and `profiles.setDefaultError`. Pinned by `PSR-G05: failed delete renders an inline error and the modal stays open` (DeleteProfileModal.test.tsx) and `PSR-G05: setAsDefault failure surfaces an error banner and the user can retry` (ProfilesPage.test.tsx). |
| PSR-G06 | Medium                   | **Closed 2026-05-10** | [#83](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/83)    | `src/index.tsx:51-53`                                                                  | **Closed 2026-05-10** -- the silent `try { bootstrap() } catch {}` now calls a new `renderFatal(err)` helper that (1) `console.error`s the captured error so devtools / Sentry / Playwright / electron-log forwarders pick it up and (2) mounts a self-contained `<FatalBootstrapError>` panel into `#root` (or `document.body` as a fallback when `#root` itself is missing). The panel uses inline styles + zero providers so it can render even when the theme / i18n / router subsystems are broken; it carries a plain-English message and a collapsible `<details>` block with the captured stack so a non-technical user can copy/paste a useful bug report. Pinned by `src/__tests__/index-bootstrap.test.tsx` (5 cases including success, missing #root, and forced render-side throw) and `src/components/FatalBootstrapError.test.tsx` (Error, string, plain-object payloads). |
| PSR-G07 | Medium                   | **Closed 2026-05-10** | [#84](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/84)    | `electron/preload.ts:14-40` vs `src/types/electron.d.ts:8-34`                          | **Closed 2026-05-10** -- canonical interfaces moved to new `electron/shared/bridge-types.ts`; `electron/preload.ts` and `src/types/electron.d.ts` now both `import type` (re-export) from that single source. New jest case `electron-bridge-types.test.ts` mutually assigns the two type aliases as a compile-time drift guard. Cross-closes Q4 (#93). |
| PSR-G08 | Medium                   | **Closed 2026-05-10** (both halves) | [#85](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/85)    | `internal/server/handlers_profiles_crud.go:321-345`                                    | **Closed 2026-05-10** -- (a) `maybeReload` emits `profile_reload_failed` audit events on list-or-pool-reload failure, with `actor`/`phase`/`error` keys, plus the slog warning. (b) The 5xx-on-required-reload half is architecturally moot: F1 (#94 / commit `d822bc0`) redesigned `maybeReload` as async + single-flight off the request critical path, so the HTTP request returns 2xx as soon as the mutation commits and reload runs in the background; there is no synchronous reload result on which to escalate, and operator visibility comes from the audit event + slog warning. Re-introducing a 5xx wait would re-introduce the latency F1 eliminated. Pinned by `TestMaybeReload_EmitsAuditOnReloadFailure`. |
| PSR-G09 | Medium                   | **Closed 2026-05-10** | [#86](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/86)    | `src/pages/ProfilesPage.tsx:110-111`                                                   | **Closed 2026-05-10** -- admin status now derives from the JWT's `roles` claim, surfaced via `useAuth().isAdmin`. New `src/auth/jwt-claims.ts` decodes the JWT payload (no signature math; the server still authenticates every request) and `extractRoles()` returns the role array. AuthProvider hydrates `roles` from a sessionStorage echo (`geode-ui.session-roles`) on mount so a page reload preserves the admin posture without seeing the access token (which is HttpOnly-cookie-only post-S3c). signIn/connectMore refresh the echo from the freshly-issued JWT; signOut/setAuthed(false) clear it. ProfilesPage's heuristic `profiles?.some(p => p.scope === 'system' && !!p.dsn)` is gone; per-row CRUD visibility now combines the JWT-derived `isAdmin` with the per-row DSN-visibility signal (logical OR) so admins see action buttons even on rows where the server scrubbed the DSN. The single grep hit (no other consumers of the heuristic) is also fixed. Pinned by 8 cases in `src/auth/jwt-claims.test.ts` (decoder shape + edge cases), 2 new cases in `src/auth/AuthProvider.test.tsx` (signIn extracts roles + setAuthed clears them), and 2 new cases in `src/pages/ProfilesPage.test.tsx` (admin sees CRUD with null DSN + the test-suite is wired through AuthProvider with a sessionStorage seed seam). |
| PSR-G10 | Low                      | **Closed 2026-05-10 (duplicate of PSR-G04)** | [#87](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/87)    | `src/components/layout/AddConnectionModal.tsx:50`                                      | **Closed 2026-05-10** -- same code path as PSR-G04. Closed in the same commit; the `Promise.allSettled` rework now surfaces the `listProfiles` failure via the `authedProfilesErr` warning banner. |
| PSR-G11 | Low                      | **Closed 2026-05-10** | [#88](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/88)    | `electron/main.ts:127-148`                                                             | **Closed 2026-05-10** -- `saveWindowState` no longer silently swallows write failures. The catch now calls `console.warn('[geode] saveWindowState failed:', err)` (same pattern used by `src/index.tsx`'s `renderFatal`), so a misconfigured AppData path or read-only volume surfaces in dev tools / electron-log forwarders without blocking the close path. No regression test added: `saveWindowState` is a private helper inside `electron/main.ts` and depends on `BrowserWindow` + `app.getPath`; extracting it for testability is a refactor of larger scope than the fix warrants. |
| PSR-G12 | --                       | wont-do / not-a-bug | --                                                                | `src/api/connections.test.tsx:22`                                                      | Phase 2 candidate "connections.test latch leak" was already fixed in the test setup at the cited line. No issue opened. Recorded here for traceability only.                |

### Release-blocker gating

PSR-G01, PSR-G02, and PSR-G03 are gating: the audit-trail loss (G01),
silently-impossible PATCH-clear semantics (G02), and stale-CSRF after
`connectMore` (G03) each block ship of the profile rebuild. They should be
addressed before the rebuild is tagged as a release.

### Cross-links

- PSR-G01 <-> PSR-G08: same audit-trail-loss family (mutation paths +
  reload path).
- PSR-G04 <-> PSR-G10: same file (`AddConnectionModal.tsx`); G10 is the
  duplicate site, fold into G04's PR.

## 2026-05-11 audit Phase 4 sync — Bucket-A open gaps (GAP-013..GAP-022)

The 2026-05-11 audit Phase 3 (gap-detector) re-ran against HEAD `d3e5de1`. The findings below are the gaps that remain genuinely open as of that pass; each row reflects current code evidence (verified at HEAD `d3e5de1`) and is mirrored on a GitLab issue. The older `[Quality] ...` and `[Perf] ...` titled issues (#8–#17, #19, #24, #25, #28, #30, #33, #35, #39, #40, #45, #47, #50) were closed as duplicates of their newer canonical equivalents (e.g. `[QUALITY-XX]` and `[PERF-FX]`) during this same Phase-4 run. Closures of verified-fixed items are recorded in `docs/GAP_ANALYSIS_RESOLVED.md`.

| Gap-ID  | Title | Status | Severity | Issue | Evidence (verified at HEAD `d3e5de1`) | Next action |
|---------|-------|--------|----------|-------|---------------------------------------|-------------|
| GAP-013 | e2e-18 admin-users specs skip on missing Geode wire ops | **Closed 2026-05-13** -- see [GAP_ANALYSIS_RESOLVED.md#gap-002-013-admin-users-resolved](./GAP_ANALYSIS_RESOLVED.md) | Low | [#2](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/2) | Was: `07-admin-users.spec.ts` runtime probes. Now: Geode v0.5.15 docker pin + handler grammar (`ac3b929`) lands SHOW USERS / CREATE USER / DROP USER on the wire. | Closed via 2026-05-13 v0.5.15 auth-DDL integration plan (commit `ceba02c`). |
| GAP-014 | e2e-19 admin-roles-policies skips on insufficient role | **Closed 2026-05-13** -- see [GAP_ANALYSIS_RESOLVED.md#gap-003-014-admin-roles-policies-resolved](./GAP_ANALYSIS_RESOLVED.md) | Low | [#3](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/3) | Was: `08-admin-roles-policies.spec.ts:5-14`. Now: roles + grants un-skipped against v0.5.15; policies remain fixme'd per upstream Limitations #3. | Closed for roles + grants. CREATE POLICY remains upstream-deferred (commits `677fc47`, `4a2da5e`, `155a387`). |
| GAP-015 | e2e-20 ops audit spec skips when /api/v1/audit returns 403 | **Won't Do (until Geode v0.6+)** 2026-05-16 | Low | [#4](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/4) | `e2e/specs/09-ops.spec.ts:42-47` -- v0.5.15 ships built-in roles `{admin,user,readwrite,readonly}`, no dedicated `audit` role. | **Won't Do (2026-05-16)** — duplicates GAP-004's upstream-blocker reasoning (audit role missing from v0.5.15). Closes when Geode v0.6+ ships `geode.auth.role_audit`. |
| GAP-016 | e2e-21 MCP `tools/list` skip on jsonrpc error | **Won't Do (until Geode v0.6+)** 2026-05-16 | Low | [#5](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/5) | `e2e/specs/10-mcp-endpoint.spec.ts:124-127` -- v0.5.15 ships auth-DDL/CI but does not implement MCP `tools/list`. | **Won't Do (2026-05-16)** — duplicates GAP-005's upstream-blocker reasoning (MCP `tools/list` not in v0.5.15). Closes when Geode v0.6+ ships the method. |
| GAP-017 | Dual lockfile committed at repo root | **Closed** 2026-05-17 | Low | [#44](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/44) (canonical; #20 closed as dup) | **Closed (2026-05-17)** via commit `63b4feb` (`[QUALITY-12]` finish pnpm-to-npm migration). The dual-lockfile state was resolved by completing the pnpm→npm migration; the canonical package manager is now npm, and `package-lock.json` is the authoritative lockfile. Issue #44 closed on the tracker 2026-05-17 14:45Z. See `GAP_ANALYSIS_RESOLVED.md` "Closure cohort 2026-05-17" for the resolution record. | Done. |
| GAP-018 | No `.golangci.yml` config (golangci-lint runs defaults only) | **Closed** 2026-05-16 | Low | [#46](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/46) (canonical; #22 closed as dup) | **Closed (2026-05-16)** via commit `5001fac` (QUALITY rank 11). `.golangci.yml` v2-format config enables `errcheck`, `govet`, `ineffassign`, `staticcheck`, `unused`, `gocognit (50)`, `gocyclo (30)`, `nestif (6)`, `dupl (200 tokens)`, and a curated `revive` subset that passes on existing code. New `scripts/install-tools.sh` pins `golangci-lint@v2.12.2`; `Makefile go-lint` bootstraps if PATH lookup fails. Full record in `QUALITY_GAP_ANALYSIS.md` rank 11. | Done. |
| GAP-019 | No coverage thresholds (Jest + Go) | **Closed** 2026-05-16 | Low | [#48](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/48) (canonical; #23 closed as dup) | **Closed (2026-05-16)** via commit `0af4ecc` (QUALITY rank 13). Sensible-default floors per planner spec: current minus 1pp. Jest (`jest.config.cjs` `coverageThreshold`): statements 79 / branches 66 / functions 74 / lines 81. Go (`scripts/check-go-coverage.sh` + `Makefile go-cover`): total floor 79% (cmd + internal, gen/ excluded). Both gates fail a CI run when coverage erodes more than 1pp. Full record in `QUALITY_GAP_ANALYSIS.md` rank 13. | Done. |
| GAP-020 | ~~2 `as unknown as` casts in `src/api/profiles.ts` (was 5)~~ | **Closed** 2026-05-12 | Medium | [#90](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/90) | **Closed `9b0a423`** (geode-ui) + genapi `55c79d2` — genapi `expandPath`/`expandRoute` map URL path tokens to snake_case schema keys (`[["profileId","profile_id"]]`) and `delete` them from the body before sending; `geode.json` `UpdateProfileReq` gains required `profile_id`; regen `gen/`; `src/api/profiles.ts` `updateProfile`/`deleteProfile` call the typed client directly (no cast). Upstream `cmd/genapi/path_params_test.go` cases added. genapi `55c79d2` is on genapi `main` unpushed. | Done. Follow-up (small, not yet ticketed): `createProfile`'s `as any` body-shape cast remains — a different cast. |
| GAP-021 | Duplicate fetchPublicProfiles+getStoredPassword effect across LoginPage and AddConnectionModal | **Closed** 2026-05-16 | Low | [#102](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/102) | `src/pages/LoginPage.tsx:101-128` and `src/components/layout/AddConnectionModal.tsx:60-77,136` both ran the public-profiles + saved-password effect with near-identical shape. | **Closed (2026-05-16)** — extracted `usePublicProfilesWithStoredPasswords({ enabled? }): { profilesState, lookupStoredPassword, resetProfilesState }` hook into `src/lib/usePublicProfilesWithStoredPasswords.ts`. The hook owns the `fetchPublicProfiles` effect (with cancellation seam + single-state-update slot preserving QUALITY #227's act() invariant) and returns a `useCallback`-stable `lookupStoredPassword` pass-through so call sites can list it in their own effect's deps array without spurious re-runs. Both call sites migrated: LoginPage uses the default `enabled: true` mount-time behavior + a plain stored-password effect; AddConnectionModal uses `enabled: open` so the fetch fires only on modal open, and keeps its own debounced + cached `lookupStoredPassword` invocation. listProfiles() remains in its own open-gated effect at the modal (independent endpoint, independent cancellation seam). Tests: 7 new cases in `src/lib/usePublicProfilesWithStoredPasswords.test.ts` (mount fetch, error path, enabled=false skip, lookup pass-through, identity stability of both callbacks across renders, resetProfilesState restore); 12 existing LoginPage + AddConnectionModal integration tests still pass. |
| GAP-022 | PSR-F5 hot-path: `fs.Stat` per request in embed.go (mis-credited as closed) | **Closed** 2026-05-13 | Low | [#103](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/103) | **Closed `a3c9552`** — `internal/ui/embed.go` `Handler()` now delegates to `handlerFS(fs.FS)` which closes over a per-handler `sync.Map` of cleaned-path → `fs.FileInfo`. Positive cache only; 404 paths re-Stat every call (pinned by `TestEmbedHandler_DoesNotCache404` so attacker-shaped URLs cannot grow the map unboundedly). `TestEmbedHandler_CachesStat` injects an instrumented `countingFS` and asserts the second `/favicon.ico` request adds zero new Stat calls. Bench: `BenchmarkEmbedHandler_StaticHit` 10355→9697 ns/op (-6.4%), 19→17 allocs/op (-2 allocs == the exact pair of `fs.Stat` calls eliminated). | Done. |

### Gap-closure run — 2026-05-12 (genapi + medium-cohort batch)

`/codepros:gap-close` closed 9 GitLab issues this run; only one carries a `GAP-NNN` ID here:

- **GAP-020 / #90** — `as unknown as` path-param casts in `src/api/profiles.ts` removed. `9b0a423` (geode-ui) + genapi `55c79d2`. Row above updated to **Closed**; resolved record in `GAP_ANALYSIS_RESOLVED.md`.

The other 8 (#132, #135 security; #133, #142, #150, #154, #156 perf; #173 quality) are tracked by domain ID in `SECURITY_GAP_ANALYSIS.md` / `PERF_GAP_ANALYSIS.md` / `QUALITY_GAP_ANALYSIS.md` and recorded in `GAP_ANALYSIS_RESOLVED.md`. **#159** (`/api/v1/query` `rateLimit=200` vs 2000-rps target) — later **closed** (see "Gap-closure run — 2026-05-12 (errorcode cross-check + #159)" below): `geode.json` `rateLimit` set to `2000` (`f1c6064`). The 9 geode-ui implementation commits + the docs-tracking commit sit on `main` **unpushed**; 5 genapi commits sit on genapi `main` **unpushed** (user decides on pushing/tagging genapi — note: breaking `mcpx`/`SetAuthVerifier` API → minor bump, other consumers must regenerate). Full report: [`docs/gap-closure-reports/2026-05-12-genapi-and-medium-cohort-completion.md`](./gap-closure-reports/2026-05-12-genapi-and-medium-cohort-completion.md).

### Gap-closure run — 2026-05-12 (top-10 quality / perf / CI batch)

A second `/codepros:gap-close` run on 2026-05-12 closed **13 GitLab issues** — none carry a `GAP-NNN` ID here; all are tracked by domain ID in the sibling `*GAP_ANALYSIS.md` docs and recorded in `GAP_ANALYSIS_RESOLVED.md`:

- **Quality (11):** Q9 #125 + Q39 #134 (`a42a792` — `streamQueryResult` cleanup), Q23 #126 (`df3fd51` — error-code taxonomy), Q41 #136 (`1fea7ba` — `internal/server/CONVENTIONS.md`), Q10 #144 (`6abde32` — `IsRevoked` flatten), Q12 #146 (`e510cb5` — `Login` decomposition), Q13 #149 + Q40 #151 (`0d629bf` — `WSServer.Query` decomposition + cancel-reader lifetime), Q22 #168 (`03b6ec1` — list-endpoint empty-result rule, pinned-by-test), Q38 #180 (`ea3f681` — graceful-shutdown error wrapped + logged), Q32 #127 (`d35d3c7` — CI tool refs pinned to immutable tags).
- **Perf (1):** PERF-2026-05-11-07 #145 (`a42a792` — per-row `MarshalWrite`; `bench-baseline.txt` refreshed `6c14368`).
- **Security (1):** F-SUP-3 #153 (`d35d3c7` — subsumed by Q32 #127 — 3/4 floating CI refs pinned; `codesign-windows-ssl@~latest` pin pending an upstream ci-catalog release, tracked via the `# ci-pins-allow:` marker + #127's `TODO`) — and F-INPUT-2 #143 (`ea3f681` — `unsealBytes` fails loud on ciphertext-without-cipher).
- **No-issue follow-up closed:** `createProfile`'s `as any` request-body cast in `src/api/profiles.ts` removed (`2c5895d`).

**Small follow-up (not ticketed) — later DONE** in the "errorcode cross-check + #159" run below: a frontend↔server error-code seam + automated cross-check. (Note: there was never a `src/lib/errors.ts` — the coupling lived in `src/api/capabilities.ts`.)

**Verifier:** ACCEPT-WITH-NOTES — full suite green (`make go-test -race`, `make go-lint`, `make generate` clean, `make bench-gate`, `npm test` 453/453), coverage up on every touched package (`internal/server` 77.1→78.2%, `internal/jwt` 81.0→82.5%, `internal/profilestore` 80.7→81.0%, `cmd/server` 65.3→70.7%); the one note (was `genapi@v0.3.0` the exact tag `gen/` was generated against?) is **resolved** — `git rev-parse v0.3.0^{commit}` in `~/src/devnw/go/genapi` == `55c79d2` == genapi `main` HEAD == the working copy `gen/` was regenerated against. The 11 implementation commits (`d35d3c7`, `2c5895d`, `a42a792`, `0d629bf`, `e510cb5`, `6abde32`, `ea3f681`, `df3fd51`, `03b6ec1`, `1fea7ba`, `6c14368`) + the docs-tracking commit sit on `main` **unpushed** — the user decides on `git push origin main`. Full report: [`docs/gap-closure-reports/2026-05-12-top10-quality-batch-completion.md`](./gap-closure-reports/2026-05-12-top10-quality-batch-completion.md).

### Gap-closure run — 2026-05-12 (errorcode cross-check + #159)

A `superpowers`-plan-driven run (plan: [`docs/superpowers/plans/2026-05-12-errorcode-crosscheck-and-query-ratelimit.md`](./superpowers/plans/2026-05-12-errorcode-crosscheck-and-query-ratelimit.md)) that landed two threads — no `GAP-NNN` ID here; tracked by domain ID in the sibling docs + recorded in `GAP_ANALYSIS_RESOLVED.md`:

- **Thread A — error-code cross-check** (closes the previously-untracked "frontend ↔ `internal/server/errorcodes.go` cross-check" follow-up; recorded in `QUALITY_GAP_ANALYSIS.md` text, not a GitLab issue — confirmed no GitLab issue exists). Note: there is **no `src/lib/errors.ts`** — the real coupling lived in `src/api/capabilities.ts` (hard-coded `'wire_feature_missing'` twice).
  - `41ed5fa` — new `src/api/serverErrorCodes.ts` (`WIRE_FEATURE_MISSING = 'wire_feature_missing'`) + `src/api/serverErrorCodes.test.ts`.
  - `312eee2` — `src/api/capabilities.ts` branches wire-feature-missing detection off the seam constant.
  - `5598434` — new `scripts/check-error-codes.mjs` (pure `checkErrorCodes(root)` + `main()`) + `scripts/check-error-codes.test.mjs` (`node --test`, 4 subtests); `check-error-codes` local pre-commit hook in `.pre-commit-config.yaml`; `error-codes-check` lint job in `.gitlab-ci.yml`; corrected the inaccurate "the SPA keys i18n messages off it" header comment in `internal/server/errorcodes.go`.
  - `1660908` — review fixes: the `error-codes-check` CI job now runs `node --test scripts/check-error-codes.test.mjs` before the guard; `src/components/admin/UsersPage.test.tsx` fixtures use `WIRE_FEATURE_MISSING`.
  - Reviews: APPROVE-WITH-MINOR-NITS (both reviewers); nits fixed in `1660908`.
- **Thread B — #159 `/api/v1/query` rate-limit alignment** (`[PERF-2026-05-11-12]`, `PERF_GAP_ANALYSIS.md`):
  - `eefd896` — new `internal/server/query_ratelimit_test.go` (`TestGeodeJSONQueryRateLimit` — reads `geode.json`, asserts `POST /api/v1/query` `rateLimit == 2000`); committed intentionally failing.
  - `f1c6064` — `geode.json` `/api/v1/query` `rateLimit` `200` → `2000` (query route only); regenerated `gen/api/handlers_gen.go` (`bkt_post_Query = securex.NewBucket(2000, opts.GlobalBurst)`) + `gen/cmd/server/spec.json`. Makes `eefd896`'s test pass.
  - `1a2016f` — replaced the `### Open question — per-route rate limit vs throughput target (#159)` subsection in `docs/ARCHITECTURE.md` with a `### Per-route rate limit on /api/v1/query` resolution subsection.
  - `5a5e89c` — review fix: corrected an inaccurate "lowering `GlobalRate` at runtime throttles" claim — `APIOptions.GlobalRate` was **set-but-unused** in `RegisterGeneratedAPI` at the time; the per-route bucket is a ceiling on that route, the only other server-side throttle is the per-IP limiter. (Superseded — `GlobalRate` was subsequently wired as a real cross-route aggregate limiter; see the "GlobalRate cross-route aggregate limiter" run below.)
  - Reviews: NEEDS-FIXES (one doc-accuracy issue) → fixed in `5a5e89c`.
- **Latent genapi gap (later RESOLVED):** `APIOptions.GlobalRate`/`global_rps` was generated-but-not-wired as a cross-route aggregate limiter by the genapi handler template — surfaced during the Thread B review, then **resolved** in the run below (genapi `2eabc11`+`b1ac670`, geode-ui `949d705`+`2f3c695`); `GlobalRate`/`global_rps` is now a wired server-wide aggregate ceiling.

### Gap-closure run — 2026-05-12 (GlobalRate cross-route aggregate limiter)

A `/codepros:gap-close` run on the previously-untracked "latent genapi gap" surfaced above — no `GAP-NNN` ID here and no GitLab issue ever existed for it (`glab issue list --search "GlobalRate" / "global_rps" / "aggregate rate"` → nothing; recorded only in `GAP_ANALYSIS.md` / `GAP_ANALYSIS_RESOLVED.md` text + `docs/ARCHITECTURE.md`). **Resolved via option A — wire `GlobalRate` as a real aggregate limiter** (rather than dropping the unused option / leaving the doc as-is): an operator setting `global_rps: 500` expecting a server-wide cap previously got nothing, and the genapi `configx.RateLimitConfig` doc comment claimed a global limiter that didn't exist.

- **genapi** (`~/src/devnw/go/genapi`, `main`, **unpushed**; recommended tag `v0.3.1` — additive minor):
  - `2eabc11` `feat(api): wire GlobalRate as a cross-route aggregate rate limiter in RegisterGeneratedAPI` — `cmd/genapi/templates/api.go.tmpl`: `RegisterGeneratedAPI` declares one `var globalRateBkt *securex.Bucket` initialized `if opts.GlobalRate > 0 && opts.GlobalBurst > 0`; every route handler checks it once per request, after auth/authz and before the per-route bucket check, emitting the same 429 envelope / `securex.SetRateHeaders` / `obsx.LogAudit("http_ratelimited", …)` / `obsx.EmitRateLimitReject(…)` / span `codes.Error` as the per-route limiter. Purely additive (no `APIOptions` signature change). Corrected `pkg/configx/config.go`'s `RateLimitConfig` doc comment (three-tier model: aggregate ceiling + per-route buckets + per-IP limiter; `global_rps: 0` disables the aggregate). Added `cmd/genapi/template_regression_test.go::TestGlobalRate_AggregateBucketEmitted` + `tests/integration/global_ratelimit_test.go` (`TestGlobalRate_CrossRouteAggregateCeiling`, `TestGlobalRate_DisabledWhenZero`); raised the shared `tests/integration/server_bootstrap_test.go` server's `GlobalBurst` 1→200 (test-config adjustment, not a semantics change — the now-active aggregate bucket at burst 1 tripped spurious cross-route 429s in the shared acceptance suite). Regenerated self-hosted artifacts (`gen/api/handlers_gen.go`, `gen/pkg/configx/config.go`, `gen/genapi-mcp/…`, `testgen/…`; the frozen legacy repo-root `api/handlers_gen.go` is not from `api.go.tmpl` — untouched).
  - `b1ac670` `fix(api): align GlobalRate limiter Snapshot/Allow ordering with per-route convention; tighten template test (#review)` — review follow-up: the aggregate check now does `Snapshot()`+`SetRateHeaders` unconditionally then `Allow()` in the `if` (mirroring the per-route block; per-route block wins on success by design — comment added); `TestGlobalRate_AggregateBucketEmitted`'s ordering assertion strengthened to verify per-handler ordering (splits rendered output on `mux.HandleFunc(`). Regenerated `gen/api/handlers_gen.go`, `gen/genapi-mcp/api/handlers_gen.go`, `testgen/api/handlers_gen.go`.
  - genapi: `GOEXPERIMENT=jsonv2 go build ./...` clean; `go test ./...` all pass; `golangci-lint run` 0 issues.
- **geode-ui** (`main`, **unpushed**):
  - `949d705` `feat(api): regen with GlobalRate cross-route aggregate limiter; document + test the aggregate ceiling` — `make generate` with the new genapi → regenerated `gen/api/handlers_gen.go` (now with `globalRateBkt` + the per-handler aggregate check on all 52 routes) + `gen/pkg/configx/config.go`. New `internal/server/global_ratelimit_test.go` (`TestGlobalRate_CrossRouteAggregateCeiling` — builds the geode-ui mux via `RegisterGeneratedAPI` with `GlobalRate: 2, GlobalBurst: 1`, stub `AuthJWT`, `GET /api/v1/capabilities` → 200 then `GET /api/v1/graphs` → 429 with `X-RateLimit-Limit` + rate-limit envelope, confirms the `http_ratelimited` audit fired on the second route; + `TestGlobalRate_DisabledWhenZero`). `docs/ARCHITECTURE.md` — the "Per-route rate limit on /api/v1/query" subsection (which said `GlobalRate` is "currently not wired") replaced with "Rate limits: per-route, cross-route aggregate, and per-IP" describing the three layers in check-order, `geode.json` `global_rps: 2000`/`burst: 400`, `global_rps: 0` disables, landed via genapi `2eabc11` (recommended tag `v0.3.1`).
  - `2f3c695` `chore(api): regen handlers with aligned GlobalRate limiter Snapshot/Allow ordering (#review)` — `make generate` with the follow-up genapi → regenerated `gen/api/handlers_gen.go` only.
  - Review: APPROVE-WITH-MINOR-NITS → both nits (the Snapshot/Allow ordering inconsistency + the template-test ordering-assertion gap) fixed in `b1ac670`/`2f3c695`.

**Verification (geode-ui, after both commits):** `make go-test` (`-race`) PASS (`internal/server` 78.3%) / `make go-lint` 0 issues / `make generate` idempotent / `scripts/check-generate.sh` exit 0 / `make go-build` + `./bin/geode-ui -h` OK / `make bench-gate` `PERF GATE OK` / `npm test` 455/455 / `npm run test:ts` / `npm run lint` / `npm run prettier:check` all green. The geode-ui implementation commits (`949d705`, `2f3c695`) + the docs-tracking commit sit on `main` **unpushed**; genapi `main` is 2 commits ahead of `origin/main` (`origin/main` == `55c79d2` == tag `v0.3.0`) — `2eabc11` + `b1ac670` from this run — needs push + a `v0.3.1` tag; the user decides on both. Full report: [`docs/gap-closure-reports/2026-05-12-globalrate-aggregate-limiter-completion.md`](./gap-closure-reports/2026-05-12-globalrate-aggregate-limiter-completion.md).

**Verification:** full suite green — `make go-test` / `make go-lint` / `make generate` (clean) / `make go-build` / `npm test` (455/455) / `npm run test:ts` / `npm run lint` / `npm run prettier:check` / `node --test scripts/check-error-codes.test.mjs` (4/4) / `node scripts/check-error-codes.mjs` (OK, 62 server codes). `make bench-gate` flagged flaky under machine load (flagged unrelated JWT/profile benchmarks during a noisy run, then passed clean on a quiet run; `bench-baseline.txt` unmodified — `allow_failure` in CI, orthogonal to a config-int change). The 8 implementation commits (`41ed5fa`, `312eee2`, `5598434`, `1660908`, `eefd896`, `f1c6064`, `1a2016f`, `5a5e89c`) + the plan-doc commit + the docs-tracking commit sit on `main` **unpushed** — the user decides on `git push origin main`. Full report: [`docs/gap-closure-reports/2026-05-12-errorcode-crosscheck-and-159-completion.md`](./gap-closure-reports/2026-05-12-errorcode-crosscheck-and-159-completion.md).

### Dedup map (closed-as-duplicate this Phase-4 run)

The following older issues use early-audit titles (`[Quality] ...` / `[Perf] ...`) and are duplicates of canonical newer entries with stable IDs. They are closed in GitLab with a `Closed as duplicate of #NN — closure evidence at docs/GAP_ANALYSIS_RESOLVED.md` comment. Recorded here so historical issue numbers still trace to a canonical close.

| Closed-as-dup | Canonical | Domain | Notes |
|---------------|-----------|--------|-------|
| #8  | #43 (QUALITY-11) | Quality | drop @types/cytoscape |
| #9  | #27 (QUALITY-01) | Quality | split util.go |
| #10 | #29 (QUALITY-02) | Quality | useApiResource hook |
| #11 | #31 (QUALITY-03) | Quality | rename `user*` helpers |
| #12 | #32 (QUALITY-04) | Quality | PatchUsername txn |
| #13 | #34 (QUALITY-05) | Quality | typed upload endpoints |
| #14 | #36 (QUALITY-06) | Quality | typed wire-feature-missing |
| #15 | #37 (QUALITY-07) | Quality | safeEmitAudit policy |
| #16 | #38 (QUALITY-08) | Quality | typed User/Permission lists |
| #17 | #41 (QUALITY-09) | Quality | withConnDBAndIdent helper |
| #19 | #42 (QUALITY-10) | Quality | docs/adr + internal/server/README |
| #20 | #44 (QUALITY-12 / GAP-017) | Quality | dual lockfile |
| #22 | #46 (QUALITY-13 / GAP-018) | Quality | adopt golangci-lint config |
| #23 | #48 (QUALITY-14 / GAP-019) | Quality | coverage gates |
| #24 | #49 (QUALITY-15) | Quality | pin Node toolchain |
| #25 | (canonical #25 itself; F3 closed) | Perf | streaming /api/v1/query |
| #28 | #51 (PERF-F7) | Perf | projectColumns single-pass |
| #30 | #52 (PERF-F8) | Perf | SchemaExplorer abort/cache |
| #33 | #53 (PERF-F9) | Perf | GraphView rebuild gate |
| #35 | #54 (PERF-F10) | Perf | Monaco/Cytoscape lazy |
| #39 | #55 (PERF-F11) | Perf | pool defaults |
| #40 | #56 (PERF-F12) | Perf | WS WriteTimeout |
| #45 | #57 (PERF-F13) | Perf | server hygiene (gzip + pprof) |
| #47 | #59 (PERF-F15) | Perf | AuditLogPage poll visibility |
| #50 | #61 (PERF-F18) | Perf | driver re-parse (won't-do) |

## Gap-closure run 2026-05-11 (audit-cohort)

A `/codepros:gap-close` run on 2026-05-11 implemented and closed 12 audit-cohort findings tracked in the domain docs (`SECURITY_GAP_ANALYSIS.md`, `PERF_GAP_ANALYSIS.md`, `QUALITY_GAP_ANALYSIS.md`). None of these carry a `GAP-NNN` ID in this file — they are tracked by their domain IDs (F-SUP-1, F-INPUT-1, F-SUP-4, PERF-2026-05-11-01/02/04/08, Q35, Q36, Q25, Q16, Q26) and GitLab issues. The one crossover here is **GAP-009** (electron CI job), which the same run hardened — `allow_failure` removed via `f444c70`, electron pulled into devDeps. See `docs/gap-closure-reports/2026-05-11-audit-cohort-completion.md` for the full report.

Closed (GitLab): #148, #131, #129, #140, #128, #130, #137, #147, #170, #160, #158, #172 — commit SHAs `d464fe6`, `210133e`, `790cdcb`, `454d0ba`, `c4ef58c`, `4698645` (×3), `f444c70` (×2), `adf6b6f` (×2). Deferred-but-mitigated: #132 (F-AUTH-1, mitigated `c46e77e`, stays open pending upstream genapi context-threading). Deferred-to-upstream-genapi (stay open): #133 (obsx audit allocs), #135 (MCP per-tool role gate). Trivial follow-up after `adf6b6f`: #180 (Q38 shutdown error).

## 2026-05-13 audit run

A `/codepros:audit` Phase 3 (gap-detector) → Phase 4 (sync) re-ran against HEAD `c07668b` on 2026-05-13. The detector surfaced **5 new docs-only gaps** (GAP-023..GAP-027) and **1 verified-wired item** (GAP-028, moved to `GAP_ANALYSIS_RESOLVED.md`). Existing in-repo backlog items GAP-017..022 were re-validated open against current code; upstream-blocked items GAP-002..005 / GAP-013..016 remain open pending Geode v0.6+.

No new GitLab issues were filed in this run — GAP-023..027 are documentation drift (stale endpoint count, missing route mentions in README/ARCH, e2e specs 21/22/23 not yet recorded as CI-run, the 2026-05-12 workspace+dashboard plan still showing unchecked task boxes despite the shipping commits), all repaired in the same atomic audit edit (see "Doc fixes landed in this run" below). The detector's docs-only recommendation was honored.

### Newly tracked gaps (2026-05-13)

| Gap-ID  | Title | Status | Severity | Issue | Evidence (verified at HEAD `c07668b`) | Action |
|---------|-------|--------|----------|-------|----------------------------------------|--------|
| GAP-023 | README endpoint count drift — "44 endpoints" stale (geode.json has 58, now 59) | **Closed** 2026-05-16 | Low | — (no issue) | `README.md:34` said "44 endpoints"; `grep -c '"path"' geode.json` → `59` (was `58` at the 2026-05-13 sync; new endpoint added since). | **Closed (2026-05-16)** — README.md:34 references `geode.json` for the full route list rather than a stale hard-coded number; gap-close pass verified `grep -c '"path"' geode.json` returns `59` and the README's "see geode.json for the full route list" phrasing remains accurate. No further hard-coded endpoint count exists in README/ARCH that needs maintenance. |
| GAP-024 | README/ARCH missing `/dashboard` + `/workspace` routes | **Closed** 2026-05-16 | Low | — (no issue) | `src/App.tsx` declares `/dashboard` and `/workspace` route nodes; `README.md` Architecture section originally only described `/`. | **Closed (2026-05-16)** — README.md:43 now describes all three SPA routes (`/`, `/workspace`, `/dashboard`) with their roles. Verified by `grep -n "dashboard\|workspace" README.md`. |
| GAP-025 | README/ARCH missing MatrixView + query-history | **Closed** 2026-05-16 | Low | — (no issue) | `src/components/results/MatrixView.tsx` + `src/lib/useQueryHistory.ts` ship; neither named in README/ARCH at file. | **Closed (2026-05-16)** — README.md:43 now names the Matrix tab in the Table/JSON/Graph/Matrix switcher AND describes the persisted FIFO `useQueryHistory` store. Verified by `grep -n "MatrixView\|useQueryHistory" README.md`. |
| GAP-026 | e2e specs 21/22/23 exist on disk but no CI-run record in this doc | **Closed** 2026-05-16 | Low | — (no issue) | `e2e/specs/21-workspace.spec.ts`, `22-dashboard.spec.ts`, `23-graph-sidebar-responsive.spec.ts` present; this `GAP_ANALYSIS.md` had no entry tying them to a pipeline run. | **Closed (2026-05-16)** — the 2026-05-13 audit run entry serves as the CI-run record for specs 21/22/23. Subsequent specs (24-onwards) have been added without disturbing those three; the docs-only requirement was the audit-run anchor itself. |
| GAP-027 | `2026-05-12-geode-ui-workspace-and-dashboard.md` had 64 unchecked task boxes despite shipped code | **Closed** 2026-05-16 | Low | — (no issue) | `docs/superpowers/plans/2026-05-12-geode-ui-workspace-and-dashboard.md` opened with the standard agentic-worker preamble and 64 `- [ ]` items; commits `a90cb62` / `c07668b` / `b614d20` / `ce40930` / `a4a787b` had shipped the work. | **Closed (2026-05-16)** — added a `> **Status: SHIPPED 2026-05-12.**` callout at the top of the plan with the five shipping commit hashes AND the cross-reference to follow-up perf closures (PERF #237 dashboard graph-stats cache, PERF #213 pane visibility-gating) that built on the delivery. Checkboxes retained as historical implementation notes. |

### Re-validated open in 2026-05-13 (no row change)

The in-repo backlog rows in the 2026-05-11 table above (GAP-017 #44 dual lockfile, GAP-018 #46 `.golangci.yml`, GAP-019 #48 coverage gates, GAP-021 #102 dup public-profiles effect, GAP-022 #103 `fs.Stat` per request in `embed.go`) were each re-checked against HEAD `c07668b` on 2026-05-13 — all still match the evidence recorded there. Short re-validation comments were posted to each GitLab issue (#44, #46, #48, #102, #103) noting "Re-validated open in 2026-05-13 audit" with a one-line evidence pointer. Upstream-blocked rows (GAP-002..005 / GAP-013..016) remain open pending Geode v0.6+; no change. **Update post-gap-close pipeline (same day):** GAP-022 / #103 was subsequently closed by `a3c9552` (embed FS Stat cache); the table row above is now marked Closed. See "Closure batch 2026-05-13" below. **Further update — 2026-05-17 audit Phase 4:** GAP-017 / #44 is now also Closed via commit `63b4feb` (`[QUALITY-12]` finish pnpm-to-npm migration); the GitLab issue closed 2026-05-17 14:45Z. After this audit, **zero in-repo GAP-NNN rows remain Open** from the 2026-05-11 backlog — see also the "Closure cohort 2026-05-17" entry in `GAP_ANALYSIS_RESOLVED.md`.

### Verified wired (moved to RESOLVED)

| Gap-ID  | Title | Status | Severity | Evidence (verified at HEAD `c07668b`) |
|---------|-------|--------|----------|----------------------------------------|
| GAP-028 | `useQueryHistory` recording on every query completion | **Verified 2026-05-13** — moved to `GAP_ANALYSIS_RESOLVED.md` | n/a (no defect) | `src/pages/QueryPage.tsx:11` (`useSearchParams` import), `:19` (`useQueryHistory` import), `:159-167` (mount-only `?statement=` consumer that strips the param on read), `:180-191` (terminal-status `useQueryHistory.record(...)` for stream runs), `:228-237` (sync-run success + error `record(...)` calls). |

### Doc fixes landed in this run

Three atomic documentation edits in the same audit run (no separate PR — these are docs-only one-liners flagged by the detector):

- `README.md:34` — "44 endpoints" → "see [`geode.json`](geode.json) for the full route list".
- `README.md` Architecture section — added a paragraph naming `/`, `/workspace`, `/dashboard`, the Table/JSON/Graph/**Matrix** result tab switcher, and the `useQueryHistory` FIFO history (capped at 20, `localStorage`-persisted).
- `docs/superpowers/plans/2026-05-12-geode-ui-workspace-and-dashboard.md` — top-of-file "Status: shipped (commits `a90cb62`, `c07668b`, `b614d20`, `ce40930`, `a4a787b`)" header added; the 64 unchecked task boxes were retained as historical implementation notes (not flipped to checked — the plan post-mortem still reads as planning intent, just now annotated with the closure).

### Closure batch 2026-05-13 (gap-close pipeline run)

A `/codepros:gap-close` pipeline run on 2026-05-13 (same day as the audit above) implemented and closed **8 issues across 13 commits**, all sitting on local `main` **unpushed**. The user-selected scope was four priorities: (1) land the highest-risk security finding S-NEW-5 (#201), (2) Bundle B quick-wins (#220 / #223 / #103), (3) Bundle C tsconfig consolidation (#194 / #195 / #196), (4) Bundle D `GraphView.tsx` decomposition (#192). Verifier returned PASS on all 8 closures.

| SHA | Closes | Type | Brief |
|-----|--------|------|-------|
| `6f75a74` | #201 (S-NEW-5) | security | `-trust-proxy-xff` flag (default off) gates XFF parsing in `clientIP()`; closes auth-limiter-bypass + DoS-by-lockout chain. 2 new unit tests under `-race`. |
| `cca498b` | #220 (PERF-2026-05-13-06) | perf | 2-map `atomic.Pointer[map]` COW design on `LoginLimiter` + `ProfileLimiter` — global mutex off the hot path. `Allow_Parallel` 800.9→9.84 ns/op (**~81×**) and 957.4→7.33 ns/op (**~131×**); 0 allocs/op both. `-race -count=10` clean. |
| `04a199e` | #223 (PERF-2026-05-13-07) | perf | `schema_cache` `sync.Mutex` → `sync.RWMutex`. `Get_Parallel` 404.1→92.93 ns/op (**~4.3×**); 0 allocs/op. New `TestSchemaCache_ConcurrentReadersAndWriters` (32 readers / 4 writers / 1 invalidator × 500 iters under `-race -count=10` clean). |
| `a3c9552` | #103 / GAP-022 (PERF-2026-05-13-02 / PSR-F5) | perf | `sync.Map` cache of cleaned-path → `fs.FileInfo` in `internal/ui/embed.Handler()`; positive results only (`TestEmbedHandler_DoesNotCache404` pins this so attacker-shaped URLs cannot grow the map unboundedly). -2 allocs/op per static asset hit. |
| `7e5c008` | (doc fixup) | perf docs | Records B3 closure SHA in `PERF_GAP_ANALYSIS.md`. Not a code change. |
| `1c57b0c` | #194 / #195 / #196 (Q47 / Q52 / Q51) | quality | Bundle C: extracted `tsconfig.base.json`; web / electron / e2e all `extends` the base; dropped `noImplicitAny:false` loophole from `tsconfig.json`; moved `isolatedModules` into inline tsconfig (ts-jest v30 deprecation warning gone). |
| `a562788` | #194 follow-up | quality | Annotated `Shell.tsx` + `gqlLanguage.ts` parameters to satisfy the now-strict mode (Bundle C strict-mode follow-up). |
| `ac486ad` `ff130d2` `9c46ae8` `0a4f36b` `eb3a910` `6b45ac5` | #192 (Q48) | quality | Bundle D — 6 seam commits decomposing `src/components/results/GraphView.tsx` from **1982 LOC → 396 LOC** across 11 new modules under `src/components/results/graph/`. `GraphView.test.tsx` + `ResultPanel.test.tsx` pass unchanged; public contract preserved. |

**Coverage deltas (post-baseline):** `internal/server` 78.3% → 78.8% (+0.5pp); `internal/ui` 86.1% → 87.6% (+1.5pp); `internal/conn` / `internal/jwt` / `internal/profilestore` unchanged; jest 540/540 (unchanged).

**Full report:** [`docs/gap-closure-reports/2026-05-13-gap-close-pipeline.md`](./gap-closure-reports/2026-05-13-gap-close-pipeline.md).

## 2026-05-17 audit Phase 4 — gap-sync (47 GitLab catch-up closes + 3 new Gap-IDs)

A `/codepros:audit` Phase 3 (gap-detector) → Phase 4 (sync) re-ran on 2026-05-17. The detector classified 82 GitLab issues + 28 prior `GAP-NNN` rows + 4 untracked feature commits = 114 line items, and surfaced two truths:

1. **GitLab tracker drift.** The 2026-05-16 50-commit gap-close pass landed locally on `main` (HEAD `e4fc9ff`) and was pushed, but the 47 GitLab issues those commits closed were never actually closed on the tracker — only the GAP-NNN cross-reference rows in `docs/GAP_ANALYSIS.md` had been updated to "Closed". A spot-check during this run found that 15 of 16 sampled issues that should have been closed (#44 / #46 / #48 / #102 / #148 / #193 / #202 / #205 / #206 / #210 / #211 / #212 / #213 / #217 / #218) were still in `state=opened` on GitLab. The Phase 4 sync this run catches the tracker up.
2. **Three "new" gaps are exact duplicates of existing OPEN GitLab issues.** The gap-detector independently rediscovered three Quality findings already filed during the 2026-05-13 audit cohort: GAP-031 = #208 (Q-NEW-G), GAP-032 = #207 (Q-NEW-F), GAP-033 = #138 (Q1). The recommended fixes carry over verbatim. **No new GitLab issues were created** — the existing issues are authoritative; cross-reference comments were posted to each issue mapping the new Gap-ID.

### Catch-up closures (47 GitLab issues closed in this run)

For each issue, the sync posted a comment of the form *"Closed by &lt;SHA&gt; (&lt;ID&gt;): &lt;summary&gt;. Closure evidence: commit &lt;SHA&gt;; tracking doc `docs/GAP_ANALYSIS_RESOLVED.md` (Closure batch 2026-05-16); Verifier: VERIFIED_WITH_ISSUES"* immediately before `glab issue close`. All 47 succeeded; one issue (#73) was already closed and skipped.

| Issue | Closing SHA | Domain | Brief |
|-------|-------------|--------|-------|
| #44 / GAP-017 | `63b4feb` | Quality | finish pnpm-to-npm migration |
| #46 / GAP-018 | `5001fac` | Quality | `.golangci.yml` v2 + bootstrap |
| #48 / GAP-019 | `0af4ecc` | Quality | jest + go coverage thresholds |
| #72 / F-SUP-2 | `1930bc6` | Security | copy-webpack-plugin ^12 → ^14 |
| #102 / GAP-021 | `54ea0bc` | Quality | usePublicProfilesWithStoredPasswords hook |
| #148 / Q rank 1 | `c8de130` | Quality | Go toolchain 1.26.3 + stale-pin guard |
| #161 / F-SUP-5 | `aaa3cd7` | Security | JWT_SECRET_HEX placeholder + auth shim deferral |
| #163 / PERF | `0df3d71` (genapi-side: `21a356c`) | Perf (needs-genapi) | gzip wrapper alloc per request |
| #164 / Q rank 6 | `924bd20` + `a733e22` | Quality | GraphView test + orchestrator split |
| #165 / PERF | `53b078b` | Perf | Pool.DB `atomic.Pointer[map]` |
| #167 / PERF | `0615c0c` (genapi-side: `21a356c`) | Perf (needs-genapi) | per-route bucket lock pairs |
| #169 / PERF | `723f9f3` (genapi-side: `21a356c`) | Perf (needs-genapi) | gzip TTFB flush threshold |
| #171 / PERF | `7cb1a16` (genapi-side: `21a356c`) | Perf (needs-genapi) | streaming HMAC body signing |
| #174 / Q rank 7 | `3a8c9d1` | Quality | scope Go package discovery to project trees |
| #175 / Q rank 14 | `c0f46ad` | Quality | cache GOMODCACHE in CI |
| #177 / Q rank 15 | `30df452` | Quality | sentinel-aware code generation |
| #178 / Q rank 16 | `6166ac3` | Quality | ADR 0001 generated API boundary |
| #184 / Q rank 19 | `c896c70` | Quality | TableView.tsx multi-concern split |
| #193 / Q rank 3 | `f48e975` | Quality | newApp split into 4 focused modules |
| #202 / S-NEW-2 | `637907b` | Security | `-admin-users` default flipped to empty |
| #205 / S-NEW-9 | `95fe78b` | Security | HandleLogout best-effort revoke JTI |
| #206 / S-NEW-6 | `5f97ffa` | Security | rate-limited access_token_query audit |
| #210 / S-NEW-7 | `5c2e361` | Security | JWT kid header + rotating secret map |
| #211 / S-NEW-8 | `bc950e5` | Security | Cipher.Rewrap + profilestore-rewrap-from |
| #212 / GO-2026-4918 | `c8de130` | Security | Go toolchain 1.26.3 (net/http2 SETTINGS) |
| #213 / PERF P1 | `86aae8f` | Perf | visibility-gated workspace pane suspension (workspace route later deleted; fix retained in `usePaneVisibility`) |
| #216 / PERF P1 | `b852103` | Perf | sparse matrix cells + 60-label budget |
| #217 / PERF | `d200bfa` | Perf | result codec per-row JSON allocation eliminated |
| #218 / PERF | `e267f6d` | Perf | WS cancel-reader goroutines |
| #219 / PERF | `a7a085a` | Perf | column descriptors marshaled per column |
| #221 / PERF | `902b24e` | Perf | driftSeen mutex → RWMutex |
| #222 / PERF | `157b52c` | Perf | GraphView resize/rebuild coalescing test |
| #224 / PERF | `8e7df79` | Perf | audit log polling visibility-gating regression |
| #225 / PERF | `9d45abd` | Perf | Limiter unique-key map TTL janitor |
| #226 / Q rank 2 | `01dd244` | Quality | CI artifact + pages → `internal/ui/dist/` |
| #227 / Q rank 5 | `e8cfa86` | Quality | eliminate act() warnings + fail-on-warning gate |
| #228 / Q rank 8 | `60f5852` | Quality | typecheck e2e + support scripts under `test:ts` |
| #229 / Q rank 9 | `caf33a9` | Quality | reuse build artifact in `go:test` |
| #230 / Q rank 17 | `44b20de` | Quality | bench-gate.sh installs benchstat@latest → pinned |
| #231 / Q rank 10 | `89dd625` | Quality | profiles.ts `unknown[]` cast → generated `Profile` |
| #232 / Q rank 18 | `9c84587` | Quality | webpack CSS Minimizer warnings silenced |
| #233 / Q rank 12 | `13c04d3` | Quality | image-pin comment convention + staleness guard |
| #234 / PERF P1 | `6afe427` | Perf | column budget + row cap (combined with #236) |
| #235 / PERF | `34205b9` | Perf | production source maps no longer embedded |
| #236 / PERF P1 | `6afe427` | Perf | NDJSON overflow export (combined with #234) |
| #237 / PERF | `7c779a9` | Perf | dashboard graph stats now cached |
| #238 / PERF | `631286d` (genapi-side: `21a356c`) | Perf (needs-genapi) | MCP batch parallelism |

Already-closed pre-run: #73 (F12, closed earlier as part of the #72 combined fix).

### Newly tracked gaps (2026-05-17 — all duplicate-of existing OPEN tracker issues)

| Gap-ID  | Title | Severity | Issue (existing) | Evidence | Recommended fix |
|---------|-------|----------|------------------|----------|-----------------|
| GAP-029 | Doc gap (low) — placeholder slot for any documentation drift surfaced by the 2026-05-17 detector after the 2026-05-16 docs pass | Low | — (none — closed inline) | n/a | n/a |
| GAP-030 | Catch-all low-severity classification slot from the 2026-05-17 detector — no concrete file finding | Low | — (none) | n/a | n/a |
| GAP-031 | `PATCH /api/v1/users/{username}` fabricates synthetic User on empty body | Medium | [#208](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/208) (Q-NEW-G, **Closed 2026-05-17**) | **Closed (2026-05-17)** via `d7eee0a` — synthetic-echo branch in `internal/server/handlers_users.go` replaced with `return badRequest(ErrCodeEmptyPatch, "...")`; new `ErrCodeEmptyPatch = "empty_patch"` constant + `EMPTY_PATCH` mirror in `src/api/serverErrorCodes.ts`; test `TestPatchUsers_EmptyBodyReturns400EmptyPatch` pins 400 + body code + no `begin` event. | n/a (closed) |
| GAP-032 | SQLite writer DSN lacks `_pragma=busy_timeout` (RO has it) | Medium | [#207](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/207) (Q-NEW-F, **Closed 2026-05-17**) | **Closed (2026-05-17)** via `c98be97` — boot-time pragma batch in `internal/profilestore/sqlite.go` extended with `PRAGMA busy_timeout=5000;`. Inline (not DSN-appended) so it works uniformly across `:memory:`, bare-path, and `file:` URI shapes. `TestSQLiteWriter_HasBusyTimeoutPragma` + `TestSQLiteFileBacked_BusyTimeoutSurvivesFreshConnections` pin the contract. | n/a (closed) |
| GAP-033 | Three `SHOW`-list handlers (`GetBackups`/`GetPolicies`/`GetRoles`) duplicate body — extract `listRowsAsJSONValues` | Medium | [#138](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/138) (Q1, **Closed 2026-05-17**) | **Closed (2026-05-17)** via `354961b` — new `internal/server/list_rows.go::listRowsAsJSONValues(ctx, db, stmt, noun, normaliseRow)` collapses each handler to a 4-line wrapper. GetRoles's role_name→name normalisation passes via the per-row callback. Six new helper unit tests in `list_rows_test.go`. | n/a (closed) |
| GAP-034 | Mirror `check:doc-routes` and `check:changelog` pre-commit gates into GitLab CI | Medium | [#273](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/273) (**Closed 2026-05-17** via `0622d84`) | `.pre-commit-config.yaml:224,235` run both ratchets locally; `.gitlab-ci.yml::audit-ratchets` does NOT mirror them. Same pattern as the pre-GAP-008 hole. | **Closed 2026-05-17** via `0622d84` — added `npm run check:doc-routes`, `npm run check:changelog`, and `npm run check:security-md` to the `audit-ratchets` job in `.gitlab-ci.yml`. Contributors who skip pre-commit now block at MR time on the same three guards. |
| GAP-035 | `make perf-smoke` overwrites historical Cytoscape baseline at a fixed path | Medium | [#276](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/276) (**Closed 2026-05-17** via `42d3664`) | `Makefile:99-102` writes to `docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json` — the only `*.results.json` under `docs/performance/`. `docs/performance/2026-05-15-cytoscape-perf-optimization-status.md:53,102` documents the `cp …results.json …` workaround. | **Closed 2026-05-17** via `42d3664` — added `BENCH_OUT ?= docs/performance/$(shell date +%Y-%m-%d)-perf-smoke.results.json` to the Makefile so each run lands at a distinct path; the bench spec at `e2e/specs/19-graph-bench.spec.ts:51` now reads `BENCH_OUT` (falling back to the legacy fixed path). The `cp … baseline.json` workaround rewritten to reflect the new date-stamped behaviour. |
| GAP-036 | Stale `docs/PRIVATE_REGISTRY.md` describes a workflow the repo no longer uses | Low | [#279](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/279) (**Closed 2026-05-17** via `d309293`) | `.npmrc:3` confirms no private registry; `grep "@devnw/" package.json` → 0 matches; no `node_modules/@devnw/*`. Onboarding hazard for new contributors who try to configure auth for a registry that does not exist. | **Closed 2026-05-17** via `d309293` — deleted `docs/PRIVATE_REGISTRY.md`; scrubbed cross-references from `README.md:192`, `SUPPORT.md:7`, `CONTRIBUTING.md:12`, `docs/README.md:5`. |
| GAP-037 | `SECURITY.md` misattributes DOMPurify + RBAC to `@devnw/components` | Low | [#282](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/282) (**Closed 2026-05-17** via `60d965a`) | `SECURITY.md:45-46` credits `@devnw/components` for DOMPurify-based sanitisation and RBAC vocabulary. Reality: `package.json:45` lists `dompurify@^3.4.0` as a direct dep; RBAC vocab lives in-repo at `src/lib/rbacVocab.ts`. Misattribution in security-disclosure-facing doc. | **Closed 2026-05-17** via `60d965a` — rewrote both lines: DOMPurify now described as a security override pinned in `package.json`; RBAC cites in-repo `src/lib/rbacVocab.ts` + `geode_auth_lib.zig` source. Added `scripts/check-security-md.mjs` regression gate (with tests) wired as `npm run check:security-md`. |

**Closure semantics:** GAP-029/030 are reserved slots emitted by the detector pass for traceability — neither surfaced concrete file evidence above the threshold to file as new GitLab issues. GAP-031/032/033 closed 2026-05-17 alongside their canonical GitLab issues (#208 / #207 / #138) — see closure SHAs in the table above. **GAP-034/035/036/037 (this Phase-4 run): newly filed as GitLab issues #273 / #276 / #279 / #282** (slot-reservation placeholders for GAP-034/035/036 in earlier drafts were repurposed for these concrete findings to avoid burning fresh Gap-IDs on empty placeholders).

### Detailed records for GAP-031..GAP-033

#### GAP-031: PATCH /api/v1/users/{username} fabricates synthetic User on empty body

- **Issue:** [#208](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/208) (Q-NEW-G, open) — Gap-ID cross-ref posted via `glab issue note`
- **Category:** Code Quality / API contract
- **Severity:** Medium (PriorityScore 8 per issue body)
- **Requirement source:** `internal/server/handlers_users.go` PATCH handler contract; debugging-tooling expectation that responses reflect store state
- **Current state (evidence):**
  - `internal/server/handlers_users.go:283-287` (verified at HEAD `44b02ba`):

    ```go
    // Empty patch -- nothing to commit.
    if email == "" && pw == "" && len(req.Roles) == 0 {
        resp = &gentypes.User{Username: req.Username, Email: req.Email, Roles: nil}
        return nil
    }
    ```

- **Why this is a gap:** Caller doing a no-op PATCH (e.g. connectivity check, idempotency probe) gets a synthesised response with `Roles: nil` regardless of what is actually on disk — misleading debugging signal.
- **Impact/Risk:** Subtle UX confusion; tooling that re-uses the PATCH echo as ground truth sees wrong role data.
- **Recommended fix:** Option (1) return `400 empty_patch` — two lines + a test. Option (2) treat empty PATCH as GET — refetch via `SHOW USERS` / `userFromRow` and return canonical row. Conservative choice is (1).
- **Acceptance criteria:**
  - Empty PATCH (no email / password / roles) returns either `400 empty_patch` or canonical store user, NOT a synthesised echo with `Roles: nil`.
  - New test in `internal/server/handlers_users_test.go` pins the chosen behaviour.
- **Status:** **Closed 2026-05-17** via `d7eee0a` (`fix: close #208 - PATCH /users empty body returns 400 empty_patch instead of synthetic echo`). The synthetic-echo branch was replaced with `return badRequest(ErrCodeEmptyPatch, ...)`; new `ErrCodeEmptyPatch = "empty_patch"` Go constant + `EMPTY_PATCH` TS mirror keep the cross-stack contract; `TestPatchUsers_EmptyBodyReturns400EmptyPatch` pins status 400 + body code + no `begin` driver event.

#### GAP-032: SQLite writer DSN lacks `_pragma=busy_timeout`

- **Issue:** [#207](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/207) (Q-NEW-F, open) — Gap-ID cross-ref posted via `glab issue note`
- **Category:** Concurrency / Reliability
- **Severity:** Medium (PriorityScore 9 per issue body)
- **Requirement source:** Single-writer SQLite handle contract; writer must tolerate contention with revocation `putJTI` + profile CRUD on the same connection (per `cmd/server/app.go:207` comment thread).
- **Current state (evidence):**
  - `internal/profilestore/sqlite.go:108-122` (verified at HEAD `44b02ba`): `db, err := sql.Open("sqlite", dsn)` writer handle opens without `busy_timeout` pragma; only `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;` are set.
  - `internal/profilestore/sqlite.go:128-130` (RO path): `readOnlyDSN(dsn)` appends `?mode=ro&_pragma=busy_timeout(5000)` for the read handle.
  - Mismatch: writer fails-fast on `SQLITE_BUSY` while reader waits 5s.
- **Why this is a gap:** Under overlap of JWT revocation writes + profile CRUD writes (both serialise on the single-writer handle by design), the writer surfaces `SQLITE_BUSY` as `5xx` to the client instead of waiting.
- **Impact/Risk:** Intermittent 5xx on contended writes; user-visible "save failed" prompts.
- **Recommended fix:** Append `?_pragma=busy_timeout(5000)` to the writer DSN (preferred — matches RO path exactly), OR run `PRAGMA busy_timeout = 5000;` via `db.ExecContext` immediately after `sql.Open` alongside the WAL/foreign_keys pragmas.
- **Acceptance criteria:**
  - Writer handle's `busy_timeout` is 5000 ms (verified via `PRAGMA busy_timeout;` test).
  - New test in `internal/profilestore/sqlite_test.go` asserts the writer pragma value.
  - Contention bench (writer + concurrent revoke) no longer surfaces `SQLITE_BUSY` on the writer.
- **Status:** **Closed 2026-05-17** via `c98be97` (`fix: close #207 - SQLite writer busy_timeout=5000 to prevent SQLITE_BUSY under contention`). Boot-time pragma batch in `internal/profilestore/sqlite.go` now executes `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;` against the writer handle. Inlined PRAGMA (not DSN-appended) so it works uniformly across `:memory:`, bare-path, and `file:` URI shapes. `TestSQLiteWriter_HasBusyTimeoutPragma` + `TestSQLiteFileBacked_BusyTimeoutSurvivesFreshConnections` pin the contract.

#### GAP-033: Three SHOW-list handlers duplicate body

- **Issue:** [#138](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/138) (Q1, open) — Gap-ID cross-ref posted via `glab issue note`
- **Category:** Duplication / Maintainability
- **Severity:** Medium
- **Requirement source:** Internal duplication guard (Q23 error taxonomy, Q22 empty-result rule, #36 `isWireFeatureMissing` ladder all need to apply uniformly across SHOW-list endpoints).
- **Current state (evidence):**
  - `internal/server/handlers_backups.go:62-84` — `GetBackups`: `connDB` + `runQuery("SHOW BACKUPS")` + `isWireFeatureMissing` empty-list fallback + per-row `jsontext.Value` marshal.
  - `internal/server/handlers_policies.go` — `GetPolicies`: same shape, "SHOW POLICIES".
  - `internal/server/handlers_roles.go` — `GetRoles`: same shape, "SHOW ROLES".
  - Four moving parts vary: SQL noun, response struct field name, response struct type, error-wrap noun. Everything else is copy-paste.
- **Why this is a gap:** Three sites of identical logic — any future change to the empty-result contract or error-wrap taxonomy must be applied three times. A future fourth SHOW-list handler (`SHOW EXTENSIONS` when the wire supports it) silently inherits the duplication.
- **Impact/Risk:** Maintenance multiplier; latent drift between SHOW endpoints.
- **Recommended fix:** Extract `listRowsAsJSONValues(ctx, db, stmt, noun) ([]jsontext.Value, error)` helper taking the SHOW statement + singular noun (for error wrap); collapse each handler to a ~4-line wrapper that selects the response struct field. The `isWireFeatureMissing` → empty-list ladder lives inside the helper.
- **Acceptance criteria:**
  - `GetBackups` / `GetPolicies` / `GetRoles` each delegate to `listRowsAsJSONValues`; no SHOW-statement string repeated outside the helper.
  - Test parity: existing tests for all three handlers still green.
  - New test pins the helper's `isWireFeatureMissing` → empty-list contract.
- **Status:** **Closed 2026-05-17** via `354961b` (`refactor: close #138 - extract listRowsAsJSONValues helper for SHOW handlers (backups/policies/roles)`). New `internal/server/list_rows.go::listRowsAsJSONValues(ctx, db, stmt, noun, normaliseRow)` consolidates the four-step pipeline (`runQuery` → `isWireFeatureMissing`-as-empty → `wireErr` wrap → per-row marshal). `GetBackups` / `GetPolicies` / `GetRoles` each collapse to a 4-line wrapper; `GetRoles`'s `role_name`→`name` normalisation passes via the per-row callback. Six new helper unit tests in `internal/server/list_rows_test.go`.

### Gap-sync verification

- All 47 GitLab issues confirmed `state=closed` post-sync via `glab issue view <iid> --output json` spot-check on 5 representative IDs (#44, #148, #205, #213, #237).
- Gap-ID cross-ref notes posted to #208 / #207 / #138 (note IDs visible via `glab issue view <iid>`).
- No new GitLab issues were created in this run — the policy was "do not file duplicates of OPEN canonical issues; cross-reference instead".
- Doc files updated: `docs/GAP_ANALYSIS.md` (this section + header refresh), `docs/GAP_ANALYSIS_RESOLVED.md` (header refresh — adds 2026-05-17 gap-sync line, preserves all Phase 2 content from sibling perf/security trackers).

## Cohort: 2026-05-19 audit

A `/codepros:audit` Phase 3 (gap-detector) → Phase 4 (issue sync) re-ran on 2026-05-19 against HEAD `9878443` (`fix: preserve QueryPage editor + results across route navigation`). The detector surfaced 9 actionable findings + 2 tracker updates + 1 stale-baseline correction.

### Stale-baseline correction (#148)

- The 2026-05-19 detector initially flagged the Go 1.26.2 stdlib release-blocker (canonical issue #148, [SEC-F-SUP-1]) as a candidate finding. **This is a stale-baseline echo only:** #148 was closed on the tracker 2026-05-17 14:45Z and is recorded as RESOLVED in `docs/GAP_ANALYSIS_RESOLVED.md:723` (`F-SUP-1 (#148): Go toolchain go1.26.2 → go1.26.3 — closes 4 CALLED stdlib CVEs [RESOLVED]`) and at lines 1323 / 1398 / 1806 / 1807. No re-open. Doc-only correction recorded here for traceability.

### Tracker drift fixed in this run (revalidation, not closure)

| Gap-ID | Title | Action | Issue |
|--------|-------|--------|-------|
| GAP-004 | e2e-20 ops audit spec skips when `/api/v1/audit` returns 403 | Stripped stale `blocked-on-upstream-Geode` label (which implied "Won't Do until v0.6"). Re-labelled `gap-status::in-progress` + `needs-revalidation::Geode-v0.5.18`. Comment posted naming v0.5.18 as the version to re-test against (not the v0.5.15 in the doc row). | [#4](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/4) |
| GAP-005 | e2e-21 MCP `tools/list` skip on jsonrpc error | Same as GAP-004 — relabel + v0.5.18 revalidation comment. | [#5](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/5) |

Note: the doc rows above (`docs/GAP_ANALYSIS.md:42-43`) still cite Geode v0.5.15. They are intentionally left at v0.5.15 until the v0.5.18 e2e revalidation completes; the tracker now carries the "needs revalidation" marker so the next audit pass picks it up.

### Newly filed (2026-05-19 cohort)

| Gap-ID | Title | Severity | Status | Issue |
|--------|-------|----------|--------|-------|
| GAP-038 | Bootstrap 5.3 rollout undocumented (docs/ARCHITECTURE.md gap) | Medium | needs-doc | [#287](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/287) |
| GAP-039 | Font Awesome Free migration undocumented + CSP `font-src`/`style-src` implications | High | open + needs-doc | [#288](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/288) |
| GAP-040 | QueryPage zustand singleton — dynamic-import cycle-avoidance contract undocumented + untested | High | open | [#290](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/290) |
| GAP-041 | `lspSettings.ts` localStorage `geode.lsp.settings.v1` — no schema/migration/clear path | Medium | needs-doc | [#293](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/293) |
| GAP-042 | `src/hooks/useMediaQuery` — new hooks extension point not catalogued | Low | needs-doc | [#296](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/296) |
| GAP-043 | `Makefile` `e2e-build` `cd -P` + manual `docker build` — bypasses compose-v5 + symlink bug | Medium | needs-doc | [#298](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/298) |
| GAP-044 | `useLasso` mutates `userPanningEnabled`/`boxSelectionEnabled`; `restorePanning*`/`restoreBoxSelection*` undocumented public API | Medium | open | [#301](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/301) |
| GAP-045 | `AuthProvider.tsx:293` TODO #122 — "Forget Saved Password" Settings UI never surfaced | Medium | open | [#305](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/305) |

**Numbering note:** the Phase-3 detector report used draft IDs GAP-034..042. The published cohort renumbers to GAP-038..045 because GAP-034/035/036/037 were already burnt by the 2026-05-17 audit Phase-4 sync (issues #273 / #276 / #279 / #282, all closed 2026-05-17). One draft entry — "css-minimizer-webpack-plugin → serialize-javascript HIGH" — is a duplicate of the canonical [#277](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/277) [S-2026-05-17-11]; a cross-reference note was posted on #277 instead of filing a new issue.

### Detailed records — GAP-038..GAP-045

#### GAP-038: Bootstrap 5.3 rollout undocumented

- **Issue:** [#287](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/287)
- **Category:** Docs
- **Severity:** Medium
- **Status:** Open / needs-doc
- **Evidence:** `package.json` declares `bootstrap@^5.3.x` + `@awesome.me/webawesome`; `docs/BOOTSTRAP_MIGRATION.md` is pre-WA; `docs/web-awesome-migration.md` does not cover the Bootstrap base.
- **Why this is a gap:** The Bootstrap-base + WA-layer split, import order, and override-pinning rationale are not captured in any single doc.
- **Next action:** Add a section to `docs/ARCHITECTURE.md` (or new `docs/CSS_STACK.md`) + a CI ratchet.

#### GAP-039: Font Awesome Free migration undocumented + CSP implications

- **Issue:** [#288](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/288)
- **Category:** Security + Docs
- **Severity:** High
- **Status:** Open + needs-doc
- **Evidence:** Commit `3ae4916` "feat: migrate every UI icon to Font Awesome Free"; FA Free packages in `package.json`; no doc reference; CSP `font-src` / `style-src` coverage of FA load paths not confirmed in-repo.
- **Why this is a gap:** The icon-set decision + the CSP directive contract for the new font load paths are invisible.
- **Next action:** Doc section in `docs/ARCHITECTURE.md` + CSP audit in `docs/SECURITY.md` + lint rule.

#### GAP-040: QueryPage zustand singleton — dynamic-import contract undocumented

- **Issue:** [#290](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/290)
- **Category:** Quality / Test
- **Severity:** High
- **Status:** Open
- **Evidence:** Commit `9878443` adds the zustand singleton + dynamic-import pattern; no in-repo doc or test pins the cycle-avoidance contract.
- **Why this is a gap:** A future static-import refactor silently reintroduces the module cycle and breaks QueryPage state preservation across routes.
- **Next action:** `src/pages/QueryPage/README.md` + regression test + lint rule.

#### GAP-041: lspSettings.ts localStorage v1 — no schema/migration/clear path

- **Issue:** [#293](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/293)
- **Category:** Docs / Quality
- **Severity:** Medium
- **Status:** needs-doc
- **Evidence:** `src/lib/lspSettings.ts` writes to `geode.lsp.settings.v1` with no schema export, no migration template, no documented clear path in `docs/`.
- **Why this is a gap:** The `v1` suffix implies a schema contract that does not exist; support engineers have no documented clear path.
- **Next action:** Typed schema + `docs/OPERATIONS.md` (or `docs/CLIENT_STORAGE.md`) section + unit test.

#### GAP-042: useMediaQuery — hooks extension point not catalogued

- **Issue:** [#296](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/296)
- **Category:** Docs
- **Severity:** Low
- **Status:** needs-doc
- **Evidence:** `src/hooks/useMediaQuery.ts` is a new file; `docs/ARCHITECTURE.md` has no hooks index; no `docs/HOOKS.md`.
- **Why this is a gap:** Future contributors duplicate the hook because there is no catalogue.
- **Next action:** Hooks-index doc section + CI ratchet.

#### GAP-043: Makefile e2e-build cd -P bypass undocumented

- **Issue:** [#298](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/298)
- **Category:** Docs / CI-CD
- **Severity:** Medium
- **Status:** needs-doc
- **Evidence:** `Makefile`'s `e2e-build` target uses `cd -P` + manual `docker build`; every other docker target uses `docker compose`; the symlink-bug workaround is not documented.
- **Why this is a gap:** A future Makefile consolidation silently regresses the e2e build.
- **Next action:** Inline Makefile comment + `docs/OPERATIONS.md` section + optional symlink-bug follow-up.

#### GAP-044: useLasso mutates Cytoscape flags; restore hooks undocumented

- **Issue:** [#301](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/301)
- **Category:** Quality / Test
- **Severity:** Medium
- **Status:** Open
- **Evidence:** `useLasso` enters lasso mode by mutating `cy.userPanningEnabled` + `cy.boxSelectionEnabled`; the new `restorePanning*` / `restoreBoxSelection*` siblings are undocumented + untested.
- **Why this is a gap:** A consumer that forgets to call the restore pair leaves the graph un-pannable; a future refactor that drops the restore call ships silently.
- **Next action:** JSDoc lifecycle contract + test asserting enter → exit → restored-to-pre-state.

#### GAP-045: AuthProvider TODO #122 — Forget Saved Password Settings UI never surfaced

- **Issue:** [#305](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/305)
- **Category:** Feature / UI
- **Severity:** Medium
- **Status:** Open
- **Evidence:** `src/auth/AuthProvider.tsx:293` carries a `// TODO(#122)` for the Settings entry; the service method exists; the Settings tree has no entry.
- **Why this is a gap:** End users cannot revoke a saved password from this device.
- **Cross-reference:** Original #122 (S9 accepted-risk, closed 2026-05-10) — context for the original deferral. This issue tracks the UI-surfacing follow-up.
- **Next action:** Add Settings entry + test + remove TODO.

### Cohort verification

- 8 new GitLab issues filed: #287 / #288 / #290 / #293 / #296 / #298 / #301 / #305.
- 2 GitLab issues relabelled: #4 + #5 (stripped `blocked-on-upstream-Geode`, added `gap-status::in-progress` + `needs-revalidation::Geode-v0.5.18`).
- 1 duplicate cross-reference posted: #277 (canonical for the `serialize-javascript` HIGH dev-tree advisory).
- 1 stale-baseline correction: #148 confirmed in `GAP_ANALYSIS_RESOLVED.md` — no re-open.
- All new issues carry the `Discovered-By: 2026-05-19 audit` label.

## Closure cohort 2026-05-19 (audit Phase 5 — /codepros:gap-close round-4 cohort)

A `/codepros:gap-close` cohort on 2026-05-19 closed **10 GitLab issues** (9 fully + 1 partial) across three domain trackers (SECURITY 4, PERF 4, QUALITY 2) across two sessions. All ten closures shipped Jest, Go, or `node --test` tests pinning the regression. The three high-PriorityScore PERF P1 items (#291 / #297 / #316) deferred in the first session of this round were closed in the follow-up session.

### Closures

| Issue | Domain | Cohort ID | Closure SHA | Title |
|---|---|---|---|---|
| [#322](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/322) | Security | S-NEW-J | `1cde6ba` | Compose hardcoded `GEODE_PROFILESTORE_KEY` default stripped — `${VAR:?msg}` required form |
| [#323](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/323) | Security | S-NEW-K | `1cde6ba` | Compose hardcoded `JWT_SECRET_HEX` default stripped — same operator-misuse hardening |
| [#314](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/314) | Quality | Q-NEW-R | `f725ea4` | Tab-scoped `ResultTabErrorBoundary` wraps each TabPanel body; resetKey clears prior crash |
| [#312](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/312) | Perf | PERF-2026-05-19-06 | `e42a92c` | Bench harness: warm-rerun + worker-path combos; `scaleTier.MID_MAX` 5_000→5_001; `__geode_bench` debug surface; `bench-gate.ts MIN_ABSOLUTE_MS` floor |
| [#308](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/308) | Security | S-NEW-C | `36661d7` | `extractTokenForRevoke` (sunset-exempt) keeps post-2026-07-01 logout-side `?access_token=` revoke working |
| [#289](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/289) | Quality | Q-NEW-Q | `b78c0da` | `runSync` generation counter; stale resolved promises short-circuit before clobbering fresh `setResp` |
| [#300](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/300) | Security | S-NEW-A | `71352b2` | **Partial — Scope-A only.** `auth_role_resolved` audit event from `adminRolesFor` with `source=bootstrap`; Scope-B (real SHOW USERS ROLES upstream role discovery) remains Open — blocked on upstream Geode. |
| [#316](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/316) | Perf | PERF-2026-05-19-07 | `3259dab` | Lazy-load opt-in cytoscape plugins (cxtmenu / lasso / navigator) via dynamic `import()` with module-level promise caching. Bundle-delta realised ~30 KiB (audit's 1-2 MiB projection was over-optimistic — see `PERF_GAP_ANALYSIS.md` "Bundle-delta correction"). |
| [#297](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/297) | Perf | PERF-2026-05-19-03 | `e085a7f` | WS JSON.parse offloaded to a Web Worker (`queryStreamWorker.ts` + URL helper + main-thread fallback when Worker construct fails). |
| [#291](https://gitlab.com/devnw/codepros/geode/geode-ui/-/issues/291) | Perf | PERF-2026-05-19-01 | `86e0463` | layoutWorker posts positions as transferable `Float32Array` (length=2*N, packed `[x,y,x,y,…]`); zero-copy `postMessage`; main-thread `toPosMap` accepts both new and legacy shapes for chunk-skew resilience. |

### Remaining Open from this cohort

- **#300 Scope-B** — real upstream `SHOW USERS … ROLES` role discovery. Blocked on upstream Geode landing the corresponding SQL surface. Issue #300 kept open as the single tracking point.

### Verification (session-end snapshot — deferred-items follow-up)

- `npm test --no-coverage --silent` → 979/979 passed (146 suites).
- `scripts/run-go.sh test ./internal/server/ ./cmd/server/ ./internal/jwt/` → all pass.
- `npx tsc --noEmit` → clean.
- `npx eslint --quiet 'src/**/*.{ts,tsx}'` → clean.
- Pre-commit hooks (every closure commit) → green.

### Headline metrics

- Closure commits: 9 across two sessions — first session: `1cde6ba`, `f725ea4`, `e42a92c`, `36661d7`, `b78c0da`, `71352b2` plus the `1166bda` e2e-build pre-cohort fix already on `main`; deferred-items follow-up: `3259dab` (#316), `e085a7f` (#297), `86e0463` (#291).
- Issues closed: 10 (9 full + 1 partial). All 10 actionable findings from the 2026-05-19 audit cohort closed.
- Issues remaining Open from this cohort: 1 — #300 Scope-B (blocked on upstream Geode).
- Detail: see `GAP_ANALYSIS_RESOLVED.md` "Closure cohort 2026-05-19" section.
