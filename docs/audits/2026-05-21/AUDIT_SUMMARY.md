# Full Codebase Audit Summary — 2026-05-21

**Mode:** `--skip-issues` (docs-only; no GitLab writes)
**Branch:** `main` @ `1199648` (clean tree)
**Run inputs:**
- `gap-collection.md` · `gap-scan.md` · `gap-detection.md`
- `quality-inventory.md` · `quality-scan.md` · `quality-review.md`
- `perf-context.md` · `perf-scan.md` · `perf-review.md`
- `security-inventory.md` · `security-scan.md` · `security-review.md`

## Repository

| Field | Value |
|---|---|
| Project | `geode-ui` (GitLab) |
| Languages | Go 1.26.3 · TypeScript 5.8 / React 18.2 · Electron 42 |
| Frameworks | Bootstrap 5.3 · Web Awesome 3.7 · Zustand 5 · react-i18next · Cytoscape · Reagraph · Recharts · Monaco · DOMPurify |
| Backend | `cmd/server/` + `internal/server/` — stdlib HTTP, JWT (`jwt/v5`, `jwx`), OTEL 1.43, `modernc.org/sqlite`, QUIC upstream |
| Tests | Jest 29 (164 suites / 1109 tests, **81.7% stmt cov**) · Go (70 `_test.go`, **80.0% cov**) · Playwright 1.59 (38 specs) |
| Tooling | ESLint 8 airbnb · Prettier 3 · golangci-lint v2 · gofmt/goimports · pre-commit + pre-push (20+ guard scripts) · gitleaks + detect-secrets · CI pinned `ci-catalog@v1.7.1` |
| Scope | entire repo |

## Domain Results

### Gap Analysis
| Status | Count | Percentage |
|---|---:|---:|
| Implemented (drift; tracker open) | 34 | 39.1% |
| Partial | 1 | 1.1% |
| Not Implemented | 47 | 54.0% |
| Won't-Do / sentinel | 5 | 5.7% |

**Open gaps:** 47 (Critical 0 · High 6 · Medium 22 · Low 19).
**Top:** `GAP-039 / #288` Font-Awesome migration + CSP · `GAP-099 / #309` Cytoscape `cy.on` registered before `cyRef.current = cy` at `src/components/results/graph/useGraphCytoscape.ts:267-283`.

### Code Quality
| Severity | Count |
|---|---:|
| P0 / Blocker | 1 |
| High | 7 |
| Medium | 12 |
| Low | 12 |

**PriorityScore top finding:** `Q-S-02` — `check-doc-routes` self-collision (score **100**). Every audit emission re-fires the guard on its own deliverables because `docs/audits/**` is missing from `scripts/check-doc-routes.mjs` allow-list. 2-line fix; must land before the next audit pass.

Other near-top: `Q-S-03` missing image-pin in `.gitlab-ci.yml:884` (80), `Q-S-04` chunk-budget over (80 — chunks `2749.*` 6.41 MiB + `vscode-services` 5.17 MiB), `Q-R-01` `result_codec.go` 828 LOC / 5 concerns (60), `Q-R-04` `QueryPage.tsx` 727 LOC + 4 effects + rAF (60).

### Performance
| PerfSeverity | Count |
|---|---:|
| P0 | 0 |
| P1 | 4 |
| P2 | 7 (5 new + 2 reverified carry-overs) |
| P3 | 4 |
| Info | 1 |

**PerfScore top finding:** `PERF-2026-05-21-01` — **bench-gate meta-blocker** (score **100**). `.gitlab-ci.yml:472` is `allow_failure:true` and there is no benchmark coverage for `ParseProm`, `projectSnapshot`, `HandleMetrics`, `lspFrameReader`, `hibpHasSeen`. Until both halves resolve, every `confidence::suspected` finding is invisible to MR review.

Next P1s: SPA `setInterval` shared-clock missing across `useMetricsPolling.ts:128`, `AuditEventMixCard.tsx:124`, `AuditLogPage.tsx:196` (80) · per-call `&http.Client{}` in `handlers_metrics.go:214` + `password_policy.go:169` (64) · `lspFrameReader` byte-by-byte read in `ws_lsp.go:351-374` (64).

### Security
| Risk Level | Count |
|---|---:|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 11 |
| Info | 5 |

**Immediate actions:** 0 secret rotations. 0 active production vulns (`govulncheck` 0, `npm audit --omit=dev` 0 across 226 prod deps).

**Top finding:** `A1` Risk 24 / Medium — CWE-639 (BOLA) on `POST /api/v1/users/{username}/password` (`internal/server/handlers_users.go:403-438`). JWT-gated but no `required_roles:["admin"]` AND no `claims.Subject == path.username` check. Defense-in-depth on upstream Geode RBAC.

**Second:** `S1` Risk 24 / Medium (dev-machine) — 15 npm advisories in `tar`/`webpack-dev-server`/`ws` cluster. Reclassified UP at dev-machine boundary (open-LAN `npm run dev` exposure); LOW at CI release host. Fix is one MR: `electron-builder 25.1.8 → 26.8.1` + `webpack-dev-server@latest`; `ws` follows via npm dedup.

## Cross-Domain Summary

| Domain | Findings (this pass) | Issues Created | Issues Updated | Issues Closed |
|---|---:|---:|---:|---:|
| Gap Analysis | 86 (47 open + 34 drift + 3 won't-do + 1 partial + 1 sentinel) | 0 | 0 | 0 |
| Quality | 32 (28 reviewer + 4 scanner) | 0 | 0 | 0 |
| Performance | 17 (14 new + 3 reverified) | 0 | 0 | 0 |
| Security | 23 (Med 2 / Low 11 / Info 5 + 5 prior carry) | 0 | 0 | 0 |
| **Total** | **158** | **0** | **0** | **0** |

> `--skip-issues` mode: GitLab is untouched. All findings are persisted to the doc trackers below; the gap-sync agent additionally maintains a "Pending tracker-issue actions" appendix in `GAP_ANALYSIS.md` (34 IID closes + 3 label flips + 5 evidence-changed verifications + stale `status::triage` strip on 46 issues) ready for the next non-skip-issues run.

## Docs Updated

| File | Domain | Action |
|---|---|---|
| `docs/GAP_ANALYSIS.md` | Gap | +291 lines — 2026-05-21 cohort section (47 open + restated + won't-do + partial), severity matrix, provenance, pending-actions appendix §A–§E |
| `docs/GAP_ANALYSIS_RESOLVED.md` | Gap | +141 lines — closure cohort 2026-05-21 with 34 drift items, SHAs verified, "tracker close pending next sync" tag |
| `docs/QUALITY_GAP_ANALYSIS.md` | Quality | 2026-05-21 cohort table (32 rows: 3 scanner + 28 reviewer + 1 RESOLVED), PriorityScores, Q-S-01 ESLint marked resolved |
| `docs/PERF_GAP_ANALYSIS.md` | Performance | 14-row cohort `PERF-2026-05-21-01..14` + 3 carry-overs reverified (#294 #302 #306), summary/top-5/roadmap updated |
| `docs/SECURITY_GAP_ANALYSIS.md` | Security | +154 lines — 2026-05-21 cohort table (23 rows), dev-machine vs CI-host boundary note, atomic 2-bump remediation plan |
| `docs/audits/2026-05-21/*.md` | All | 12 per-agent deliverables + this summary |

## Top 10 Findings (cross-domain, by severity)

| # | Domain | Finding | Severity | Score | Location |
|---:|---|---|---|---:|---|
| 1 | Quality | `check-doc-routes` self-collision blocks future audits in CI | P0/Blocker | 100 | `scripts/check-doc-routes.mjs` allow-list |
| 2 | Perf | `bench-gate` meta-blocker — `allow_failure:true` + 5 hot paths uncovered | P1 | 100 | `.gitlab-ci.yml:472`, `bench-baseline.txt` |
| 3 | Security | BOLA on password-change route — no subject-equality check | Medium | 24 | `internal/server/handlers_users.go:403-438` |
| 4 | Security | Dev-machine npm cluster (tar/wds/ws) — open-LAN `npm run dev` exposure | Medium | 24 | `package.json` electron-builder + jest-environment-jsdom chains |
| 5 | Perf | SPA pollers don't share a clock — server load `O(tabs × pollers)` | P1 | 80 | `useMetricsPolling.ts:128`, `AuditEventMixCard.tsx:124`, `AuditLogPage.tsx:196` |
| 6 | Quality | `result_codec.go` 828 LOC / 5 concerns — splittable | High | 60 | `internal/server/result_codec.go` |
| 7 | Quality | `QueryPage.tsx` 727 LOC + 4 effects + rAF + JSX | High | 60 | `src/pages/QueryPage.tsx:155-727` |
| 8 | Perf | Per-call `&http.Client{}` w/ default transport (TLS handshake every 5s poll) | P1 | 64 | `handlers_metrics.go:214`, `password_policy.go:169` |
| 9 | Perf | `lspFrameReader` byte-by-byte read + per-frame `strings.ToLower` | P1 | 64 | `internal/server/ws_lsp.go:351-374` |
| 10 | Gap | Cytoscape `cy.on` handlers registered before `cyRef.current = cy` — leak on error | High | — | `src/components/results/graph/useGraphCytoscape.ts:267-283` |

## Blockers

1. **Q-S-02 / check-doc-routes self-collision** — must fix the allow-list (2 lines) before the next audit pass, or every audit deliverable will re-fail CI.
2. **PERF-2026-05-21-01 / bench-gate** — `allow_failure: true` + 5 missing benches makes `confidence::suspected` perf findings invisible to MR review. Single highest-leverage closure.
3. **glab token reports invalid** for write API (read works) — operator rotation needed before any future non-skip-issues sync.

## Recommended Next Actions (priority order)

1. **Fix `scripts/check-doc-routes.mjs`** — add `docs/audits/**` to allow-list (~2 lines + guard test update).
2. **Land the 5 missing benches** (`ParseProm`, `projectSnapshot`, `HandleMetrics`, `lspFrameReader`, `hibpHasSeen`) and flip `bench-gate` to `allow_failure: false`.
3. **Close BOLA `A1`** — add subject-equality gate at `handlers_users.go:404` (admin or self).
4. **Atomic dev-dep bump MR** — `electron-builder 25.1.8 → 26.8.1` + `webpack-dev-server@latest`; re-validate Authenticode + `ws` dedup.
5. **Shared polling clock hook** — single `usePollingClock` hub feeding the three SPA pollers.
6. **Tuned `*http.Transport` singleton** — package-level for `/api/v1/metrics` and HIBP calls.
7. **Rotate `glab` token**, then run a non-skip-issues `/codepros:audit` pass to drain the 34 drift closes, 3 label flips, 5 evidence-changed verifications, and 46 `status::triage` strips queued in the GAP_ANALYSIS appendix.
