# Cytoscape Perf Optimization — Implementation Status

**Date:** 2026-05-15
**Spec:** `docs/superpowers/specs/2026-05-15-cytoscape-perf-optimization-design.md`
**Plan:** `docs/superpowers/plans/2026-05-15-cytoscape-perf-optimization.md`
**Baseline data:** `docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json` (commit `2e51bb6`)

## Implementation: complete (21 of 23 code tasks)

All P0, P1, and P2 code lands on `main`. Jest passes (236 tests across the
graph subsystem). TypeScript clean. Lint clean.

### P0 — Small-tier instrumentation + degradation

| Task | Commit  | Deliverable                                                         |
|------|---------|---------------------------------------------------------------------|
| T1   | `e003c54` | `src/lib/perfMarks.ts` — start/end/tier wrappers                    |
| T2   | `ce4f607` | + `PerformanceObserver` buffered upload to OTEL                     |
| T3   | `00dd649` | `src/components/results/graph/scaleTier.ts` — ±100 hysteresis        |
| T4   | `fe57ce2` | `useGraphPrefs` adds `tier`, `useWorkerLayout`, `effective*` selectors |
| T5   | `1bb8e47` | `useGraphCytoscape.ts` wraps rebuild + layout in `perfMarks` brackets |
| T6   | `c7422bb` | `useGraphCytoscape.ts` writes `scaleTier(n, prev)` into `useGraphPrefs` |
| T7   | `63c868b` | `GraphViewCytoscape.tsx` consumes `effective*` selectors             |
| T8   | `cd2baf6` | `/dev/graph-bench` exposes a `useWorkerLayout` toggle                |
| T9   | `d11ba9f` | `e2e/specs/20-graph-scale-degradation.spec.ts` (asserts gating at n=6 000) |
| T10  | `0a89831` | Bench harness extended with `tier`/`layoutMs`/`firstInteractiveMs`/`cacheHitRate`/`usedWorker` |
| T11  | `2167649` | `graph:firstInteractive` mark emitted + `make perf-smoke` target     |

### P1 — Mid-tier worker + cache

| Task | Commit  | Deliverable                                                         |
|------|---------|---------------------------------------------------------------------|
| T12  | `e84028c` | `layoutCache.ts` — bounded LRU (8) + `partialMatch`                 |
| T13  | `34e2274` | `layoutWorker.ts` — Web Worker entry running headless fcose          |
| T14  | `be71f95` | `useLayoutWorker.ts` — singleton hook + `runLayoutOnWorker` with fallback policy |
| T15  | `b441aa5` | `runLayout.ts` — cache → worker → main-thread dispatcher             |
| T16  | `ebb30b8` | `useGraphCytoscape.ts` routes initial + rerun layouts through `runLayout` |
| T17  | `abd8295` | Partial cache hit (≥60% matched): apply cached + `lock()` + layout subset |
| T18  | `fbc0b26` | `scripts/bench-gate.ts` — CLI comparing results JSON to baseline at 10% threshold |

### P2 — Large-tier progressive reveal + streaming gate

| Task | Commit  | Deliverable                                                         |
|------|---------|---------------------------------------------------------------------|
| T20  | `dba8292` | `layoutWorker.ts` emits `tick` snapshots every 33 ms                |
| T21  | `e4417f3` | `runLayout.ts` dispatcher applies tick positions via `cy.batch`     |
| T22  | `0077709` | `useGraphCytoscape.ts` suppresses layout while `row_count` is growing |

### Pre-existing bench data

Baseline results from the pre-optimization run at commit `2e51bb6`
(cytoscape vs. reagraph spike) are preserved at
`docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json`. Use that
as the comparison baseline for the gates below.

## Validation: deferred (T19, T23)

Both P1 and P2 validation tasks require:

1. Container rebuild via `make e2e-up` (rebuilds the `geode-ui:e2e` image with the new code).
2. Bench run via `make bench-graph` (writes a fresh results JSON keyed by the HEAD commit).
3. Manual interpretation against the gate criteria in the spec (§5).
4. Optional comparison via `npx ts-node scripts/bench-gate.ts <new>.json <baseline>.json`.

Today's session attempted container rebuilds twice; both failed with
buildkit cache errors (`failed to calculate checksum of ref ...
"/geode-ui/package.json": not found`) regardless of the invoking
working directory. The currently running `geode-e2e-geode-ui-1`
container holds an older build that pre-dates today's commits — so
running `make bench-graph` against it would not exercise any of the
new perfMarks / dispatcher / worker / cache / streaming-gate paths.

The buildkit error appears to be a daemon-side cache corruption rather
than a config bug (the `context: ../..` resolution is correct from the
Makefile's `$(COMPOSE) up -d --build` invocation). A `docker builder
prune --all` plus a fresh `make e2e-up` will likely resolve it.

### P1 gate criteria (from spec §5)

After `make bench-graph` produces a new results JSON, verify at the
`cytoscape, n=5000` record:

- `p5Fps >= 20` during steady-state.
- `layoutMs` p95 < 2 500 ms.

Also: a second-run combo at the same `n` (currently not in the harness;
add manually for the cache-warm verification) should report
`cacheHitRate == 1` and `layoutMs < 50`.

### P2 gate criteria (from spec §5)

At `cytoscape, n=10000`:

- `layoutMs` p95 < 5 000 ms.
- Pan p5 ≥ 10 FPS (subjective; bench harness doesn't drive pan today).

### Once both gates pass

Move the current results file to a baseline and re-run the gate script:

```bash
cp docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json \
   docs/performance/2026-05-14-cytoscape-vs-reagraph.baseline.json
make bench-graph
npx ts-node scripts/bench-gate.ts \
  docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json \
  docs/performance/2026-05-14-cytoscape-vs-reagraph.baseline.json
```

Then update this file's status section with the new numbers and the
date of the validating bench run.

## Architecture summary

The dispatcher is a pure function. The hook owns the worker singleton +
watchdog. The cache is a bounded LRU keyed by `${layoutName}|${sig}`.
The tier system runs entirely off the rebuild's node count.

Each layer is independently revertable:

- If the **worker** path turns out broken on real hardware, set
  `useWorkerLayout=false` via the `/dev/graph-bench` toggle (or
  long-term, flip the default in `useGraphPrefs`). The dispatcher's
  `else` branch is bit-for-bit the pre-optimization main-thread layout.
- If the **partial-hit** path misbehaves (e.g., cytoscape's `lock`
  semantics differ across versions), the predicate
  `partial.matched.length >= currentIds.length * 0.6` is the kill
  switch — raise to `1.0` to disable partial without removing the
  branch.
- If the **streaming gate** causes user-visible jank
  (e.g., users see (0,0) nodes too often), bump
  `STREAMING_WINDOW_MS` down to `0` or remove the gate; the layout
  pass simply runs every rebuild as before.
- The **tier feature gates** can be widened back to "always on" by
  changing `allowedFeatures` to return `{...: true}` for every tier.

## Open follow-ups

1. **Hardware bench for reagraph NO-GO** — independent of this work;
   tracked at `docs/performance/2026-05-14-cytoscape-vs-reagraph.md`.
2. **DOM-node batching** — deferred per spec §2. Only relevant if
   telemetry shows the `domNodes=true` opt-in case is the next
   bottleneck after this work lands.
3. **`scripts/bench-gate.ts` in CI** — currently a manual invocation;
   wire into a CI job once the gates are shown to be stable.
4. **Per-tick reveal smoothness** — the 33 ms tick interval is the
   minimum that doesn't flood the main thread. If users report jitter,
   consider a `requestAnimationFrame`-anchored cadence inside the
   dispatcher's `onTick` handler.
