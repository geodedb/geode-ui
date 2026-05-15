# Gap Closure Completion Report -- 2026-05-12 (error-code cross-check + #159 rate-limit alignment)

- **Repository:** `devnw/codepros/geode/geode-ui`
- **Branch:** `main` (8 implementation commits + 1 plan-doc commit + 1 docs-tracking commit, **unpushed**)
- **Companion repo:** none this run (no genapi change -- the surfaced `GlobalRate` gap is upstream but deliberately left unfiled; see below)
- **Platform:** GitLab (`glab` as `benjiv`)
- **Plan:** [`docs/superpowers/plans/2026-05-12-errorcode-crosscheck-and-query-ratelimit.md`](../superpowers/plans/2026-05-12-errorcode-crosscheck-and-query-ratelimit.md) (committed this run)
- **Reviews:** Thread A -- **APPROVE-WITH-MINOR-NITS** (both reviewers); nits fixed in `1660908`. Thread B -- **NEEDS-FIXES** (one doc-accuracy issue); fixed in `5a5e89c`.
- **Companion docs:** [PERF_GAP_ANALYSIS.md](../PERF_GAP_ANALYSIS.md), [QUALITY_GAP_ANALYSIS.md](../QUALITY_GAP_ANALYSIS.md), [GAP_ANALYSIS.md](../GAP_ANALYSIS.md), [GAP_ANALYSIS_RESOLVED.md](../GAP_ANALYSIS_RESOLVED.md); prior runs: [2026-05-12-top10-quality-batch-completion.md](./2026-05-12-top10-quality-batch-completion.md), [2026-05-12-genapi-and-medium-cohort-completion.md](./2026-05-12-genapi-and-medium-cohort-completion.md), [2026-05-11-audit-cohort-completion.md](./2026-05-11-audit-cohort-completion.md), [2026-05-11-followup-completion.md](./2026-05-11-followup-completion.md), [2026-05-11-completion.md](./2026-05-11-completion.md), [2026-05-10-completion.md](./2026-05-10-completion.md)

## Summary

| Metric | Value |
|---|---|
| GitLab issues closed | **1** -- #159 (`[PERF-2026-05-11-12]`) |
| GitLab issues commented (no close) | 0 |
| Closed-no-issue follow-ups | **1** -- frontend ↔ `internal/server/errorcodes.go` error-code cross-check (no GitLab issue ever existed -- was an untracked note in `QUALITY_GAP_ANALYSIS.md` text; verified via `glab issue list --search`) |
| Implementation commits | **8** on `main`, unpushed: `41ed5fa`, `312eee2`, `5598434`, `1660908` (Thread A); `eefd896`, `f1c6064`, `1a2016f`, `5a5e89c` (Thread B) |
| Other commits this run | **2** -- `b7b45d6` (plan doc), `<docs-tracking>` (this report + the 4 `*GAP_ANALYSIS*.md` updates) |
| Build / test status | GREEN -- see "Tests executed" below |
| Pushed? | **No** -- the commits sit on `main` ahead of `origin/main`; the user decides on `git push origin main` |

## Threads

### Thread A -- error-code cross-check (closes the untracked frontend ↔ `errorcodes.go` follow-up)

The follow-up was recorded only in `QUALITY_GAP_ANALYSIS.md`'s text -- no GitLab issue. It referenced `src/lib/errors.ts`, which **does not exist**; the real coupling was in `src/api/capabilities.ts`, which hard-coded the literal `'wire_feature_missing'` twice.

| Commit | What |
|---|---|
| `41ed5fa` | `feat(api): add serverErrorCodes seam for server error-code coupling` -- new `src/api/serverErrorCodes.ts` (exports `WIRE_FEATURE_MISSING = 'wire_feature_missing'`) + `src/api/serverErrorCodes.test.ts`. |
| `312eee2` | `refactor(api): branch wire-feature-missing detection off serverErrorCodes seam` -- `src/api/capabilities.ts` imports the constant instead of hard-coding the literal twice. |
| `5598434` | `test(server): cross-check serverErrorCodes seam against errorcodes.go + wire pre-commit/CI` -- new `scripts/check-error-codes.mjs` (pure `checkErrorCodes(root)` + `main()`) + `scripts/check-error-codes.test.mjs` (`node --test`, 4 subtests); `check-error-codes` local pre-commit hook in `.pre-commit-config.yaml`; `error-codes-check` lint job in `.gitlab-ci.yml`; corrected the inaccurate "the SPA keys i18n messages off it" header comment in `internal/server/errorcodes.go`. |
| `1660908` | `ci: run check-error-codes.test.mjs in CI; couple UsersPage test fixture to the seam` -- review fixes: the `error-codes-check` CI job now runs `node --test scripts/check-error-codes.test.mjs` before the guard; `src/components/admin/UsersPage.test.tsx` fixtures use `WIRE_FEATURE_MISSING` instead of raw literals. |

**Status:** Done. Reviews APPROVE-WITH-MINOR-NITS; nits fixed in `1660908`.

### Thread B -- #159 `/api/v1/query` rate-limit alignment

| Commit | What |
|---|---|
| `eefd896` | `test(server): pin /api/v1/query rate limit to the documented 2000-rps SLO (#159)` -- new `internal/server/query_ratelimit_test.go` (`TestGeodeJSONQueryRateLimit` -- reads `../../geode.json`, parses the `api` array, asserts `POST /api/v1/query` `rateLimit == 2000`); committed intentionally failing. |
| `f1c6064` | `fix(api): align /api/v1/query per-route rate limit with the 2000-rps SLO (#159)` -- `geode.json` `/api/v1/query` `rateLimit` `200` → `2000` (query route only); regenerated `gen/api/handlers_gen.go` (`bkt_post_Query = securex.NewBucket(2000, opts.GlobalBurst)`) + `gen/cmd/server/spec.json`. Makes `eefd896`'s test pass. |
| `1a2016f` | `docs: record /api/v1/query rate-limit resolution in ARCHITECTURE.md (#159)` -- replaced the `### Open question — per-route rate limit vs throughput target (#159)` subsection with a `### Per-route rate limit on /api/v1/query` resolution subsection. |
| `5a5e89c` | `docs: correct GlobalRate throttling claim in ARCHITECTURE.md (#159 follow-up)` -- review fix: corrected an inaccurate "lowering `GlobalRate` at runtime throttles" claim -- `APIOptions.GlobalRate` is set-but-unused in `RegisterGeneratedAPI`; the doc now accurately says the per-route bucket is a ceiling on that route, `GlobalRate`/`global_rps` is not wired as a cross-route aggregate limit, and the only other server-side throttle is the per-IP limiter. |

**Status:** Done. Review NEEDS-FIXES (one doc-accuracy issue) → fixed in `5a5e89c`.

## GAP_ANALYSIS status

| File | Closed (this run) | Notes |
|---|---|---|
| `PERF_GAP_ANALYSIS.md` | 1 -- PERF-2026-05-11-12 (#159) | findings table row 12 → **Closed `f1c6064`**; "Refreshed assumptions" + SLO-gap + summary-by-severity tables + risks section all updated; P1 count now 5 closed / 0 open / 0 blocked; overall **17 issues -- 6 open, 11 closed, 0 blocked** |
| `QUALITY_GAP_ANALYSIS.md` | the untracked error-code cross-check follow-up → **Done** | the "Remaining small follow-up" note rewritten as a Done entry with the 4 Thread-A commits + the "no `src/lib/errors.ts`" correction |
| `GAP_ANALYSIS.md` | 0 with a `GAP-NNN` ID (both threads tracked by domain ID) | added "Gap-closure run -- 2026-05-12 (errorcode cross-check + #159)" subsection; #159 row in the prior "genapi + medium-cohort batch" / "top-10" subsections updated to point at the new resolution |
| `GAP_ANALYSIS_RESOLVED.md` | +1 resolved entry (PERF-2026-05-11-12 #159) + 1 no-issue follow-up entry + the `GlobalRate` latent-gap note + index line; the prior "still open" #159 / errors.ts bullets struck through | -- |

**Overall:** 1 GitLab issue closed, 1 no-issue follow-up closed, 0 blocked, 0 won't-do, 0 deferred this run.

## Closed items

| Gap-ID | File | Title | Commit(s) | Evidence |
|---|---|---|---|---|
| PERF-2026-05-11-12 (#159) | `PERF_GAP_ANALYSIS.md` | `/api/v1/query` rateLimit=200 vs documented 2000-rps target | `f1c6064` (config + regen); `eefd896` (pinning test); `1a2016f` + `5a5e89c` (ARCHITECTURE.md) | `internal/server/query_ratelimit_test.go` `TestGeodeJSONQueryRateLimit` (asserts `geode.json` `POST /api/v1/query` `rateLimit == 2000`); `gen/api/handlers_gen.go` `bkt_post_Query == securex.NewBucket(2000, …)`; `make go-test` green; `make generate` clean; `docs/ARCHITECTURE.md` `### Per-route rate limit on /api/v1/query` section |
| (no issue) | `QUALITY_GAP_ANALYSIS.md` | frontend ↔ `internal/server/errorcodes.go` error-code cross-check | `41ed5fa`, `312eee2`, `5598434`, `1660908` | `src/api/serverErrorCodes.ts` + `serverErrorCodes.test.ts`; `src/api/capabilities.ts` branches off `WIRE_FEATURE_MISSING`; `scripts/check-error-codes.mjs` + `scripts/check-error-codes.test.mjs` (`node --test`, 4/4); `check-error-codes` pre-commit hook + `error-codes-check` CI job; `node scripts/check-error-codes.mjs` → OK (62 server codes); `npm test` 455/455 |

## Won't Do items

None this run.

## Blocked items

None this run. (#159 was the last deferred-on-product item; it is now closed -- the documented ~2000-rps SLO is the budget for `/query`, and `geode.json` reflects it.)

## Tests executed

| Command | Result |
|---|---|
| `make go-test` | PASS |
| `make go-lint` | PASS |
| `make generate` | PASS (clean -- no diff) |
| `make go-build` | PASS |
| `npm test` | PASS (455/455) |
| `npm run test:ts` | PASS |
| `npm run lint` | PASS |
| `npm run prettier:check` | PASS |
| `node --test scripts/check-error-codes.test.mjs` | PASS (4/4) |
| `node scripts/check-error-codes.mjs` | PASS (OK -- 62 server codes) |
| `make bench-gate` | FLAKY-then-PASS -- see note below |

## Notes / latent gaps

- **`APIOptions.GlobalRate` set-but-unused (genapi generator) -- noted, not ticketed.** The generated `RegisterGeneratedAPI` accepts `APIOptions.GlobalRate` / a `global_rps` config knob but never wires it as a cross-route aggregate limiter -- per-route token buckets and the per-IP limiter are the only server-side throttles. Surfaced during the Thread B review; now accurately documented in `docs/ARCHITECTURE.md`. **Decision: no new issue filed** -- it's documented behavior, not a regression, and `geode-ui` has no current need for a cross-route cap. File an upstream genapi issue if/when one is actually required.
- **`make bench-gate` flakiness under machine load.** During one noisy run it flagged unrelated JWT/profile benchmarks as regressions, then passed clean on a quiet run. `bench-baseline.txt` was **not** modified -- a config-int change to a rate limit doesn't move any benchmarked code path. The CI `bench-gate` job is `allow_failure: true`. Recorded so a future run doesn't chase a phantom regression.
- **`codesign-windows-ssl` pin** -- unchanged from prior runs: still `@~latest` with a `# ci-pins-allow:` marker + `TODO(#127)`; pin to an immutable ci-catalog tag once one ships that component.

## GitLab actions

| Gap-ID | Issue | Action |
|---|---|---|
| PERF-2026-05-11-12 | #159 | commented (closure evidence) + **closed** |
| (error-code cross-check) | -- | no issue exists (`glab issue list --search "error code" / "errorcodes" / "cross-check"` → none) -- recorded in `QUALITY_GAP_ANALYSIS.md` + `GAP_ANALYSIS_RESOLVED.md` only |

## Handoff

8 implementation commits (`41ed5fa`, `312eee2`, `5598434`, `1660908`, `eefd896`, `f1c6064`, `1a2016f`, `5a5e89c`) + the plan-doc commit (`b7b45d6`) + the docs-tracking commit for this report sit on `main` **unpushed** -- on top of the 11 from the prior 2026-05-12 top-10 batch and the 9 from the genapi+medium batch. Counting from `origin/main`, **20+ commits sit on `main` unpushed -- the user decides on `git push origin main`.** No genapi change in this run; the `GlobalRate` gap is upstream but deliberately left unfiled (file if a cross-route cap becomes a real requirement).
