# Cytoscape Perf Optimization — Design Spec

**Date:** 2026-05-15
**Author:** Brainstorming session (Approach B — layout-first, DOM-batching deferred)
**Predecessor:** `docs/performance/2026-05-14-cytoscape-vs-reagraph.md` (NO-GO on
reagraph renderer swap, follow-up recommendation: optimise cytoscape itself)
**Baseline data:** `docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json`
(commit `2e51bb6`)

## 1. Goal

Make the existing cytoscape renderer hit three workload tiers without swapping
the renderer:

| Tier  | n      | Target                                                |
|-------|--------|-------------------------------------------------------|
| small | ≤ 2 000  | p5 ≥ 50 FPS during idle; no behavioral regressions    |
| mid   | ≤ 5 000  | p5 ≥ 20 FPS steady-state; layout completes < 2 500 ms p95 |
| large | ≤ 10 000 | layout completes < 5 000 ms p95; pan/zoom interactive |

Baseline at commit `2e51bb6`: `p5=50` at 2 000; `p5=0.8` at 5 000; layout never
completes at 10 000. Bench validates against this baseline.

## 2. Non-Goals

- Renderer swap (cytoscape stays). Reagraph stays NO-GO pending separate
  hardware bench.
- DOM-node batching (per-node `createRoot` → single portal). Deferred — the
  `domNodes` pref is default-off; universal layout cost is the priority. A
  follow-up spec opens only if telemetry shows the opt-in DOM-node case is
  still the next bottleneck.
- Custom WebGL canvas / cytoscape-headless. Out of scope.

## 3. Approach (B — Layout-first)

Four new small modules; two existing files take edits. No existing file is
replaced.

### 3.1 New modules

Two distinct seams are referenced throughout this spec:

- **`runLayout` dispatcher** — a pure runtime function (not a hook). Imported
  and called from inside an effect. Decides cache / worker / main-thread per
  call.
- **`useLayoutWorker` hook** — owns the singleton worker, its message
  protocol, and the React lifecycle (cleanup on unmount). Exposes
  `runLayoutOnWorker(...)` (a non-hook function bound to the singleton).

The dispatcher calls `runLayoutOnWorker`. It does not call the hook itself.

#### `src/components/results/graph/layoutCache.ts` (pure)

In-memory bounded LRU mapping a signature to a node-position map. The
signature is the node-id set hash already produced by `respSignature`
(`cyHelpers.ts`).

```ts
type Sig = string
type PosMap = Map<NodeId, { x: number; y: number }>

interface LayoutCache {
  get(sig: Sig): { hit: 'full' | 'miss'; positions?: PosMap }
  partialMatch(sig: Sig, currentIds: NodeId[]):
    { matched: NodeId[]; missing: NodeId[]; positions: PosMap }
  set(sig: Sig, positions: PosMap): void
}
```

Capacity: 8 entries (LRU eviction). Per-layout-name separation is implicit:
the `sig` includes the active layout name so dagre↔fcose toggles always
invalidate.

#### `src/components/results/graph/scaleTier.ts` (pure)

```ts
type Tier = 'small' | 'mid' | 'large'

interface ScaleTier {
  tier(n: number, prevTier?: Tier): Tier  // with hysteresis
  allowedFeatures(t: Tier):
    { domNodes: boolean; cxtmenu: boolean; tooltips: boolean; badges: boolean }
}
```

Thresholds: `2 000` (small→mid), `5 000` (mid→large). Hysteresis band: ±100
nodes around each boundary to prevent thrash during streaming. Feature
allow-lists:

| Tier  | domNodes | cxtmenu | tooltips | badges |
|-------|----------|---------|----------|--------|
| small | ✔        | ✔       | ✔        | ✔      |
| mid   | ✘        | ✔       | ✔        | ✔      |
| large | ✘        | ✘       | ✘        | ✘      |

#### `src/components/results/graph/layoutWorker.ts` + `useLayoutWorker.ts`

`layoutWorker.ts` is the Web Worker entry. Imports `cytoscape-fcose` (fcose
is DOM-free; it accepts a topology and returns positions). Accepts:

```ts
type WorkerIn =
  | { kind: 'run'; runId: number; nodes: NodeSnap[]; edges: EdgeSnap[]; opts: FcoseOpts }
  | { kind: 'cancel'; runId: number }

type WorkerOut =
  | { kind: 'tick'; runId: number; positions: Record<NodeId, [number, number]> }
  | { kind: 'done'; runId: number; positions: Record<NodeId, [number, number]> }
  | { kind: 'error'; runId: number; message: string }
```

`useLayoutWorker.ts` owns the singleton worker. Public API:

```ts
useLayoutWorker({
  cy: Core,
  graphSig: Sig,
  layout: LayoutName,
  onTick: (pos: PosMap) => void,    // for progressive reveal
  onDone: (pos: PosMap) => void,    // caches + measures
  onFallback: (reason: string) => void,
})
```

Fallback policy (any one triggers main-thread `cy.layout(...).run()`):

- `layout !== 'fcose'` (dagre / cose / grid stay on main).
- `n < 200` (worker boot > main-thread cost at this size).
- `new Worker(...)` throws (CSP / missing global) → session-wide disable.
- `onerror` from the worker → session-wide disable.
- No `tick` within 5 s after `run` → terminate and rebuild on next request;
  do NOT session-disable (silent stalls may be transient).

Progressive reveal: hook applies each `tick` snapshot via
`cy.batch(() => cy.nodes().forEach(n => n.position(positions[n.id()])))` at
~30 FPS (caller throttles or worker self-throttles to ~33 ms).

#### `src/lib/perfMarks.ts`

Thin wrapper around `performance.mark` / `performance.measure`. Public API:

```ts
perfMarks.start(name: string): void
perfMarks.end(name: string): { measure: PerformanceMeasure | null }
perfMarks.tier(t: Tier): void
```

Mark vocabulary:

- `graph:rebuild:{start,end}` — bracketed around the debounced rebuild path.
- `graph:layout:{start,end}` — bracketed around the dispatcher's layout phase.
- `graph:firstInteractive` — emitted at first `cy.fit()` after a rebuild.
- `graph:tier:{small,mid,large}` — emitted on tier transition.

A `PerformanceObserver` buffers `measure` entries and uploads to the existing
OTEL collector (`otel-collector:4318` per `docker ps`) every ~5 s or on
`visibilitychange → hidden`. Failures are silent.

### 3.2 Edits to existing files

| File | Edit |
|------|------|
| `useGraphCytoscape.ts:140` | Initial layout call routes through new `runLayout({cy, layoutRef, sig, n})` dispatcher. |
| `useGraphCytoscape.ts:225` | Layout-rerun call routes through same dispatcher. |
| `useGraphCytoscape.ts` | Rebuild / layout phases wrapped in `perfMarks.start`/`perfMarks.end`. |
| `useGraphPrefs.ts` | Add derived selectors `effectiveDomNodes`, `effectiveCxtMenu`, `effectiveTooltips`, `effectiveBadges` = `user-pref AND allowedFeatures(tier)`. |
| `GraphViewCytoscape.tsx` | Replace raw pref consumers with `effective*` selectors. Add a sticky `useWorkerLayout` pref (default `true`) — exposed initially only in `/dev/graph-bench`. |

## 4. Data Flow

### 4.1 Layout dispatcher

```text
runLayout({cy, layoutRef, sig, n}) {
  perfMarks.start('graph:layout')

  cached = layoutCache.get(sig)
  if (cached.hit === 'full') {
    applyPositions(cy, cached.positions)
    cy.fit({ padding: 24 })
    perfMarks.end('graph:layout')
    return
  }

  partial = layoutCache.partialMatch(sig, currentIds)
  if (partial.matched.length / currentIds.length >= 0.6) {
    lock(cy, partial.matched)
    applyPositions(cy, partial.positions)
    cy.layout(layoutConfig(layoutRef.current)).run()  // unlocked only
    unlock(cy, partial.matched)
    layoutCache.set(sig, snapshotPositions(cy))
    perfMarks.end('graph:layout')
    return
  }

  if (layoutRef.current === 'fcose' && n >= 200 && !workerDisabled) {
    runLayoutOnWorker({
      cy, graphSig: sig, layout: 'fcose',
      onTick:   (pos) => cy.batch(() => applyPositions(cy, pos)),
      onDone:   (pos) => { layoutCache.set(sig, pos); perfMarks.end('graph:layout') },
      onFallback: (reason) => { mainThreadLayout(); perfMarks.end('graph:layout') },
    })
    return
  }

  cy.layout(layoutConfig(layoutRef.current)).run()
  layoutCache.set(sig, snapshotPositions(cy))
  perfMarks.end('graph:layout')
}
```

### 4.2 Streaming gate

`useGraphCytoscape` already debounces rebuild on streaming. We extend the
contract: while `resp.row_count` is still growing (or the debounce window
has not yet elapsed), apply position cache if present but suppress layout.
Layout runs exactly once when row count stabilises.

### 4.3 Tier flow

`useGraphCytoscape` owns tier computation. On every change to `n`, it
computes `tier = scaleTier(n, prevTier)` and (only if the tier changed)
writes the new tier into the `useGraphPrefs` store via
`setTier(tier)`. The `effective*` selectors are defined inside
`useGraphPrefs.ts` as `(s) => s.userPrefX && allowedFeatures(s.tier).X`,
so any consumer that subscribed via the selector re-renders with the new
value. No central re-derive step is needed — Zustand selector
reactivity handles it.

```text
n changes (in useGraphCytoscape's effect)
  → tier = scaleTier(n, prevTier)        (hysteresis applied here)
  → if tier !== prevTier:
      useGraphPrefs.setTier(tier)
      perfMarks.tier(tier)
  → consumers (useDomNodes, useCxtMenu, useNodeTooltip, useGraphBadges)
      already subscribed to effective* selectors;
      Zustand re-renders them with the flipped flag,
      they tear down what is now disallowed
```

Tier transitions never rebuild the cy core or re-run layout.

### 4.4 Telemetry flow

```text
perfMarks.start/end → performance.mark/measure
                    → PerformanceObserver(buffered)
                    → batch every 5 s or on visibility=hidden
                    → POST → otel-collector:4318
                    → Grafana dashboard
```

Best-effort; never blocks render. Buffer overflow drops oldest.

## 5. Phase Gates

Phases ship in order. Each is independently shippable and independently
gated against the baseline JSON. A phase that misses its gate stays as
tier-degradation-only (i.e., `large` just disables more features rather
than landing the worker).

| Phase | Scope | Acceptance gate (vs. `2026-05-14-cytoscape-vs-reagraph.results.json`) |
|-------|-------|----------------------------------------------------------------------|
| **P0** small-tier | `scaleTier`, `effective*` selectors, `perfMarks` wiring, `/dev/graph-bench` UI exposing a `useWorkerLayout` toggle as a stub (no worker code shipped yet — toggle is wired to a placeholder pref). No worker, no cache. | At n=500 and n=2000: `firstPaintMs` regression < 5 %; `avgFps` regression < 5 %; `p5Fps` regression < 5 %. `peakHeapBytes` excluded (Chromium bucketing unreliable). Grafana measure series exists for at least `graph:rebuild`, `graph:layout`, and one `graph:tier:*`. |
| **P1** mid-tier | `layoutCache` (full and partial paths), `useLayoutWorker` + `layoutWorker.ts` (final positions only — no progressive tick reveal yet). | n=5000 p5 ≥ 20 FPS during steady-state; `layoutMs` p95 < 2 500 ms; cache-warm rebuild reports `cacheHitRate == 1` and `layoutMs < 50`. |
| **P2** large-tier | Per-tick progressive reveal; `partialMatch` hot path validated on a streaming-expand fixture; streaming-gate. | n=10000 `layoutMs` p95 < 5 000 ms; pan/zoom remains responsive (p5 ≥ 10 FPS during pan). |

## 6. Error Handling

### Worker

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Construction throws | `try`/`catch` around `new Worker(...)` | Memoise session-wide `workerDisabled`. Log once. |
| `onerror` event | Worker error handler | `terminate()`, set `workerDisabled` for session, fall back to main-thread for current run. |
| No tick in > 5 s | Per-run `setTimeout` watchdog | `terminate()`, fall back to main-thread for this run. Worker rebuilds on next call. Do NOT session-disable. |
| Stale `runId` results | Compare `runId` on receipt | Drop silently. |
| Component unmount with worker live | `useEffect` cleanup | `terminate()` (idempotent). |

### Cache

| Case | Behavior |
|------|----------|
| Sig collision | Apply positions, drop ids not present in cy, run layout on the unlocked subset. One extra pass; no crash. |
| Layout-name change | `sig` includes layout name → entry is implicitly invalidated. |
| Cache miss after partial-hit threshold not met (< 60 % matched) | Fall through to full layout. |

### Tier transition

| Case | Behavior |
|------|----------|
| `mid → large` crossed mid-interaction | Effective flag flip → consumers tear down. No layout re-run. |
| `large → small` (filter down) | Effective flag flip restores user prefs; consumers set up via existing per-toggle path. |
| Oscillation near boundary | Hysteresis band (±100 nodes) suppresses thrash. |

### Telemetry

| Case | Behavior |
|------|----------|
| OTEL collector down | Buffer up to 512 measures, then drop oldest. No retries. |
| `performance.mark` throws (jsdom corner) | Wrapper swallows; marks become no-ops. |
| Hidden-tab close | Flush buffer on `visibilitychange === 'hidden'`. |

### Backwards compatibility

All new behavior is additive. The dispatcher's fallback path is bit-for-bit
the current `cy.layout(layoutConfig(layoutRef.current)).run()` call. A
sticky `useWorkerLayout` pref (default `true`) is the escape hatch.

## 7. Testing

### Unit (Jest, jsdom)

| Module | Cases |
|--------|-------|
| `layoutCache.ts` | LRU eviction at capacity; `get` miss/hit; `partialMatch` `matched`/`missing` split; collision drops missing ids; per-layout-name isolation. |
| `scaleTier.ts` | Boundary table at `n ∈ {0, 1999, 2000, 2100, 4999, 5000, 5100, 10000}`; hysteresis around each boundary; `allowedFeatures` matches the table above. |
| `perfMarks.ts` | `mark`/`measure` wrappers call native APIs; jsdom-throws path becomes no-op; observer buffer drains to upload helper. |
| `useLayoutWorker.ts` | Mocks `Worker`. Dispatches `{nodes, edges, opts, runId}`; applies `tick` positions via `cy.batch`; drops stale `runId` results; watchdog `terminate()` after 5 s; fallback signals `{usedFallback: true, reason}`. |

### Hook / integration

- `useGraphCytoscape` with mocked cy: cached `sig` skips layout; cache miss
  runs layout and stores; layout-name change invalidates.
- `GraphViewCytoscape` integration: tier transition `small → mid` unmounts
  dom roots even with `domNodes=true` (dom-nodes are off in `mid`);
  back-transition `mid → small` remounts them.
- `GraphViewCytoscape` integration: tier transition `mid → large` tears
  down cxtmenu, tooltip, and badge consumers even when their user prefs
  are on; `large → mid` brings them back.
- cxtmenu listener tear-down asserted via spy on `cy.removeListener`.

### E2E bench

Extend `e2e/specs/19-graph-bench.spec.ts` records with:

- `tier`, `layoutMs`, `firstInteractiveMs`, `cacheHitRate`, `usedWorker`
- Second-run combo per `n` to capture warm-cache delta (first run primes,
  second consults).

Spec is data-collection only. Gate evaluation lives in
`scripts/bench-gate.ts` comparing the new results JSON against
`2026-05-14-cytoscape-vs-reagraph.results.json`. Exits non-zero on
regression > 10 % at any tier-record.

### New tier-degradation spec

`e2e/specs/20-graph-scale-degradation.spec.ts` (new):

- Synthetic 6 000-node fixture via `seededGraph(6000)`.
- Assert: cxtmenu trigger does not open; tooltip never appears; badges
  absent; `domNodes` toggle on has no DOM children rendered.
- Filter to < 2 000 nodes via the search input; assert features restore.

### Existing E2E

`09-graph-viz` and sibling specs run at small-tier sizes — must continue
to pass with no observable change.

### Telemetry validation

`make perf-smoke` (new target, P0 only):

- Boots the running container, drives a small bench run, queries the OTEL
  collector for the expected measure names.
- Confirms the pipeline end-to-end.
- Not part of CI; manual / scheduled.

### Coverage

- New modules: ≥ 90 % statement coverage.
- Modified hooks: ≥ 80 % coverage (existing baseline).
- No coverage regression on touched existing files.

## 8. Open Questions

None at spec time. The following are deliberate deferrals, not open
questions:

- **DOM-node batching.** Deferred to a follow-up spec, opened only if
  telemetry shows the opt-in `domNodes=true` path is the next bottleneck.
- **Headed/hardware bench for reagraph.** Out of scope; tracked separately
  in `docs/performance/2026-05-14-cytoscape-vs-reagraph.md`.
- **CI gate enforcement.** `scripts/bench-gate.ts` runs locally in P1; CI
  wiring is a separate ops task once the gate is shown to be stable.

## 9. Future Plans (decided NOT to do now)

| Item | Reason |
|------|--------|
| Replace cytoscape with custom WebGL | Out of scope — this spec exists because the renderer-swap option was already evaluated and rejected. |
| Per-tick DOM-node updates | Pointless without first batching the per-node React roots. |
| Server-side layout | Backend would need a graph layout engine; round-trip would dominate small-graph cost. Re-evaluate only if client-side hits a hard ceiling. |
