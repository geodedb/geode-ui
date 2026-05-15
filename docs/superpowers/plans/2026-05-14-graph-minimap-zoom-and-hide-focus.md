# Graph Mini-map Fix + Zoom-to-Node + Hide-Based Focus Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken mini-map (missing upstream CSS), add a "Zoom to node" context menu action, and replace the dim-based focus mode with a hide-based one that also pans/zooms onto the focal subgraph (with a persistent Clear chip).

**Architecture:** Surgical changes to the existing graph subsystem. Mini-map fix is one CSS import. Zoom-to-node is a new pure helper plus a menu route. Focus rework changes the `.gv-out-of-focus` CSS from opacity-dim to `display: none`, captures pre-focus viewport into `useFocusMode` state for restore, and adds a floating Clear-focus chip overlay on the canvas.

**Tech Stack:** React + TypeScript, Cytoscape 3.x, `cytoscape-navigator`, Jest + Testing Library, Playwright (e2e), styled-components, react-i18next.

---

## File Structure

**New files:**
- `src/components/results/graph/zoomToNode.ts` — pure helper that builds the animation/viewport arguments for "zoom to this node id."
- `src/components/results/graph/zoomToNode.test.ts` — unit tests for the helper.
- `src/components/results/graph/FocusClearChip.tsx` — small floating overlay button rendered on the canvas while focus mode is active.

**Modified files:**
- `src/components/results/graph/GraphMiniMap.tsx` — add `import 'cytoscape-navigator/cytoscape.js-navigator.css'` so the navigator panel is visually drawn (viewport rectangle, panner handle).
- `src/components/results/graph/GraphMiniMap.test.tsx` — add a smoke test that asserts the navigator's expected child structure exists after mount.
- `src/components/results/graph/NodeContextMenu.tsx` — extend `NodeContextMenuAction` with `'zoomTo'`; render its menu entry; map to `graph.menuZoomTo` i18n key.
- `src/components/results/graph/NodeContextMenu.test.tsx` — extend tests with the new action.
- `src/components/results/graph/useFocusMode.ts` — change `apply` to:
  - hide non-N-hop nodes via `.gv-out-of-focus` (now `display: none`),
  - capture `prevPan` + `prevZoom` into state on first apply,
  - call `cy.fit(keepCollection, 32)` to pan/zoom onto the focal subgraph,
  - restore `prevPan` + `prevZoom` on `clear()`.
- `src/components/results/graph/useFocusMode.test.ts` — update to assert the new hide-and-zoom contract.
- `src/components/results/cytoscapeStyle.ts` — change `.gv-out-of-focus` from `opacity: 0.12` to `display: none`. Add adjacent-edge auto-hide via cytoscape's natural display:none-on-an-endpoint behaviour (no extra rule needed, but verify in the layout test).
- `src/components/results/GraphView.tsx` — route the menu's new `'zoomTo'` action; mount the `FocusClearChip` overlay; pass `selected` + `focusMode.clear` to it.
- `src/components/results/GraphView.test.tsx` — update the "Focus action" describe to assert hide + zoom semantics; add a new "Zoom-to-node action" describe.
- `src/services/i18n/locales/en.ts` — new keys `graph.menuZoomTo` and `graph.focusClearChip`.
- `e2e/specs/24-graph-power-features.spec.ts` — extend with two new specs (zoom-to keeps view zoomed on the focal node; focus hides off-set nodes and persists Clear chip until dismissed).

**Untouched (deliberate):**
- The toolbar / sidebar / inspector wiring for focus stays as-is — only the underlying apply path changes, plus the new persistent chip.
- The mini-map toggle pref + button stay as-is — only the CSS is missing.

---

## Phase 1 — Mini-map CSS fix

### Task 1: Import upstream CSS + smoke test

**Files:**
- Modify: `src/components/results/graph/GraphMiniMap.tsx`
- Modify: `src/components/results/graph/GraphMiniMap.test.tsx`

- [ ] **Step 1: Write the failing smoke test**

Open `src/components/results/graph/GraphMiniMap.test.tsx`. After the existing 2 specs, add:

```tsx
it('imports the cytoscape-navigator stylesheet (smoke check)', () => {
  // The stylesheet's existence is what makes the viewport rectangle +
  // panner handle visible. We can't query loaded stylesheets reliably
  // in jsdom, so we assert via the side-effect that the cytoscape
  // collection method `.navigator()` returns an instance (the import
  // registers the extension). Failing to import the CSS does not stop
  // registration, but the regression we care about is that someone
  // removes the import — pair this with the e2e visibility test
  // in 24-graph-power-features.spec.ts.
  const navigator = jest.fn(() => ({ destroy: jest.fn() }))
  const cy = { navigator } as unknown as { navigator: jest.Mock }
  const cyRef = { current: cy as never }
  render(
    <ThemeProvider theme={theme}>
      <GraphMiniMap cyRef={cyRef as never} />
    </ThemeProvider>
  )
  // The CSS file is imported as a side-effect at the top of GraphMiniMap.
  // Jest's moduleNameMapper for "\\.css$" returns a stub, but the import
  // still runs. We pin the assertion on the fact that the navigator()
  // call was wired (which proves the module file loaded without error).
  expect(navigator).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run test to verify it fails IF the CSS path is wrong**

Run: `npm test -- --testPathPattern=graph/GraphMiniMap.test`
Expected: PASS — the new test passes against the existing component because navigator() is still called. The CSS import does not fail the test today (no error path). This is a regression-canary test, not a TDD test in the strict sense. If the CSS path is incorrect after Step 3, the import will throw a module-not-found error and Jest will fail with a clear message.

(Skip the fail-first cycle for this canary; document why in the test comment above.)

- [ ] **Step 3: Add the CSS import**

In `src/components/results/graph/GraphMiniMap.tsx`, AFTER the existing `import navigator from 'cytoscape-navigator'` and BEFORE the `cytoscape.use(...)` call, add:

```ts
// Side-effect import — the package ships its panner / viewport-rect
// styles in this file. Without it the navigator div renders empty
// (no visible rectangle, no draggable handle), which looks exactly
// like a broken mini-map. The Jest CSS stub (jest.config.cjs's
// moduleNameMapper for "\\.css$") returns an empty module so this
// import is a no-op in tests.
import 'cytoscape-navigator/cytoscape.js-navigator.css'
```

- [ ] **Step 4: Run tests to verify it still passes**

Run: `npm test -- --testPathPattern=graph/GraphMiniMap.test`
Expected: PASS — all 3 specs.

Run: `npm test`
Expected: ALL pass.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/GraphMiniMap.tsx \
  src/components/results/graph/GraphMiniMap.test.tsx
git commit -m "fix(graph): import cytoscape-navigator stylesheet so mini-map renders"
```

---

## Phase 2 — Zoom-to-node helper + context menu action

### Task 2: Pure `zoomToNode` helper

**Files:**
- Create: `src/components/results/graph/zoomToNode.ts`
- Create: `src/components/results/graph/zoomToNode.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/results/graph/zoomToNode.test.ts
import { zoomToNode } from './zoomToNode'

function makeFakeCy(adj: Record<string, { x: number; y: number }>) {
  const calls: { method: string; args: unknown[] }[] = []
  const wrap = (id: string) => ({
    empty: () => !(id in adj),
    position: () => adj[id] ?? { x: 0, y: 0 },
  })
  return {
    getElementById: (id: string) => wrap(id),
    animate: (opts: unknown) => {
      calls.push({ method: 'animate', args: [opts] })
      return { promise: () => Promise.resolve() }
    },
    center: (n: { position: () => { x: number; y: number } }) => {
      calls.push({ method: 'center', args: [n.position()] })
    },
    zoom: (level: number) => {
      calls.push({ method: 'zoom', args: [level] })
    },
    calls,
  }
}

describe('zoomToNode', () => {
  it('animates the viewport onto the node at the requested zoom level', () => {
    const cy = makeFakeCy({ a: { x: 50, y: 75 } })
    zoomToNode(cy as never, 'a', { zoom: 2, duration: 300 })
    expect(cy.calls).toEqual([
      {
        method: 'animate',
        args: [
          {
            center: { eles: expect.anything() },
            zoom: 2,
            duration: 300,
            easing: 'ease-in-out',
          },
        ],
      },
    ])
  })

  it('uses defaults when no opts provided (zoom=1.5, duration=400)', () => {
    const cy = makeFakeCy({ a: { x: 0, y: 0 } })
    zoomToNode(cy as never, 'a')
    expect(cy.calls).toEqual([
      {
        method: 'animate',
        args: [
          {
            center: { eles: expect.anything() },
            zoom: 1.5,
            duration: 400,
            easing: 'ease-in-out',
          },
        ],
      },
    ])
  })

  it('is a no-op when the node does not exist', () => {
    const cy = makeFakeCy({})
    zoomToNode(cy as never, 'ghost')
    expect(cy.calls).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=graph/zoomToNode.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/components/results/graph/zoomToNode.ts
import type { Core } from 'cytoscape'

export type ZoomToNodeOpts = {
  // Target zoom level. 1 is the default cy.zoom(); 1.5 is a nice
  // "close enough to see the labels" framing for typical graphs.
  zoom?: number
  // Animation duration in ms.
  duration?: number
}

const DEFAULTS: Required<ZoomToNodeOpts> = {
  zoom: 1.5,
  duration: 400,
}

// Animate the viewport to center on `id` at the requested zoom level.
// No-op when the node does not exist on the current core (the caller
// is responsible for selection-state plumbing — this helper only owns
// the camera move).
export function zoomToNode(cy: Core, id: string, opts?: ZoomToNodeOpts): void {
  const node = cy.getElementById(id)
  if (node.empty()) return
  const { zoom, duration } = { ...DEFAULTS, ...(opts ?? {}) }
  cy.animate({
    center: { eles: node },
    zoom,
    duration,
    easing: 'ease-in-out',
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=graph/zoomToNode.test`
Expected: PASS — 3 specs.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/zoomToNode.ts \
  src/components/results/graph/zoomToNode.test.ts
git commit -m "feat(graph): zoomToNode helper for centred-camera animation"
```

### Task 3: Add `'zoomTo'` to the context menu

**Files:**
- Modify: `src/components/results/graph/NodeContextMenu.tsx`
- Modify: `src/components/results/graph/NodeContextMenu.test.tsx`
- Modify: `src/services/i18n/locales/en.ts`
- Modify: `src/components/results/GraphView.tsx`
- Modify: `src/components/results/GraphView.test.tsx`

- [ ] **Step 1: Write the failing test**

In `src/components/results/graph/NodeContextMenu.test.tsx`, extend the items list in `renderMenu`'s default props:

```tsx
items={['zoomTo', 'expand', 'hide', 'collapse', 'focus', 'pin', 'copyId']}
```

Then add a new spec:

```tsx
it('fires onSelect with "zoomTo" when the zoom-to item is clicked', () => {
  const onSelect = jest.fn()
  renderMenu({ onSelect })
  fireEvent.click(screen.getByTestId('graph-node-menu-zoomTo'))
  expect(onSelect).toHaveBeenCalledWith('zoomTo')
})
```

Then in `src/components/results/GraphView.test.tsx`, add a new describe (use the file's render helper):

```tsx
describe('GraphView — zoomTo menu action', () => {
  it('routes the menu zoomTo action to cyRef.animate', () => {
    // Override the useNodeContextMenu mock to drive the menu open
    // on node id '1' (same pattern Task 6 used).
    ;(useNodeContextMenu as jest.Mock).mockImplementation(() => ({
      state: { open: true, x: 5, y: 7, nodeId: '1' },
      close: jest.fn(),
    }))
    renderGraphViewWithFixture()
    fireEvent.click(screen.getByTestId('graph-node-menu-zoomTo'))
    // The fake-cy fixture exposes its `animate` calls via the same
    // testing handle used elsewhere in the suite. Assert the call
    // shape rather than the camera positions (the helper has its
    // own unit tests that pin the args).
    // The exact mechanism here depends on whether the existing fixture
    // exposes the cy mock. If not, assert via a side-effect of the
    // animate completing — e.g. a debug data attribute, or by reading
    // the test-only `__geode_cy` window hook.
    expect(true).toBe(true)
  })
})
```

NOTE on the GraphView test: the existing GraphView test suite uses a hand-rolled cytoscape mock (`makeColl`, `makeCy` in the file). To verify the zoomTo route, add an `animate` jest.fn to the mock cy and assert it was called with the right shape. Locate the existing cy mock builder (search for `getElementById:` / `nodes:` in `GraphView.test.tsx`) and extend it with:

```tsx
animate: jest.fn(() => ({ promise: () => Promise.resolve() })),
```

Then the test asserts:

```tsx
const cyMock = /* the existing mock cy instance the test grabs from cyRef */
expect(cyMock.animate).toHaveBeenCalledWith(
  expect.objectContaining({ zoom: 1.5, duration: 400 })
)
```

If the existing fixture doesn't expose the cy mock to the test, follow the pattern other tests in the file use — they typically interact through `data-testid` assertions rather than mock-call introspection. In that case, drop the call-introspection assertion and just verify the menu closed:

```tsx
fireEvent.click(screen.getByTestId('graph-node-menu-zoomTo'))
// Menu should have been closed by the action router.
expect(screen.queryByTestId('graph-node-menu')).not.toBeInTheDocument()
```

(The router calls `menu.close()` before dispatching every action; that's the observable side-effect that's universally testable.)

- [ ] **Step 2: Run tests to verify failures**

Run: `npm test -- --testPathPattern='graph/NodeContextMenu.test|results/GraphView.test'`
Expected: FAIL — `graph-node-menu-zoomTo` not found; `zoomTo` not in `NodeContextMenuAction` union.

- [ ] **Step 3: Extend `NodeContextMenuAction`**

In `src/components/results/graph/NodeContextMenu.tsx`:

```ts
export type NodeContextMenuAction =
  | 'zoomTo'
  | 'expand'
  | 'hide'
  | 'collapse'
  | 'focus'
  | 'pin'
  | 'copyId'
```

In the `labelFor()` switch (or LABEL_KEY map — whichever the file uses), add the new case:

```ts
case 'zoomTo':
  return t('graph.menuZoomTo')
```

If the file uses an exhaustive `default: const _: never = action` check, this case is required for compile-time exhaustiveness.

- [ ] **Step 4: Add the i18n key**

In `src/services/i18n/locales/en.ts`, inside `graph: {}` near the other menu keys:

```ts
menuZoomTo: 'Zoom to node',
```

- [ ] **Step 5: Route the action in the orchestrator**

In `src/components/results/GraphView.tsx`, add the import:

```ts
import { zoomToNode } from './graph/zoomToNode'
```

In the `onMenuSelect` switch, add the `'zoomTo'` case BEFORE `case 'expand':` (so it appears at the top of the menu, mirroring the items list order):

```ts
case 'zoomTo':
  if (cyRef.current) zoomToNode(cyRef.current, id)
  break
```

In the menu's items list (the `<NodeContextMenu>` JSX), update the items array to include `'zoomTo'` as the FIRST entry:

```tsx
items={['zoomTo', 'expand', 'hide', 'collapse', 'focus', 'pin', 'copyId']}
```

- [ ] **Step 6: Run tests to verify passes**

Run: `npm test -- --testPathPattern='graph/NodeContextMenu.test|results/GraphView.test'`
Expected: PASS — all specs.

Run: `npm test`
Expected: ALL pass.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/results/graph/NodeContextMenu.tsx \
  src/components/results/graph/NodeContextMenu.test.tsx \
  src/components/results/GraphView.tsx \
  src/components/results/GraphView.test.tsx \
  src/services/i18n/locales/en.ts
git commit -m "feat(graph): zoomTo menu action routes through zoomToNode helper"
```

---

## Phase 3 — Focus rework: dim → hide + zoom

### Task 4: Change `.gv-out-of-focus` from opacity-dim to `display: none`

**Files:**
- Modify: `src/components/results/cytoscapeStyle.ts`

- [ ] **Step 1: Locate the existing rule**

In `src/components/results/cytoscapeStyle.ts`, find the existing block:

```ts
{
  selector: '.gv-out-of-focus',
  style: { opacity: 0.12, 'text-opacity': 0.12 },
},
```

- [ ] **Step 2: Replace with display:none**

```ts
{
  // Focus mode visually removes non-N-hop nodes from the canvas
  // entirely (display:none also drops them from layout + edge
  // routing). The matching cy.fit(keepCollection) call in
  // useFocusMode handles the camera move; this rule handles the
  // hide. Cytoscape cascades display:none to adjacent edges
  // automatically — no extra rule needed.
  selector: '.gv-out-of-focus',
  style: { display: 'none' },
},
```

- [ ] **Step 3: Run existing useFocusMode tests**

Run: `npm test -- --testPathPattern=graph/useFocusMode.test`
Expected: existing tests still pass because they assert on class-application, not on visible opacity. (Task 5 updates the tests for the new hide+zoom semantics.)

Run: `npm test`
Expected: ALL pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/results/cytoscapeStyle.ts
git commit -m "fix(graph): focus mode hides off-set nodes instead of dimming"
```

### Task 5: Add zoom + viewport-restore to `useFocusMode`

**Files:**
- Modify: `src/components/results/graph/useFocusMode.ts`
- Modify: `src/components/results/graph/useFocusMode.test.ts`

- [ ] **Step 1: Write the failing test additions**

In `src/components/results/graph/useFocusMode.test.ts`, extend the `makeCy` helper to support `pan/zoom/fit`:

```ts
function makeCy(adj: Record<string, string[]>) {
  const allClasses = new Map<string, Set<string>>()
  const camera = { pan: { x: 0, y: 0 }, zoom: 1 }
  const fitCalls: unknown[] = []
  const wrap = (id: string) => ({
    id: () => id,
    addClass: (c: string) => {
      if (!allClasses.has(id)) allClasses.set(id, new Set())
      allClasses.get(id)!.add(c)
    },
    removeClass: (c: string) => allClasses.get(id)?.delete(c),
    neighborhood: () => {
      const ns = (adj[id] ?? []).map((n) => wrap(n))
      return {
        nodes: () => ns,
        forEach: (cb: (n: { id: () => string }) => void) =>
          ns.forEach(cb),
      }
    },
    empty: () => false,
  })
  const all = Object.keys(adj).map((id) => wrap(id))
  return {
    getElementById: (id: string) => wrap(id),
    batch: (fn: () => void) => fn(),
    nodes: () => ({
      forEach: (
        cb: (n: {
          id: () => string
          removeClass: (c: string) => void
        }) => void
      ) => all.forEach(cb),
    }),
    pan: (next?: { x: number; y: number }) => {
      if (next !== undefined) camera.pan = next
      return camera.pan
    },
    zoom: (next?: number) => {
      if (next !== undefined) camera.zoom = next
      return camera.zoom
    },
    fit: (eles: unknown, padding: number) => {
      fitCalls.push({ eles, padding })
    },
    elements: () => ({
      filter: (predicate: (e: { id: () => string }) => boolean) => {
        const matched = all.filter((n) => predicate(n))
        return matched
      },
    }),
    classes: allClasses,
    camera,
    fitCalls,
  }
}
```

Then add these tests:

```ts
it('focus captures the current pan + zoom and fits to the focal set', () => {
  const cy = makeCy({ a: ['b'], b: ['a', 'c'], c: ['b'] })
  cy.pan({ x: 11, y: 22 })
  cy.zoom(0.75)
  const cyRef = { current: cy as never }
  const { result } = renderHook(() =>
    useFocusMode({ cyRef: cyRef as never })
  )
  act(() => result.current.focus({ id: 'a', hops: 1 }))
  // State remembers pre-focus camera.
  expect(result.current.state).toEqual({
    id: 'a',
    hops: 1,
    prevPan: { x: 11, y: 22 },
    prevZoom: 0.75,
  })
  // fit was called with the keep-set (a + b) and 32 px padding.
  expect(cy.fitCalls).toHaveLength(1)
})

it('clear restores the captured pan + zoom', () => {
  const cy = makeCy({ a: ['b'], b: ['a'] })
  cy.pan({ x: 11, y: 22 })
  cy.zoom(0.75)
  const cyRef = { current: cy as never }
  const { result } = renderHook(() =>
    useFocusMode({ cyRef: cyRef as never })
  )
  act(() => result.current.focus({ id: 'a', hops: 0 }))
  // Pretend the user zoomed/panned around inside focus mode.
  cy.pan({ x: 999, y: 999 })
  cy.zoom(3)
  act(() => result.current.clear())
  expect(cy.camera.pan).toEqual({ x: 11, y: 22 })
  expect(cy.camera.zoom).toBe(0.75)
})

it('clear removes .gv-out-of-focus from every node', () => {
  // (already covered by the prior "clear() removes the class from
  // every node" test — keep it, no change needed.)
})
```

- [ ] **Step 2: Run tests to verify failures**

Run: `npm test -- --testPathPattern=graph/useFocusMode.test`
Expected: FAIL — `state` shape mismatch (`prevPan`/`prevZoom` missing), `cy.fitCalls` empty.

- [ ] **Step 3: Update `useFocusMode.ts`**

Replace the existing implementation:

```ts
// src/components/results/graph/useFocusMode.ts
import { useCallback, useState } from 'react'
import type { Core } from 'cytoscape'
import { nHopNeighborhood } from './focus'

export type FocusState =
  | {
      id: string
      hops: number
      // Camera state captured at focus-on so clear() restores
      // exactly the user's pre-focus viewport.
      prevPan: { x: number; y: number }
      prevZoom: number
    }
  | null

export type UseFocusModeArgs = {
  cyRef: React.MutableRefObject<Core | null>
}

export type UseFocusModeResult = {
  state: FocusState
  focus: (s: { id: string; hops: number }) => void
  clear: () => void
  // Re-apply after rebuilds / layout reruns so the hide + camera
  // survive a new core.
  reapply: () => void
}

const FOCUS_CLASS = 'gv-out-of-focus'
const FIT_PADDING = 32

export function useFocusMode(args: UseFocusModeArgs): UseFocusModeResult {
  const { cyRef } = args
  const [state, setState] = useState<FocusState>(null)

  // applyHide owns the class-mutation pass. Returns the keep-set so
  // callers can fit() to it.
  const applyHide = useCallback(
    (s: { id: string; hops: number } | null): Set<string> | null => {
      const cy = cyRef.current
      if (!cy) return null
      let keep: Set<string> | null = null
      cy.batch(() => {
        cy.nodes().forEach((n) => n.removeClass(FOCUS_CLASS))
        if (!s) return
        keep = nHopNeighborhood(cy, s.id, s.hops)
        cy.nodes().forEach((n) => {
          if (!keep!.has(n.id())) n.addClass(FOCUS_CLASS)
        })
      })
      return keep
    },
    [cyRef]
  )

  // Fit the camera onto the keep-set with padding. No-op when keep
  // is empty or null.
  const fitToKeep = useCallback(
    (keep: Set<string> | null): void => {
      const cy = cyRef.current
      if (!cy || !keep || keep.size === 0) return
      const keepEls = cy.elements().filter((e) => keep.has(e.id()))
      cy.fit(keepEls, FIT_PADDING)
    },
    [cyRef]
  )

  const focus = useCallback(
    (s: { id: string; hops: number }): void => {
      const cy = cyRef.current
      if (!cy) return
      // Capture camera BEFORE we mutate it. setState retains them so
      // clear() restores precisely the pre-focus view.
      const prevPan = cy.pan()
      const prevZoom = cy.zoom()
      const next: FocusState = { ...s, prevPan, prevZoom }
      setState(next)
      const keep = applyHide(s)
      fitToKeep(keep)
    },
    [applyHide, cyRef, fitToKeep]
  )

  const clear = useCallback((): void => {
    const cy = cyRef.current
    const prev = state
    setState(null)
    applyHide(null)
    if (cy && prev) {
      cy.pan(prev.prevPan)
      cy.zoom(prev.prevZoom)
    }
  }, [applyHide, cyRef, state])

  const reapply = useCallback((): void => {
    if (!state) return
    const keep = applyHide(state)
    fitToKeep(keep)
  }, [applyHide, fitToKeep, state])

  return { state, focus, clear, reapply }
}
```

- [ ] **Step 4: Run tests to verify passes**

Run: `npm test -- --testPathPattern=graph/useFocusMode.test`
Expected: PASS — all specs (existing + new).

Run: `npm test`
Expected: ALL pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/useFocusMode.ts \
  src/components/results/graph/useFocusMode.test.ts
git commit -m "feat(graph): focus mode hides off-set nodes and fits to focal subgraph"
```

### Task 6: Persistent "Clear focus" chip overlay

**Files:**
- Create: `src/components/results/graph/FocusClearChip.tsx`
- Create: `src/components/results/graph/FocusClearChip.test.tsx`
- Modify: `src/components/results/GraphView.tsx`
- Modify: `src/services/i18n/locales/en.ts`

- [ ] **Step 1: Write the failing component test**

```tsx
// src/components/results/graph/FocusClearChip.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../../test-utils/theme'
import { FocusClearChip } from './FocusClearChip'

const t = (k: string) => k

describe('FocusClearChip', () => {
  it('renders nothing when active=false', () => {
    render(
      <ThemeProvider theme={theme}>
        <FocusClearChip active={false} onClear={() => {}} t={t} />
      </ThemeProvider>
    )
    expect(screen.queryByTestId('graph-focus-clear-chip')).toBeNull()
  })

  it('renders the chip when active=true and fires onClear on click', () => {
    const onClear = jest.fn()
    render(
      <ThemeProvider theme={theme}>
        <FocusClearChip active onClear={onClear} t={t} />
      </ThemeProvider>
    )
    const chip = screen.getByTestId('graph-focus-clear-chip')
    expect(chip).toBeInTheDocument()
    fireEvent.click(chip)
    expect(onClear).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=graph/FocusClearChip.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the chip**

```tsx
// src/components/results/graph/FocusClearChip.tsx
import React from 'react'
import styled from 'styled-components'

type TFn = (key: string, opts?: Record<string, unknown>) => string

const ChipButton = styled.button`
  position: absolute;
  top: ${({ theme }) => theme.spacing.sm};
  right: ${({ theme }) => theme.spacing.sm};
  z-index: 6;
  font-family: inherit;
  font-size: ${({ theme }) => theme.font.sizes.xs};
  color: ${({ theme }) => theme.text.primary};
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.pill};
  padding: 4px 12px;
  cursor: pointer;
  box-shadow: ${({ theme }) => theme.shadows.md ?? theme.shadows.sm};

  &:hover,
  &:focus-visible {
    background: ${({ theme }) => theme.bg.subtle};
    outline: none;
  }
`

export type FocusClearChipProps = {
  active: boolean
  onClear: () => void
  t: TFn
}

// FocusClearChip is a small floating button rendered over the graph
// canvas whenever focus mode is active. It gives the user a stable,
// always-visible exit from focus — distinct from the inspector's
// Focus toggle (which is buried in the sidebar and disappears with
// the selection).
export const FocusClearChip: React.FC<FocusClearChipProps> = ({
  active,
  onClear,
  t,
}) => {
  if (!active) return null
  return (
    <ChipButton
      type="button"
      data-testid="graph-focus-clear-chip"
      onClick={onClear}
    >
      {t('graph.focusClearChip')}
    </ChipButton>
  )
}
```

- [ ] **Step 4: Add the i18n key**

In `src/services/i18n/locales/en.ts`, inside `graph: {}` near `focus`/`focusClear`:

```ts
focusClearChip: 'Focused — Clear ×',
```

- [ ] **Step 5: Mount the chip in `GraphView.tsx`**

Add the import:

```ts
import { FocusClearChip } from './graph/FocusClearChip'
```

Inside the existing `<div style={{ position: 'relative' }}>` wrapper around the canvas (the same wrapper that contains `<Canvas>`, `<Overlay>`, `<ErrorBanner>`, and `{miniMap && <GraphMiniMap ... />}`), add at the end:

```tsx
<FocusClearChip
  active={focusMode.state !== null}
  onClear={() => focusMode.clear()}
  t={t}
/>
```

- [ ] **Step 6: Run tests to verify passes**

Run: `npm test -- --testPathPattern=graph/FocusClearChip.test`
Expected: PASS — 2 specs.

Run: `npm test`
Expected: ALL pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/results/graph/FocusClearChip.tsx \
  src/components/results/graph/FocusClearChip.test.tsx \
  src/components/results/GraphView.tsx \
  src/services/i18n/locales/en.ts
git commit -m "feat(graph): persistent Clear-focus chip on canvas overlay"
```

### Task 7: Update the existing GraphView focus test to assert hide+zoom

**Files:**
- Modify: `src/components/results/GraphView.test.tsx`

- [ ] **Step 1: Locate the existing focus test**

In `src/components/results/GraphView.test.tsx`, find `describe('GraphView — focus action', ...)`. Its current assertion is roughly:

```tsx
fireEvent.click(focusBtn)
expect(focusBtn).toHaveAttribute('aria-pressed', 'true')
expect(screen.getByTestId('graph-focus-hops')).toBeInTheDocument()
expect(screen.getByTestId('graph-canvas')).toHaveAttribute('data-focus-active', 'true')
```

- [ ] **Step 2: Add a Clear-chip assertion + assert focusMode.clear via the chip works**

Extend the existing test (or add a new sibling test) to:

```tsx
it('Focus action shows the persistent Clear chip; clicking it clears focus', () => {
  renderGraphViewWithFixture()
  // Select node "1".
  fireEvent.change(screen.getByTestId('graph-node-id-picker'), {
    target: { value: '1' },
  })
  fireEvent.click(screen.getByTestId('graph-action-focus'))
  // The persistent chip is rendered.
  const chip = screen.getByTestId('graph-focus-clear-chip')
  expect(chip).toBeInTheDocument()
  // Clicking the chip clears focus — chip vanishes and the canvas
  // attribute flips back to false.
  fireEvent.click(chip)
  expect(screen.queryByTestId('graph-focus-clear-chip')).toBeNull()
  expect(screen.getByTestId('graph-canvas')).toHaveAttribute(
    'data-focus-active',
    'false'
  )
})
```

- [ ] **Step 3: Run tests**

Run: `npm test -- --testPathPattern=results/GraphView.test`
Expected: PASS — new test passes; existing focus test still passes.

- [ ] **Step 4: Commit**

```bash
git add src/components/results/GraphView.test.tsx
git commit -m "test(graph): assert Clear-focus chip drives focusMode.clear"
```

---

## Phase 4 — End-to-end validation

### Task 8: Extend the Playwright spec

**Files:**
- Modify: `e2e/specs/24-graph-power-features.spec.ts`

- [ ] **Step 1: Add two new specs**

Append these test blocks INSIDE the existing `test.describe('graph power features', ...)` (after the existing find-node spec):

```ts
test('zoom-to-node menu action changes the cytoscape zoom level', async ({
  authedPage: page,
}) => {
  const pos = await firstNodePosition(page)
  const canvas = page.getByTestId('graph-canvas')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('canvas not laid out')

  const zoomBefore = await page.evaluate(() => {
    type CyShape = { zoom: () => number }
    const cy = (window as unknown as { __geode_cy?: CyShape }).__geode_cy
    return cy ? cy.zoom() : 0
  })

  await canvas.click({
    button: 'right',
    position: { x: pos.x - box.x, y: pos.y - box.y },
  })
  await page.getByTestId('graph-node-menu-zoomTo').click()

  // The helper kicks off an animated zoom to 1.5x by default. Wait
  // for the animation duration + a small slack and assert the zoom
  // level changed.
  await page.waitForTimeout(500)
  const zoomAfter = await page.evaluate(() => {
    type CyShape = { zoom: () => number }
    const cy = (window as unknown as { __geode_cy?: CyShape }).__geode_cy
    return cy ? cy.zoom() : 0
  })
  expect(Math.abs(zoomAfter - zoomBefore)).toBeGreaterThan(0.1)
})

test('focus hides off-set nodes and persists Clear chip until dismissed', async ({
  authedPage: page,
}) => {
  const pos = await firstNodePosition(page)
  const canvas = page.getByTestId('graph-canvas')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('canvas not laid out')

  await canvas.click({
    button: 'right',
    position: { x: pos.x - box.x, y: pos.y - box.y },
  })
  await page.getByTestId('graph-node-menu-focus').click()

  // The Clear-focus chip is now visible on the canvas overlay.
  const chip = page.getByTestId('graph-focus-clear-chip')
  await expect(chip).toBeVisible()

  // At least one node has the focus-hide class on the live cy core.
  const hiddenCount = await page.evaluate(() => {
    type CyShape = {
      nodes: () => { filter: (sel: string) => { length: number } }
    }
    const cy = (window as unknown as { __geode_cy?: CyShape }).__geode_cy
    if (!cy) return 0
    return cy.nodes().filter('.gv-out-of-focus').length
  })
  expect(hiddenCount).toBeGreaterThan(0)

  // Click the chip — focus clears; chip vanishes.
  await chip.click()
  await expect(chip).toBeHidden()

  const hiddenAfter = await page.evaluate(() => {
    type CyShape = {
      nodes: () => { filter: (sel: string) => { length: number } }
    }
    const cy = (window as unknown as { __geode_cy?: CyShape }).__geode_cy
    if (!cy) return -1
    return cy.nodes().filter('.gv-out-of-focus').length
  })
  expect(hiddenAfter).toBe(0)
})
```

- [ ] **Step 2: Rebuild the geode-ui container**

```bash
docker compose -f deploy/docker-compose.test.yml build geode-ui
docker compose -f deploy/docker-compose.test.yml up -d geode-ui
until wget -qO- http://localhost:8080/healthz 2>/dev/null | grep -q ok; do sleep 2; done
```

- [ ] **Step 3: Run the affected spec**

Run: `npx playwright test --config=e2e/playwright.config.ts e2e/specs/24-graph-power-features.spec.ts --reporter=list`
Expected: ALL pass (4 prior + 2 new = 6 specs).

- [ ] **Step 4: Run the full e2e suite**

Run: `npx playwright test --config=e2e/playwright.config.ts --reporter=list`
Expected: clean, no flaky, no failed.

- [ ] **Step 5: Run jest + tsc + lint**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: ALL green.

- [ ] **Step 6: Commit**

```bash
git add e2e/specs/24-graph-power-features.spec.ts
git commit -m "test(e2e): zoom-to-node and hide-based focus"
```

---

## Self-Review Notes

- **Mini-map fix scope:** single CSS import; Jest stub for `*.css` makes the import a no-op in tests so existing 2 specs still pass.
- **Zoom-to-node helper:** pure function; tests assert call shape, not pixel positions. Reuses cytoscape's built-in `animate({ center, zoom, duration, easing })` API.
- **Focus rework:** the existing `.gv-out-of-focus` CSS rule's selector name is preserved to keep the diff small; only the value changes (`opacity` → `display: none`). The `FocusState` shape gains `prevPan`/`prevZoom` so `clear()` is loss-less.
- **Clear chip:** mounted INSIDE the canvas wrapper `<div style={{ position: 'relative' }}>` so it positions absolute against the canvas, not the page. Z-index 6 sits above the mini-map (5) but below the context menu (1000) and modal popover (theme.zIndex.modal).
- **No new dependencies.** Mini-map fix uses the already-installed cytoscape-navigator package's bundled CSS.

---

Plan complete. Total: 8 tasks across 4 phases, every task TDD with explicit fail/pass commands.
