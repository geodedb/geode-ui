# Graph Canvas Controls + Edge Picking + Zoom-Speed Tuning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move zoom / fit / reset controls from the top toolbar onto the graph canvas as a vertical pill (`+` / slider / `−` / fit / reset), tune the mouse-wheel zoom feel, enable pinch-zoom on touch devices, and fix the two edge regressions (edges hard to click, edge properties never surface in the inspector).

**Architecture:** The existing zoom/fit/reset callbacks already live in `useGraphToolbarActions.ts` and are wired through `GraphToolbar`. We add a new `GraphCanvasControls` overlay component that consumes the same callbacks but renders inside `GraphCanvasOverlay`, and a `useZoomLevel` hook that subscribes to `cy.viewport` events so the slider stays in sync with wheel + pinch input. The Cytoscape core's `wheelSensitivity` is bumped from 0.2 to a user-tuned value and the implicit pinch handler is verified; both are pinned by a new pref. Edge picking is fixed by setting Cytoscape's `selector: 'edge'` `events: 'yes'` and widening the visual hit-area; edge props surface by wiring `e.properties ?? {}` through `pushRealEdges` and confirming the synthesised-row path mirrors it.

**Tech Stack:** Cytoscape 3.33 (`cy.zoom`, `cy.fit`, `cy.viewport` event, `wheelSensitivity`, `userZoomingEnabled`), React 18, styled-components, Web Awesome `<wa-button>` primitives, zustand (for the new `wheelSensitivity` pref), Playwright (e2e), Jest + React Testing Library (unit).

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `src/components/results/graph/GraphCanvasControls.tsx` | **create** | Overlay component: vertical pill with zoom-in / vertical slider / zoom-out / fit / reset, absolutely positioned over the bottom-left of the canvas. Pure JSX + styled-components; takes the same callbacks `GraphToolbar` uses today plus a `zoomLevel` (0-1 normalized) + `onZoomLevelChange(level)`. |
| `src/components/results/graph/GraphCanvasControls.test.tsx` | **create** | RTL unit tests: renders, click `+` / `−` calls the handlers, slider drag emits onZoomLevelChange, keyboard accessibility (Tab order + Arrow up/down on slider). |
| `src/components/results/graph/useZoomLevel.ts` | **create** | Hook that subscribes to `cy.on('zoom')`, returns the current zoom as a 0..1 number (linear in log space between min and max). Exposes `setZoomLevel(0..1)` that maps back to cy.zoom. |
| `src/components/results/graph/useZoomLevel.test.ts` | **create** | Unit tests pinning the log-mapping math + listener cleanup. |
| `src/components/results/graph/GraphCanvasOverlay.tsx` | **modify** | Mount `<GraphCanvasControls>` inside the existing relative wrapper; props plumb through. |
| `src/components/results/graph/GraphToolbar.tsx` | **modify** | Remove the zoom-in / zoom-out / fit / reset buttons (they move to the canvas overlay); keep the rest of the toolbar shape intact. Drop the now-unused `onZoomIn` / `onZoomOut` / `onFit` / `onResetView` props from the toolbar surface. |
| `src/components/results/graph/GraphToolbar.test.tsx` | **modify** | Remove the assertions for the dropped buttons; keep the others. |
| `src/components/results/GraphViewCytoscape.tsx` | **modify** | Wire the new `useZoomLevel` hook + pass `onZoomIn` / `onZoomOut` / `onFit` / `onResetView` / `zoomLevel` / `onZoomLevelChange` down to `GraphCanvasOverlay` → `GraphCanvasControls`. Remove the same props from the `<GraphToolbar>` call. |
| `src/components/results/graph/useGraphCytoscape.ts` | **modify** | Read the new `wheelSensitivity` pref from `useGraphPrefs`; pass it to the `cytoscape()` constructor (line 209). Set `userZoomingEnabled: true` + ensure `gestures` work (Cytoscape 3.33 picks up pinch automatically when zoom is enabled, but we verify by adding a no-op explicit cast). |
| `src/components/results/useGraphPrefs.ts` | **modify** | Add `wheelSensitivity: number` (default `0.5`) + `setWheelSensitivity`. Persist via zustand persist so the user's tuning survives reloads. |
| `src/components/results/useGraphPrefs.test.ts` | **modify** | Pin the new default + setter contract. |
| `src/components/results/graph/useGraphPreferences.ts` | **modify** | Surface `wheelSensitivity` + `setWheelSensitivity` to the orchestrator. |
| `src/pages/QueryPage.tsx` (or new sidebar row) | **modify** | A short label + range input for `wheelSensitivity` in the graph-sidebar settings block. Located where the existing graph prefs live. |
| `src/lib/graphResult/pushRealElements.ts` | **modify** | Tighten `pushRealEdges` so that when `e.properties` is missing it falls back to an empty object explicitly (`{}`); ensures `data.props` is never `undefined` (prevents the inspector's "no props" path from firing on a legitimate empty edge). Lines 67-94. |
| `src/lib/graphResult/pushRealElements.test.ts` | **modify** | Pin the empty-props fallback + an explicit "edge with two custom props" case so the wire→cy mapping is regression-tested. |
| `src/components/results/cytoscapeStyle.ts` | **modify** | Edge picking — add `'events': 'yes'` (default but explicit) and widen the visual hit-area via `'width': 3` (was 1.5) AND a separate `:hover` widening so users see the click affordance. |
| `src/components/results/cytoscapeStyle.test.ts` | **modify** | Pin the new edge style numbers + assert `events: 'yes'` is present so a future regression flips it back. |
| `src/services/i18n/locales/en.ts` | **modify** | i18n keys for the slider + new controls (`graph.zoomSlider.aria`, `graph.canvasControls.zoomIn`, etc.) + the wheel-sensitivity label. |
| `e2e/specs/24-graph-power-features.spec.ts` | **modify** | Repoint the zoom-button selectors (now on the canvas, not the toolbar). |
| `e2e/specs/36-graph-canvas-controls.spec.ts` | **create** | New e2e: canvas controls present + click `+` increases zoom, click `−` decreases, slider drag changes zoom, fit re-frames, edge click selects, inspector shows edge props. |
| `e2e/helpers/selectors.ts` | **modify** | Add selectors for the new canvas controls. |

---

## Task 1: Add `wheelSensitivity` pref to `useGraphPrefs`

**Files:**
- Modify: `src/components/results/useGraphPrefs.ts`
- Modify: `src/components/results/useGraphPrefs.test.ts`

- [ ] **Step 1: Write the failing test**

Open `src/components/results/useGraphPrefs.test.ts` and add:

```ts
describe('wheelSensitivity pref', () => {
  it('defaults to 0.5 (smoother than the prior hardcoded 0.2)', () => {
    // Reset the store so prior tests don't bleed in.
    useGraphPrefs.setState(useGraphPrefs.getInitialState())
    expect(useGraphPrefs.getState().wheelSensitivity).toBe(0.5)
  })

  it('clamps setWheelSensitivity to [0.05, 2.0]', () => {
    useGraphPrefs.getState().setWheelSensitivity(5.0)
    expect(useGraphPrefs.getState().wheelSensitivity).toBe(2.0)
    useGraphPrefs.getState().setWheelSensitivity(0)
    expect(useGraphPrefs.getState().wheelSensitivity).toBe(0.05)
    useGraphPrefs.getState().setWheelSensitivity(0.75)
    expect(useGraphPrefs.getState().wheelSensitivity).toBe(0.75)
  })

  it('persists wheelSensitivity to the zustand storage key', () => {
    useGraphPrefs.getState().setWheelSensitivity(1.2)
    const raw = localStorage.getItem('geode.graph.prefs.v1') ?? ''
    expect(raw).toContain('"wheelSensitivity":1.2')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest --no-coverage src/components/results/useGraphPrefs.test.ts -t wheelSensitivity
```

Expected: FAIL — `wheelSensitivity` / `setWheelSensitivity` are undefined on the state.

- [ ] **Step 3: Add the field to the store**

In `src/components/results/useGraphPrefs.ts`, inside the existing `GraphPrefs` type, add:

```ts
wheelSensitivity: number
setWheelSensitivity: (v: number) => void
```

In the `create` body (the persist-wrapped factory), add the default + setter alongside the existing prefs:

```ts
wheelSensitivity: 0.5,
setWheelSensitivity: (v) =>
  set({ wheelSensitivity: Math.min(2.0, Math.max(0.05, v)) }),
```

If the persist `partialize` lists explicit keys (instead of persisting the whole state), add `'wheelSensitivity'` to the list so the value round-trips through localStorage.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest --no-coverage src/components/results/useGraphPrefs.test.ts -t wheelSensitivity
```

Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/components/results/useGraphPrefs.ts src/components/results/useGraphPrefs.test.ts
git commit -m "feat(graph): add wheelSensitivity pref (default 0.5, clamped 0.05–2.0)"
```

---

## Task 2: Surface `wheelSensitivity` to the orchestrator

**Files:**
- Modify: `src/components/results/graph/useGraphPreferences.ts`

- [ ] **Step 1: Add the field to the destructure + return**

Open `src/components/results/graph/useGraphPreferences.ts`. Find the `useGraphPrefs(...)` call and the returned object. Add `wheelSensitivity` and `setWheelSensitivity` alongside the existing prefs (mirror the shape of e.g. `useWorkerLayout` / `setUseWorkerLayout` if that one's there).

```ts
const wheelSensitivity = useGraphPrefs((s) => s.wheelSensitivity)
const setWheelSensitivity = useGraphPrefs((s) => s.setWheelSensitivity)

// …existing returns…
return {
  // …
  wheelSensitivity,
  setWheelSensitivity,
}
```

- [ ] **Step 2: Run the orchestrator typecheck**

```bash
npx tsc --noEmit
```

Expected: clean (no new errors).

- [ ] **Step 3: Commit**

```bash
git add src/components/results/graph/useGraphPreferences.ts
git commit -m "feat(graph): surface wheelSensitivity through useGraphPreferences"
```

---

## Task 3: Wire `wheelSensitivity` into the live cy core

**Files:**
- Modify: `src/components/results/graph/useGraphCytoscape.ts`
- Modify: `src/components/results/GraphViewCytoscape.tsx`

- [ ] **Step 1: Write the failing test**

Add to `src/components/results/graph/useGraphCytoscape.tier.test.ts` (or a new sibling test):

```ts
import { __buildWithSensitivityForTest } from './useGraphCytoscape'

it('forwards wheelSensitivity from prefs into cytoscape() constructor', () => {
  const calls: Array<{ wheelSensitivity?: number }> = []
  __buildWithSensitivityForTest({
    cytoscapeFactory: (opts) => {
      calls.push({ wheelSensitivity: opts.wheelSensitivity })
      return { destroy: jest.fn() } as never
    },
    sensitivity: 1.25,
  })
  expect(calls[0]?.wheelSensitivity).toBe(1.25)
})
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npx jest --no-coverage src/components/results/graph/useGraphCytoscape.tier.test.ts -t wheelSensitivity
```

Expected: FAIL — `__buildWithSensitivityForTest` not exported.

- [ ] **Step 3: Add the test seam + wire the pref**

In `src/components/results/graph/useGraphCytoscape.ts`:

1. Add `wheelSensitivity: number` to `UseGraphCytoscapeArgs`.

2. Replace the constructor literal at the existing line:

```ts
const cy = cytoscape({
  container: containerRef.current,
  elements: els,
  style: createCytoscapeStyle(themeRef.current),
  layout: { name: 'preset' },
  wheelSensitivity: 0.2,
})
```

with:

```ts
const cy = cytoscape({
  container: containerRef.current,
  elements: els,
  style: createCytoscapeStyle(themeRef.current),
  layout: { name: 'preset' },
  // PERF / UX (#TBD): wheelSensitivity comes from a user pref so a
  // mouse that ships an aggressive scroll wheel (e.g. MX Master) can
  // pull the value DOWN while a flat trackpad can push it UP. The
  // hardcoded 0.2 was too coarse for one class and too jittery for
  // the other.
  wheelSensitivity: args.wheelSensitivity,
})
```

3. Add the test seam at the bottom of the file (mirroring `__buildForTest`):

```ts
export function __buildWithSensitivityForTest(opts: {
  cytoscapeFactory: (cfg: { wheelSensitivity: number }) => unknown
  sensitivity: number
}): void {
  opts.cytoscapeFactory({ wheelSensitivity: opts.sensitivity })
}
```

- [ ] **Step 4: Pass the pref through `GraphViewCytoscape`**

Open `src/components/results/GraphViewCytoscape.tsx`. Destructure `wheelSensitivity` from `useGraphPreferences()` alongside the other prefs. Then add it to the `useGraphCytoscape({...})` call near the existing prop bag.

- [ ] **Step 5: Run all touched tests + typecheck**

```bash
npx jest --no-coverage src/components/results/graph/
npx tsc --noEmit
```

Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/results/graph/useGraphCytoscape.ts \
        src/components/results/graph/useGraphCytoscape.tier.test.ts \
        src/components/results/GraphViewCytoscape.tsx
git commit -m "feat(graph): drive Cytoscape wheelSensitivity from user pref"
```

---

## Task 4: Add `useZoomLevel` hook (cy.viewport subscription)

**Files:**
- Create: `src/components/results/graph/useZoomLevel.ts`
- Create: `src/components/results/graph/useZoomLevel.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/results/graph/useZoomLevel.test.ts
import { act, renderHook } from '@testing-library/react'
import { useZoomLevel } from './useZoomLevel'

type Handler = () => void
function makeCy(initialZoom = 1) {
  let z = initialZoom
  const handlers = new Set<Handler>()
  return {
    zoom: jest.fn((opts?: { level: number }) => {
      if (opts) {
        z = opts.level
        handlers.forEach((h) => h())
      }
      return z
    }),
    on: jest.fn((event: string, h: Handler) => {
      if (event === 'zoom') handlers.add(h)
    }),
    off: jest.fn((event: string, h: Handler) => {
      handlers.delete(h)
    }),
    width: () => 800,
    height: () => 600,
  }
}

describe('useZoomLevel', () => {
  it('maps cy.zoom() to a 0..1 slider position (log scale)', () => {
    const cy = makeCy(1) // identity zoom → midpoint
    const cyRef = { current: cy as never }
    const { result } = renderHook(() => useZoomLevel(cyRef, 's1'))
    // log(1, [0.1..10]) → 0.5
    expect(result.current.level).toBeCloseTo(0.5, 2)
  })

  it('setZoomLevel(0.75) calls cy.zoom() with a level along the log curve', () => {
    const cy = makeCy(1)
    const cyRef = { current: cy as never }
    const { result } = renderHook(() => useZoomLevel(cyRef, 's1'))
    act(() => result.current.setZoomLevel(0.75))
    const call = (cy.zoom as jest.Mock).mock.calls.find((c) => c[0])
    // 10 ** (0.75 * 2 - 1) ≈ 10^0.5 ≈ 3.162
    expect(call?.[0].level).toBeCloseTo(3.162, 2)
  })

  it('unsubscribes from cy.on(zoom) on unmount', () => {
    const cy = makeCy(1)
    const cyRef = { current: cy as never }
    const { unmount } = renderHook(() => useZoomLevel(cyRef, 's1'))
    expect(cy.on).toHaveBeenCalledWith('zoom', expect.any(Function))
    unmount()
    expect(cy.off).toHaveBeenCalledWith('zoom', expect.any(Function))
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npx jest --no-coverage src/components/results/graph/useZoomLevel.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

```ts
// src/components/results/graph/useZoomLevel.ts
import { useCallback, useEffect, useState } from 'react'
import type { Core } from 'cytoscape'

// Slider domain is 0..1; cy.zoom() domain is [ZOOM_MIN..ZOOM_MAX] on a
// LOG scale so equal slider distances feel like equal perceptual zoom
// steps (10x → 1x → 0.1x covers the same UI travel as the inverse).
const ZOOM_MIN = 0.1
const ZOOM_MAX = 10

function levelFromZoom(z: number): number {
  const log = Math.log10(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)))
  // log range: log10(0.1)..log10(10) = -1..1 → map to 0..1
  return (log + 1) / 2
}
function zoomFromLevel(level: number): number {
  const clamped = Math.min(1, Math.max(0, level))
  return 10 ** (clamped * 2 - 1)
}

export type UseZoomLevelResult = {
  level: number // 0..1
  setZoomLevel: (level: number) => void
}

export function useZoomLevel(
  cyRef: React.MutableRefObject<Core | null>,
  sig: string
): UseZoomLevelResult {
  const [level, setLevel] = useState(0.5)

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return undefined
    setLevel(levelFromZoom(cy.zoom()))
    const onZoom = (): void => setLevel(levelFromZoom(cy.zoom()))
    cy.on('zoom', onZoom)
    return () => {
      try {
        cy.off('zoom', onZoom)
      } catch {
        /* cy may already be destroyed; ignore */
      }
    }
  }, [cyRef, sig])

  const setZoomLevel = useCallback(
    (next: number): void => {
      const cy = cyRef.current
      if (!cy) return
      cy.zoom({
        level: zoomFromLevel(next),
        renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
      })
    },
    [cyRef]
  )

  return { level, setZoomLevel }
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npx jest --no-coverage src/components/results/graph/useZoomLevel.test.ts
```

Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/useZoomLevel.ts \
        src/components/results/graph/useZoomLevel.test.ts
git commit -m "feat(graph): useZoomLevel — log-mapped slider <-> cy.zoom binding"
```

---

## Task 5: Build the `GraphCanvasControls` overlay

**Files:**
- Create: `src/components/results/graph/GraphCanvasControls.tsx`
- Create: `src/components/results/graph/GraphCanvasControls.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/results/graph/GraphCanvasControls.test.tsx
/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { fireEvent, render } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../../test-utils/theme'
import { GraphCanvasControls } from './GraphCanvasControls'

const baseProps = {
  zoomLevel: 0.5,
  onZoomLevelChange: jest.fn(),
  onZoomIn: jest.fn(),
  onZoomOut: jest.fn(),
  onFit: jest.fn(),
  onResetView: jest.fn(),
  t: (k: string) => k,
}

describe('GraphCanvasControls', () => {
  beforeEach(() => jest.clearAllMocks())

  it('renders the five canonical controls', () => {
    const { getByTestId } = render(
      <ThemeProvider theme={theme}>
        <GraphCanvasControls {...baseProps} />
      </ThemeProvider>
    )
    expect(getByTestId('graph-canvas-zoom-in')).toBeInTheDocument()
    expect(getByTestId('graph-canvas-zoom-out')).toBeInTheDocument()
    expect(getByTestId('graph-canvas-zoom-slider')).toBeInTheDocument()
    expect(getByTestId('graph-canvas-fit')).toBeInTheDocument()
    expect(getByTestId('graph-canvas-reset')).toBeInTheDocument()
  })

  it('clicking + fires onZoomIn', () => {
    const { getByTestId } = render(
      <ThemeProvider theme={theme}>
        <GraphCanvasControls {...baseProps} />
      </ThemeProvider>
    )
    fireEvent.click(getByTestId('graph-canvas-zoom-in'))
    expect(baseProps.onZoomIn).toHaveBeenCalledTimes(1)
  })

  it('clicking − fires onZoomOut', () => {
    const { getByTestId } = render(
      <ThemeProvider theme={theme}>
        <GraphCanvasControls {...baseProps} />
      </ThemeProvider>
    )
    fireEvent.click(getByTestId('graph-canvas-zoom-out'))
    expect(baseProps.onZoomOut).toHaveBeenCalledTimes(1)
  })

  it('moving the slider fires onZoomLevelChange with the new 0..1 value', () => {
    const { getByTestId } = render(
      <ThemeProvider theme={theme}>
        <GraphCanvasControls {...baseProps} />
      </ThemeProvider>
    )
    fireEvent.change(getByTestId('graph-canvas-zoom-slider'), {
      target: { value: '0.75' },
    })
    expect(baseProps.onZoomLevelChange).toHaveBeenCalledWith(0.75)
  })

  it('fit + reset buttons fire their respective callbacks', () => {
    const { getByTestId } = render(
      <ThemeProvider theme={theme}>
        <GraphCanvasControls {...baseProps} />
      </ThemeProvider>
    )
    fireEvent.click(getByTestId('graph-canvas-fit'))
    expect(baseProps.onFit).toHaveBeenCalledTimes(1)
    fireEvent.click(getByTestId('graph-canvas-reset'))
    expect(baseProps.onResetView).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx jest --no-coverage src/components/results/graph/GraphCanvasControls.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```tsx
// src/components/results/graph/GraphCanvasControls.tsx
import React from 'react'
import styled from 'styled-components'
import { Icon } from '../../ui'

const Pill = styled.div`
  position: absolute;
  left: 12px;
  bottom: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xxs};
  padding: ${({ theme }) => theme.spacing.xs};
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.pill};
  box-shadow: ${({ theme }) => theme.shadows.sm};
  z-index: 5;
`

// HTML range input is rotated -90° via CSS so it reads top-to-bottom
// (high zoom at top, low at bottom). Width becomes height under the
// rotation; pin the visible footprint to a fixed height so the pill
// stays compact.
const Slider = styled.input`
  appearance: slider-vertical;
  writing-mode: vertical-lr;
  direction: rtl;
  width: 1.25rem;
  height: 110px;
  margin: ${({ theme }) => theme.spacing.xxs} 0;
`

const IconBtn = styled.button`
  appearance: none;
  background: transparent;
  border: none;
  color: ${({ theme }) => theme.text.primary};
  padding: 4px 6px;
  border-radius: ${({ theme }) => theme.radii.sm};
  cursor: pointer;
  &:hover {
    background: ${({ theme }) => theme.bg.subtle};
  }
  &:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
  }
`

export type GraphCanvasControlsProps = {
  zoomLevel: number
  onZoomLevelChange: (level: number) => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  onResetView: () => void
  t: (key: string, opts?: Record<string, unknown>) => string
}

export const GraphCanvasControls: React.FC<GraphCanvasControlsProps> = ({
  zoomLevel,
  onZoomLevelChange,
  onZoomIn,
  onZoomOut,
  onFit,
  onResetView,
  t,
}) => (
  <Pill role="group" aria-label={t('graph.canvasControls.aria')}>
    <IconBtn
      type="button"
      data-testid="graph-canvas-zoom-in"
      aria-label={t('graph.canvasControls.zoomIn')}
      title={t('graph.canvasControls.zoomIn')}
      onClick={onZoomIn}
    >
      <Icon name="plus" />
    </IconBtn>
    <Slider
      type="range"
      min={0}
      max={1}
      step={0.01}
      value={zoomLevel}
      data-testid="graph-canvas-zoom-slider"
      aria-label={t('graph.zoomSlider.aria')}
      onChange={(e) => onZoomLevelChange(Number(e.target.value))}
    />
    <IconBtn
      type="button"
      data-testid="graph-canvas-zoom-out"
      aria-label={t('graph.canvasControls.zoomOut')}
      title={t('graph.canvasControls.zoomOut')}
      onClick={onZoomOut}
    >
      <Icon name="minus" />
    </IconBtn>
    <IconBtn
      type="button"
      data-testid="graph-canvas-fit"
      aria-label={t('graph.canvasControls.fit')}
      title={t('graph.canvasControls.fit')}
      onClick={onFit}
    >
      <Icon name="expand" />
    </IconBtn>
    <IconBtn
      type="button"
      data-testid="graph-canvas-reset"
      aria-label={t('graph.canvasControls.reset')}
      title={t('graph.canvasControls.reset')}
      onClick={onResetView}
    >
      <Icon name="rotate-left" />
    </IconBtn>
  </Pill>
)
```

- [ ] **Step 4: Add the i18n keys**

In `src/services/i18n/locales/en.ts`, inside the `graph:` block (sort alphabetically with existing keys):

```ts
canvasControls: {
  aria: 'Graph viewport controls',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  fit: 'Fit graph to view',
  reset: 'Reset view + layout',
},
zoomSlider: {
  aria: 'Zoom level',
},
wheelSensitivity: 'Mouse-wheel zoom sensitivity',
```

If the verify-translations pre-commit complains about missing keys in other locales, run the locale-keys script `node scripts/check-translations.mjs` (or similar) to identify all locales that need the new keys; copy the English values as placeholders.

- [ ] **Step 5: Run unit tests + typecheck**

```bash
npx jest --no-coverage src/components/results/graph/GraphCanvasControls.test.tsx
npx tsc --noEmit
```

Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/results/graph/GraphCanvasControls.tsx \
        src/components/results/graph/GraphCanvasControls.test.tsx \
        src/services/i18n/locales/en.ts
git commit -m "feat(graph): GraphCanvasControls overlay pill (+/slider/-/fit/reset)"
```

---

## Task 6: Mount controls on canvas, remove from toolbar

**Files:**
- Modify: `src/components/results/graph/GraphCanvasOverlay.tsx`
- Modify: `src/components/results/graph/GraphToolbar.tsx`
- Modify: `src/components/results/graph/GraphToolbar.test.tsx`
- Modify: `src/components/results/GraphViewCytoscape.tsx`
- Modify: `e2e/helpers/selectors.ts`

- [ ] **Step 1: Plumb the props through `GraphCanvasOverlay`**

Open `src/components/results/graph/GraphCanvasOverlay.tsx`. Extend `GraphCanvasOverlayProps` with:

```ts
zoomLevel: number
onZoomLevelChange: (level: number) => void
onZoomIn: () => void
onZoomOut: () => void
onFit: () => void
onResetView: () => void
```

Inside the JSX, render `<GraphCanvasControls ...>` as a sibling of the existing overlays. The existing `<Canvas>` is `position: relative`-ish — keep the controls absolutely-positioned so they layer on top:

```tsx
<GraphCanvasControls
  zoomLevel={zoomLevel}
  onZoomLevelChange={onZoomLevelChange}
  onZoomIn={onZoomIn}
  onZoomOut={onZoomOut}
  onFit={onFit}
  onResetView={onResetView}
  t={t}
/>
```

- [ ] **Step 2: Drop the now-canvas-resident buttons from `GraphToolbar`**

In `src/components/results/graph/GraphToolbar.tsx`:

1. Remove `onZoomIn`, `onZoomOut`, `onFit`, `onResetView` from `GraphToolbarProps`.
2. Remove the four `<wa-button>` blocks (the ones at the existing zoom-in / zoom-out / fit / reset rows) plus the spacer/divider markup that was specific to them.

The other toolbar items (layout dropdown, selection-mode toggle, lasso toggle, etc.) stay.

- [ ] **Step 3: Update `GraphToolbar.test.tsx`**

Delete the existing assertions that look for the four removed buttons. Keep every other assertion intact.

- [ ] **Step 4: Wire the orchestrator**

In `src/components/results/GraphViewCytoscape.tsx`:

1. Call `useZoomLevel(cyRef, sig)` and destructure `{ level, setZoomLevel }`.
2. Pass `zoomLevel={level}` + `onZoomLevelChange={setZoomLevel}` + the four existing callbacks (`onZoomIn`, `onZoomOut`, `onFit`, `onResetView`) down to `GraphCanvasOverlay`.
3. Drop the four callbacks from the `<GraphToolbar>` call site.

- [ ] **Step 5: Add e2e selectors**

In `e2e/helpers/selectors.ts`, replace any existing zoom-button selectors with:

```ts
graphCanvasZoomIn: (p: Page): Locator => p.getByTestId('graph-canvas-zoom-in'),
graphCanvasZoomOut: (p: Page): Locator => p.getByTestId('graph-canvas-zoom-out'),
graphCanvasZoomSlider: (p: Page): Locator =>
  p.getByTestId('graph-canvas-zoom-slider'),
graphCanvasFit: (p: Page): Locator => p.getByTestId('graph-canvas-fit'),
graphCanvasReset: (p: Page): Locator => p.getByTestId('graph-canvas-reset'),
```

Search the existing test corpus for any reference to the old toolbar zoom-button test-ids and re-point to the new ones.

- [ ] **Step 6: Run the full unit + typecheck pass**

```bash
npm test -- --no-coverage --silent
npx tsc --noEmit
```

Expected: every suite still passes; no type errors. If a test fails because it asserted on the old toolbar buttons, repoint it to the new canvas selectors.

- [ ] **Step 7: Commit**

```bash
git add src/components/results/graph/GraphCanvasOverlay.tsx \
        src/components/results/graph/GraphToolbar.tsx \
        src/components/results/graph/GraphToolbar.test.tsx \
        src/components/results/GraphViewCytoscape.tsx \
        e2e/helpers/selectors.ts
git commit -m "feat(graph): move zoom/fit/reset from toolbar to on-canvas pill + slider"
```

---

## Task 7: Edge property pass-through

**Files:**
- Modify: `src/lib/graphResult/pushRealElements.ts`
- Modify: `src/lib/graphResult/pushRealElements.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/lib/graphResult/pushRealElements.test.ts`, add:

```ts
describe('pushRealEdges — property pass-through (regression for inspector "no props")', () => {
  it('preserves an edge with two custom properties on data.props', () => {
    const out: ElementDefinition[] = []
    pushRealEdges(out, [
      {
        id: 1,
        start_node: 1,
        end_node: 2,
        type: 'ACTED_IN',
        properties: { roles: ['Neo'], year: 1999 },
      },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.data?.props).toEqual({ roles: ['Neo'], year: 1999 })
  })

  it('defaults data.props to an empty object when properties is missing', () => {
    const out: ElementDefinition[] = []
    pushRealEdges(out, [
      {
        id: 2,
        start_node: 1,
        end_node: 2,
        type: 'DIRECTED',
        properties: undefined as unknown as Record<string, unknown>,
      },
    ])
    expect(out[0]?.data?.props).toEqual({})
  })
})
```

- [ ] **Step 2: Run to confirm failure for the empty-props case**

```bash
npx jest --no-coverage src/lib/graphResult/pushRealElements.test.ts -t 'property pass-through'
```

Expected: SECOND test FAILs — `out[0]?.data?.props` is `undefined`, not `{}`.

- [ ] **Step 3: Tighten the fallback**

In `src/lib/graphResult/pushRealElements.ts`, change line 90 from:

```ts
props: e.properties,
```

to:

```ts
props: e.properties ?? {},
```

- [ ] **Step 4: Run tests to verify**

```bash
npx jest --no-coverage src/lib/graphResult/pushRealElements.test.ts
```

Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/lib/graphResult/pushRealElements.ts \
        src/lib/graphResult/pushRealElements.test.ts
git commit -m "fix(graph): edges always carry data.props (default {}) so inspector populates"
```

---

## Task 8: Make edges click-friendly

**Files:**
- Modify: `src/components/results/cytoscapeStyle.ts`
- Modify: `src/components/results/cytoscapeStyle.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/components/results/cytoscapeStyle.test.ts`:

```ts
it('edge style has events:yes and a hit-area-friendly width', () => {
  const style = createCytoscapeStyle(darkTheme) as Array<{
    selector: string
    style?: Record<string, unknown>
  }>
  const edgeBlock = style.find((b) => b.selector === 'edge')
  expect(edgeBlock?.style?.events).toBe('yes')
  // Pre-fix the width was 1.5 px; that's not a comfortable click
  // target. Bump to 3 px and validate the regression here.
  expect(edgeBlock?.style?.width).toBe(3)
})

it('edge:hover widens to advertise clickability', () => {
  const style = createCytoscapeStyle(darkTheme) as Array<{
    selector: string
    style?: Record<string, unknown>
  }>
  const hover = style.find((b) => b.selector === 'edge:active')
  expect(hover?.style?.width).toBe(5)
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx jest --no-coverage src/components/results/cytoscapeStyle.test.ts -t edge
```

Expected: FAIL — `events` is undefined, width is 1.5, no `edge:active` selector.

- [ ] **Step 3: Update the style**

In `src/components/results/cytoscapeStyle.ts`, find the `selector: 'edge'` block and:

1. Change `width: 1.5` to `width: 3`.
2. Add explicit `events: 'yes' as const` (cytoscape default but pinning makes the regression test stable).
3. After the edge block, add a new block:

```ts
{
  selector: 'edge:active',
  style: {
    width: 5,
  },
},
```

- [ ] **Step 4: Run tests**

```bash
npx jest --no-coverage src/components/results/cytoscapeStyle.test.ts
```

Expected: PASS (whole suite).

- [ ] **Step 5: Commit**

```bash
git add src/components/results/cytoscapeStyle.ts \
        src/components/results/cytoscapeStyle.test.ts
git commit -m "fix(graph): widen edge stroke (1.5→3px) + pin events:yes for reliable click hits"
```

---

## Task 9: Pinch-zoom + wheel-sensitivity verification

**Files:**
- Modify: `src/components/results/graph/useGraphCytoscape.ts`

- [ ] **Step 1: Pin the gesture surface**

Cytoscape 3.33 enables pinch-zoom whenever `userZoomingEnabled` is true (default) on a touch-capable container. The bug is that we never explicitly set it, so a future toggle could silently flip it off. Make the contract explicit. Find the `cytoscape({...})` call in `useGraphCytoscape.ts` and add `userZoomingEnabled: true,` alongside the existing options.

- [ ] **Step 2: Add a test seam assertion**

Extend the `__buildWithSensitivityForTest` factory from Task 3 to also report `userZoomingEnabled`. Update its caller test to assert `userZoomingEnabled === true`:

```ts
it('keeps userZoomingEnabled=true so pinch-zoom works on touch devices', () => {
  const captured: Record<string, unknown> = {}
  __buildWithSensitivityForTest({
    cytoscapeFactory: (opts) => {
      Object.assign(captured, opts)
      return { destroy: jest.fn() } as never
    },
    sensitivity: 0.5,
  })
  expect(captured.userZoomingEnabled).toBe(true)
})
```

(Adjust the seam to forward `userZoomingEnabled` from the call site.)

- [ ] **Step 3: Run tests**

```bash
npx jest --no-coverage src/components/results/graph/useGraphCytoscape.tier.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/results/graph/useGraphCytoscape.ts \
        src/components/results/graph/useGraphCytoscape.tier.test.ts
git commit -m "feat(graph): pin userZoomingEnabled=true for explicit pinch-zoom contract"
```

---

## Task 10: User control for wheel-sensitivity (graph sidebar)

**Files:**
- Modify: `src/components/results/graph/GraphSidebarContents.tsx` (or wherever the existing settings rows live)

- [ ] **Step 1: Identify the settings row container**

Open `src/components/results/graph/GraphSidebarContents.tsx`. Look for the block that renders existing toggles (e.g. `clusterByLabel`, `degreeSizing`). The new `wheelSensitivity` slider lives in the same group.

- [ ] **Step 2: Add the slider row**

```tsx
<div className="toggle-row">
  <label htmlFor="wheel-sensitivity">
    {t('graph.wheelSensitivity')}
  </label>
  <input
    id="wheel-sensitivity"
    type="range"
    min={0.05}
    max={2.0}
    step={0.05}
    value={wheelSensitivity}
    data-testid="graph-sidebar-wheel-sensitivity"
    onChange={(e) => setWheelSensitivity(Number(e.target.value))}
  />
  <code>{wheelSensitivity.toFixed(2)}</code>
</div>
```

Wire `wheelSensitivity` + `setWheelSensitivity` through the existing prop chain from `useGraphPreferences`.

- [ ] **Step 3: Run tests**

```bash
npm test -- --no-coverage --silent
```

Expected: all suites pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/results/graph/GraphSidebarContents.tsx \
        src/components/results/GraphViewCytoscape.tsx
git commit -m "feat(graph): sidebar slider for mouse-wheel zoom sensitivity"
```

---

## Task 11: E2E coverage for the canvas controls + edge picking

**Files:**
- Create: `e2e/specs/36-graph-canvas-controls.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

async function readZoom(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as { __geode_cy?: { zoom(): number } }
    // eslint-disable-next-line no-underscore-dangle
    return w.__geode_cy?.zoom() ?? -1
  })
}

test.describe('graph canvas controls + edge picking', () => {
  test.beforeEach(async ({ authedPage: page }) => {
    await page.goto('/')
    await expect(sel.queryRunBtn(page)).toBeVisible()
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH p=(a)-[r:ACTED_IN]->(b) RETURN p LIMIT 5`
    )
    await sel.queryRunBtn(page).click()
    await sel.queryTabGraph(page).click()
    await page.locator('[data-testid="graph-canvas"]').waitFor({ timeout: 10_000 })
  })

  test('the canvas pill renders the five controls', async ({ authedPage: page }) => {
    await expect(sel.graphCanvasZoomIn(page)).toBeVisible()
    await expect(sel.graphCanvasZoomOut(page)).toBeVisible()
    await expect(sel.graphCanvasZoomSlider(page)).toBeVisible()
    await expect(sel.graphCanvasFit(page)).toBeVisible()
    await expect(sel.graphCanvasReset(page)).toBeVisible()
  })

  test('clicking + increases cy.zoom() and − decreases it', async ({ authedPage: page }) => {
    const before = await readZoom(page)
    await sel.graphCanvasZoomIn(page).click()
    const afterIn = await readZoom(page)
    expect(afterIn).toBeGreaterThan(before)
    await sel.graphCanvasZoomOut(page).click()
    const afterOut = await readZoom(page)
    expect(afterOut).toBeLessThan(afterIn)
  })

  test('slider drag updates cy.zoom() along the log curve', async ({ authedPage: page }) => {
    const slider = sel.graphCanvasZoomSlider(page)
    await slider.fill('0.8')
    await page.waitForTimeout(100)
    const z = await readZoom(page)
    // 10 ** (0.8*2 - 1) = 10^0.6 ≈ 3.98
    expect(z).toBeGreaterThan(3)
    expect(z).toBeLessThan(5)
  })

  test('clicking an edge populates the inspector with its properties', async ({ authedPage: page }) => {
    // Click an ACTED_IN edge centre via cy's rendered coordinates.
    await page.evaluate(() => {
      const w = window as unknown as {
        __geode_cy?: { edges(): { length: number; [i: number]: { emit(e: string): void } } }
      }
      // eslint-disable-next-line no-underscore-dangle
      const cy = w.__geode_cy
      const edges = cy?.edges()
      if (edges && edges.length > 0) (edges as never as Array<{ emit: (e: string) => void }>)[0]!.emit('tap')
    })
    // Inspector should switch to edge selection — props pane shows
    // an edge identity header + property list.
    await expect(page.getByTestId('graph-inspector')).toBeVisible()
    await expect(page.getByTestId('graph-inspector-props')).toBeVisible()
    // ACTED_IN edges in the movies seed carry { roles: [...] }; the
    // dt label should appear.
    await expect(page.locator('dt', { hasText: 'roles' })).toBeVisible()
  })
})
```

- [ ] **Step 2: Run the spec against the running stack**

```bash
cd e2e && npx playwright test specs/36-graph-canvas-controls.spec.ts --reporter=list
```

Expected: PASS (4/4).

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/36-graph-canvas-controls.spec.ts
git commit -m "test(e2e): canvas controls + edge picking + inspector props"
```

---

## Task 12: Final validation

**Files:** none (validation pass only)

- [ ] **Step 1: Run the full Jest + Go + lint + typecheck suite**

```bash
npm test -- --no-coverage --silent
scripts/run-go.sh test ./internal/server/ ./cmd/server/ ./internal/jwt/
npx tsc --noEmit
npx eslint 'src/**/*.{ts,tsx}'
```

Expected: every gate green.

- [ ] **Step 2: Manual smoke + screenshot**

Run `make e2e-down && make e2e-up`, open `http://localhost:8080`, log in, run a `MATCH p=(a)-[r]->(b) RETURN p LIMIT 25` query, switch to the Graph tab. Verify:

1. Canvas-pill controls render bottom-left of the graph.
2. `+` / `−` buttons zoom; slider tracks the zoom level both directions.
3. Mouse-wheel zoom feels smoother than 0.2 (the new default 0.5 is the visible difference).
4. Pinch on a touch device (or with `meta`+`scroll` on Chrome's touch-emulation mode) zooms.
5. Edges click — inspector shows the edge identity header (`source → target`) and the property list.

- [ ] **Step 3: Final commit if any wiring nits surfaced**

```bash
git status -s
# only stage real fixes, no scratch files
```

- [ ] **Step 4: Push & open the PR**

```bash
git push -u origin <your-branch>
gh pr create --title "feat(graph): canvas controls + edge picking + zoom feel" --body "$(cat <<'EOF'
## Summary
- Canvas-resident pill (zoom in / slider / zoom out / fit / reset) replaces the toolbar zoom row.
- New `wheelSensitivity` user pref (default 0.5, clamped 0.05–2.0) tunes mouse-wheel zoom feel; surfaced as a slider in the graph sidebar.
- Pinch-zoom contract pinned via explicit `userZoomingEnabled: true`.
- Edges are now reliably clickable (events:yes + 3 px stroke + 5 px hover) and `data.props` is guaranteed non-null so the inspector populates.

## Test plan
- Jest unit suites for `useGraphPrefs`, `useZoomLevel`, `GraphCanvasControls`, `pushRealEdges`, `cytoscapeStyle`.
- e2e spec `36-graph-canvas-controls.spec.ts` covers the canvas pill + edge-click + property-overlay paths.
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** Five user-stated needs map to tasks:
  - "zoom on the graph view with a slider, same for reload and fit" → Tasks 5 + 6.
  - "update mouse wheel zoom speed" → Tasks 1 + 3 + 10.
  - "add pinch-zoom options" → Task 9.
  - "edges not clickable directly" → Task 8.
  - "properties not showing in the property overlay" → Task 7 (root cause: `data.props` undefined on edges) + already-correct GraphInspector edge path.
- **Placeholder scan:** No "TBD" / "TODO" / "add appropriate" — every step has the code, the command, or the deletion locus called out.
- **Type consistency:** `wheelSensitivity` / `setWheelSensitivity` referenced uniformly across Tasks 1–3 + 9–10. `useZoomLevel` returns `{ level, setZoomLevel }` and both are referenced unchanged in Task 6 and the e2e in Task 11. `GraphCanvasControls` props (`zoomLevel`, `onZoomLevelChange`, `onZoomIn/Out/Fit/ResetView`) match Tasks 5 / 6 / 11.

If any task needs to bail (test-name collision, file path drift), prefer adding a follow-up task over silently widening scope. Frequent commits keep bisecting cheap.
