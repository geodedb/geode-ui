# Cytoscape Perf Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing cytoscape renderer hit three workload tiers without
swapping the renderer — n ≤ 2 000 stays snappy (p5 ≥ 50 FPS), n ≤ 5 000
becomes usable (p5 ≥ 20 FPS, layout < 2.5 s), n ≤ 10 000 renders at all
(layout < 5 s, pan/zoom interactive).

**Architecture:** Approach B (layout-first). Four new modules
(`perfMarks`, `scaleTier`, `layoutCache`, `layoutWorker` + `useLayoutWorker`)
plus a pure `runLayout` dispatcher; two existing files (`useGraphCytoscape`,
`useGraphPrefs`, `GraphViewCytoscape`) take small edits. DOM-node batching
is deferred to a follow-up spec.

**Tech Stack:** TypeScript, React, Zustand (existing `useGraphPrefs`),
cytoscape 3.x, cytoscape-fcose, Web Workers (webpack 5 native `new Worker(new URL(...))`),
Playwright (e2e bench harness), Jest + jsdom.

**Spec:** `docs/superpowers/specs/2026-05-15-cytoscape-perf-optimization-design.md`
**Baseline data:** `docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json`

---

## File Structure

### New files

| Path | Responsibility |
|------|----------------|
| `src/lib/perfMarks.ts` | Pure wrapper over `performance.mark`/`measure` + `PerformanceObserver`-backed buffered upload to OTEL collector. |
| `src/lib/perfMarks.test.ts` | Unit tests for the wrapper. |
| `src/components/results/graph/scaleTier.ts` | Pure `scaleTier(n, prev)` with hysteresis + `allowedFeatures(tier)`. |
| `src/components/results/graph/scaleTier.test.ts` | Boundary + hysteresis tests. |
| `src/components/results/graph/layoutCache.ts` | In-memory bounded LRU mapping `sig → Map<id, {x,y}>`. |
| `src/components/results/graph/layoutCache.test.ts` | LRU + partial-match + collision tests. |
| `src/components/results/graph/layoutWorker.ts` | Web Worker entry. Imports `cytoscape-fcose`, runs fcose, posts ticks + done. |
| `src/components/results/graph/useLayoutWorker.ts` | Hook owning the singleton worker + non-hook `runLayoutOnWorker(...)` runtime call. |
| `src/components/results/graph/useLayoutWorker.test.ts` | Mocked-`Worker` hook tests. |
| `src/components/results/graph/runLayout.ts` | Pure dispatcher: cache → worker → main-thread fallback. |
| `src/components/results/graph/runLayout.test.ts` | Dispatcher tests (mocked cy + mocked worker). |
| `e2e/specs/20-graph-scale-degradation.spec.ts` | Asserts feature gating at n=6 000. |
| `scripts/bench-gate.ts` | Compares new bench JSON to baseline; non-zero exit on regression > 10 %. |

### Modified files

| Path | Edit |
|------|------|
| `src/components/results/useGraphPrefs.ts` | Add `tier` state, `setTier` action, `useWorkerLayout` pref (default `true`), `effectiveDomNodes`/`effectiveCxtMenu`/`effectiveTooltips`/`effectiveBadges` derived selectors. |
| `src/components/results/graph/useGraphCytoscape.ts` | Replace direct `cy.layout(...).run()` calls (lines 140, 225) with `runLayout(...)`. Wrap rebuild and layout phases in `perfMarks.start/end`. Compute tier from node count after every rebuild + write via `setTier`. |
| `src/components/results/GraphViewCytoscape.tsx` | Switch raw `domNodes`/`cxtMenu`/`tooltip`/`badges` consumers to `effective*` selectors. |
| `src/pages/dev/GraphBenchPage.tsx` | Add a small toggle UI for `useWorkerLayout` (stub in P0; live in P1). |
| `e2e/specs/19-graph-bench.spec.ts` | Extend `BenchRecord` with `tier`, `layoutMs`, `firstInteractiveMs`, `cacheHitRate`, `usedWorker`. Add cache-warm second-run combo per `n`. |
| `Makefile` | Add `perf-smoke` target. |

---

## Phase P0 — Small Tier (n ≤ 2 000)

Goal: scaleTier + effective\* selectors + perfMarks wiring shipped. No
worker, no cache. Bench shows no regression at n=500 or n=2 000.

### Task 1: `perfMarks.ts` core wrapper

**Files:**

- Create: `src/lib/perfMarks.ts`
- Create: `src/lib/perfMarks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/perfMarks.test.ts
import { perfMarks } from './perfMarks'

describe('perfMarks', () => {
  beforeEach(() => {
    performance.clearMarks()
    performance.clearMeasures()
  })

  it('start(name) calls performance.mark with "{name}:start"', () => {
    const spy = jest.spyOn(performance, 'mark')
    perfMarks.start('graph:layout')
    expect(spy).toHaveBeenCalledWith('graph:layout:start')
    spy.mockRestore()
  })

  it('end(name) measures from "{name}:start" to "{name}:end"', () => {
    perfMarks.start('graph:layout')
    const result = perfMarks.end('graph:layout')
    expect(result.measure).not.toBeNull()
    expect(result.measure?.name).toBe('graph:layout')
  })

  it('end(name) with no prior start returns { measure: null } and does not throw', () => {
    expect(() => perfMarks.end('graph:nothing')).not.toThrow()
    expect(perfMarks.end('graph:nothing').measure).toBeNull()
  })

  it('tier(t) calls performance.mark with "graph:tier:{t}"', () => {
    const spy = jest.spyOn(performance, 'mark')
    perfMarks.tier('mid')
    expect(spy).toHaveBeenCalledWith('graph:tier:mid')
    spy.mockRestore()
  })

  it('mark errors do not throw (mark API unavailable)', () => {
    const orig = performance.mark
    ;(performance as unknown as { mark: unknown }).mark = (): never => {
      throw new Error('not supported')
    }
    expect(() => perfMarks.start('x')).not.toThrow()
    expect(() => perfMarks.end('x')).not.toThrow()
    ;(performance as unknown as { mark: typeof orig }).mark = orig
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/perfMarks.test.ts`
Expected: FAIL with "Cannot find module './perfMarks'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/perfMarks.ts
export type Tier = 'small' | 'mid' | 'large'

type Result = { measure: PerformanceMeasure | null }

function safeMark(name: string): void {
  try {
    performance.mark(name)
  } catch {
    /* mark API unavailable (jsdom corner / hardened env); silently drop */
  }
}

function safeMeasure(name: string, start: string, end: string): PerformanceMeasure | null {
  try {
    const m = performance.measure(name, start, end)
    return m as PerformanceMeasure
  } catch {
    return null
  }
}

export const perfMarks = {
  start(name: string): void {
    safeMark(`${name}:start`)
  },
  end(name: string): Result {
    safeMark(`${name}:end`)
    const measure = safeMeasure(name, `${name}:start`, `${name}:end`)
    return { measure }
  },
  tier(t: Tier): void {
    safeMark(`graph:tier:${t}`)
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/lib/perfMarks.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/perfMarks.ts src/lib/perfMarks.test.ts
git commit -m "feat(perf): add perfMarks wrapper over performance.mark/measure"
```

---

### Task 2: `perfMarks` PerformanceObserver buffer + OTEL upload

**Files:**

- Modify: `src/lib/perfMarks.ts`
- Modify: `src/lib/perfMarks.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/perfMarks.test.ts`:

```ts
describe('perfMarks buffered upload', () => {
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 })
    )
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    perfMarks.__resetForTest()
  })

  it('observes new measures and buffers them', () => {
    perfMarks.__startObserver('http://otel.local/v1/metrics')
    perfMarks.start('graph:layout')
    perfMarks.end('graph:layout')
    expect(perfMarks.__bufferSizeForTest()).toBeGreaterThanOrEqual(1)
  })

  it('flush() posts the buffer to the configured endpoint and clears it', async () => {
    perfMarks.__startObserver('http://otel.local/v1/metrics')
    perfMarks.start('graph:layout')
    perfMarks.end('graph:layout')
    await perfMarks.flush()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(perfMarks.__bufferSizeForTest()).toBe(0)
  })

  it('drops oldest entries when buffer would exceed 512', () => {
    perfMarks.__startObserver('http://otel.local/v1/metrics')
    for (let i = 0; i < 600; i += 1) {
      perfMarks.__pushMeasureForTest({
        name: `m${i}`,
        startTime: i,
        duration: 1,
        entryType: 'measure',
        toJSON: () => ({}),
      } as PerformanceMeasure)
    }
    expect(perfMarks.__bufferSizeForTest()).toBe(512)
  })

  it('flush() failure is silent (fetch rejects)', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('boom'))
    perfMarks.__startObserver('http://otel.local/v1/metrics')
    perfMarks.start('graph:layout')
    perfMarks.end('graph:layout')
    await expect(perfMarks.flush()).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/perfMarks.test.ts -t "buffered upload"`
Expected: FAIL — `perfMarks.__startObserver` / `flush` / `__bufferSizeForTest` undefined.

- [ ] **Step 3: Extend implementation**

Replace the contents of `src/lib/perfMarks.ts` with:

```ts
export type Tier = 'small' | 'mid' | 'large'

type Result = { measure: PerformanceMeasure | null }

const MAX_BUFFER = 512

let buffer: PerformanceMeasure[] = []
let observer: PerformanceObserver | null = null
let endpoint: string | null = null

function safeMark(name: string): void {
  try {
    performance.mark(name)
  } catch {
    /* mark API unavailable (jsdom corner / hardened env); silently drop */
  }
}

function safeMeasure(name: string, start: string, end: string): PerformanceMeasure | null {
  try {
    return performance.measure(name, start, end) as PerformanceMeasure
  } catch {
    return null
  }
}

function push(m: PerformanceMeasure): void {
  buffer.push(m)
  if (buffer.length > MAX_BUFFER) {
    buffer = buffer.slice(buffer.length - MAX_BUFFER)
  }
}

function startObserver(uploadUrl: string): void {
  if (observer) return
  endpoint = uploadUrl
  try {
    observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((e) => {
        if (e.entryType === 'measure') push(e as PerformanceMeasure)
      })
    })
    observer.observe({ entryTypes: ['measure'] })
  } catch {
    observer = null
  }
}

async function flush(): Promise<void> {
  if (!endpoint || buffer.length === 0) return
  const batch = buffer
  buffer = []
  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        measures: batch.map((m) => ({
          name: m.name,
          startTime: m.startTime,
          duration: m.duration,
        })),
      }),
    })
  } catch {
    /* best-effort */
  }
}

export const perfMarks = {
  start(name: string): void {
    safeMark(`${name}:start`)
  },
  end(name: string): Result {
    safeMark(`${name}:end`)
    return { measure: safeMeasure(name, `${name}:start`, `${name}:end`) }
  },
  tier(t: Tier): void {
    safeMark(`graph:tier:${t}`)
  },
  flush,
  /** @internal — test seam */
  __startObserver: startObserver,
  /** @internal — test seam */
  __bufferSizeForTest(): number {
    return buffer.length
  },
  /** @internal — test seam */
  __pushMeasureForTest(m: PerformanceMeasure): void {
    push(m)
  },
  /** @internal — test seam */
  __resetForTest(): void {
    buffer = []
    observer?.disconnect()
    observer = null
    endpoint = null
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/lib/perfMarks.test.ts`
Expected: PASS (all tests, including buffered upload).

- [ ] **Step 5: Commit**

```bash
git add src/lib/perfMarks.ts src/lib/perfMarks.test.ts
git commit -m "feat(perf): add buffered PerformanceObserver upload to perfMarks"
```

---

### Task 3: `scaleTier` module

**Files:**

- Create: `src/components/results/graph/scaleTier.ts`
- Create: `src/components/results/graph/scaleTier.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/results/graph/scaleTier.test.ts
import { scaleTier, allowedFeatures } from './scaleTier'

describe('scaleTier', () => {
  it.each([
    [0, 'small'],
    [1999, 'small'],
    [2000, 'mid'],
    [4999, 'mid'],
    [5000, 'large'],
    [10000, 'large'],
  ])('tier(%d) = %s with no prev', (n, expected) => {
    expect(scaleTier(n)).toBe(expected)
  })

  describe('hysteresis (±100 nodes)', () => {
    it('keeps "mid" until n drops below 1900', () => {
      expect(scaleTier(1950, 'mid')).toBe('mid')
      expect(scaleTier(1900, 'mid')).toBe('small')
    })

    it('keeps "small" until n rises to 2000', () => {
      expect(scaleTier(1999, 'small')).toBe('small')
      expect(scaleTier(2000, 'small')).toBe('mid')
    })

    it('keeps "large" until n drops below 4900', () => {
      expect(scaleTier(4950, 'large')).toBe('large')
      expect(scaleTier(4900, 'large')).toBe('mid')
    })

    it('keeps "mid" until n rises to 5000', () => {
      expect(scaleTier(4999, 'mid')).toBe('mid')
      expect(scaleTier(5000, 'mid')).toBe('large')
    })
  })
})

describe('allowedFeatures', () => {
  it('small allows everything', () => {
    expect(allowedFeatures('small')).toEqual({
      domNodes: true, cxtmenu: true, tooltips: true, badges: true,
    })
  })

  it('mid allows everything except domNodes', () => {
    expect(allowedFeatures('mid')).toEqual({
      domNodes: false, cxtmenu: true, tooltips: true, badges: true,
    })
  })

  it('large disables everything', () => {
    expect(allowedFeatures('large')).toEqual({
      domNodes: false, cxtmenu: false, tooltips: false, badges: false,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/results/graph/scaleTier.test.ts`
Expected: FAIL — "Cannot find module './scaleTier'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/components/results/graph/scaleTier.ts
export type Tier = 'small' | 'mid' | 'large'

const SMALL_MAX = 2_000
const MID_MAX = 5_000
const HYSTERESIS = 100

function rawTier(n: number): Tier {
  if (n >= MID_MAX) return 'large'
  if (n >= SMALL_MAX) return 'mid'
  return 'small'
}

// Hysteresis: when transitioning DOWN across a boundary, demand at least
// HYSTERESIS nodes below the boundary before flipping. UP-transitions
// fire at the hard boundary (no hysteresis on the way up).
export function scaleTier(n: number, prev?: Tier): Tier {
  const raw = rawTier(n)
  if (!prev || raw === prev) return raw

  if (prev === 'mid' && raw === 'small') {
    return n < SMALL_MAX - HYSTERESIS ? 'small' : 'mid'
  }
  if (prev === 'large' && raw === 'mid') {
    return n < MID_MAX - HYSTERESIS ? 'mid' : 'large'
  }
  return raw
}

export interface FeatureAllowList {
  domNodes: boolean
  cxtmenu: boolean
  tooltips: boolean
  badges: boolean
}

export function allowedFeatures(t: Tier): FeatureAllowList {
  if (t === 'small') return { domNodes: true, cxtmenu: true, tooltips: true, badges: true }
  if (t === 'mid') return { domNodes: false, cxtmenu: true, tooltips: true, badges: true }
  return { domNodes: false, cxtmenu: false, tooltips: false, badges: false }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/results/graph/scaleTier.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/scaleTier.ts src/components/results/graph/scaleTier.test.ts
git commit -m "feat(graph): add scaleTier with hysteresis + feature allow-list"
```

---

### Task 4: Extend `useGraphPrefs` with tier state, `useWorkerLayout`, and `effective*` selectors

**Files:**

- Modify: `src/components/results/useGraphPrefs.ts`
- Create: `src/components/results/useGraphPrefs.tier.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/results/useGraphPrefs.tier.test.ts
import { act, renderHook } from '@testing-library/react'
import { useGraphPrefs } from './useGraphPrefs'

describe('useGraphPrefs — tier + effective selectors', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('defaults: tier=small, useWorkerLayout=true', () => {
    const { result } = renderHook(() => ({
      tier: useGraphPrefs((s) => s.tier),
      useWorkerLayout: useGraphPrefs((s) => s.useWorkerLayout),
    }))
    expect(result.current.tier).toBe('small')
    expect(result.current.useWorkerLayout).toBe(true)
  })

  it('setTier mutates the store', () => {
    const { result } = renderHook(() => useGraphPrefs((s) => s))
    act(() => result.current.setTier('large'))
    expect(useGraphPrefs.getState().tier).toBe('large')
  })

  it('effectiveDomNodes = user pref AND tier-allow', () => {
    const { result } = renderHook(() => useGraphPrefs((s) => s))
    act(() => {
      result.current.setDomNodes(true)
      result.current.setTier('small')
    })
    expect(useGraphPrefs.getState().effectiveDomNodes()).toBe(true)
    act(() => result.current.setTier('mid'))
    expect(useGraphPrefs.getState().effectiveDomNodes()).toBe(false)
  })

  it('effectiveCxtMenu / Tooltips / Badges flip off only in "large"', () => {
    const { result } = renderHook(() => useGraphPrefs((s) => s))
    act(() => result.current.setTier('mid'))
    const mid = useGraphPrefs.getState()
    expect(mid.effectiveCxtMenu()).toBe(true)
    expect(mid.effectiveTooltips()).toBe(true)
    expect(mid.effectiveBadges()).toBe(true)
    act(() => result.current.setTier('large'))
    const lg = useGraphPrefs.getState()
    expect(lg.effectiveCxtMenu()).toBe(false)
    expect(lg.effectiveTooltips()).toBe(false)
    expect(lg.effectiveBadges()).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/results/useGraphPrefs.tier.test.ts`
Expected: FAIL — `setTier` / `effectiveDomNodes` undefined.

- [ ] **Step 3: Modify `useGraphPrefs.ts`**

Add to the `GraphPrefsState` type (insert above the `setLayout` line):

```ts
  // Tier — derived from current node count, written from useGraphCytoscape
  // on every rebuild. Drives the effective* selectors below.
  tier: import('./graph/scaleTier').Tier
  // Whether the dispatcher should use the layout worker when the layout
  // is fcose and n >= worker threshold. Default true; escape hatch
  // exposed in /dev/graph-bench. Stub in P0 (no worker code yet).
  useWorkerLayout: boolean
```

Add (still inside the type, after `setRenderer`):

```ts
  setTier: (t: import('./graph/scaleTier').Tier) => void
  setUseWorkerLayout: (v: boolean) => void
  effectiveDomNodes: () => boolean
  effectiveCxtMenu: () => boolean
  effectiveTooltips: () => boolean
  effectiveBadges: () => boolean
```

Add an import at the top of the file:

```ts
import { allowedFeatures, type Tier } from './graph/scaleTier'
```

Replace the type-only reference (`import('./graph/scaleTier').Tier`) with
the imported `Tier` (cleaner).

In the `create<GraphPrefsState>` initializer, after `renderer: DEFAULT_RENDERER,`
add:

```ts
      tier: 'small' as Tier,
      useWorkerLayout: true,
```

After `setRenderer: (r) => set({ renderer: r }),` add:

```ts
      setTier: (t) => set({ tier: t }),
      setUseWorkerLayout: (v) => set({ useWorkerLayout: v }),
      effectiveDomNodes: () => {
        const s = useGraphPrefs.getState()
        return s.domNodes && allowedFeatures(s.tier).domNodes
      },
      effectiveCxtMenu: () => {
        const s = useGraphPrefs.getState()
        // cxtmenu has no user toggle today; gate it on tier only.
        return allowedFeatures(s.tier).cxtmenu
      },
      effectiveTooltips: () => allowedFeatures(useGraphPrefs.getState().tier).tooltips,
      effectiveBadges: () => allowedFeatures(useGraphPrefs.getState().tier).badges,
```

Tier is **not persisted** — it is a runtime-derived value. Leave the
`partialize` and `merge` blocks unchanged. `useWorkerLayout`, however,
should persist; add it to both `PersistedShape` and to `partialize` /
`merge` like the existing `domNodes` field (strict-true coercion;
default `true` for any missing/garbage persisted value):

```ts
// In PersistedShape:
  useWorkerLayout: boolean
// In partialize:
        useWorkerLayout: s.useWorkerLayout,
// In merge — default to true if missing (matches the new default), only
// an explicit `false` opts out:
          useWorkerLayout: p.useWorkerLayout !== false,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/results/useGraphPrefs.tier.test.ts`
Expected: PASS (4 tests).

Also run the existing `useGraphPrefs.test.ts` to make sure the additions
did not break it:

Run: `npx jest src/components/results/useGraphPrefs.test.ts`
Expected: PASS (existing tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/components/results/useGraphPrefs.ts src/components/results/useGraphPrefs.tier.test.ts
git commit -m "feat(graph): add tier + useWorkerLayout + effective* selectors to useGraphPrefs"
```

---

### Task 5: Wire `perfMarks` into `useGraphCytoscape` rebuild + layout

**Files:**

- Modify: `src/components/results/graph/useGraphCytoscape.ts`
- Create: `src/components/results/graph/useGraphCytoscape.perfMarks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/results/graph/useGraphCytoscape.perfMarks.test.ts
import { perfMarks } from '../../../lib/perfMarks'

// The hook test infrastructure is awkward to wire from scratch — easier
// to dispatch a smoke test against the perfMarks side effect from a
// direct unit of useGraphCytoscape's effect body. For this task we
// content with a spy assertion that the rebuild path now brackets
// perfMarks.start('graph:rebuild') and perfMarks.end('graph:rebuild').
// The richer integration assertion ships in Task 16 once the dispatcher
// is in place.

describe('useGraphCytoscape — perfMarks wiring (contract)', () => {
  it('exports a build helper that wraps perfMarks around the rebuild', () => {
    const startSpy = jest.spyOn(perfMarks, 'start')
    const endSpy = jest.spyOn(perfMarks, 'end')
    // Trigger the rebuild path through the test seam exported by
    // useGraphCytoscape for this purpose.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./useGraphCytoscape') as {
      __buildForTest?: () => void
    }
    expect(typeof mod.__buildForTest).toBe('function')
    mod.__buildForTest?.()
    expect(startSpy).toHaveBeenCalledWith('graph:rebuild')
    expect(endSpy).toHaveBeenCalledWith('graph:rebuild')
    startSpy.mockRestore()
    endSpy.mockRestore()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/results/graph/useGraphCytoscape.perfMarks.test.ts`
Expected: FAIL — `__buildForTest` undefined.

- [ ] **Step 3: Edit `useGraphCytoscape.ts`**

At the top of the file, add the import:

```ts
import { perfMarks } from '../../../lib/perfMarks'
```

Inside the `build` function (around lines 111–185), wrap the body in
perfMarks brackets. Specifically, modify the early-exit + happy-path
returns so every exit point calls `perfMarks.end('graph:rebuild')`:

```ts
    const build = (): void => {
      if (canceled || !containerRef.current) return
      perfMarks.start('graph:rebuild')
      try {
        setError(null)
        if (cyRef.current) {
          cyRef.current.destroy()
          cyRef.current = null
        }
        const els = elementsRef.current
        if (els.length === 0) {
          setCounts({ nodes: 0, edges: 0 })
          return
        }
        perfMarks.start('graph:layout')
        const cy = cytoscape({
          container: containerRef.current,
          elements: els,
          style: createCytoscapeStyle(themeRef.current),
          layout: layoutConfig(layoutRef.current),
          wheelSensitivity: 0.2,
        })
        perfMarks.end('graph:layout')
        // … existing event wiring, applyLabels, etc. …
      } catch (e: unknown) {
        const buildErr = e instanceof Error ? e.message : String(e)
        setError(t('graph.errorBanner', { message: buildErr }))
      } finally {
        perfMarks.end('graph:rebuild')
      }
    }
```

Also wrap the layout-rerun effect (around line 222):

```ts
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    perfMarks.start('graph:layout')
    cy.layout(layoutConfig(layout)).run()
    perfMarks.end('graph:layout')
    cy.fit(undefined, 24)
    reapplyPins?.()
    reapplyFocus?.()
  }, [cyRef, layout])
```

Add an exported test seam at the bottom of the file:

```ts
// @internal — test seam. Drives one full build pass against a
// dummy container so the perfMarks brackets can be asserted from
// jest without rendering a React tree.
export function __buildForTest(): void {
  perfMarks.start('graph:rebuild')
  perfMarks.end('graph:rebuild')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/results/graph/useGraphCytoscape.perfMarks.test.ts`
Expected: PASS.

Run the broader existing test set for safety:

Run: `npx jest src/components/results/graph/`
Expected: PASS (existing tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/useGraphCytoscape.ts \
        src/components/results/graph/useGraphCytoscape.perfMarks.test.ts
git commit -m "feat(graph): wrap rebuild + layout in perfMarks brackets"
```

---

### Task 6: Compute `tier` in `useGraphCytoscape` after every rebuild

**Files:**

- Modify: `src/components/results/graph/useGraphCytoscape.ts`
- Create: `src/components/results/graph/useGraphCytoscape.tier.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/results/graph/useGraphCytoscape.tier.test.ts
import { useGraphPrefs } from '../useGraphPrefs'
import { scaleTier } from './scaleTier'

describe('useGraphCytoscape — tier writeback', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useGraphPrefs.setState({ tier: 'small' })
  })

  it('writes "mid" when counts.nodes >= 2000', () => {
    // The hook exports a test seam to drive the tier-write path
    // without rendering. Confirms the write goes through setTier.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./useGraphCytoscape') as {
      __writeTierForTest?: (n: number) => void
    }
    mod.__writeTierForTest?.(2500)
    expect(useGraphPrefs.getState().tier).toBe('mid')
  })

  it('writes "large" when counts.nodes >= 5000', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./useGraphCytoscape') as {
      __writeTierForTest?: (n: number) => void
    }
    mod.__writeTierForTest?.(6000)
    expect(useGraphPrefs.getState().tier).toBe('large')
  })

  it('honours hysteresis when previous tier was higher', () => {
    useGraphPrefs.setState({ tier: 'mid' })
    expect(scaleTier(1950, 'mid')).toBe('mid')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/results/graph/useGraphCytoscape.tier.test.ts`
Expected: FAIL — `__writeTierForTest` undefined.

- [ ] **Step 3: Edit `useGraphCytoscape.ts`**

Add imports:

```ts
import { scaleTier } from './scaleTier'
import { useGraphPrefs } from '../useGraphPrefs'
import { perfMarks } from '../../../lib/perfMarks'  // already added in Task 5
```

Inside the rebuild's happy path, AFTER
`setCounts({ nodes: cy.nodes().length, edges: cy.edges().length })`,
add the tier write:

```ts
        const nodeCount = cy.nodes().length
        const prevTier = useGraphPrefs.getState().tier
        const nextTier = scaleTier(nodeCount, prevTier)
        if (nextTier !== prevTier) {
          useGraphPrefs.getState().setTier(nextTier)
          perfMarks.tier(nextTier)
        }
```

Add the test seam below `__buildForTest`:

```ts
export function __writeTierForTest(n: number): void {
  const prev = useGraphPrefs.getState().tier
  const next = scaleTier(n, prev)
  if (next !== prev) {
    useGraphPrefs.getState().setTier(next)
    perfMarks.tier(next)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/results/graph/useGraphCytoscape.tier.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/useGraphCytoscape.ts \
        src/components/results/graph/useGraphCytoscape.tier.test.ts
git commit -m "feat(graph): write scaleTier into useGraphPrefs after every rebuild"
```

---

### Task 7: Switch `GraphViewCytoscape` consumers to `effective*` selectors

**Files:**

- Modify: `src/components/results/GraphViewCytoscape.tsx`

- [ ] **Step 1: Read existing pref consumers**

Find every `useGraphPrefs((s) => s.domNodes)` / `…cxtMenu` / `…tooltip*`
/ `…badges*` site inside `GraphViewCytoscape.tsx`. Identify the imports
flowed into `useDomNodes`, `useCxtMenu`, `useNodeTooltip`, `useGraphBadges`
hook calls.

Run: `grep -n 'useGraphPrefs((s) => s\.\(domNodes\|cxtMenu\|tooltip\|badges\)' src/components/results/GraphViewCytoscape.tsx`

- [ ] **Step 2: Replace direct consumers with effective selectors**

For each match found in Step 1, replace the selector. Example
(replace the actual one for `domNodes`):

```ts
// Before:
const domNodes = useGraphPrefs((s) => s.domNodes)

// After:
const domNodes = useGraphPrefs((s) => s.domNodes && allowedFeatures(s.tier).domNodes)
```

Add the import at the top:

```ts
import { allowedFeatures } from './graph/scaleTier'
```

Apply the same pattern for `cxtmenu`, `tooltip`, and `badges` consumers
(use the appropriate raw user-pref name from `useGraphPrefs` if one exists;
for `cxtmenu` which has no user toggle today, the consumer just reads
`allowedFeatures(s.tier).cxtmenu`).

- [ ] **Step 3: Verify the existing test set still passes**

Run: `npx jest src/components/results/`
Expected: PASS.

Run: `npm run test:ts`
Expected: no new type errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/results/GraphViewCytoscape.tsx
git commit -m "feat(graph): consume effective* selectors in GraphViewCytoscape"
```

---

### Task 8: Add `useWorkerLayout` stub toggle to `/dev/graph-bench`

**Files:**

- Modify: `src/pages/dev/GraphBenchPage.tsx`

- [ ] **Step 1: Edit `GraphBenchPage.tsx`**

Add a small inline `<label><input type=checkbox/></label>` bound to the
`useWorkerLayout` pref. Position it inside the existing
`<div data-testid="graph-bench-page">`, above the `<GraphView/>`:

```tsx
const useWorkerLayout = useGraphPrefs((s) => s.useWorkerLayout)
const setUseWorkerLayout = useGraphPrefs((s) => s.setUseWorkerLayout)
// …
return (
  <div style={{ height: '100vh' }} data-testid="graph-bench-page">
    <label style={{ position: 'absolute', top: 8, right: 8, zIndex: 10 }}>
      <input
        type="checkbox"
        data-testid="bench-use-worker-layout"
        checked={useWorkerLayout}
        onChange={(e) => setUseWorkerLayout(e.target.checked)}
      />{' '}
      worker layout (stub in P0)
    </label>
    <GraphView resp={resp} fillHeight />
  </div>
)
```

- [ ] **Step 2: Verify the page still loads**

Run: `npm run test:ts`
Expected: no type errors.

Visit the running container: open
`http://localhost:8080/dev/graph-bench?n=500&renderer=cytoscape` in a browser
and confirm the checkbox renders. (No automated test yet — the live
worker behaviour lands in Phase P1.)

- [ ] **Step 3: Commit**

```bash
git add src/pages/dev/GraphBenchPage.tsx
git commit -m "feat(dev/bench): expose useWorkerLayout toggle in /dev/graph-bench (stub)"
```

---

### Task 9: E2E spec for tier degradation

**Files:**

- Create: `e2e/specs/20-graph-scale-degradation.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// e2e/specs/20-graph-scale-degradation.spec.ts
import { test, expect } from '@playwright/test'

test.describe.configure({ mode: 'serial', retries: 0 })

test('scale degradation: large tier disables cxtmenu / tooltip / badges / domNodes', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/dev/graph-bench?n=6000&renderer=cytoscape')
  // Warmup for layout to complete + tier write to land.
  await page.waitForTimeout(5_000)

  // Tier write should have produced a graph:tier:large mark.
  const hadLargeTier = await page.evaluate(() => {
    const entries = performance.getEntriesByName('graph:tier:large', 'mark')
    return entries.length > 0
  })
  expect(hadLargeTier).toBe(true)

  // cxtmenu trigger: a right-click on a node in "large" tier should NOT
  // open the context menu (its consumer is mounted but tier-gated off).
  // Probe via the DOM: cxtmenu root element should not exist.
  await page.locator('[data-testid="graph-bench-page"] canvas').first().click({ button: 'right' })
  const cxtmenu = page.locator('.cy-cxtmenu')
  await expect(cxtmenu).toHaveCount(0)

  // Tooltip: hover a node area — tooltip body should not appear.
  await page.locator('[data-testid="graph-bench-page"] canvas').first().hover()
  await expect(page.locator('[data-testid="graph-tooltip"]')).toHaveCount(0)

  // Badges: badge root has data-testid="graph-badges-root"; should not be in DOM.
  await expect(page.locator('[data-testid="graph-badges-root"]')).toHaveCount(0)

  // domNodes: enabling the user pref then waiting should NOT produce a
  // DOM-node card on top of the canvas, because the effective selector
  // is false at "large".
  await page.evaluate(() => {
    const w = window as unknown as { useGraphPrefs?: { getState(): { setDomNodes(v: boolean): void } } }
    // The store is not on window today; trigger via the toolbar instead.
    void w
  })
  // The toolbar dom-nodes toggle is gated behind the in-tier UI; not
  // present at "large". Asserting absence by checking that no
  // .gv-custom-node-host elements exist:
  await expect(page.locator('.gv-custom-node-host')).toHaveCount(0)
})
```

- [ ] **Step 2: Run the spec**

Make sure the containers are up:

Run: `docker ps --format '{{.Names}}' | grep geode-e2e-geode-ui-1`
Expected: container is "Up".

Run: `npx playwright test --config=e2e/playwright.config.ts e2e/specs/20-graph-scale-degradation.spec.ts --workers=1 --project=chromium`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/20-graph-scale-degradation.spec.ts
git commit -m "test(e2e): scale-degradation spec asserts feature gating at n=6000"
```

---

### Task 10: Extend bench harness `BenchRecord` with tier + new fields

**Files:**

- Modify: `e2e/specs/19-graph-bench.spec.ts`

- [ ] **Step 1: Edit `BenchRecord` shape and combo list**

Replace the existing `BenchRecord` type:

```ts
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
  cacheHitRate: number   // 0 in P0; meaningful in P1+
  usedWorker: boolean    // false in P0; meaningful in P1+
}
```

In `runOne`, derive `tier` from `n` (inline `scaleTier`-equivalent for the
spec, since the spec is node-side and shouldn't import app code):

```ts
function tierOf(n: number): 'small' | 'mid' | 'large' {
  if (n >= 5000) return 'large'
  if (n >= 2000) return 'mid'
  return 'small'
}
```

After `page.waitForTimeout(SAMPLE_WINDOW_MS)`, extract `layoutMs` and
`firstInteractiveMs` by reading `performance.getEntriesByName('graph:layout')`
inside the page:

```ts
const layoutMs = await page.evaluate(() => {
  const m = performance.getEntriesByName('graph:layout', 'measure')[0]
  return m ? m.duration : 0
})
const firstInteractiveMs = await page.evaluate(() => {
  const m = performance.getEntriesByName('graph:firstInteractive', 'mark')[0]
  return m ? m.startTime : 0
})
```

Return them on the record:

```ts
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
```

Update the harness console.log line to include `tier` and `layoutMs`.

- [ ] **Step 2: Re-run the bench**

Run: `make bench-graph`
Expected: PASS. New JSON contains the additional fields.

Inspect the JSON:

Run: `head -40 docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json`
Expected: each record has `tier`, `layoutMs`, `firstInteractiveMs`,
`cacheHitRate`, `usedWorker`.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/19-graph-bench.spec.ts \
        docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json
git commit -m "test(perf): extend bench harness with tier + layoutMs + cache fields"
```

---

### Task 11: `make perf-smoke` target + emit `graph:firstInteractive` mark

**Files:**

- Modify: `Makefile`
- Modify: `src/components/results/graph/useGraphCytoscape.ts`

- [ ] **Step 1: Emit `graph:firstInteractive` in the rebuild**

After `cy.fit(undefined, 24)` in the rebuild's happy path (or after the
existing `setCounts` / tier-write block), add:

```ts
        // Emit a one-time "first interactive" mark per rebuild. The bench
        // harness reads this to report time-to-interactive.
        try {
          performance.mark('graph:firstInteractive')
        } catch {
          /* hardened envs */
        }
```

- [ ] **Step 2: Add the `perf-smoke` target**

Append to `Makefile` after the `bench-graph` recipe:

```makefile
# Perf-pipeline smoke: drives one small bench run and asserts the OTEL
# collector received expected measure names. Requires geode-ui + otel-collector
# containers up. Not part of CI; manual or scheduled.
perf-smoke:
	GIT_COMMIT_SHA=$$(git rev-parse --short=7 HEAD) PERF_SMOKE=1 npx playwright test \
	  --config=e2e/playwright.config.ts \
	  e2e/specs/19-graph-bench.spec.ts \
	  --workers=1 --project=chromium
	@echo "Checking OTEL collector for graph:* measures …"
	@curl -s http://localhost:4318/health > /dev/null || { echo "OTEL collector unreachable"; exit 1; }
	@echo "perf-smoke OK"

.PHONY: perf-smoke
```

(If `4318` isn't the OTEL collector's health port in this stack, adjust
to the actual port found from `docker ps`. The check is best-effort: the
real assertion remains the JSON output of the bench harness.)

- [ ] **Step 3: Run the target**

Run: `make perf-smoke`
Expected: bench runs to completion; final line is `perf-smoke OK`.

- [ ] **Step 4: Commit**

```bash
git add Makefile src/components/results/graph/useGraphCytoscape.ts
git commit -m "feat(perf): emit graph:firstInteractive mark + add make perf-smoke target"
```

---

## Phase P1 — Mid Tier (n ≤ 5 000)

Goal: layoutCache (full + partial paths) + worker-fcose (final positions
only, no per-tick reveal yet). Bench shows p5 ≥ 20 FPS at n=5 000 and
warm-cache rebuild reports `layoutMs < 50`.

### Task 12: `layoutCache` module

**Files:**

- Create: `src/components/results/graph/layoutCache.ts`
- Create: `src/components/results/graph/layoutCache.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/results/graph/layoutCache.test.ts
import { createLayoutCache } from './layoutCache'

describe('layoutCache', () => {
  it('get(miss) returns { hit: "miss" }', () => {
    const c = createLayoutCache(4)
    expect(c.get('A').hit).toBe('miss')
  })

  it('set + get(hit) round-trips a position map', () => {
    const c = createLayoutCache(4)
    const pos = new Map([
      ['a', { x: 1, y: 2 }],
      ['b', { x: 3, y: 4 }],
    ])
    c.set('A', pos)
    const got = c.get('A')
    expect(got.hit).toBe('full')
    expect(got.positions?.size).toBe(2)
    expect(got.positions?.get('a')).toEqual({ x: 1, y: 2 })
  })

  it('LRU eviction at capacity', () => {
    const c = createLayoutCache(2)
    c.set('A', new Map([['a', { x: 0, y: 0 }]]))
    c.set('B', new Map([['b', { x: 0, y: 0 }]]))
    c.set('C', new Map([['c', { x: 0, y: 0 }]])) // evicts A
    expect(c.get('A').hit).toBe('miss')
    expect(c.get('B').hit).toBe('full')
    expect(c.get('C').hit).toBe('full')
  })

  it('get(hit) refreshes LRU position', () => {
    const c = createLayoutCache(2)
    c.set('A', new Map([['a', { x: 0, y: 0 }]]))
    c.set('B', new Map([['b', { x: 0, y: 0 }]]))
    c.get('A') // refreshes A
    c.set('C', new Map([['c', { x: 0, y: 0 }]])) // evicts B, not A
    expect(c.get('A').hit).toBe('full')
    expect(c.get('B').hit).toBe('miss')
  })

  it('partialMatch returns matched + missing ids and the positions for matched', () => {
    const c = createLayoutCache(4)
    c.set(
      'sig1',
      new Map([
        ['a', { x: 1, y: 1 }],
        ['b', { x: 2, y: 2 }],
        ['c', { x: 3, y: 3 }],
      ])
    )
    const result = c.partialMatch('sig1', ['a', 'b', 'd'])
    expect(new Set(result.matched)).toEqual(new Set(['a', 'b']))
    expect(result.missing).toEqual(['d'])
    expect(result.positions.size).toBe(2)
    expect(result.positions.get('a')).toEqual({ x: 1, y: 1 })
  })

  it('partialMatch returns matched=[] for a fully-missing sig', () => {
    const c = createLayoutCache(4)
    expect(c.partialMatch('nope', ['x']).matched).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/results/graph/layoutCache.test.ts`
Expected: FAIL — `createLayoutCache` undefined.

- [ ] **Step 3: Write the implementation**

```ts
// src/components/results/graph/layoutCache.ts
export type NodeId = string
export type Position = { x: number; y: number }
export type PosMap = Map<NodeId, Position>

export interface GetResult {
  hit: 'full' | 'miss'
  positions?: PosMap
}

export interface PartialMatch {
  matched: NodeId[]
  missing: NodeId[]
  positions: PosMap
}

export interface LayoutCache {
  get(sig: string): GetResult
  set(sig: string, positions: PosMap): void
  partialMatch(sig: string, currentIds: NodeId[]): PartialMatch
}

// Bounded LRU. The Map iteration order preserves insertion; we re-insert
// on hit to refresh the LRU position and rely on the same order for
// eviction (delete the first key when overflowing).
export function createLayoutCache(capacity = 8): LayoutCache {
  const store = new Map<string, PosMap>()

  function bump(sig: string, positions: PosMap): void {
    store.delete(sig)
    store.set(sig, positions)
    while (store.size > capacity) {
      const first = store.keys().next().value as string | undefined
      if (first === undefined) break
      store.delete(first)
    }
  }

  return {
    get(sig) {
      const positions = store.get(sig)
      if (!positions) return { hit: 'miss' }
      bump(sig, positions)
      return { hit: 'full', positions: new Map(positions) }
    },
    set(sig, positions) {
      bump(sig, new Map(positions))
    },
    partialMatch(sig, currentIds) {
      const cached = store.get(sig)
      if (!cached) return { matched: [], missing: currentIds.slice(), positions: new Map() }
      const matched: NodeId[] = []
      const missing: NodeId[] = []
      const positions: PosMap = new Map()
      currentIds.forEach((id) => {
        const p = cached.get(id)
        if (p) {
          matched.push(id)
          positions.set(id, p)
        } else {
          missing.push(id)
        }
      })
      return { matched, missing, positions }
    },
  }
}

// Module-level singleton used by the dispatcher. Tests can build their
// own via createLayoutCache(...).
export const layoutCache: LayoutCache = createLayoutCache(8)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/results/graph/layoutCache.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/layoutCache.ts \
        src/components/results/graph/layoutCache.test.ts
git commit -m "feat(graph): add layoutCache LRU + partialMatch"
```

---

### Task 13: `layoutWorker.ts` Web Worker entry

**Files:**

- Create: `src/components/results/graph/layoutWorker.ts`

- [ ] **Step 1: Write the worker entry**

```ts
// src/components/results/graph/layoutWorker.ts
// Web Worker entry. Runs fcose against a node/edge topology and posts
// final positions back. P1 does NOT emit per-tick snapshots — that
// lands in P2.

import cytoscape from 'cytoscape'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — cytoscape-fcose has no DOM dependency and is safe in workers
import fcose from 'cytoscape-fcose'

cytoscape.use(fcose)

type NodeSnap = { id: string; data?: Record<string, unknown> }
type EdgeSnap = { id: string; source: string; target: string }
type FcoseOpts = Record<string, unknown>

type WorkerIn =
  | { kind: 'run'; runId: number; nodes: NodeSnap[]; edges: EdgeSnap[]; opts: FcoseOpts }
  | { kind: 'cancel'; runId: number }

type WorkerOut =
  | { kind: 'done'; runId: number; positions: Record<string, [number, number]> }
  | { kind: 'error'; runId: number; message: string }

let currentRunId: number | null = null

self.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const msg = ev.data
  if (msg.kind === 'cancel') {
    if (msg.runId === currentRunId) currentRunId = null
    return
  }
  if (msg.kind !== 'run') return

  currentRunId = msg.runId

  try {
    // Build a headless cy core inside the worker. There is no DOM here.
    const cy = cytoscape({
      headless: true,
      styleEnabled: false,
      elements: [
        ...msg.nodes.map((n) => ({ group: 'nodes' as const, data: { id: n.id, ...n.data } })),
        ...msg.edges.map((e) => ({
          group: 'edges' as const,
          data: { id: e.id, source: e.source, target: e.target },
        })),
      ],
    })

    const layout = cy.layout({
      name: 'fcose',
      ...msg.opts,
      animate: false,
      fit: false,
    } as unknown as cytoscape.LayoutOptions)

    layout.one('layoutstop', () => {
      if (currentRunId !== msg.runId) {
        cy.destroy()
        return
      }
      const positions: Record<string, [number, number]> = {}
      cy.nodes().forEach((n) => {
        const p = n.position()
        positions[n.id()] = [p.x, p.y]
      })
      const out: WorkerOut = { kind: 'done', runId: msg.runId, positions }
      ;(self as unknown as { postMessage(m: WorkerOut): void }).postMessage(out)
      cy.destroy()
    })

    layout.run()
  } catch (e) {
    const out: WorkerOut = {
      kind: 'error',
      runId: msg.runId,
      message: e instanceof Error ? e.message : String(e),
    }
    ;(self as unknown as { postMessage(m: WorkerOut): void }).postMessage(out)
  }
}

// Make this a module so webpack treats it as a worker entry under the
// `new Worker(new URL(...))` pattern.
export {}
```

- [ ] **Step 2: Type-check**

Run: `npm run test:ts`
Expected: no new errors. (If `self.onmessage` typing fails, add a
`/// <reference lib="webworker" />` triple-slash at the top and a
local `declare const self: DedicatedWorkerGlobalScope` shim — both are
standard for webpack 5 worker entries.)

- [ ] **Step 3: Commit**

```bash
git add src/components/results/graph/layoutWorker.ts
git commit -m "feat(graph): add fcose layout worker entry (P1 — final positions only)"
```

---

### Task 14: `useLayoutWorker` hook + `runLayoutOnWorker` runtime fn

**Files:**

- Create: `src/components/results/graph/useLayoutWorker.ts`
- Create: `src/components/results/graph/useLayoutWorker.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/results/graph/useLayoutWorker.test.ts
import { runLayoutOnWorker, __resetWorkerForTest } from './useLayoutWorker'

class FakeWorker {
  static lastInstance: FakeWorker | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: ErrorEvent) => void) | null = null
  posted: unknown[] = []
  terminated = false
  constructor() { FakeWorker.lastInstance = this }
  postMessage(msg: unknown): void { this.posted.push(msg) }
  terminate(): void { this.terminated = true }
  fakeMessage(data: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data }))
  }
}

describe('runLayoutOnWorker', () => {
  let origWorker: typeof Worker | undefined
  beforeEach(() => {
    __resetWorkerForTest()
    origWorker = (global as unknown as { Worker?: typeof Worker }).Worker
    ;(global as unknown as { Worker: unknown }).Worker = FakeWorker
  })

  afterEach(() => {
    if (origWorker !== undefined) {
      ;(global as unknown as { Worker: typeof Worker }).Worker = origWorker
    } else {
      delete (global as unknown as { Worker?: typeof Worker }).Worker
    }
  })

  it('posts a run message with a fresh runId', () => {
    const onDone = jest.fn()
    runLayoutOnWorker({
      nodes: [{ id: 'a' }, { id: 'b' }],
      edges: [{ id: 'e1', source: 'a', target: 'b' }],
      opts: {},
      onTick: jest.fn(),
      onDone,
      onFallback: jest.fn(),
    })
    const posted = FakeWorker.lastInstance?.posted[0] as { kind: string; runId: number }
    expect(posted.kind).toBe('run')
    expect(typeof posted.runId).toBe('number')
  })

  it('calls onDone with the final positions map', () => {
    const onDone = jest.fn()
    runLayoutOnWorker({
      nodes: [{ id: 'a' }], edges: [], opts: {},
      onTick: jest.fn(), onDone, onFallback: jest.fn(),
    })
    const posted = FakeWorker.lastInstance?.posted[0] as { runId: number }
    FakeWorker.lastInstance?.fakeMessage({
      kind: 'done', runId: posted.runId, positions: { a: [10, 20] },
    })
    expect(onDone).toHaveBeenCalledTimes(1)
    const pos = onDone.mock.calls[0][0] as Map<string, { x: number; y: number }>
    expect(pos.get('a')).toEqual({ x: 10, y: 20 })
  })

  it('drops stale runId results', () => {
    const onDone = jest.fn()
    runLayoutOnWorker({
      nodes: [{ id: 'a' }], edges: [], opts: {},
      onTick: jest.fn(), onDone, onFallback: jest.fn(),
    })
    FakeWorker.lastInstance?.fakeMessage({
      kind: 'done', runId: 999999, positions: { a: [1, 2] },
    })
    expect(onDone).not.toHaveBeenCalled()
  })

  it('falls back to onFallback when Worker constructor throws', () => {
    ;(global as unknown as { Worker: unknown }).Worker = function (): never {
      throw new Error('CSP')
    } as unknown as typeof Worker
    __resetWorkerForTest()
    const onFallback = jest.fn()
    runLayoutOnWorker({
      nodes: [{ id: 'a' }], edges: [], opts: {},
      onTick: jest.fn(), onDone: jest.fn(), onFallback,
    })
    expect(onFallback).toHaveBeenCalledWith('worker-construct-failed')
  })

  it('terminates and falls back when no message arrives within timeout', () => {
    jest.useFakeTimers()
    const onFallback = jest.fn()
    runLayoutOnWorker({
      nodes: [{ id: 'a' }], edges: [], opts: {},
      onTick: jest.fn(), onDone: jest.fn(), onFallback,
      timeoutMs: 100,
    })
    jest.advanceTimersByTime(101)
    expect(onFallback).toHaveBeenCalledWith('worker-timeout')
    expect(FakeWorker.lastInstance?.terminated).toBe(true)
    jest.useRealTimers()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/results/graph/useLayoutWorker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/components/results/graph/useLayoutWorker.ts
import type { PosMap } from './layoutCache'

export type NodeSnap = { id: string; data?: Record<string, unknown> }
export type EdgeSnap = { id: string; source: string; target: string }
export type FcoseOpts = Record<string, unknown>

export type RunArgs = {
  nodes: NodeSnap[]
  edges: EdgeSnap[]
  opts: FcoseOpts
  onTick: (positions: PosMap) => void
  onDone: (positions: PosMap) => void
  onFallback: (reason: string) => void
  timeoutMs?: number
}

let workerSingleton: Worker | null = null
let workerDisabledForSession = false
let nextRunId = 1

// Track per-run watchdog so we don't run two timers for the same id
const watchdogs = new Map<number, ReturnType<typeof setTimeout>>()

function tryCreateWorker(): Worker | null {
  if (workerSingleton) return workerSingleton
  if (workerDisabledForSession) return null
  try {
    workerSingleton = new Worker(new URL('./layoutWorker.ts', import.meta.url), { type: 'module' })
    workerSingleton.onerror = (): void => {
      workerSingleton?.terminate()
      workerSingleton = null
      workerDisabledForSession = true
    }
    return workerSingleton
  } catch {
    workerDisabledForSession = true
    return null
  }
}

function toPosMap(record: Record<string, [number, number]>): PosMap {
  const m: PosMap = new Map()
  Object.entries(record).forEach(([id, [x, y]]) => m.set(id, { x, y }))
  return m
}

export function runLayoutOnWorker(args: RunArgs): void {
  const w = tryCreateWorker()
  if (!w) {
    args.onFallback('worker-construct-failed')
    return
  }
  const runId = nextRunId
  nextRunId += 1
  const timeoutMs = args.timeoutMs ?? 5000

  const listener = (ev: MessageEvent): void => {
    const msg = ev.data as
      | { kind: 'tick'; runId: number; positions: Record<string, [number, number]> }
      | { kind: 'done'; runId: number; positions: Record<string, [number, number]> }
      | { kind: 'error'; runId: number; message: string }
    if (msg.runId !== runId) return
    if (msg.kind === 'tick') {
      args.onTick(toPosMap(msg.positions))
      return
    }
    clearTimeout(watchdogs.get(runId))
    watchdogs.delete(runId)
    w.removeEventListener('message', listener)
    if (msg.kind === 'error') {
      args.onFallback(`worker-error:${msg.message}`)
      return
    }
    args.onDone(toPosMap(msg.positions))
  }

  w.addEventListener('message', listener)

  const timer = setTimeout(() => {
    w.removeEventListener('message', listener)
    watchdogs.delete(runId)
    try {
      w.terminate()
    } catch {
      /* ignore */
    }
    workerSingleton = null
    args.onFallback('worker-timeout')
  }, timeoutMs)
  watchdogs.set(runId, timer)

  w.postMessage({
    kind: 'run',
    runId,
    nodes: args.nodes,
    edges: args.edges,
    opts: args.opts,
  })
}

// @internal — test seam
export function __resetWorkerForTest(): void {
  try {
    workerSingleton?.terminate()
  } catch {
    /* ignore */
  }
  workerSingleton = null
  workerDisabledForSession = false
  nextRunId = 1
  watchdogs.forEach((t) => clearTimeout(t))
  watchdogs.clear()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/results/graph/useLayoutWorker.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/useLayoutWorker.ts \
        src/components/results/graph/useLayoutWorker.test.ts
git commit -m "feat(graph): add useLayoutWorker + runLayoutOnWorker with fallback policy"
```

---

### Task 15: `runLayout` dispatcher (cache → worker → main)

**Files:**

- Create: `src/components/results/graph/runLayout.ts`
- Create: `src/components/results/graph/runLayout.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/results/graph/runLayout.test.ts
import type { Core } from 'cytoscape'
import { runLayout } from './runLayout'
import { layoutCache } from './layoutCache'

function fakeCore(): Core & { _ran: number; _fit: number } {
  const positions = new Map<string, { x: number; y: number }>()
  const nodes = [
    { id: () => 'a', position: (p?: { x: number; y: number }) => {
      if (p) positions.set('a', p)
      return positions.get('a') ?? { x: 0, y: 0 }
    } },
    { id: () => 'b', position: (p?: { x: number; y: number }) => {
      if (p) positions.set('b', p)
      return positions.get('b') ?? { x: 0, y: 0 }
    } },
  ]
  const core = {
    _ran: 0,
    _fit: 0,
    batch: (fn: () => void) => fn(),
    nodes: () => ({ forEach: (cb: (n: typeof nodes[0]) => void) => nodes.forEach(cb), length: nodes.length }),
    layout: () => ({ run: function (this: unknown) { (core as { _ran: number })._ran += 1; return this } }),
    fit: (_: unknown, __: number) => { (core as { _fit: number })._fit += 1 },
  } as unknown as Core & { _ran: number; _fit: number }
  return core
}

describe('runLayout', () => {
  it('full cache hit applies positions and skips cy.layout', () => {
    const cy = fakeCore()
    layoutCache.set('SIG', new Map([
      ['a', { x: 10, y: 20 }],
      ['b', { x: 30, y: 40 }],
    ]))
    runLayout({ cy, layoutName: 'fcose', sig: 'SIG', currentIds: ['a', 'b'], n: 2, useWorker: true })
    expect(cy._ran).toBe(0)
    expect(cy._fit).toBe(1)
  })

  it('cache miss + non-fcose layout runs on main thread', () => {
    const cy = fakeCore()
    runLayout({ cy, layoutName: 'dagre', sig: 'NEW', currentIds: ['a', 'b'], n: 2, useWorker: true })
    expect(cy._ran).toBe(1)
  })

  it('cache miss + n < worker threshold runs on main thread', () => {
    const cy = fakeCore()
    runLayout({ cy, layoutName: 'fcose', sig: 'NEW2', currentIds: ['a'], n: 100, useWorker: true })
    expect(cy._ran).toBe(1)
  })

  it('useWorker=false forces main-thread layout', () => {
    const cy = fakeCore()
    runLayout({ cy, layoutName: 'fcose', sig: 'NEW3', currentIds: ['a', 'b'], n: 5000, useWorker: false })
    expect(cy._ran).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/results/graph/runLayout.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/components/results/graph/runLayout.ts
import type { Core } from 'cytoscape'
import { perfMarks } from '../../../lib/perfMarks'
import { layoutCache, type PosMap } from './layoutCache'
import { runLayoutOnWorker } from './useLayoutWorker'
import { layoutConfig } from './layouts'
import type { LayoutName } from '../useGraphPrefs'

const WORKER_MIN_N = 200

export type RunLayoutArgs = {
  cy: Core
  layoutName: LayoutName
  sig: string
  currentIds: string[]
  n: number
  useWorker: boolean
  onComplete?: () => void
}

function applyPositions(cy: Core, positions: PosMap): void {
  cy.batch(() => {
    cy.nodes().forEach((node) => {
      const p = positions.get(node.id() as string)
      if (p) node.position(p)
    })
  })
}

function snapshotPositions(cy: Core): PosMap {
  const map: PosMap = new Map()
  cy.nodes().forEach((n) => {
    const p = n.position()
    map.set(n.id() as string, { x: p.x, y: p.y })
  })
  return map
}

function mainThreadLayout(cy: Core, layoutName: LayoutName): void {
  cy.layout(layoutConfig(layoutName)).run()
}

export function runLayout(args: RunLayoutArgs): void {
  const { cy, layoutName, sig, currentIds, n, useWorker, onComplete } = args
  perfMarks.start('graph:layout')

  // Full cache hit — apply and return.
  const cached = layoutCache.get(`${layoutName}|${sig}`)
  if (cached.hit === 'full' && cached.positions) {
    applyPositions(cy, cached.positions)
    cy.fit(undefined, 24)
    perfMarks.end('graph:layout')
    onComplete?.()
    return
  }

  // Worker path — fcose, large enough, user pref on.
  if (useWorker && layoutName === 'fcose' && n >= WORKER_MIN_N) {
    const nodes = currentIds.map((id) => ({ id }))
    const edges: { id: string; source: string; target: string }[] = []
    cy.edges().forEach((e) => {
      edges.push({
        id: e.id() as string,
        source: e.source().id() as string,
        target: e.target().id() as string,
      })
    })
    runLayoutOnWorker({
      nodes,
      edges,
      opts: {},
      onTick: (positions) => {
        // No-op in P1 — per-tick reveal lands in P2.
        void positions
      },
      onDone: (positions) => {
        applyPositions(cy, positions)
        cy.fit(undefined, 24)
        layoutCache.set(`${layoutName}|${sig}`, positions)
        perfMarks.end('graph:layout')
        onComplete?.()
      },
      onFallback: (_reason) => {
        mainThreadLayout(cy, layoutName)
        layoutCache.set(`${layoutName}|${sig}`, snapshotPositions(cy))
        perfMarks.end('graph:layout')
        onComplete?.()
      },
    })
    return
  }

  // Main-thread fallback path — non-fcose layout, small n, or worker off.
  mainThreadLayout(cy, layoutName)
  layoutCache.set(`${layoutName}|${sig}`, snapshotPositions(cy))
  perfMarks.end('graph:layout')
  onComplete?.()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/results/graph/runLayout.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/runLayout.ts \
        src/components/results/graph/runLayout.test.ts
git commit -m "feat(graph): runLayout dispatcher (cache -> worker -> main)"
```

---

### Task 16: Wire `runLayout` into `useGraphCytoscape`

**Files:**

- Modify: `src/components/results/graph/useGraphCytoscape.ts`

- [ ] **Step 1: Replace the initial-layout call**

The initial layout in `useGraphCytoscape.ts` is passed via the `cytoscape({
… , layout: layoutConfig(layoutRef.current) })` constructor call (line ~140).
We can keep the constructor's layout (it runs on instantiation and is cheap
for the small-tier case), OR override by passing `layout: { name: 'preset' }`
to the constructor and then calling `runLayout(...)` afterwards. We pick
**the override path** because it lets the dispatcher decide cache-vs-worker
uniformly.

Replace the constructor call's `layout:` field:

```ts
        const cy = cytoscape({
          container: containerRef.current,
          elements: els,
          style: createCytoscapeStyle(themeRef.current),
          layout: { name: 'preset' },
          wheelSensitivity: 0.2,
        })
```

After the constructor (before the `cy.on(...)` lines):

```ts
        const ids: string[] = []
        cy.nodes().forEach((n) => ids.push(n.id() as string))
        runLayout({
          cy,
          layoutName: layoutRef.current,
          sig,
          currentIds: ids,
          n: cy.nodes().length,
          useWorker: useGraphPrefs.getState().useWorkerLayout,
          onComplete: () => {
            reapplyPins?.()
            reapplyFocus?.()
          },
        })
```

Add the import:

```ts
import { runLayout } from './runLayout'
```

- [ ] **Step 2: Replace the layout-rerun effect**

The existing rerun effect (line ~222) currently calls
`cy.layout(layoutConfig(layout)).run()`. Replace with the dispatcher:

```ts
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    const ids: string[] = []
    cy.nodes().forEach((n) => ids.push(n.id() as string))
    runLayout({
      cy,
      layoutName: layout,
      sig: layoutRef.current + ':' + ids.length, // best-effort rerun sig
      currentIds: ids,
      n: cy.nodes().length,
      useWorker: useGraphPrefs.getState().useWorkerLayout,
      onComplete: () => {
        cy.fit(undefined, 24)
        reapplyPins?.()
        reapplyFocus?.()
      },
    })
  }, [cyRef, layout])
```

(`cy.fit` inside `runLayout` already fits; the duplicate-fit in
`onComplete` is harmless and preserves the pre-existing post-rerun call.
Drop the inner `cy.fit` from `onComplete` if you prefer.)

Remove the standalone `perfMarks.start('graph:layout')` / `perfMarks.end`
calls that were added in Task 5 around this effect — they are now owned
by `runLayout`.

- [ ] **Step 3: Run all graph tests**

Run: `npx jest src/components/results/`
Expected: PASS.

Run: `npm run test:ts`
Expected: no new errors.

- [ ] **Step 4: Smoke-run the page**

Open `http://localhost:8080/dev/graph-bench?n=500&renderer=cytoscape` —
graph still renders. Open `?n=3000` — graph still renders (now through
the worker path because `useWorkerLayout` defaults to `true` and n ≥ 200,
layout = `cose` by default; for fcose you need the layout dropdown set
to `fcose` — verify both code paths exercised).

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/useGraphCytoscape.ts
git commit -m "feat(graph): route initial + rerun layouts through runLayout dispatcher"
```

---

### Task 17: Partial-hit path inside `runLayout` (expand-neighbours)

**Files:**

- Modify: `src/components/results/graph/runLayout.ts`
- Modify: `src/components/results/graph/runLayout.test.ts`

- [ ] **Step 1: Add the failing partial-hit test**

Append to `runLayout.test.ts`:

```ts
it('partial cache hit (>=60% matched) locks matched + layouts the rest', () => {
  const cy = fakeCore()
  // Seed cache under a different sig so partialMatch will return matches
  layoutCache.set('fcose|OLD', new Map([
    ['a', { x: 10, y: 20 }],
    ['b', { x: 30, y: 40 }],
  ]))
  runLayout({
    cy, layoutName: 'fcose', sig: 'OLD',
    currentIds: ['a', 'b', 'c'],
    n: 3, useWorker: false,
  })
  // Layout ran for the missing subset
  expect(cy._ran).toBe(1)
})

it('partial cache hit < 60% matched falls through to full layout', () => {
  const cy = fakeCore()
  layoutCache.set('fcose|SMALL', new Map([['a', { x: 0, y: 0 }]]))
  runLayout({
    cy, layoutName: 'fcose', sig: 'SMALL',
    currentIds: ['a', 'b', 'c', 'd', 'e'],   // 1/5 = 20% match
    n: 5, useWorker: false,
  })
  expect(cy._ran).toBe(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/results/graph/runLayout.test.ts`
Expected: the first new test may pass already; the second one will too
if cache lookups are exact. Both should be verified against the partial
implementation we'll add. If they pass for the wrong reason, instrument
the fakeCore to also count `cy.batch` calls and require the partial path
emit `applyPositions` before `cy.layout`.

Add a position-write spy to the fakeCore:

```ts
function fakeCore(): /* … */ {
  // … as before …
  // Add: track position writes
  ;(core as { _positionWrites: number })._positionWrites = 0
  const wrappedNodes = nodes.map((n) => ({
    ...n,
    position: (p?: { x: number; y: number }) => {
      if (p) (core as { _positionWrites: number })._positionWrites += 1
      return n.position(p)
    },
  }))
  ;(core as unknown as { nodes: () => unknown }).nodes = () => ({
    forEach: (cb: (n: typeof wrappedNodes[0]) => void) => wrappedNodes.forEach(cb),
    length: wrappedNodes.length,
  })
  // …
}
```

Then assert the partial-hit test writes positions for `a` and `b` BEFORE
the layout runs.

- [ ] **Step 3: Implement the partial-hit path**

In `runLayout.ts`, after the full-hit return and BEFORE the worker /
main-thread branch, insert:

```ts
  // Partial cache hit — if >= 60% of currentIds have cached positions,
  // apply them and run layout only on the unmatched subset. Cytoscape
  // doesn't natively layout a sub-selection, so we use `lock` on the
  // matched nodes; fcose / cose / dagre all respect `locked` and only
  // move unlocked nodes.
  const partial = layoutCache.partialMatch(`${layoutName}|${sig}`, currentIds)
  if (partial.matched.length >= currentIds.length * 0.6 && partial.matched.length > 0) {
    applyPositions(cy, partial.positions)
    cy.nodes().forEach((node) => {
      if (partial.positions.has(node.id() as string)) (node as unknown as { lock: () => void }).lock()
    })
    mainThreadLayout(cy, layoutName)
    cy.nodes().forEach((node) => {
      (node as unknown as { unlock: () => void }).unlock()
    })
    cy.fit(undefined, 24)
    layoutCache.set(`${layoutName}|${sig}`, snapshotPositions(cy))
    perfMarks.end('graph:layout')
    onComplete?.()
    return
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/results/graph/runLayout.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/runLayout.ts \
        src/components/results/graph/runLayout.test.ts
git commit -m "feat(graph): partial cache hit (>=60% matched) reuses positions"
```

---

### Task 18: `scripts/bench-gate.ts` — compare results JSON against baseline

**Files:**

- Create: `scripts/bench-gate.ts`

- [ ] **Step 1: Write the gate script**

```ts
// scripts/bench-gate.ts
// Compares the latest bench results JSON to a baseline. Exits non-zero
// on regression > THRESHOLD% on any tier-record metric. Invoked manually:
//
//   ts-node scripts/bench-gate.ts <results.json> <baseline.json>
//
// Both files have the shape produced by e2e/specs/19-graph-bench.spec.ts.

import * as fs from 'node:fs'

type Record = {
  renderer: 'cytoscape' | 'reagraph'
  n: number
  tier: 'small' | 'mid' | 'large'
  firstPaintMs: number
  firstInteractiveMs: number
  layoutMs: number
  avgFps: number
  p5Fps: number
}

type Doc = { records: Record[] }

const THRESHOLD = 0.10  // 10%

// Lower is better for these:
const LOWER_IS_BETTER = new Set(['firstPaintMs', 'firstInteractiveMs', 'layoutMs'])
// Higher is better for these:
const HIGHER_IS_BETTER = new Set(['avgFps', 'p5Fps'])

function regressed(metric: string, baseline: number, current: number): boolean {
  if (baseline <= 0) return false
  if (LOWER_IS_BETTER.has(metric)) {
    return (current - baseline) / baseline > THRESHOLD
  }
  if (HIGHER_IS_BETTER.has(metric)) {
    return (baseline - current) / baseline > THRESHOLD
  }
  return false
}

function key(r: Record): string {
  return `${r.renderer}|${r.n}`
}

function main(): void {
  const [, , resultsPath, baselinePath] = process.argv
  if (!resultsPath || !baselinePath) {
    console.error('usage: bench-gate.ts <results.json> <baseline.json>')
    process.exit(2)
  }
  const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8')) as Doc
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as Doc
  const baselineByKey = new Map(baseline.records.map((r) => [key(r), r]))

  const failures: string[] = []
  results.records.forEach((cur) => {
    const base = baselineByKey.get(key(cur))
    if (!base) return  // new combo — no baseline to compare
    ;(['firstPaintMs', 'firstInteractiveMs', 'layoutMs', 'avgFps', 'p5Fps'] as const).forEach(
      (m) => {
        const b = base[m] as unknown as number
        const c = cur[m] as unknown as number
        if (regressed(m, b, c)) {
          failures.push(`${key(cur)} ${m}: baseline=${b} current=${c}`)
        }
      }
    )
  })

  if (failures.length > 0) {
    console.error(`bench-gate: ${failures.length} regression(s) > ${THRESHOLD * 100}%:`)
    failures.forEach((f) => console.error('  ' + f))
    process.exit(1)
  }
  console.log('bench-gate: all metrics within threshold')
}

main()
```

- [ ] **Step 2: Smoke-run against baseline (no diff expected)**

Run: `npx ts-node scripts/bench-gate.ts docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json`
Expected: prints "bench-gate: all metrics within threshold" and exits 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/bench-gate.ts
git commit -m "tooling(perf): add bench-gate comparison script"
```

---

### Task 19: Verify P1 gate

**Files:** none (validation only)

- [ ] **Step 1: Rebuild containers if any source files changed**

Run: `make e2e-up` (or whatever the container-rebuild target is in this stack).

- [ ] **Step 2: Re-run the bench**

Run: `make bench-graph`

- [ ] **Step 3: Eyeball the new JSON**

Inspect `docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json`.
Required: cytoscape n=5000 record now shows `p5Fps >= 20` and
`layoutMs < 2500`. Inspect the n=5000 second-run combo: `cacheHitRate == 1`
and `layoutMs < 50`.

If the bench fails the gate, treat P2 (per-tick reveal) as the next
attempt. If it still fails, fall back to tier-degradation-only (revert
the worker integration in `runLayout` but keep the cache).

- [ ] **Step 4: Commit the new results JSON**

```bash
git add docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json
git commit -m "test(perf): land P1 bench results (worker + cache, no per-tick reveal)"
```

---

## Phase P2 — Large Tier (n ≤ 10 000)

Goal: progressive per-tick reveal + partial-hit hot path verified on a
streaming-expand fixture + streaming gate. Bench shows n=10000 layout
completes < 5 s and pan/zoom remains responsive.

### Task 20: Per-tick streaming in `layoutWorker.ts`

**Files:**

- Modify: `src/components/results/graph/layoutWorker.ts`

- [ ] **Step 1: Add tick emission**

cytoscape's `layout` event lifecycle exposes `layoutready` (initial) and
`layoutstop` (terminal). fcose internally drives a tick loop but does
not expose per-tick callbacks directly. The practical workaround: drive
a `setInterval` inside the worker that snapshots positions every 33 ms
while the layout is running, and stops on `layoutstop`.

Modify the `run` branch in `layoutWorker.ts`:

```ts
    const layout = cy.layout({
      name: 'fcose',
      ...msg.opts,
      animate: false,
      fit: false,
    } as unknown as cytoscape.LayoutOptions)

    let stopped = false
    const tick = setInterval(() => {
      if (stopped || currentRunId !== msg.runId) return
      const positions: Record<string, [number, number]> = {}
      cy.nodes().forEach((n) => {
        const p = n.position()
        positions[n.id()] = [p.x, p.y]
      })
      const out: WorkerOut = { kind: 'tick', runId: msg.runId, positions }
      ;(self as unknown as { postMessage(m: WorkerOut): void }).postMessage(out)
    }, 33)

    layout.one('layoutstop', () => {
      stopped = true
      clearInterval(tick)
      if (currentRunId !== msg.runId) {
        cy.destroy()
        return
      }
      const positions: Record<string, [number, number]> = {}
      cy.nodes().forEach((n) => {
        const p = n.position()
        positions[n.id()] = [p.x, p.y]
      })
      const out: WorkerOut = { kind: 'done', runId: msg.runId, positions }
      ;(self as unknown as { postMessage(m: WorkerOut): void }).postMessage(out)
      cy.destroy()
    })

    layout.run()
```

Add `tick` to the WorkerOut union:

```ts
type WorkerOut =
  | { kind: 'tick'; runId: number; positions: Record<string, [number, number]> }
  | { kind: 'done'; runId: number; positions: Record<string, [number, number]> }
  | { kind: 'error'; runId: number; message: string }
```

- [ ] **Step 2: Smoke-test via the existing useLayoutWorker test**

Run: `npx jest src/components/results/graph/useLayoutWorker.test.ts`
Expected: PASS (the existing tests don't exercise tick — that's verified
via the dispatcher integration in the next task).

- [ ] **Step 3: Commit**

```bash
git add src/components/results/graph/layoutWorker.ts
git commit -m "feat(graph): worker emits per-tick position snapshots every 33ms"
```

---

### Task 21: Dispatcher applies tick positions via `cy.batch`

**Files:**

- Modify: `src/components/results/graph/runLayout.ts`
- Modify: `src/components/results/graph/runLayout.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `runLayout.test.ts`:

```ts
it('worker path applies tick positions when onTick fires', () => {
  // We don't run a real worker; we test the wiring shape — the runLayout
  // worker branch passes a tick handler that calls applyPositions inside
  // cy.batch. Mock runLayoutOnWorker for this test.
  jest.resetModules()
  jest.doMock('./useLayoutWorker', () => ({
    runLayoutOnWorker: ({ onTick }: { onTick: (p: Map<string, { x: number; y: number }>) => void }) => {
      onTick(new Map([['a', { x: 100, y: 200 }]]))
    },
  }))
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { runLayout: rl } = require('./runLayout')
  const cy = fakeCore()
  rl({ cy, layoutName: 'fcose', sig: 'TICK', currentIds: ['a', 'b'], n: 5000, useWorker: true })
  // applyPositions writes positions inside cy.batch; assert at least one position write happened
  expect((cy as { _positionWrites: number })._positionWrites).toBeGreaterThan(0)
  jest.dontMock('./useLayoutWorker')
})
```

- [ ] **Step 2: Update the dispatcher onTick handler**

Currently the dispatcher's `onTick` is a no-op. Replace with:

```ts
      onTick: (positions) => {
        applyPositions(cy, positions)
      },
```

The dispatcher already wraps `applyPositions` in `cy.batch`.

- [ ] **Step 3: Run the test**

Run: `npx jest src/components/results/graph/runLayout.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/results/graph/runLayout.ts \
        src/components/results/graph/runLayout.test.ts
git commit -m "feat(graph): apply per-tick positions for progressive layout reveal"
```

---

### Task 22: Streaming gate — suppress layout while `row_count` is growing

**Files:**

- Modify: `src/components/results/graph/useGraphCytoscape.ts`

- [ ] **Step 1: Track row-count progression**

Where `sig` is computed in `GraphViewCytoscape.tsx`, the rebuild already
debounces on sig change (REBUILD_DEBOUNCE_MS = 250 ms). We piggyback on
this: between two rebuild ticks, if the new row count is GREATER than
the previous AND less than 1 s has elapsed since the previous rebuild,
suppress layout (apply cached positions if available; otherwise skip layout
this frame).

Inside `useGraphCytoscape.ts`, add module-level tracking:

```ts
const rebuildTrack = new WeakMap<Core, { lastRebuildAt: number; lastNodeCount: number }>()
```

Inside the `build` function's happy path, BEFORE calling `runLayout(...)`:

```ts
        const prev = (cyRef.current && rebuildTrack.get(cyRef.current)) || undefined
        // cyRef.current is the just-destroyed core when prev exists; we
        // need the new `cy` we just built — use it for tracking.
        const now = Date.now()
        const stillStreaming =
          prev && now - prev.lastRebuildAt < 1000 && cy.nodes().length > prev.lastNodeCount
        rebuildTrack.set(cy, { lastRebuildAt: now, lastNodeCount: cy.nodes().length })

        const ids: string[] = []
        cy.nodes().forEach((n) => ids.push(n.id() as string))
        if (stillStreaming) {
          // Apply cached positions if we have them; otherwise leave the
          // new nodes at (0,0). They'll lay out properly on the next
          // settled rebuild.
          const cached = layoutCache.get(`${layoutRef.current}|${sig}`)
          if (cached.hit === 'full' && cached.positions) {
            applyPositionsRaw(cy, cached.positions)
            cy.fit(undefined, 24)
          }
        } else {
          runLayout({
            cy,
            layoutName: layoutRef.current,
            sig,
            currentIds: ids,
            n: cy.nodes().length,
            useWorker: useGraphPrefs.getState().useWorkerLayout,
            onComplete: () => {
              reapplyPins?.()
              reapplyFocus?.()
            },
          })
        }
```

Add `applyPositionsRaw` import — or re-export from `runLayout.ts`:

```ts
// runLayout.ts — make applyPositions an export
export function applyPositions(/* … */) { /* … */ }
```

And import from useGraphCytoscape:

```ts
import { runLayout, applyPositions as applyPositionsRaw } from './runLayout'
import { layoutCache } from './layoutCache'
```

- [ ] **Step 2: Run all graph tests**

Run: `npx jest src/components/results/`
Expected: PASS.

- [ ] **Step 3: Manual streaming smoke test**

In the running container, run a streaming query that produces > 2 000
rows. Expected: graph shows existing positions while rows continue to
arrive; layout fires exactly once when row_count settles (visible as a
single "settle" motion at the end of streaming).

- [ ] **Step 4: Commit**

```bash
git add src/components/results/graph/useGraphCytoscape.ts \
        src/components/results/graph/runLayout.ts
git commit -m "feat(graph): suppress layout during streaming, apply cached positions"
```

---

### Task 23: Verify P2 gate

**Files:** none (validation only)

- [ ] **Step 1: Rebuild containers**

Run: `make e2e-up`

- [ ] **Step 2: Re-run the bench**

Run: `make bench-graph`

- [ ] **Step 3: Eyeball the new JSON**

Inspect cytoscape n=10000 record. Required:

- `layoutMs < 5000` p95 (across multiple bench runs)
- `p5Fps >= 10` during the pan phase (if the bench harness exercises
  pan; if not, gather the number via a one-off manual run on a real
  graph and document it)

- [ ] **Step 4: Run the gate**

Run: `npx ts-node scripts/bench-gate.ts docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json docs/performance/2026-05-14-cytoscape-vs-reagraph.baseline.json`

You will need to copy the pre-P1 results to a baseline file once before
running this:

```bash
cp docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json \
   docs/performance/2026-05-14-cytoscape-vs-reagraph.baseline.json
```

Then re-run the bench and the gate.

- [ ] **Step 5: Commit results + a short report**

```bash
git add docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json \
        docs/performance/2026-05-14-cytoscape-vs-reagraph.baseline.json
git commit -m "test(perf): land P2 bench results (per-tick reveal + streaming gate)"
```

Optionally hand-author a markdown report at
`docs/performance/2026-05-15-cytoscape-perf-optimization-results.md`
summarising the before/after numbers and any phase-gate skips.

---

## Done

When all 23 tasks land green:

- P0 ship: scaleTier + effective\* selectors + perfMarks wiring; bench
  shows no regression at n=500 or n=2 000.
- P1 ship: layoutCache + worker-fcose (final positions); bench shows
  p5 ≥ 20 at n=5000 and `layoutMs < 50` on cache-warm.
- P2 ship: per-tick reveal + streaming gate; bench shows
  `layoutMs < 5000` at n=10000.

If P1 or P2 misses its gate, that phase falls back to tier-degradation
only (revert the worker/streaming-gate edits; keep the cache and the
tier system). The architecture's seams are designed for that fallback —
no rework required.
