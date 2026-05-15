# Cytoscape vs Reagraph — Renderer Benchmark

**Date:** 2026-05-14
**Commit:** `2e51bb6` (data run); report itself lands at HEAD of this branch
**Plan:** `docs/superpowers/plans/2026-05-14-cytoscape-to-reagraph-migration.md`
**Harness:** `e2e/specs/19-graph-bench.spec.ts`
**Page:** `src/pages/dev/GraphBenchPage.tsx` mounted at `/dev/graph-bench`
**Raw data:** `docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json`

## Method

For each `(renderer, n)` combo in `{cytoscape, reagraph} × {500, 2 000, 5 000, 10 000}`:

1. Playwright (Chromium, headless, `workers=1`, `retries=0`) navigates to
   `/dev/graph-bench?n=N&renderer=R`.
2. `GraphBenchPage` synthesises a deterministic `seededGraph(N)` fixture
   (`src/lib/seededGraph.ts`, xorshift32 PRNG, avg degree ~3, 6 label
   buckets), projects it into the `GqlNode`/`GqlEdge` shape that the
   real query response uses (so the cytoscape branch's
   `extractElements` recognises it).
3. After a 3 s warmup wait, the harness samples FPS for 5 000 ms via a
   `requestAnimationFrame`-driven console log; the spec parses
   `[graph-bench] sample fps=… mem=… elapsed=…` lines.
4. The harness writes one record per combo to a JSON file.

## Caveats — read these before reading the results

1. **Headless software WebGL.** Playwright's default Chromium uses
   `swiftshader` (CPU rasteriser). Real users will see GPU rasterisation.
   Both renderers pay the same software-rendering cost, so the
   *comparison* is fair — but the absolute FPS numbers are lower than
   on real hardware, and *failure modes that only appear in software
   WebGL* (driver stalls, shader-compile timeouts, OOM) can mislead.
2. **Single run per combo.** No averaging across runs; one outlier
   shifts the avg. p5 is more robust.
3. **No interaction.** Idle measurement only — no drag, zoom, or
   selection.
4. **Cold first-paint includes JS download + lazy-chunk parse.** The
   `firstPaintMs` value bundles "navigate", "compile bundle", "execute
   bundle", and "first React commit" together. Cytoscape gets the
   simpler path; reagraph pays an additional ~600 KB of three.js +
   `@react-three/fiber` + reagraph itself on cold start.
5. **`peakHeapBytes` shows the literal value `10_000_000` on cytoscape
   runs and `0` on stalled reagraph runs.** That `10_000_000` is
   Chromium's coarse-grained `performance.memory.usedJSHeapSize`
   bucketing (it rounds heavily for cross-origin privacy reasons), not
   a real measurement. The data is signal that heap is non-zero, not a
   trustworthy magnitude.

## Results

| Renderer  |     n | First paint (ms) | Avg FPS | p5 FPS | Peak heap (B) |
|-----------|------:|-----------------:|--------:|-------:|--------------:|
| cytoscape |   500 |             3213 |   58.37 |  59.60 |    10 000 000 |
| cytoscape | 2 000 |             3118 |   57.89 |  50.00 |    10 000 000 |
| cytoscape | 5 000 |             3112 |   53.51 |   0.80 |    10 000 000 |
| cytoscape | 10000 |             3117 |   67.00 |  67.00 |    10 000 000 |
| reagraph  |   500 |             5124 |   51.50 |  51.50 |    10 000 000 |
| reagraph  | 2 000 |             3144 |    0.00 |   0.00 |             0 |
| reagraph  | 5 000 |             3120 |    0.00 |   0.00 |             0 |
| reagraph  | 10000 |             3117 |    0.00 |   0.00 |             0 |

## Observations

- **Cytoscape renders at every size we tested.** Avg FPS ranges from
  53–67. The `p5 = 0.8` at `n=5000` is real signal — the layout pass
  monopolises a frame and the RAF tick that landed during it
  registered ~0 FPS. The `p5 = 67` at `n=10000` is suspicious: it
  almost certainly means the layout *never finished* in the 5 s
  sampling window and the page sat idle (at 60 fps idle) for most of
  the sample, with no layout work to compete for the main thread.
  Cytoscape's reported `avgFps=67` at `n=10000` is therefore **not** a
  measurement of "cytoscape at 10k nodes" — it's a measurement of
  "cytoscape during the post-layout idle phase". A longer sampling
  window or instrumenting "layout done" would correct this.
- **Reagraph rendered cleanly only at `n=500`** (avgFps=51.5,
  firstPaint=5.1 s). The +2 s first-paint penalty vs cytoscape is the
  three.js / `@react-three/fiber` bundle cost.
- **Reagraph stalled at `n ≥ 2000`** — three consecutive combos at
  2 000 / 5 000 / 10 000 nodes report `avgFps=0`, `p5=0`, and
  `peakHeapBytes=0`. The `peakHeapBytes=0` is the smoking gun: the
  bench page's RAF sampler never fired its first 200 ms tick. That
  means either:
  - the page is JS-thread-blocked on shader compilation / WebGL init
    longer than the 5 s sampling window allowed; or
  - the headless software rasteriser refused the GL context at scale
    (no console error captured, but the bench harness only parses
    `[graph-bench] sample` lines — a `[graph-bench] init` may have
    fired and was simply not logged).
- **Reagraph's first paint at the failing sizes (3.1 s) is much
  faster than at `n=500` (5.1 s).** Counter-intuitive at first, but
  consistent with "shader compile started but produced no frames": the
  `goto` returned on `load`, the 3 s warmup expired, sampling started,
  no frames ever landed. The first-paint number isn't load-of-graph,
  it's the harness's pragmatic `WARMUP_MS` constant.

## Decision

**NO-GO** for the full cytoscape→reagraph feature-parity migration as
originally scoped, **with a follow-up bench scheduled on real
hardware before this is closed for good.**

### Why NO-GO now

The migration's stated goal (Phase-0 question form: "Does reagraph's
WebGL renderer beat cytoscape's canvas renderer at 5k+ nodes?") has a
clear answer from the data we have:

- At `n=500`, reagraph is **slower** than cytoscape on first-paint and
  comparable on FPS. Cytoscape wins.
- At `n ≥ 2000`, **reagraph does not render at all** in the
  environment we measure. There is no perf comparison to make.

Even granting the headless-software-WebGL caveat, this is fatal for
two operational reasons:

1. **Our CI cannot validate reagraph at scale.** Every PR that touches
   the renderer pipeline would need a real-GPU runner to validate
   perf, contradicting our current Playwright-on-headless model.
2. **The cost-of-change is concentrated in P1–P5** (~150 tasks across
   layouts, selection, context menu, custom overlays, focus/path,
   tests, removal) — and that effort is wasted if reagraph regresses
   in the runtime environments we ship to (most directly: Electron's
   bundled Chromium, which mirrors the headless software-WebGL path
   on machines without GPU drivers).

### What we have left from P0

P0 was specifically scoped to produce this decision cheaply, and it
did. The cost was ~12 commits and one container-build precondition
fix (`its-fine` override). The artifacts are useful regardless:

- **Renderer pref + dispatcher** (`useGraphPrefs.renderer`,
  `GraphView.tsx`) — cleanly separates the cytoscape body into
  `GraphViewCytoscape.tsx` and isolates renderer choice into one
  branch. If we ever revisit, the toggle is already there.
- **`toReagraphElements` projection helper** (Task 3) — pure,
  testable, no React deps. Reusable if we ever pursue a different
  WebGL graph library.
- **`seededGraph` deterministic fixture** (`src/lib/seededGraph.ts`)
  — general-purpose; can drive any future benchmark.
- **`/dev/graph-bench` route + Playwright harness** — usable for
  cytoscape-only perf regression watch right now (e.g., to validate
  the upcoming P1+ work on a *cytoscape* clustering optimisation).

### Recommended follow-up before final close-out

Before we permanently rule reagraph out, run **one** real-hardware
session on the same fixture. The cheapest path is local: same
`make bench-graph` target on a workstation with a real GPU. If the
hardware bench shows reagraph clearly winning at `n≥2000`, the
software-WebGL stall is a CI artifact, and the decision flips to
**GO-WITH-CAVEAT** (need a GPU runner for renderer PRs). If the
hardware bench *also* shows the stall, the NO-GO is permanent and
we should delete the reagraph branch.

A specific reproduction-then-decision sub-plan:

```bash
make bench-graph                              # current baseline
# … move to a GPU machine OR re-run with --use-gl=desktop …
GIT_COMMIT_SHA=$(git rev-parse --short=7 HEAD) \
  npx playwright test e2e/specs/19-graph-bench.spec.ts \
  --headed --project=chromium --workers=1
# Compare results JSON; update this report's "Decision" section.
```

## What we will NOT do without further evidence

- **Skip P1 (Layouts parity).** Pointless without proof reagraph
  renders at all at scale.
- **Skip P2 (Selection + interactions).** Same.
- **Skip P3 (Context menus + custom node overlays).** Same.
- **Skip P4 (Focus / path / minimap / find / badges / tooltip).** Same.
- **Skip P5 (Test migration + cytoscape removal).** Same — and removing
  cytoscape would be especially destructive given P0 just confirmed
  cytoscape is the renderer that *works*.

The dispatcher / pref / projection / fixture / bench-route / harness
artifacts stay. The reagraph branch in `GraphView.tsx` becomes the
hook for any future hardware-validated attempt — no cleanup commit
needed unless we explicitly decide reagraph is dead forever.

## Next-step gate

Before any P1–P5 work begins:

1. Re-run `make bench-graph` on a real-GPU machine OR in headed-mode
   with hardware-accelerated WebGL.
2. Update this document's "Decision" section with the new data.
3. If GO or GO-WITH-CAVEAT: invoke `/superpowers:writing-plans` per
   the original plan's "Future plans" table, grounded in the new
   bench data.
4. If NO-GO confirmed: open a separate, smaller spike to optimise
   cytoscape itself (web-worker fcose, batched DOM-node strategy,
   layout caching). That's a different question from "should we
   switch renderer".
