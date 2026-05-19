import { test, type Page } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'

// Phase 0 perf harness for the cytoscape→reagraph migration. For each
// (renderer, n) combo we navigate to /dev/graph-bench?n=N&renderer=R,
// wait for first paint, collect FPS samples logged to the console for
// SAMPLE_WINDOW_MS after first paint, capture the JS heap size at the
// same instant, and write one row to the JSON results file. The
// companion markdown report (Task 9) is hand-authored against this
// JSON.
//
// The commit SHA is read from the GIT_COMMIT_SHA env var, set by the
// make target `bench-graph` via `git rev-parse HEAD`. The spec stays
// pure (no shell-outs) — the caller is responsible for sourcing the
// SHA before invoking Playwright.

type Sample = { fps: number; mem: number; elapsed: number }
type BenchRecord = {
  renderer: 'cytoscape' | 'reagraph'
  n: number
  tier: 'small' | 'mid' | 'large'
  firstPaintMs: number
  firstInteractiveMs: number
  layoutMs: number
  samples: Sample[]
  avgFps: number
  p5Fps: number
  peakHeapBytes: number
  cacheHitRate: number // 0 in P0; meaningful in P1+
  usedWorker: boolean // false in P0; meaningful in P1+
}

// PERF #312: inline tier helper kept in sync with the canonical
// implementation at src/components/results/graph/scaleTier.ts. The e2e
// tsconfig restricts imports to the e2e tree, so we cannot reuse the
// production helper directly — the boundary values are pinned here to
// match. The spec's T19 P1 sample point at n=5000 must land in `mid`
// (where domNodes/cxtmenu/tooltips/badges stay enabled); pre-fix this
// helper had `>= 5000` semantics that put n=5000 in `large`, making
// the spec's `p5Fps@n=5000 ≥ 20` gate unmeasurable.
function tierOf(n: number): 'small' | 'mid' | 'large' {
  if (n >= 5001) return 'large'
  if (n >= 2000) return 'mid'
  return 'small'
}

// PERF #312: bench combos now include a `worker` axis at n≥5000 so the
// audit's worker-layout perf path is actually exercised by the harness.
// Pre-fix the bench never set `worker=1` on the URL, so layoutWorker
// allocations and cache-warm reruns were uncovered. The companion
// `useWorkerLayout` user-pref is honored by GraphBenchPage when the
// `worker` query param is `1`.
//
// `cache` axis: a second run at the same (renderer, n) re-uses the
// in-memory `layoutCache`, hitting the warm-rerun gate (cacheHitRate
// ≈ 1 expected). The cache survives the second navigate because the
// page is the same Playwright tab; cytoscape's layoutCache is in-
// memory only and goes away on full reload, which Playwright doesn't
// do between combos.
type Combo = {
  renderer: 'cytoscape' | 'reagraph'
  n: number
  worker?: boolean
  cacheRerun?: boolean
}

const COMBOS: Combo[] = [
  { renderer: 'cytoscape', n: 500 },
  { renderer: 'cytoscape', n: 2000 },
  { renderer: 'cytoscape', n: 5000 },
  // Same-shape rerun immediately after the cold n=5000 run so the
  // production `layoutCache` registers a hit. `cacheRerun: true` is
  // a marker for the JSON output.
  { renderer: 'cytoscape', n: 5000, cacheRerun: true },
  { renderer: 'cytoscape', n: 10000 },
  // Worker-path axis: same n=10000 sample point as above but routed
  // through the worker layout. Lets the harness compare cytoscape-
  // main-thread vs cytoscape-worker on the same hardware.
  { renderer: 'cytoscape', n: 10000, worker: true },
  { renderer: 'reagraph', n: 500 },
  { renderer: 'reagraph', n: 2000 },
  { renderer: 'reagraph', n: 5000 },
  { renderer: 'reagraph', n: 10000 },
]

// GAP-035 (#276): the bench results file path is configurable so a
// repeat run does NOT silently overwrite a historical baseline. The
// canonical recipe in the Makefile passes a date-stamped path; CI /
// ad-hoc invocations can override via the `BENCH_OUT` env var.
//
//   priority 1: BENCH_OUT env var (absolute or repo-relative).
//   priority 2: legacy fixed path (back-compat fallback so a bare
//               `npx playwright test ...` still produces an output).
const RESULTS_PATH = (() => {
  const envOut = process.env.BENCH_OUT
  if (envOut && envOut.trim() !== '') {
    return path.resolve(envOut.trim())
  }
  return path.resolve(
    __dirname,
    '../../docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json'
  )
})()

const SAMPLE_WINDOW_MS = 5000

// First-paint warmup: the time we give the page to mount + lazy-load
// the renderer chunk + run the first RAF tick before we start counting
// samples. Tuned empirically (probe shows init at ~450ms cold; the
// reagraph WebGL chunk can take longer to compile shaders on cold
// start). Anything before this is treated as warmup, not perf data.
const WARMUP_MS = 3000

async function runOne(page: Page, combo: Combo): Promise<BenchRecord> {
  const samples: Sample[] = []
  let firstSample = -1
  const onConsole = (msg: import('@playwright/test').ConsoleMessage): void => {
    const txt = msg.text()
    if (!txt.startsWith('[graph-bench] sample')) return
    const fpsMatch = /fps=(\S+)/.exec(txt)
    const memMatch = /mem=(\S+)/.exec(txt)
    const elapsedMatch = /elapsed=(\S+)/.exec(txt)
    if (!fpsMatch || !memMatch || !elapsedMatch) return
    const fps = Number(fpsMatch[1])
    const mem = Number(memMatch[1])
    const elapsed = Number(elapsedMatch[1])
    if (!Number.isFinite(fps) || !Number.isFinite(elapsed)) return
    if (firstSample < 0) firstSample = elapsed
    samples.push({ fps, mem, elapsed: elapsed - firstSample })
  }
  page.on('console', onConsole)
  try {
    const navStart = Date.now()
    // PERF #312: the URL carries optional `worker=1` so the bench can
    // exercise the worker layout path (useLayoutWorker.ts). The dev
    // page is the only place this is reachable; `cacheRerun` doesn't
    // need a URL flag — re-issuing the same URL re-uses the in-process
    // layoutCache for a cache hit.
    const params = new URLSearchParams({
      n: String(combo.n),
      renderer: combo.renderer,
    })
    if (combo.worker) params.set('worker', '1')
    await page.goto(`/dev/graph-bench?${params.toString()}`)
    // Pragmatic mount wait — the probe pattern that worked reliably.
    // Avoids DOM-testid races under the lazy / Suspense path.
    await page.waitForTimeout(WARMUP_MS)
    const firstPaintMs = Date.now() - navStart
    await page.waitForTimeout(SAMPLE_WINDOW_MS)
    const layoutMs = await page.evaluate(() => {
      const m = performance.getEntriesByName('graph:layout', 'measure')[0]
      return m ? m.duration : 0
    })
    const firstInteractiveMs = await page.evaluate(() => {
      const m = performance.getEntriesByName(
        'graph:firstInteractive',
        'mark'
      )[0]
      return m ? m.startTime : 0
    })
    // PERF #312: read the production cache-hit + worker-used signals
    // off the in-page debug surface. GraphBenchPage exposes these via
    // `window.__geode_bench` so the harness records whether the cache
    // and worker paths actually ran. Fallback to 0/false on legacy
    // builds (page version pre-dating the surface) so the harness
    // still passes — those rows just won't be useful for the warm-
    // rerun / worker gates.
    const benchSignals = await page.evaluate(() => {
      const w = window as unknown as {
        __geode_bench?: { cacheHitRate?: number; usedWorker?: boolean }
      }
      // eslint-disable-next-line no-underscore-dangle
      const sig = w.__geode_bench
      return {
        cacheHitRate: sig?.cacheHitRate ?? 0,
        usedWorker: sig?.usedWorker ?? false,
      }
    })
    const fpsVals = samples.map((s) => s.fps).sort((a, b) => a - b)
    const avgFps =
      fpsVals.reduce((s, v) => s + v, 0) / Math.max(fpsVals.length, 1)
    const p5Fps = fpsVals[Math.floor(fpsVals.length * 0.05)] ?? 0
    const peakHeapBytes = samples.reduce((m, s) => Math.max(m, s.mem), 0)
    return {
      renderer: combo.renderer,
      n: combo.n,
      tier: tierOf(combo.n),
      firstPaintMs,
      firstInteractiveMs,
      layoutMs,
      samples,
      avgFps: Number(avgFps.toFixed(2)),
      p5Fps: Number(p5Fps.toFixed(2)),
      peakHeapBytes,
      cacheHitRate: benchSignals.cacheHitRate,
      usedWorker: benchSignals.usedWorker,
    }
  } finally {
    page.off('console', onConsole)
  }
}

test.describe.configure({ mode: 'serial', retries: 0 })
test('graph renderer benchmark', async ({ page }) => {
  // ~50 s wall: 8 combos × ~6 s each (nav + 5 s sample). 120 s gives
  // headroom for cold WebGL init at n=10000.
  test.setTimeout(120_000)
  // Reduce-with-promise-chain so we stay sequential (perf samples must
  // not overlap — same GPU / event loop). A classic `for-of + await`
  // would be cleaner but airbnb's no-restricted-syntax bans for-of in
  // this project, and `Promise.all(COMBOS.map(...))` would parallelise.
  const records: BenchRecord[] = await COMBOS.reduce<Promise<BenchRecord[]>>(
    (acc, combo) =>
      acc.then(async (prev) => {
        const rec = await runOne(page, combo)
        // eslint-disable-next-line no-console
        console.log(
          `[harness] ${combo.renderer} n=${combo.n} tier=${tierOf(combo.n)} firstPaint=${rec.firstPaintMs}ms layoutMs=${rec.layoutMs}ms avgFps=${rec.avgFps} p5Fps=${rec.p5Fps}`
        )
        return [...prev, rec]
      }),
    Promise.resolve([])
  )
  const commit = process.env.GIT_COMMIT_SHA?.trim() || 'unknown'
  fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true })
  fs.writeFileSync(
    RESULTS_PATH,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        commit,
        sampleWindowMs: SAMPLE_WINDOW_MS,
        records,
      },
      null,
      2
    )}\n`
  )
})
