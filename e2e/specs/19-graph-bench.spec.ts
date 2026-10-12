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

function tierOf(n: number): 'small' | 'mid' | 'large' {
  if (n >= 5000) return 'large'
  if (n >= 2000) return 'mid'
  return 'small'
}

const COMBOS: { renderer: 'cytoscape' | 'reagraph'; n: number }[] = [
  { renderer: 'cytoscape', n: 500 },
  { renderer: 'cytoscape', n: 2000 },
  { renderer: 'cytoscape', n: 5000 },
  { renderer: 'cytoscape', n: 10000 },
  { renderer: 'reagraph', n: 500 },
  { renderer: 'reagraph', n: 2000 },
  { renderer: 'reagraph', n: 5000 },
  { renderer: 'reagraph', n: 10000 },
]

// CI runs this spec on a contended shared VM with software WebGL. There,
// reagraph at n >= 5000 keeps the page's main thread busy past even a
// 6-minute budget (pipeline 2937517308; locally it already samples at
// < 1 fps). On CI, run every combo except those two as a smoke check of
// both renderers. `make bench-graph` (CI unset) still records all eight.
const RUN_COMBOS = process.env.CI
  ? COMBOS.filter((c) => !(c.renderer === 'reagraph' && c.n >= 5000))
  : COMBOS

const RESULTS_PATH = path.resolve(
  __dirname,
  '../../docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json'
)

const SAMPLE_WINDOW_MS = 5000

// First-paint warmup: the time we give the page to mount + lazy-load
// the renderer chunk + run the first RAF tick before we start counting
// samples. Tuned empirically (probe shows init at ~450ms cold; the
// reagraph WebGL chunk can take longer to compile shaders on cold
// start). Anything before this is treated as warmup, not perf data.
const WARMUP_MS = 3000

async function runOne(
  page: Page,
  combo: { renderer: 'cytoscape' | 'reagraph'; n: number }
): Promise<BenchRecord> {
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
    await page.goto(`/dev/graph-bench?n=${combo.n}&renderer=${combo.renderer}`)
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
      cacheHitRate: 0,
      usedWorker: false,
    }
  } finally {
    page.off('console', onConsole)
  }
}

test.describe.configure({ mode: 'serial', retries: 0 })
test('graph renderer benchmark', async ({ page }) => {
  // ~50 s wall: 8 combos × ~6 s each (nav + 5 s sample). 120 s gives
  // headroom for cold WebGL init at n=10000. CI's contended shared VM
  // renders the n=10000 combos several times slower, so it gets the same
  // 3x as the suite-wide timeout in playwright.config.ts.
  test.setTimeout(process.env.CI ? 360_000 : 120_000)
  // Reduce-with-promise-chain so we stay sequential (perf samples must
  // not overlap — same GPU / event loop). A classic `for-of + await`
  // would be cleaner but airbnb's no-restricted-syntax bans for-of in
  // this project, and `Promise.all(COMBOS.map(...))` would parallelise.
  const records: BenchRecord[] = await RUN_COMBOS.reduce<
    Promise<BenchRecord[]>
  >(
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
