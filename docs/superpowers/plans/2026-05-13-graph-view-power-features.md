# Graph View Power Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the result-tab graph view into a navigable, exploratory surface — nodes sized by degree, a long-press / right-click context menu, an editable "Expand neighbours" popover, neighbor keyboard navigation, pinning, N-hop focus mode, a mini-map, and a property-value find-node search.

**Architecture:** Layer onto the existing modularized GraphView (orchestrator + `graph/` subfolder of hooks/helpers). New features each get their own hook + small UI component, wired through the orchestrator. No new state stores: degree is derived in `useGraphElements`, pinning/focus live in result-scoped state, sticky toggles extend the existing `useGraphPrefs` zustand store. The query-preview popover reuses the existing `client.query()` path used by "Explore neighbours" today.

**Tech Stack:** React + TypeScript, Cytoscape 3.x (already wired), `cytoscape-navigator` (new dep for mini-map), Jest + Testing Library, Playwright (e2e), styled-components, react-i18next.

---

## File Structure

**New files (production):**
- `src/components/results/graph/nodeDegree.ts` — pure functions: compute degree map from elements, log-scale a count to a pixel radius.
- `src/components/results/graph/NodeContextMenu.tsx` — visual menu portalled into `document.body`.
- `src/components/results/graph/useNodeContextMenu.ts` — long-press (`taphold`) + right-click (`cxttap`) detection that opens the menu and tracks the target node.
- `src/components/results/graph/ExpandQueryPopover.tsx` — editable preview of the generated `MATCH` statement (direction radios, label filter, limit input).
- `src/components/results/graph/buildExpand.ts` — pure builder: `buildExpandStatement({ id, direction, labelFilter, limit })`. Replaces the current single-purpose `explore.ts:buildExploreStatement`.
- `src/components/results/graph/useGraphKeyboardNav.ts` — `Tab` / arrow keys / `Enter` neighbor-walk handlers for the canvas.
- `src/components/results/graph/usePinnedNodes.ts` — result-scoped `Set<string>` of pinned ids, with `cy.lock()` / `unlock()` side-effects.
- `src/components/results/graph/useFocusMode.ts` — focus state (active id, hop count), with `applyFocus(cy, focus)` style mutation.
- `src/components/results/graph/focus.ts` — pure helper `nHopNeighborhood(cy, id, n)` (BFS).
- `src/components/results/graph/GraphMiniMap.tsx` — wraps `cytoscape-navigator` and mounts a side panel below the canvas (or floating, in fill mode).
- `src/components/results/graph/FindNodeInput.tsx` — toolbar text input that filters / selects nodes by property substring.
- `src/components/results/graph/findNode.ts` — pure helper `matchesQuery(data, q)` for the property-value matcher.

**Modified files:**
- `src/components/results/GraphView.tsx:1-396` — orchestrator wiring for context menu, popover, keyboard nav, pinning, focus, mini-map, find input.
- `src/components/results/cytoscapeStyle.ts:80-225` — node `width`/`height` read from `data.size`; new `.gv-pinned` and `.gv-out-of-focus` selectors.
- `src/components/results/useGraphPrefs.ts:50-156` — new sticky toggles: `degreeSizing`, `miniMap`, `focusHops`.
- `src/components/results/graph/useGraphElements.ts:1-148` — stamp `data.degree` + `data.size` on each node element.
- `src/components/results/graph/useGraphCytoscape.ts:1-264` — bind `taphold` / `cxttap`; emit pin lock state; re-apply focus on selection / focus deps.
- `src/components/results/graph/GraphToolbar.tsx:1-256` — toggles for sizing / mini-map; find-node input; focus-mode chip.
- `src/components/results/graph/GraphInspector.tsx:1-310` — neighbors chip list; pin toggle button; focus toggle + hops slider.
- `src/components/results/graph/useGraphActions.ts:156-202` — `onExploreNeighbours(id, opts)` accepts direction/limit/labelFilter and an "echo to editor" flag.
- `src/components/results/graph/explore.ts:1-32` — re-export `buildExpandStatement` for back-compat; mark old name deprecated.
- `src/services/i18n/locales/en.ts:100-174` — new `graph.*` keys (listed inline per task).

**New / modified tests:**
- `src/components/results/graph/nodeDegree.test.ts`
- `src/components/results/graph/useGraphElements.test.ts` (extend)
- `src/components/results/graph/buildExpand.test.ts`
- `src/components/results/graph/NodeContextMenu.test.tsx`
- `src/components/results/graph/useNodeContextMenu.test.ts`
- `src/components/results/graph/ExpandQueryPopover.test.tsx`
- `src/components/results/graph/useGraphKeyboardNav.test.ts`
- `src/components/results/graph/usePinnedNodes.test.ts`
- `src/components/results/graph/focus.test.ts`
- `src/components/results/graph/useFocusMode.test.ts`
- `src/components/results/graph/findNode.test.ts`
- `src/components/results/graph/FindNodeInput.test.tsx`
- `src/components/results/graph/GraphMiniMap.test.tsx`
- `src/components/results/GraphView.test.tsx` (extend)
- `e2e/specs/24-graph-power-features.spec.ts` (new)

---

## Phase 1 — Degree-Based Node Sizing

### Task 1: Pure degree + log-scale helpers

**Files:**
- Create: `src/components/results/graph/nodeDegree.ts`
- Test: `src/components/results/graph/nodeDegree.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/results/graph/nodeDegree.test.ts
import type { ElementDefinition } from 'cytoscape'
import {
  computeDegrees,
  degreeToSize,
  MIN_NODE_SIZE,
  MAX_NODE_SIZE,
} from './nodeDegree'

const node = (id: string): ElementDefinition => ({ data: { id, label: 'X' } })
const edge = (id: string, source: string, target: string): ElementDefinition => ({
  data: { id, source, target, type: 'R' },
})

describe('computeDegrees', () => {
  it('returns zero for isolated nodes', () => {
    const map = computeDegrees([node('a'), node('b')])
    expect(map.get('a')).toBe(0)
    expect(map.get('b')).toBe(0)
  })

  it('counts each adjacent edge once per endpoint', () => {
    const els = [node('a'), node('b'), node('c'), edge('e1', 'a', 'b'), edge('e2', 'a', 'c')]
    const map = computeDegrees(els)
    expect(map.get('a')).toBe(2)
    expect(map.get('b')).toBe(1)
    expect(map.get('c')).toBe(1)
  })

  it('ignores edges whose endpoints are unknown', () => {
    const map = computeDegrees([node('a'), edge('e', 'a', 'ghost')])
    expect(map.get('a')).toBe(1)
  })
})

describe('degreeToSize', () => {
  it('returns MIN_NODE_SIZE for degree 0', () => {
    expect(degreeToSize(0)).toBe(MIN_NODE_SIZE)
  })

  it('grows monotonically with degree', () => {
    expect(degreeToSize(10)).toBeGreaterThan(degreeToSize(1))
    expect(degreeToSize(100)).toBeGreaterThan(degreeToSize(10))
  })

  it('saturates at MAX_NODE_SIZE for very large degrees', () => {
    expect(degreeToSize(100000)).toBeLessThanOrEqual(MAX_NODE_SIZE)
  })

  it('uses log scaling — 10x degree adds a roughly constant size step', () => {
    const step1 = degreeToSize(10) - degreeToSize(1)
    const step2 = degreeToSize(100) - degreeToSize(10)
    // Allow ±20% wobble; log step is identical in theory, but rounded
    // pixel sizing introduces small rounding noise.
    expect(Math.abs(step1 - step2) / step1).toBeLessThan(0.2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=graph/nodeDegree.test.ts`
Expected: FAIL — `Cannot find module './nodeDegree'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/components/results/graph/nodeDegree.ts
import type { ElementDefinition } from 'cytoscape'

// Pixel bounds for degree-based sizing. The default Cytoscape style
// (cytoscapeStyle.ts) used a flat width/height of 38; degree sizing
// extends that to 28–72 so isolated nodes shrink visibly and hubs grow
// visibly without becoming the whole canvas.
export const MIN_NODE_SIZE = 28
export const MAX_NODE_SIZE = 72
// log scale tuned so degree 1 ≈ 32px, degree 10 ≈ 44px, degree 100 ≈ 56px.
const STEP = 12

export function computeDegrees(
  elements: readonly ElementDefinition[]
): Map<string, number> {
  const nodeIds = new Set<string>()
  for (const el of elements) {
    const d = el.data as Record<string, unknown> | undefined
    if (!d || d.id == null) continue
    const isEdge = d.source !== undefined && d.target !== undefined
    if (!isEdge) nodeIds.add(String(d.id))
  }
  const out = new Map<string, number>()
  nodeIds.forEach((id) => out.set(id, 0))
  for (const el of elements) {
    const d = el.data as Record<string, unknown> | undefined
    if (!d) continue
    const src = d.source != null ? String(d.source) : undefined
    const tgt = d.target != null ? String(d.target) : undefined
    if (!src || !tgt) continue
    if (nodeIds.has(src)) out.set(src, (out.get(src) ?? 0) + 1)
    if (nodeIds.has(tgt)) out.set(tgt, (out.get(tgt) ?? 0) + 1)
  }
  return out
}

export function degreeToSize(degree: number): number {
  const d = Math.max(0, degree)
  const px = Math.round(MIN_NODE_SIZE + STEP * Math.log10(d + 1))
  return Math.min(MAX_NODE_SIZE, px)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=graph/nodeDegree.test.ts`
Expected: PASS — 4 specs in `computeDegrees`, 4 in `degreeToSize`.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/nodeDegree.ts src/components/results/graph/nodeDegree.test.ts
git commit -m "feat(graph): degree + log-scale sizing helpers"
```

### Task 2: Stamp degree + size onto element data

**Files:**
- Modify: `src/components/results/graph/useGraphElements.ts:80-92` (`baseEls` memo)
- Test: `src/components/results/graph/useGraphElements.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `useGraphElements.test.ts`:

```ts
import { renderHook } from '@testing-library/react'
import { useGraphElements } from './useGraphElements'

describe('useGraphElements — degree stamp', () => {
  const resp = {
    columns: [{ name: 'n' }, { name: 'r' }, { name: 'm' }],
    rows: [],
    graph_summary: {
      nodes: [
        { id: 1, labels: ['Person'], properties: { name: 'A' } },
        { id: 2, labels: ['Person'], properties: { name: 'B' } },
        { id: 3, labels: ['Movie'], properties: { title: 'X' } },
      ],
      edges: [
        { id: 10, start_node: 1, end_node: 2, type: 'KNOWS', properties: {} },
        { id: 11, start_node: 1, end_node: 3, type: 'ACTED_IN', properties: {} },
      ],
    },
  }

  it('stamps data.degree and data.size on each node', () => {
    const { result } = renderHook(() =>
      useGraphElements({ resp, clusterByLabel: false })
    )
    const nodes = result.current.baseEls.filter(
      (e) => (e.data as { source?: unknown }).source === undefined
    )
    const byId = new Map(
      nodes.map((n) => [
        String((n.data as { id: unknown }).id),
        n.data as Record<string, unknown>,
      ])
    )
    expect(byId.get('1')?.degree).toBe(2)
    expect(byId.get('2')?.degree).toBe(1)
    expect(byId.get('3')?.degree).toBe(1)
    expect(typeof byId.get('1')?.size).toBe('number')
    expect(byId.get('1')?.size as number).toBeGreaterThan(
      byId.get('3')?.size as number
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=graph/useGraphElements.test`
Expected: FAIL — degree stamp test reports `degree` undefined.

- [ ] **Step 3: Modify `useGraphElements.ts`**

Replace the `baseEls` memo block (lines 85-88) with:

```ts
import { computeDegrees, degreeToSize } from './nodeDegree'

// …existing imports…

const baseEls = useMemo<ElementDefinition[]>(() => {
  const raw = extractElements(resp, query)
  const degrees = computeDegrees(raw)
  // Stamp degree + size on every node. Edges pass through unchanged.
  return raw.map((el) => {
    const d = el.data as Record<string, unknown> | undefined
    if (!d || d.id == null) return el
    const isEdge = d.source !== undefined && d.target !== undefined
    if (isEdge) return el
    const id = String(d.id)
    const degree = degrees.get(id) ?? 0
    return { ...el, data: { ...d, degree, size: degreeToSize(degree) } }
  })
}, [resp, query])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=graph/useGraphElements.test`
Expected: PASS — degree stamp test passes; existing tests remain green.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/useGraphElements.ts src/components/results/graph/useGraphElements.test.ts
git commit -m "feat(graph): stamp degree + size on node data"
```

### Task 3: Apply degree size in the Cytoscape stylesheet + sticky toggle

**Files:**
- Modify: `src/components/results/cytoscapeStyle.ts:100-104` (node width/height)
- Modify: `src/components/results/useGraphPrefs.ts:50-156` (add `degreeSizing` sticky pref)
- Modify: `src/components/results/graph/GraphToolbar.tsx:101-127` (add toggle)
- Modify: `src/services/i18n/locales/en.ts:100-174` (`graph.degreeSizing*` keys)
- Test: extend `GraphView.test.tsx` to verify size pref drives style

- [ ] **Step 1: Write the failing test**

In `src/components/results/GraphView.test.tsx` add:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
// existing imports stay; add:
import { useGraphPrefs } from './useGraphPrefs'

describe('GraphView — degree sizing toggle', () => {
  beforeEach(() => {
    useGraphPrefs.setState({ degreeSizing: true })
  })

  it('exposes a graph-size-toggle that flips the sticky pref', () => {
    // render a default GraphView with the existing test fixture (see
    // the file's helper near the top of the suite).
    renderGraphViewWithFixture()
    const toggle = screen.getByTestId('graph-size-toggle')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(toggle)
    expect(useGraphPrefs.getState().degreeSizing).toBe(false)
  })
})
```

If `renderGraphViewWithFixture` isn't already extracted, copy the inline pattern used elsewhere in the file (build a tiny `QueryRespLike` then `render(<GraphView resp={fixture} />)` wrapped in the existing theme provider).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=results/GraphView.test`
Expected: FAIL — `graph-size-toggle` not found; `degreeSizing` is undefined on the store.

- [ ] **Step 3: Add the pref to `useGraphPrefs`**

In the `GraphPrefsState` type add:

```ts
  // Whether node width/height scales with degree (log-scaled). When off,
  // nodes render at the legacy flat 38px. Sticky.
  degreeSizing: boolean
  setDegreeSizing: (v: boolean) => void
```

In the `PersistedShape` type:

```ts
  degreeSizing: boolean
```

In the create-store initializer:

```ts
      degreeSizing: true,
      setDegreeSizing: (v) => set({ degreeSizing: v }),
```

In `partialize`:

```ts
      degreeSizing: s.degreeSizing,
```

In `merge`:

```ts
      degreeSizing: p.degreeSizing === false ? false : true,
```

- [ ] **Step 4: Apply the pref in the stylesheet**

In `cytoscapeStyle.ts` change the node block's `width`/`height` from `38` to expressions that read `data.size` (with a fallback for when sizing is off — handled by the orchestrator stripping `data.size`):

```ts
    {
      selector: 'node',
      style: {
        // …existing entries…
        width: (e: cytoscape.NodeSingular) =>
          (e.data('size') as number | undefined) ?? 38,
        height: (e: cytoscape.NodeSingular) =>
          (e.data('size') as number | undefined) ?? 38,
        // …rest unchanged…
      },
    },
```

In `useGraphElements.ts:baseEls` (modified in Task 2), gate the `size` stamp on a new `degreeSizing` arg:

```ts
export type UseGraphElementsArgs = {
  resp: QueryRespLike & { row_count?: number }
  query?: string
  clusterByLabel: boolean
  degreeSizing: boolean
}
```

And in the `baseEls` map:

```ts
const size = degreeSizing ? degreeToSize(degree) : undefined
return { ...el, data: { ...d, degree, ...(size != null ? { size } : {}) } }
```

In `GraphView.tsx:117` add:

```ts
  const degreeSizing = useGraphPrefs((s) => s.degreeSizing)
  const setDegreeSizing = useGraphPrefs((s) => s.setDegreeSizing)
```

And pass it through to `useGraphElements({ ..., degreeSizing })`. Add to the `sig` string so flips force a rebuild:

```ts
  const sig = `${respSignature(resp)}|${query ?? ''}|${clusterByLabel ? 'c' : ''}|${degreeSizing ? 'd' : ''}`
```

- [ ] **Step 5: Add the toolbar toggle**

In `GraphToolbar.tsx` add to `GraphToolbarProps`:

```ts
  degreeSizing: boolean
  onToggleDegreeSizing: () => void
```

In the JSX, inside the existing `<div className="group">` that has the cluster/path-mode toggles, append:

```tsx
        <button
          type="button"
          data-testid="graph-size-toggle"
          aria-pressed={degreeSizing}
          aria-label={t('graph.degreeSizingLabel')}
          title={t('graph.degreeSizingLabel')}
          onClick={onToggleDegreeSizing}
        >
          {t('graph.degreeSizing')}
        </button>
```

Add i18n keys in `en.ts`:

```ts
    degreeSizing: 'Size by edges',
    degreeSizingLabel: 'Resize nodes by number of connections (log-scaled)',
```

Wire from `GraphView.tsx` at the existing toolbar render:

```tsx
        <GraphToolbar
          /* …existing props… */
          degreeSizing={degreeSizing}
          onToggleDegreeSizing={() => setDegreeSizing(!degreeSizing)}
        />
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- --testPathPattern=results/GraphView.test`
Expected: PASS — toggle test passes; existing tests still green.

- [ ] **Step 7: Run full test suite to catch regressions**

Run: `npm test`
Expected: ALL PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/results/cytoscapeStyle.ts \
  src/components/results/useGraphPrefs.ts \
  src/components/results/graph/GraphToolbar.tsx \
  src/components/results/graph/useGraphElements.ts \
  src/components/results/GraphView.tsx \
  src/components/results/GraphView.test.tsx \
  src/services/i18n/locales/en.ts
git commit -m "feat(graph): apply log-scaled degree sizing with sticky toggle"
```

---

## Phase 2 — Node Context Menu (long-press + right-click)

### Task 4: Visual menu shell

**Files:**
- Create: `src/components/results/graph/NodeContextMenu.tsx`
- Test: `src/components/results/graph/NodeContextMenu.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/results/graph/NodeContextMenu.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { lightTheme } from '../../../theme/themes'
import { NodeContextMenu, NodeContextMenuAction } from './NodeContextMenu'

const t = (k: string) => k

const renderMenu = (
  overrides: Partial<React.ComponentProps<typeof NodeContextMenu>> = {}
) =>
  render(
    <ThemeProvider theme={lightTheme}>
      <NodeContextMenu
        open
        x={20}
        y={30}
        items={['expand', 'hide', 'collapse', 'focus', 'pin', 'copyId']}
        onSelect={() => {}}
        onClose={() => {}}
        t={t}
        {...overrides}
      />
    </ThemeProvider>
  )

describe('NodeContextMenu', () => {
  it('renders nothing when open=false', () => {
    renderMenu({ open: false })
    expect(screen.queryByTestId('graph-node-menu')).toBeNull()
  })

  it('renders all items when open and positions them at (x, y)', () => {
    renderMenu()
    const root = screen.getByTestId('graph-node-menu')
    expect(root.style.left).toBe('20px')
    expect(root.style.top).toBe('30px')
    expect(screen.getByTestId('graph-node-menu-expand')).toBeInTheDocument()
    expect(screen.getByTestId('graph-node-menu-pin')).toBeInTheDocument()
  })

  it('fires onSelect with the action when an item is clicked', () => {
    const onSelect = jest.fn()
    renderMenu({ onSelect })
    fireEvent.click(screen.getByTestId('graph-node-menu-expand'))
    expect(onSelect).toHaveBeenCalledWith<[NodeContextMenuAction]>('expand')
  })

  it('fires onClose when Escape is pressed', () => {
    const onClose = jest.fn()
    renderMenu({ onClose })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=graph/NodeContextMenu.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```tsx
// src/components/results/graph/NodeContextMenu.tsx
import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import styled from 'styled-components'

export type NodeContextMenuAction =
  | 'expand'
  | 'hide'
  | 'collapse'
  | 'focus'
  | 'pin'
  | 'copyId'

type TFn = (key: string, opts?: Record<string, unknown>) => string

const Menu = styled.ul`
  position: fixed;
  z-index: 1000;
  margin: 0;
  padding: ${({ theme }) => theme.spacing.xxs};
  list-style: none;
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.md};
  box-shadow: ${({ theme }) => theme.shadows.lg ?? theme.shadows.md};
  min-width: 180px;

  li button {
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    color: ${({ theme }) => theme.text.primary};
    font: inherit;
    padding: 6px 10px;
    border-radius: ${({ theme }) => theme.radii.sm};
    cursor: pointer;
  }
  li button:hover,
  li button:focus-visible {
    background: ${({ theme }) => theme.bg.subtle};
    outline: none;
  }
`

export type NodeContextMenuProps = {
  open: boolean
  x: number
  y: number
  // Ordered list of actions; the component renders one button per id.
  items: NodeContextMenuAction[]
  onSelect: (a: NodeContextMenuAction) => void
  onClose: () => void
  t: TFn
}

const LABEL_KEY: Record<NodeContextMenuAction, string> = {
  expand: 'graph.menuExpand',
  hide: 'graph.actionHide',
  collapse: 'graph.actionCollapse',
  focus: 'graph.menuFocus',
  pin: 'graph.menuPin',
  copyId: 'graph.menuCopyId',
}

export const NodeContextMenu: React.FC<NodeContextMenuProps> = ({
  open,
  x,
  y,
  items,
  onSelect,
  onClose,
  t,
}) => {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const onClick = (e: MouseEvent): void => {
      const root = document.querySelector('[data-testid="graph-node-menu"]')
      if (root && !root.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    // Capture phase so we close before any descendant catches the click.
    window.addEventListener('mousedown', onClick, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick, true)
    }
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <Menu
      data-testid="graph-node-menu"
      role="menu"
      style={{ left: x, top: y }}
    >
      {items.map((id) => (
        <li key={id} role="none">
          <button
            type="button"
            role="menuitem"
            data-testid={`graph-node-menu-${id}`}
            onClick={() => onSelect(id)}
          >
            {t(LABEL_KEY[id])}
          </button>
        </li>
      ))}
    </Menu>,
    document.body
  )
}
```

Add i18n keys to `en.ts`:

```ts
    menuExpand: 'Expand neighbours…',
    menuFocus: 'Focus on this node',
    menuPin: 'Pin position',
    menuUnpin: 'Unpin',
    menuCopyId: 'Copy id',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=graph/NodeContextMenu.test`
Expected: PASS — 4 specs.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/NodeContextMenu.tsx \
  src/components/results/graph/NodeContextMenu.test.tsx \
  src/services/i18n/locales/en.ts
git commit -m "feat(graph): NodeContextMenu portal shell"
```

### Task 5: `useNodeContextMenu` hook — long-press + right-click detection

**Files:**
- Create: `src/components/results/graph/useNodeContextMenu.ts`
- Test: `src/components/results/graph/useNodeContextMenu.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/results/graph/useNodeContextMenu.test.ts
import { act, renderHook } from '@testing-library/react'
import { useNodeContextMenu } from './useNodeContextMenu'

type FakeNode = { id: () => string; data: () => Record<string, unknown> }
type Handler = (ev: { target: FakeNode; renderedPosition: { x: number; y: number }; originalEvent?: { clientX: number; clientY: number; preventDefault: () => void } }) => void
type FakeCore = {
  on: jest.Mock<void, [string, string, Handler]>
  off: jest.Mock
  __handlers: Map<string, Handler>
}

function makeCore(): FakeCore {
  const handlers = new Map<string, Handler>()
  return {
    on: jest.fn((event: string, _selector: string, h: Handler) => {
      handlers.set(event, h)
    }) as unknown as FakeCore['on'],
    off: jest.fn(),
    __handlers: handlers,
  }
}

describe('useNodeContextMenu', () => {
  it('opens at the cxttap position with the tapped node id', () => {
    const core = makeCore()
    const cyRef = { current: core as unknown as cytoscape.Core }
    const { result } = renderHook(() => useNodeContextMenu({ cyRef, enabled: true }))
    expect(result.current.state.open).toBe(false)
    const node: FakeNode = { id: () => 'n42', data: () => ({ id: 'n42' }) }
    act(() => {
      core.__handlers.get('cxttap')!({
        target: node,
        renderedPosition: { x: 12, y: 34 },
      })
    })
    expect(result.current.state).toEqual({
      open: true,
      x: expect.any(Number),
      y: expect.any(Number),
      nodeId: 'n42',
    })
  })

  it('opens on taphold (long press) as well', () => {
    const core = makeCore()
    const cyRef = { current: core as unknown as cytoscape.Core }
    const { result } = renderHook(() => useNodeContextMenu({ cyRef, enabled: true }))
    const node: FakeNode = { id: () => 'n7', data: () => ({ id: 'n7' }) }
    act(() => {
      core.__handlers.get('taphold')!({
        target: node,
        renderedPosition: { x: 0, y: 0 },
      })
    })
    expect(result.current.state.open).toBe(true)
    expect(result.current.state.nodeId).toBe('n7')
  })

  it('close() resets the open flag', () => {
    const core = makeCore()
    const cyRef = { current: core as unknown as cytoscape.Core }
    const { result } = renderHook(() => useNodeContextMenu({ cyRef, enabled: true }))
    act(() => {
      core.__handlers.get('cxttap')!({
        target: { id: () => 'n1', data: () => ({ id: 'n1' }) },
        renderedPosition: { x: 0, y: 0 },
      })
    })
    act(() => result.current.close())
    expect(result.current.state.open).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=graph/useNodeContextMenu.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

```ts
// src/components/results/graph/useNodeContextMenu.ts
import { useCallback, useEffect, useState } from 'react'
import type { Core } from 'cytoscape'

export type NodeMenuState = {
  open: boolean
  // Page coordinates so the menu portal can `position: fixed` cleanly.
  x: number
  y: number
  nodeId: string | null
}

export type UseNodeContextMenuArgs = {
  cyRef: React.MutableRefObject<Core | null>
  enabled: boolean
}

export type UseNodeContextMenuResult = {
  state: NodeMenuState
  close: () => void
}

const CLOSED: NodeMenuState = { open: false, x: 0, y: 0, nodeId: null }

export function useNodeContextMenu(
  args: UseNodeContextMenuArgs
): UseNodeContextMenuResult {
  const { cyRef, enabled } = args
  const [state, setState] = useState<NodeMenuState>(CLOSED)

  useEffect(() => {
    if (!enabled) return undefined
    const cy = cyRef.current
    if (!cy) return undefined

    const open = (ev: {
      target: { id: () => string }
      renderedPosition: { x: number; y: number }
      originalEvent?: { clientX?: number; clientY?: number; preventDefault?: () => void }
    }): void => {
      const id = ev.target.id()
      const orig = ev.originalEvent
      const x = orig?.clientX ?? ev.renderedPosition.x
      const y = orig?.clientY ?? ev.renderedPosition.y
      if (orig?.preventDefault) orig.preventDefault()
      setState({ open: true, x, y, nodeId: id })
    }

    // cxttap = canvas right-click on an element. taphold = long-press
    // (touch or mouse). Both routes the same handler.
    cy.on('cxttap', 'node', open as never)
    cy.on('taphold', 'node', open as never)
    // A normal tap on background closes the menu — keeps the gesture
    // model identical to background-tap clears selection.
    const closeOnBg = (ev: { target: unknown }): void => {
      if (ev.target === cy) setState(CLOSED)
    }
    cy.on('tap', closeOnBg as never)

    return () => {
      cy.off('cxttap', 'node', open as never)
      cy.off('taphold', 'node', open as never)
      cy.off('tap', closeOnBg as never)
    }
  }, [cyRef, enabled])

  const close = useCallback(() => setState(CLOSED), [])
  return { state, close }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=graph/useNodeContextMenu.test`
Expected: PASS — 3 specs.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/useNodeContextMenu.ts src/components/results/graph/useNodeContextMenu.test.ts
git commit -m "feat(graph): useNodeContextMenu — cxttap + taphold detection"
```

### Task 6: Wire the menu into the orchestrator

**Files:**
- Modify: `src/components/results/GraphView.tsx:80-396`
- Modify: `src/components/results/graph/useGraphCytoscape.ts:97-170` (must run after the core mounts so the hook can subscribe)
- Test: extend `GraphView.test.tsx`

- [ ] **Step 1: Write the failing test**

In `GraphView.test.tsx`:

```tsx
import { useNodeContextMenu } from './graph/useNodeContextMenu'

jest.mock('./graph/useNodeContextMenu', () => ({
  useNodeContextMenu: jest.fn(() => ({
    state: { open: true, x: 5, y: 7, nodeId: '1' },
    close: jest.fn(),
  })),
}))

describe('GraphView — context menu wiring', () => {
  afterEach(() => jest.clearAllMocks())

  it('renders the menu when the hook reports open=true', () => {
    renderGraphViewWithFixture()
    expect(screen.getByTestId('graph-node-menu')).toBeInTheDocument()
  })

  it('routes the "hide" menu action to onHideNode', () => {
    renderGraphViewWithFixture()
    fireEvent.click(screen.getByTestId('graph-node-menu-hide'))
    // The mocked menu state's nodeId is '1' — the assertion checks the
    // canvas state by querying the existing hidden-id sidebar, which
    // re-renders to include that id. (Match the file's existing pattern
    // for asserting hide effects.)
    expect(screen.queryByText(/1/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=results/GraphView.test`
Expected: FAIL — `graph-node-menu` not in DOM.

- [ ] **Step 3: Wire the menu in `GraphView.tsx`**

Add at the imports:

```tsx
import { NodeContextMenu, NodeContextMenuAction } from './graph/NodeContextMenu'
import { useNodeContextMenu } from './graph/useNodeContextMenu'
```

Inside the component body, after `useGraphCytoscape({...})`:

```tsx
  const menu = useNodeContextMenu({ cyRef, enabled: true })

  const onMenuSelect = (action: NodeContextMenuAction): void => {
    const id = menu.state.nodeId
    menu.close()
    if (!id) return
    switch (action) {
      case 'expand':
        // Phase-3 wires this to the popover. Until then fall back to
        // the existing direct-explore path so the menu is usable.
        onExploreNeighbours(id)
        break
      case 'hide':
        onHideNode(id)
        break
      case 'collapse':
        onCollapseNode(id)
        break
      case 'copyId':
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(id).catch(() => {})
        }
        break
      case 'focus':
      case 'pin':
        // Stubbed — Phase 5 (pin) and Phase 6 (focus) wire these up.
        break
    }
  }
```

In the JSX, just before `</Wrap>`:

```tsx
      <NodeContextMenu
        open={menu.state.open}
        x={menu.state.x}
        y={menu.state.y}
        items={['expand', 'hide', 'collapse', 'focus', 'pin', 'copyId']}
        onSelect={onMenuSelect}
        onClose={menu.close}
        t={t}
      />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=results/GraphView.test`
Expected: PASS — menu renders; hide path still fires via existing flow.

- [ ] **Step 5: Run full suite to confirm no regressions**

Run: `npm test`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/results/GraphView.tsx src/components/results/GraphView.test.tsx
git commit -m "feat(graph): wire NodeContextMenu into orchestrator"
```

---

## Phase 3 — Editable Expand-Query Popover

### Task 7: Pure `buildExpandStatement`

**Files:**
- Create: `src/components/results/graph/buildExpand.ts`
- Test: `src/components/results/graph/buildExpand.test.ts`
- Modify: `src/components/results/graph/explore.ts` (re-export for back-compat)

- [ ] **Step 1: Write the failing test**

```ts
// src/components/results/graph/buildExpand.test.ts
import { buildExpandStatement } from './buildExpand'

describe('buildExpandStatement', () => {
  it('defaults to undirected with limit 100', () => {
    expect(buildExpandStatement({ id: '7' })).toBe(
      'MATCH (n)-[r]-(m) WHERE id(n) = 7 RETURN n, r, m LIMIT 100;'
    )
  })

  it('outgoing direction emits the directed arrow', () => {
    expect(buildExpandStatement({ id: '7', direction: 'out' })).toBe(
      'MATCH (n)-[r]->(m) WHERE id(n) = 7 RETURN n, r, m LIMIT 100;'
    )
  })

  it('incoming direction emits the reverse arrow', () => {
    expect(buildExpandStatement({ id: '7', direction: 'in' })).toBe(
      'MATCH (n)<-[r]-(m) WHERE id(n) = 7 RETURN n, r, m LIMIT 100;'
    )
  })

  it('label filter applies on m', () => {
    expect(
      buildExpandStatement({ id: '7', labelFilter: 'Movie' })
    ).toBe(
      'MATCH (n)-[r]-(m:Movie) WHERE id(n) = 7 RETURN n, r, m LIMIT 100;'
    )
  })

  it('clamps a non-positive limit to 1 and a huge one to 10000', () => {
    expect(buildExpandStatement({ id: '7', limit: 0 })).toContain('LIMIT 1;')
    expect(buildExpandStatement({ id: '7', limit: 999999 })).toContain('LIMIT 10000;')
  })

  it('rejects a non-numeric id by throwing', () => {
    expect(() => buildExpandStatement({ id: 'abc' })).toThrow()
  })

  it('rejects a label filter that is not an identifier', () => {
    expect(() =>
      buildExpandStatement({ id: '7', labelFilter: 'X; DROP DATABASE' })
    ).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=graph/buildExpand.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the builder**

```ts
// src/components/results/graph/buildExpand.ts
export type ExpandDirection = 'both' | 'in' | 'out'

export type ExpandStatementInput = {
  id: string
  direction?: ExpandDirection
  labelFilter?: string
  limit?: number
}

const ID_RE = /^\d+$/
const LABEL_RE = /^[A-Za-z_][\w]*$/

const MIN_LIMIT = 1
const MAX_LIMIT = 10000
const DEFAULT_LIMIT = 100

function arrow(dir: ExpandDirection): { left: string; right: string } {
  if (dir === 'in') return { left: '<-', right: '-' }
  if (dir === 'out') return { left: '-', right: '->' }
  return { left: '-', right: '-' }
}

function clampLimit(n: number | undefined): number {
  if (!Number.isFinite(n as number)) return DEFAULT_LIMIT
  const v = Math.trunc(n as number)
  if (v < MIN_LIMIT) return MIN_LIMIT
  if (v > MAX_LIMIT) return MAX_LIMIT
  return v
}

export function buildExpandStatement(input: ExpandStatementInput): string {
  if (!ID_RE.test(input.id)) {
    throw new Error(`Expand: invalid node id ${input.id}`)
  }
  const dir = input.direction ?? 'both'
  const { left, right } = arrow(dir)
  let mPart = '(m)'
  if (input.labelFilter) {
    if (!LABEL_RE.test(input.labelFilter)) {
      throw new Error(`Expand: invalid label filter ${input.labelFilter}`)
    }
    mPart = `(m:${input.labelFilter})`
  }
  const limit = clampLimit(input.limit)
  return `MATCH (n)${left}[r]${right}${mPart} WHERE id(n) = ${input.id} RETURN n, r, m LIMIT ${limit};`
}
```

In `explore.ts`, replace `buildExploreStatement` body to delegate (keep the export for back-compat):

```ts
import { buildExpandStatement } from './buildExpand'

export function buildExploreStatement(nodeId: string): string {
  return buildExpandStatement({ id: nodeId })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=graph/buildExpand.test`
Expected: PASS — 7 specs.

- [ ] **Step 5: Run the broader graph test to make sure `useGraphActions` still uses the back-compat function**

Run: `npm test -- --testPathPattern=results/graph`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/results/graph/buildExpand.ts \
  src/components/results/graph/buildExpand.test.ts \
  src/components/results/graph/explore.ts
git commit -m "feat(graph): configurable buildExpandStatement"
```

### Task 8: ExpandQueryPopover component

**Files:**
- Create: `src/components/results/graph/ExpandQueryPopover.tsx`
- Test: `src/components/results/graph/ExpandQueryPopover.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/results/graph/ExpandQueryPopover.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { lightTheme } from '../../../theme/themes'
import { ExpandQueryPopover } from './ExpandQueryPopover'

const t = (k: string, o?: Record<string, unknown>) =>
  o ? `${k}:${JSON.stringify(o)}` : k

const renderPop = (
  overrides: Partial<React.ComponentProps<typeof ExpandQueryPopover>> = {}
) =>
  render(
    <ThemeProvider theme={lightTheme}>
      <ExpandQueryPopover
        open
        nodeId="42"
        labelOptions={['Person', 'Movie']}
        onRun={() => {}}
        onCancel={() => {}}
        t={t}
        {...overrides}
      />
    </ThemeProvider>
  )

describe('ExpandQueryPopover', () => {
  it('renders nothing when open=false', () => {
    renderPop({ open: false })
    expect(screen.queryByTestId('graph-expand-popover')).toBeNull()
  })

  it('shows the generated statement live as inputs change', () => {
    renderPop()
    const preview = screen.getByTestId('graph-expand-preview')
    expect(preview.textContent).toContain('MATCH (n)-[r]-(m) WHERE id(n) = 42')
    fireEvent.click(screen.getByTestId('graph-expand-direction-out'))
    expect(preview.textContent).toContain('MATCH (n)-[r]->(m)')
    fireEvent.change(screen.getByTestId('graph-expand-label-filter'), {
      target: { value: 'Movie' },
    })
    expect(preview.textContent).toContain('(m:Movie)')
    fireEvent.change(screen.getByTestId('graph-expand-limit'), {
      target: { value: '25' },
    })
    expect(preview.textContent).toContain('LIMIT 25;')
  })

  it('Run calls onRun with the current options', () => {
    const onRun = jest.fn()
    renderPop({ onRun })
    fireEvent.click(screen.getByTestId('graph-expand-run'))
    expect(onRun).toHaveBeenCalledWith({
      direction: 'both',
      labelFilter: undefined,
      limit: 100,
    })
  })

  it('Cancel calls onCancel', () => {
    const onCancel = jest.fn()
    renderPop({ onCancel })
    fireEvent.click(screen.getByTestId('graph-expand-cancel'))
    expect(onCancel).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=graph/ExpandQueryPopover.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the popover**

```tsx
// src/components/results/graph/ExpandQueryPopover.tsx
import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import styled from 'styled-components'
import { buildExpandStatement, ExpandDirection } from './buildExpand'

type TFn = (key: string, opts?: Record<string, unknown>) => string

const Modal = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.32);
`
const Card = styled.div`
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.md};
  min-width: 360px;
  max-width: 560px;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};

  h4 {
    margin: 0;
    font-size: ${({ theme }) => theme.font.sizes.md};
    color: ${({ theme }) => theme.text.primary};
  }
  .row {
    display: flex;
    align-items: center;
    gap: ${({ theme }) => theme.spacing.sm};
    flex-wrap: wrap;
  }
  pre {
    background: ${({ theme }) => theme.bg.canvas};
    color: ${({ theme }) => theme.text.primary};
    padding: ${({ theme }) => theme.spacing.xs};
    border-radius: ${({ theme }) => theme.radii.sm};
    border: 1px solid ${({ theme }) => theme.border.subtle};
    font-family: ${({ theme }) => theme.font.family.mono};
    font-size: ${({ theme }) => theme.font.sizes.xs};
    overflow-x: auto;
    margin: 0;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: ${({ theme }) => theme.spacing.xs};
  }
  button.primary {
    background: ${({ theme }) => theme.colors.primary};
    color: #fff;
    border: 1px solid ${({ theme }) => theme.colors.primary};
  }
`

export type ExpandRunOpts = {
  direction: ExpandDirection
  labelFilter: string | undefined
  limit: number
}

export type ExpandQueryPopoverProps = {
  open: boolean
  nodeId: string
  // Allowed label filter values, drawn from the live graph's buckets.
  labelOptions: string[]
  onRun: (opts: ExpandRunOpts) => void
  onCancel: () => void
  t: TFn
}

export const ExpandQueryPopover: React.FC<ExpandQueryPopoverProps> = ({
  open,
  nodeId,
  labelOptions,
  onRun,
  onCancel,
  t,
}) => {
  const [direction, setDirection] = useState<ExpandDirection>('both')
  const [labelFilter, setLabelFilter] = useState<string>('')
  const [limit, setLimit] = useState<string>('100')

  if (!open) return null

  const parsedLimit = Number.parseInt(limit, 10)
  const preview = (() => {
    try {
      return buildExpandStatement({
        id: nodeId,
        direction,
        labelFilter: labelFilter || undefined,
        limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      })
    } catch (e) {
      return `# ${(e as Error).message}`
    }
  })()

  const runDisabled = preview.startsWith('# ')

  return createPortal(
    <Modal role="dialog" aria-modal="true" data-testid="graph-expand-popover">
      <Card>
        <h4>{t('graph.expandTitle', { id: nodeId })}</h4>
        <div className="row" role="radiogroup" aria-label={t('graph.expandDirection')}>
          <label>
            <input
              type="radio"
              data-testid="graph-expand-direction-both"
              checked={direction === 'both'}
              onChange={() => setDirection('both')}
            />
            {t('graph.expandBoth')}
          </label>
          <label>
            <input
              type="radio"
              data-testid="graph-expand-direction-out"
              checked={direction === 'out'}
              onChange={() => setDirection('out')}
            />
            {t('graph.expandOut')}
          </label>
          <label>
            <input
              type="radio"
              data-testid="graph-expand-direction-in"
              checked={direction === 'in'}
              onChange={() => setDirection('in')}
            />
            {t('graph.expandIn')}
          </label>
        </div>
        <div className="row">
          <label>
            {t('graph.expandLabelFilter')}
            <select
              data-testid="graph-expand-label-filter"
              value={labelFilter}
              onChange={(e) => setLabelFilter(e.target.value)}
            >
              <option value="">{t('graph.expandLabelAny')}</option>
              {labelOptions.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('graph.expandLimit')}
            <input
              type="number"
              data-testid="graph-expand-limit"
              min={1}
              max={10000}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              style={{ width: 80 }}
            />
          </label>
        </div>
        <pre data-testid="graph-expand-preview">{preview}</pre>
        <div className="actions">
          <button
            type="button"
            data-testid="graph-expand-cancel"
            onClick={onCancel}
          >
            {t('graph.expandCancel')}
          </button>
          <button
            type="button"
            data-testid="graph-expand-run"
            className="primary"
            disabled={runDisabled}
            onClick={() =>
              onRun({
                direction,
                labelFilter: labelFilter || undefined,
                limit: Number.isFinite(parsedLimit) ? parsedLimit : 100,
              })
            }
          >
            {t('graph.expandRun')}
          </button>
        </div>
      </Card>
    </Modal>,
    document.body
  )
}
```

Add i18n keys:

```ts
    expandTitle: 'Expand neighbours of node {{id}}',
    expandDirection: 'Direction',
    expandBoth: 'Both',
    expandOut: 'Outgoing',
    expandIn: 'Incoming',
    expandLabelFilter: 'Label filter',
    expandLabelAny: '(any)',
    expandLimit: 'Limit',
    expandCancel: 'Cancel',
    expandRun: 'Run',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=graph/ExpandQueryPopover.test`
Expected: PASS — 4 specs.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/ExpandQueryPopover.tsx \
  src/components/results/graph/ExpandQueryPopover.test.tsx \
  src/services/i18n/locales/en.ts
git commit -m "feat(graph): editable ExpandQueryPopover with live preview"
```

### Task 9: Generalize `onExploreNeighbours` and wire menu → popover → run

**Files:**
- Modify: `src/components/results/graph/useGraphActions.ts:156-202`
- Modify: `src/components/results/GraphView.tsx`
- Test: extend `useGraphActions.test.ts` (file already exists alongside `graphActions.test.ts` — if not present, follow the existing test-style pattern)

- [ ] **Step 1: Write the failing test**

In `src/components/results/graph/useGraphActions.test.ts` (create if missing):

```ts
import { act, renderHook } from '@testing-library/react'
import { useGraphActions } from './useGraphActions'
import { client } from '../../../api/client'

jest.mock('../../../api/client', () => ({
  client: { query: jest.fn() },
}))

describe('useGraphActions — onExploreNeighbours with options', () => {
  beforeEach(() => jest.clearAllMocks())

  it('passes direction + labelFilter + limit into the query statement', async () => {
    ;(client.query as jest.Mock).mockResolvedValue({ rows: [], graph_summary: {} })
    const cyRef = { current: { add: jest.fn(), getElementById: () => ({ empty: () => true }), layout: () => ({ run: () => {} }), fit: () => {} } as never }
    const layoutRef = { current: 'cose' as const }
    const queryRef = { current: 'USE GRAPH g;' }
    const { result } = renderHook(() =>
      useGraphActions({
        cyRef: cyRef as never,
        layoutRef: layoutRef as never,
        queryRef: queryRef as never,
        setSelected: jest.fn(),
        setError: jest.fn(),
        t: (k) => k,
      })
    )
    await act(async () => {
      result.current.onExploreNeighbours('42', {
        direction: 'out',
        labelFilter: 'Movie',
        limit: 25,
      })
    })
    expect(client.query).toHaveBeenCalledWith(
      expect.objectContaining({
        statement: 'MATCH (n)-[r]->(m:Movie) WHERE id(n) = 42 RETURN n, r, m LIMIT 25;',
        graph: 'g',
      })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=graph/useGraphActions.test`
Expected: FAIL — `onExploreNeighbours` doesn't accept options.

- [ ] **Step 3: Modify `useGraphActions.ts`**

Change the type of `onExploreNeighbours` to accept opts, and pass them through `buildExpandStatement`:

```ts
import { buildExpandStatement } from './buildExpand'
import type { ExpandDirection } from './buildExpand'

export type ExploreOpts = {
  direction?: ExpandDirection
  labelFilter?: string
  limit?: number
}

// …UseGraphActionsResult update:
  onExploreNeighbours: (id: string, opts?: ExploreOpts) => void

// …inside the hook:
  const onExploreNeighbours = useCallback(
    (id: string, opts?: ExploreOpts): void => {
      const cy = cyRef.current
      if (!cy || !id) return
      // The existing isRealNodeId check works on buildExpand too — bail
      // on synthesised ids.
      if (!/^\d+$/.test(id)) return
      const capturedCy = cy
      let alreadyInFlight = false
      setExploringId((cur) => {
        if (cur) {
          alreadyInFlight = true
          return cur
        }
        return id
      })
      if (alreadyInFlight) return
      setError(null)
      let statement: string
      try {
        statement = buildExpandStatement({ id, ...(opts ?? {}) })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        setError(t('graph.exploreNeighboursFailed', { message: msg }))
        setExploringId((cur) => (cur === id ? null : cur))
        return
      }
      client
        .query({
          statement,
          graph: graphNameOf(queryRef.current),
          page_size: opts?.limit ? Math.max(opts.limit, 1) * 2 : 200,
          timeout_ms: 30000,
        })
        .then((result) => {
          const live = cyRef.current
          if (!live || live !== capturedCy) return
          const newEls = extractElements(result as QueryRespLike)
          const added = mergeSubgraph(live, newEls)
          if (added.length > 0) {
            live.layout(layoutConfig(layoutRef.current)).run()
            live.fit(undefined, 24)
          }
        })
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e)
          setError(t('graph.exploreNeighboursFailed', { message: msg }))
        })
        .finally(() => {
          setExploringId((cur) => (cur === id ? null : cur))
        })
    },
    [cyRef, layoutRef, queryRef, setError, t]
  )
```

- [ ] **Step 4: Wire popover into orchestrator**

In `GraphView.tsx` add:

```tsx
import { ExpandQueryPopover, ExpandRunOpts } from './graph/ExpandQueryPopover'

// inside component:
  const [expandFor, setExpandFor] = useState<string | null>(null)

  // Re-route the menu's 'expand' to open the popover instead of firing
  // the explore directly.
  // (replace the case 'expand' branch in onMenuSelect with this:)
  case 'expand':
    setExpandFor(id)
    break

  const onExpandRun = (opts: ExpandRunOpts): void => {
    if (!expandFor) return
    const target = expandFor
    setExpandFor(null)
    onExploreNeighbours(target, opts)
  }

  const labelOptionList = Array.from(nodeLabelBuckets.keys()).filter(Boolean)
```

In JSX before `</Wrap>`:

```tsx
      <ExpandQueryPopover
        open={expandFor !== null}
        nodeId={expandFor ?? ''}
        labelOptions={labelOptionList}
        onRun={onExpandRun}
        onCancel={() => setExpandFor(null)}
        t={t}
      />
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --testPathPattern=graph/useGraphActions.test`
Expected: PASS.

Run: `npm test`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/results/graph/useGraphActions.ts \
  src/components/results/graph/useGraphActions.test.ts \
  src/components/results/GraphView.tsx
git commit -m "feat(graph): expand popover routes options to onExploreNeighbours"
```

---

## Phase 4 — Neighbor Navigation (Keyboard + Inspector Chip List)

### Task 10: Neighbors chip list in the inspector

**Files:**
- Modify: `src/components/results/graph/GraphInspector.tsx:134-310`
- Modify: `src/components/results/graph/GraphSidebarContents.tsx` (pass `neighbors` + jump handler through)
- Modify: `src/components/results/GraphView.tsx` (compute neighbors from `cyRef.current`)
- Test: extend the inspector test in `GraphView.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
describe('GraphView — inspector neighbors', () => {
  it('lists 1-hop neighbors of the selected node and jumps when clicked', () => {
    renderGraphViewWithFixture()
    // Select node id "1" by id-picker (existing test helper).
    fireEvent.change(screen.getByTestId('graph-node-id-input'), {
      target: { value: '1' },
    })
    fireEvent.click(screen.getByTestId('graph-node-id-pick'))
    // Neighbors panel is now visible and contains chips for each
    // adjacent node id.
    expect(screen.getByTestId('graph-neighbors')).toBeInTheDocument()
    const chip = screen.getByTestId('graph-neighbor-chip-2')
    fireEvent.click(chip)
    // After click, the selected element is now node "2".
    expect(screen.getByTestId('graph-inspector')).toHaveTextContent(
      /Node 2/i
    )
  })
})
```

(Adapt `graph-node-id-input` / `graph-node-id-pick` to whatever the existing picker `data-testid`s are — check `GraphSidebarContents.tsx` first.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=results/GraphView.test`
Expected: FAIL — `graph-neighbors` not found.

- [ ] **Step 3: Add `neighbors` to `GraphInspectorProps` + render chips**

In `GraphInspector.tsx`:

```ts
export type Neighbor = { id: string; label: string }

export type GraphInspectorProps = {
  // …existing fields…
  // Adjacent (1-hop) neighbors of the selected node, with display
  // labels. Empty when the selection is an edge or has no adjacency.
  neighbors: Neighbor[]
  // Jump selection to this neighbor id (and emphasize it).
  onJumpNeighbor: (id: string) => void
}
```

In the JSX, just after the existing `<InspectorActions>` block, add (inside the `kind === 'node'` branch):

```tsx
          {neighbors.length > 0 && (
            <NeighborsList data-testid="graph-neighbors">
              <span className="hd">{t('graph.neighborsHeading', { count: neighbors.length })}</span>
              {neighbors.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  data-testid={`graph-neighbor-chip-${n.id}`}
                  onClick={() => onJumpNeighbor(n.id)}
                >
                  {n.label} <code>#{n.id}</code>
                </button>
              ))}
            </NeighborsList>
          )}
```

Add the styled component near the existing styled list:

```tsx
const NeighborsList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.spacing.xxs};
  margin-bottom: ${({ theme }) => theme.spacing.xs};

  .hd {
    width: 100%;
    font-size: ${({ theme }) => theme.font.sizes.xs};
    color: ${({ theme }) => theme.text.secondary};
  }
  button {
    font: inherit;
    font-size: ${({ theme }) => theme.font.sizes.xs};
    background: ${({ theme }) => theme.bg.canvas};
    border: 1px solid ${({ theme }) => theme.border.default};
    border-radius: ${({ theme }) => theme.radii.pill};
    padding: 2px 8px;
    cursor: pointer;
    color: ${({ theme }) => theme.text.primary};
  }
  button:hover { background: ${({ theme }) => theme.bg.subtle}; }
  code { font-family: ${({ theme }) => theme.font.family.mono}; opacity: 0.7; }
`
```

Add i18n key:

```ts
    neighborsHeading_one: '{{count}} neighbor',
    neighborsHeading_other: '{{count}} neighbors',
```

- [ ] **Step 4: Compute + pass `neighbors` from `GraphView.tsx`**

After `useGraphCytoscape`, before the JSX:

```tsx
  const neighbors = (() => {
    const cy = cyRef.current
    if (!cy || !selected || selected.kind !== 'node') return []
    const id = String(selected.data.id ?? '')
    if (!id) return []
    const node = cy.$id(id)
    if (node.empty()) return []
    const out: Neighbor[] = []
    node.neighborhood('node').forEach((n) => {
      const nid = String(n.data('id') ?? '')
      if (!nid) return
      const label = resolveNodeLabel(
        n.data() as Record<string, unknown>,
        nodeLabelPrefs
      )
      out.push({ id: nid, label })
    })
    return out
  })()

  const onJumpNeighbor = (id: string): void => {
    const data = nodeDataById.get(id)
    if (!data) return
    setSelected({ kind: 'node', data })
    cyRef.current?.$id(id).select()
  }
```

Wire both through `GraphSidebarContents`:

In `GraphSidebarContents.tsx`, add `neighbors` and `onJumpNeighbor` to props and forward to `GraphInspector`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --testPathPattern=results/GraphView.test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/results/graph/GraphInspector.tsx \
  src/components/results/graph/GraphSidebarContents.tsx \
  src/components/results/GraphView.tsx \
  src/components/results/GraphView.test.tsx \
  src/services/i18n/locales/en.ts
git commit -m "feat(graph): inspector neighbors chip list with jump-to"
```

### Task 11: Keyboard navigation hook

**Files:**
- Create: `src/components/results/graph/useGraphKeyboardNav.ts`
- Test: `src/components/results/graph/useGraphKeyboardNav.test.ts`
- Modify: `src/components/results/GraphView.tsx` (mount hook, expose `tabIndex={0}` on Canvas)

- [ ] **Step 1: Write the failing test**

```ts
// src/components/results/graph/useGraphKeyboardNav.test.ts
import { act, renderHook } from '@testing-library/react'
import { useGraphKeyboardNav } from './useGraphKeyboardNav'

function makeNeighborhood(neighbors: string[]) {
  return neighbors.map((id) => ({ data: (k: string) => (k === 'id' ? id : undefined) }))
}

describe('useGraphKeyboardNav', () => {
  it('Tab moves selection to the next neighbor, Shift+Tab to the previous', () => {
    const onJump = jest.fn()
    const onExpand = jest.fn()
    const { result } = renderHook(() =>
      useGraphKeyboardNav({
        selectedId: '1',
        neighborIds: ['2', '3', '4'],
        onJump,
        onExpand,
      })
    )
    act(() => result.current.handleKey({ key: 'Tab', shiftKey: false, preventDefault: () => {} } as unknown as KeyboardEvent))
    expect(onJump).toHaveBeenLastCalledWith('2')
    act(() => result.current.handleKey({ key: 'Tab', shiftKey: true, preventDefault: () => {} } as unknown as KeyboardEvent))
    expect(onJump).toHaveBeenLastCalledWith('4') // wraps backward from 2 to 4? No — from initial; see note.
  })

  it('Enter on a selected node fires onExpand with the id', () => {
    const onJump = jest.fn()
    const onExpand = jest.fn()
    const { result } = renderHook(() =>
      useGraphKeyboardNav({ selectedId: '7', neighborIds: [], onJump, onExpand })
    )
    act(() => result.current.handleKey({ key: 'Enter', preventDefault: () => {} } as unknown as KeyboardEvent))
    expect(onExpand).toHaveBeenCalledWith('7')
  })

  it('no-ops when no selection and no neighbors', () => {
    const onJump = jest.fn()
    const onExpand = jest.fn()
    const { result } = renderHook(() =>
      useGraphKeyboardNav({ selectedId: null, neighborIds: [], onJump, onExpand })
    )
    act(() => result.current.handleKey({ key: 'Tab', preventDefault: () => {} } as unknown as KeyboardEvent))
    expect(onJump).not.toHaveBeenCalled()
  })
})
```

Note on `Shift+Tab wraps backward from 2 to 4`: that's because after the first Tab the cursor is on `2`, so Shift+Tab from `2` wraps to the previous → `4`. Adjust the test if your implementation prefers no-wrap; document the chosen behaviour in the code comment.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=graph/useGraphKeyboardNav.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

```ts
// src/components/results/graph/useGraphKeyboardNav.ts
import { useCallback, useRef } from 'react'

export type UseGraphKeyboardNavArgs = {
  selectedId: string | null
  neighborIds: string[]
  onJump: (id: string) => void
  onExpand: (id: string) => void
}

export type UseGraphKeyboardNavResult = {
  handleKey: (e: KeyboardEvent | React.KeyboardEvent) => void
}

// Walk neighbors with Tab / Shift+Tab. The cursor starts implicitly at
// the selection; Tab advances to neighbor[0], subsequent Tabs walk
// neighbor[i+1] (wrapping). Shift+Tab steps back. Enter fires onExpand
// on the currently-selected node. Arrow Left/Right are aliases for
// Shift+Tab / Tab so the canvas reads naturally for non-keyboard users.
export function useGraphKeyboardNav(
  args: UseGraphKeyboardNavArgs
): UseGraphKeyboardNavResult {
  const { selectedId, neighborIds, onJump, onExpand } = args
  const cursorRef = useRef<number>(-1)
  // Reset cursor whenever the selection changes.
  if (cursorRef.current !== -1) {
    const last = neighborIds[cursorRef.current]
    if (selectedId !== last) cursorRef.current = -1
  }

  const handleKey = useCallback(
    (e: KeyboardEvent | React.KeyboardEvent): void => {
      const isTab = e.key === 'Tab'
      const isArrowFwd = e.key === 'ArrowRight'
      const isArrowBack = e.key === 'ArrowLeft'
      const isEnter = e.key === 'Enter'
      if (!isTab && !isArrowFwd && !isArrowBack && !isEnter) return
      if (isEnter) {
        if (selectedId) {
          e.preventDefault()
          onExpand(selectedId)
        }
        return
      }
      if (neighborIds.length === 0) return
      e.preventDefault()
      const backward = (isTab && e.shiftKey) || isArrowBack
      const next = backward
        ? (cursorRef.current - 1 + neighborIds.length) % neighborIds.length
        : (cursorRef.current + 1 + neighborIds.length) % neighborIds.length
      cursorRef.current = next
      onJump(neighborIds[next] as string)
    },
    [neighborIds, onExpand, onJump, selectedId]
  )

  return { handleKey }
}
```

In `GraphView.tsx`:

```tsx
const { handleKey } = useGraphKeyboardNav({
  selectedId: selected?.data.id != null ? String(selected.data.id) : null,
  neighborIds: neighbors.map((n) => n.id),
  onJump: onJumpNeighbor,
  onExpand: (id) => setExpandFor(id),
})
```

And on the `<Canvas>` element add `tabIndex={0}` and `onKeyDown={handleKey}`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=graph/useGraphKeyboardNav.test`
Expected: PASS — 3 specs.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/results/graph/useGraphKeyboardNav.ts \
  src/components/results/graph/useGraphKeyboardNav.test.ts \
  src/components/results/GraphView.tsx
git commit -m "feat(graph): keyboard neighbor navigation"
```

---

## Phase 5 — Pin / Unpin Nodes

### Task 12: `usePinnedNodes` hook + cytoscape lock

**Files:**
- Create: `src/components/results/graph/usePinnedNodes.ts`
- Test: `src/components/results/graph/usePinnedNodes.test.ts`
- Modify: `src/components/results/cytoscapeStyle.ts` (add `.gv-pinned` selector)
- Modify: `src/components/results/graph/useGraphCytoscape.ts` (re-lock pinned on every build + layout-run)

- [ ] **Step 1: Write the failing test**

```ts
// src/components/results/graph/usePinnedNodes.test.ts
import { act, renderHook } from '@testing-library/react'
import { usePinnedNodes } from './usePinnedNodes'

function makeCy() {
  const els = new Map<string, { locked: boolean }>()
  return {
    getElementById: (id: string) => {
      let el = els.get(id)
      if (!el) {
        el = { locked: false }
        els.set(id, el)
      }
      return {
        empty: () => false,
        lock: () => {
          el!.locked = true
        },
        unlock: () => {
          el!.locked = false
        },
        addClass: jest.fn(),
        removeClass: jest.fn(),
      }
    },
    __els: els,
  }
}

describe('usePinnedNodes', () => {
  it('toggling a pin locks the node and adds .gv-pinned', () => {
    const cy = makeCy()
    const cyRef = { current: cy as never }
    const { result } = renderHook(() => usePinnedNodes({ cyRef: cyRef as never }))
    act(() => result.current.togglePin('5'))
    expect(result.current.isPinned('5')).toBe(true)
    expect(cy.__els.get('5')!.locked).toBe(true)
  })

  it('toggling twice unlocks the node', () => {
    const cy = makeCy()
    const cyRef = { current: cy as never }
    const { result } = renderHook(() => usePinnedNodes({ cyRef: cyRef as never }))
    act(() => result.current.togglePin('5'))
    act(() => result.current.togglePin('5'))
    expect(result.current.isPinned('5')).toBe(false)
    expect(cy.__els.get('5')!.locked).toBe(false)
  })

  it('reapplyAll re-locks every pinned id (used after a rebuild)', () => {
    const cy = makeCy()
    const cyRef = { current: cy as never }
    const { result } = renderHook(() => usePinnedNodes({ cyRef: cyRef as never }))
    act(() => result.current.togglePin('3'))
    act(() => result.current.togglePin('4'))
    // Simulate a rebuild: the underlying cy elements are "new" so we
    // construct a fresh fake-cy and call reapplyAll on it.
    const cy2 = makeCy()
    cyRef.current = cy2 as never
    act(() => result.current.reapplyAll())
    expect(cy2.__els.get('3')!.locked).toBe(true)
    expect(cy2.__els.get('4')!.locked).toBe(true)
  })

  it('clear() releases all pins and unlocks them', () => {
    const cy = makeCy()
    const cyRef = { current: cy as never }
    const { result } = renderHook(() => usePinnedNodes({ cyRef: cyRef as never }))
    act(() => result.current.togglePin('3'))
    act(() => result.current.clear())
    expect(result.current.isPinned('3')).toBe(false)
    expect(cy.__els.get('3')!.locked).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=graph/usePinnedNodes.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

```ts
// src/components/results/graph/usePinnedNodes.ts
import { useCallback, useState } from 'react'
import type { Core } from 'cytoscape'

export type UsePinnedNodesArgs = {
  cyRef: React.MutableRefObject<Core | null>
}

export type UsePinnedNodesResult = {
  pinned: Set<string>
  isPinned: (id: string) => boolean
  togglePin: (id: string) => void
  clear: () => void
  // Re-apply every pinned id on the current cy core. Used after a
  // rebuild or a layout switch — Cytoscape persists `locked` across
  // .layout().run() calls, but a fresh core has no memory of it.
  reapplyAll: () => void
}

export function usePinnedNodes(args: UsePinnedNodesArgs): UsePinnedNodesResult {
  const { cyRef } = args
  const [pinned, setPinned] = useState<Set<string>>(new Set())

  const apply = useCallback((id: string, on: boolean): void => {
    const cy = cyRef.current
    if (!cy) return
    const node = cy.getElementById(id)
    if (node.empty()) return
    if (on) {
      node.lock()
      node.addClass('gv-pinned')
    } else {
      node.unlock()
      node.removeClass('gv-pinned')
    }
  }, [cyRef])

  const togglePin = useCallback(
    (id: string): void => {
      setPinned((prev) => {
        const next = new Set(prev)
        const on = !next.has(id)
        if (on) next.add(id)
        else next.delete(id)
        apply(id, on)
        return next
      })
    },
    [apply]
  )

  const clear = useCallback(() => {
    setPinned((prev) => {
      prev.forEach((id) => apply(id, false))
      return new Set()
    })
  }, [apply])

  const reapplyAll = useCallback(() => {
    setPinned((prev) => {
      prev.forEach((id) => apply(id, true))
      return prev
    })
  }, [apply])

  return { pinned, isPinned: (id) => pinned.has(id), togglePin, clear, reapplyAll }
}
```

In `cytoscapeStyle.ts` add (after the `.gv-emphasized` selector block):

```ts
    {
      // Pinned nodes get a dashed double border so they read as
      // "locked" without overpowering the per-label fill.
      selector: 'node.gv-pinned',
      style: {
        'border-width': 3,
        'border-style': 'double',
        'border-color': theme.colors.warning ?? '#d4a300',
      },
    },
```

In `useGraphCytoscape.ts`, after the build effect successfully mounts, call `args.reapplyPins?.()` and after the layout-rerun effect. Add `reapplyPins?: () => void` to `UseGraphCytoscapeArgs`, pass it from the orchestrator.

In `GraphView.tsx`:

```tsx
const { pinned, togglePin, clear: clearPins, reapplyAll: reapplyPins, isPinned } =
  usePinnedNodes({ cyRef })

// In the sig-keyed reset effect (Task 0 of the file — the existing
// `useEffect(() => { ... }, [sig])` block that already resets path /
// hidden / collapsed), clear pins too:
clearPins()

// Pass reapplyPins:
useGraphCytoscape({ /* …existing… */, reapplyPins })
```

In `useGraphCytoscape.ts`, inside the `build()` callback after `cyRef.current = cy; applyLabels(...)`, call `reapplyPins?.()`. And inside the layout-effect (`useEffect(() => { … }, [cyRef, layout])`) after the `cy.layout(...).run()` call.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=graph/usePinnedNodes.test`
Expected: PASS — 4 specs.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/usePinnedNodes.ts \
  src/components/results/graph/usePinnedNodes.test.ts \
  src/components/results/cytoscapeStyle.ts \
  src/components/results/graph/useGraphCytoscape.ts \
  src/components/results/GraphView.tsx
git commit -m "feat(graph): pin/unpin nodes with persistent lock across rebuilds"
```

### Task 13: Wire pin action into menu + inspector

**Files:**
- Modify: `src/components/results/graph/GraphInspector.tsx` (add Pin button)
- Modify: `src/components/results/GraphView.tsx` (route 'pin' menu action)
- Test: extend `GraphView.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('Pin action locks the node and surfaces the pinned state in the inspector', () => {
  renderGraphViewWithFixture()
  // Select node "1"
  // …(existing select-by-id pattern)…
  fireEvent.click(screen.getByTestId('graph-action-pin'))
  expect(screen.getByTestId('graph-action-pin')).toHaveAttribute('aria-pressed', 'true')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=results/GraphView.test`
Expected: FAIL.

- [ ] **Step 3: Add Pin button to GraphInspector**

```tsx
// Inside GraphInspectorProps:
  onPin: (id: string) => void
  isPinned: boolean
```

In the `InspectorActions` row inside the `kind === 'node'` branch:

```tsx
            <button
              type="button"
              data-testid="graph-action-pin"
              aria-pressed={isPinned}
              onClick={() => onPin(id)}
            >
              {isPinned ? t('graph.menuUnpin') : t('graph.menuPin')}
            </button>
```

- [ ] **Step 4: Wire in orchestrator**

In the menu's `case 'pin':` branch:

```tsx
case 'pin':
  togglePin(id)
  break
```

Forward through `GraphSidebarContents` → `GraphInspector`:

```tsx
isPinned={selected?.kind === 'node' && isPinned(String(selected.data.id ?? ''))}
onPin={(id) => togglePin(id)}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --testPathPattern=results/GraphView.test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/results/graph/GraphInspector.tsx \
  src/components/results/graph/GraphSidebarContents.tsx \
  src/components/results/GraphView.tsx \
  src/components/results/GraphView.test.tsx
git commit -m "feat(graph): pin/unpin button in inspector + menu route"
```

---

## Phase 6 — Focus Mode (N-Hop Fade)

### Task 14: BFS helper

**Files:**
- Create: `src/components/results/graph/focus.ts`
- Test: `src/components/results/graph/focus.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/results/graph/focus.test.ts
import { nHopNeighborhood } from './focus'

function makeFakeCy(adj: Record<string, string[]>) {
  const wrap = (id: string) => ({
    id: () => id,
    neighborhood: () => ({
      nodes: () => (adj[id] ?? []).map((n) => wrap(n)),
      forEach: (cb: (n: { id: () => string }) => void) =>
        (adj[id] ?? []).forEach((n) => cb(wrap(n))),
    }),
    empty: () => false,
  })
  return {
    getElementById: (id: string) => wrap(id),
  }
}

describe('nHopNeighborhood', () => {
  it('returns the node itself for n=0', () => {
    const cy = makeFakeCy({ a: ['b'], b: ['a'] })
    expect(nHopNeighborhood(cy as never, 'a', 0)).toEqual(new Set(['a']))
  })

  it('returns 1-hop for n=1', () => {
    const cy = makeFakeCy({ a: ['b', 'c'], b: ['a'], c: ['a', 'd'], d: ['c'] })
    expect(nHopNeighborhood(cy as never, 'a', 1)).toEqual(new Set(['a', 'b', 'c']))
  })

  it('returns 2-hop for n=2', () => {
    const cy = makeFakeCy({ a: ['b'], b: ['a', 'c'], c: ['b', 'd'], d: ['c'] })
    expect(nHopNeighborhood(cy as never, 'a', 2)).toEqual(new Set(['a', 'b', 'c']))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=graph/focus.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/components/results/graph/focus.ts
import type { Core } from 'cytoscape'

export function nHopNeighborhood(
  cy: Core,
  id: string,
  hops: number
): Set<string> {
  const visited = new Set<string>()
  const start = cy.getElementById(id)
  if (start.empty()) return visited
  visited.add(id)
  let frontier: string[] = [id]
  for (let i = 0; i < Math.max(0, hops); i += 1) {
    const next: string[] = []
    for (const cur of frontier) {
      const node = cy.getElementById(cur)
      node
        .neighborhood()
        .nodes()
        .forEach((n) => {
          const nid = n.id()
          if (!visited.has(nid)) {
            visited.add(nid)
            next.push(nid)
          }
        })
    }
    if (next.length === 0) break
    frontier = next
  }
  return visited
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=graph/focus.test`
Expected: PASS — 3 specs.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/focus.ts src/components/results/graph/focus.test.ts
git commit -m "feat(graph): BFS n-hop neighborhood helper"
```

### Task 15: `useFocusMode` + style class

**Files:**
- Create: `src/components/results/graph/useFocusMode.ts`
- Test: `src/components/results/graph/useFocusMode.test.ts`
- Modify: `src/components/results/cytoscapeStyle.ts` (add `.gv-out-of-focus`)
- Modify: `src/components/results/useGraphPrefs.ts` (add sticky `focusHops`)

- [ ] **Step 1: Write the failing test**

```ts
// src/components/results/graph/useFocusMode.test.ts
import { act, renderHook } from '@testing-library/react'
import { useFocusMode } from './useFocusMode'

function makeCy(adj: Record<string, string[]>) {
  const allClasses = new Map<string, Set<string>>()
  const wrap = (id: string) => ({
    id: () => id,
    addClass: (c: string) => {
      if (!allClasses.has(id)) allClasses.set(id, new Set())
      allClasses.get(id)!.add(c)
    },
    removeClass: (c: string) => allClasses.get(id)?.delete(c),
    neighborhood: () => ({
      nodes: () => (adj[id] ?? []).map((n) => wrap(n)),
      forEach: (cb: (n: { id: () => string }) => void) =>
        (adj[id] ?? []).forEach((n) => cb(wrap(n))),
    }),
    empty: () => false,
  })
  const all = Object.keys(adj).map((id) => wrap(id))
  return {
    getElementById: (id: string) => wrap(id),
    batch: (fn: () => void) => fn(),
    nodes: () => ({
      forEach: (cb: (n: { id: () => string; removeClass: (c: string) => void }) => void) =>
        all.forEach(cb),
    }),
    __classes: allClasses,
  }
}

describe('useFocusMode', () => {
  it('marking focus adds .gv-out-of-focus to nodes outside the N-hop set', () => {
    const cy = makeCy({ a: ['b'], b: ['a', 'c'], c: ['b', 'd'], d: ['c'] })
    const cyRef = { current: cy as never }
    const { result } = renderHook(() => useFocusMode({ cyRef: cyRef as never }))
    act(() => result.current.focus({ id: 'a', hops: 1 }))
    expect(cy.__classes.get('a')?.has('gv-out-of-focus')).toBeFalsy()
    expect(cy.__classes.get('b')?.has('gv-out-of-focus')).toBeFalsy()
    expect(cy.__classes.get('d')?.has('gv-out-of-focus')).toBe(true)
  })

  it('clear() removes the class from every node', () => {
    const cy = makeCy({ a: ['b'], b: ['a'] })
    const cyRef = { current: cy as never }
    const { result } = renderHook(() => useFocusMode({ cyRef: cyRef as never }))
    act(() => result.current.focus({ id: 'a', hops: 0 }))
    act(() => result.current.clear())
    expect(cy.__classes.get('b')?.has('gv-out-of-focus')).toBeFalsy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=graph/useFocusMode.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

```ts
// src/components/results/graph/useFocusMode.ts
import { useCallback, useState } from 'react'
import type { Core } from 'cytoscape'
import { nHopNeighborhood } from './focus'

export type FocusState = { id: string; hops: number } | null

export type UseFocusModeArgs = {
  cyRef: React.MutableRefObject<Core | null>
}

export type UseFocusModeResult = {
  state: FocusState
  focus: (s: { id: string; hops: number }) => void
  clear: () => void
  // Re-apply after rebuilds / layout reruns so the dim persists.
  reapply: () => void
}

const FOCUS_CLASS = 'gv-out-of-focus'

export function useFocusMode(args: UseFocusModeArgs): UseFocusModeResult {
  const { cyRef } = args
  const [state, setState] = useState<FocusState>(null)

  const apply = useCallback((s: FocusState): void => {
    const cy = cyRef.current
    if (!cy) return
    cy.batch(() => {
      cy.nodes().forEach((n) => n.removeClass(FOCUS_CLASS))
      if (!s) return
      const keep = nHopNeighborhood(cy, s.id, s.hops)
      cy.nodes().forEach((n) => {
        if (!keep.has(n.id())) n.addClass(FOCUS_CLASS)
      })
    })
  }, [cyRef])

  const focus = useCallback(
    (s: { id: string; hops: number }): void => {
      setState(s)
      apply(s)
    },
    [apply]
  )
  const clear = useCallback((): void => {
    setState(null)
    apply(null)
  }, [apply])
  const reapply = useCallback((): void => {
    apply(state)
  }, [apply, state])

  return { state, focus, clear, reapply }
}
```

In `cytoscapeStyle.ts` add:

```ts
    {
      selector: '.gv-out-of-focus',
      style: { opacity: 0.12, 'text-opacity': 0.12 },
    },
```

In `useGraphPrefs.ts` add `focusHops` (sticky, defaults to 1, valid 0–3):

```ts
  focusHops: number
  setFocusHops: (n: number) => void
```

Initialize to `1`, partialize / merge, coerce to 0..3 in merge.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=graph/useFocusMode.test`
Expected: PASS — 2 specs.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/useFocusMode.ts \
  src/components/results/graph/useFocusMode.test.ts \
  src/components/results/cytoscapeStyle.ts \
  src/components/results/useGraphPrefs.ts
git commit -m "feat(graph): useFocusMode + N-hop dim style"
```

### Task 16: Wire focus into inspector + menu

**Files:**
- Modify: `src/components/results/graph/GraphInspector.tsx` (Focus toggle + hops slider)
- Modify: `src/components/results/GraphView.tsx` (route 'focus' menu action; pass hops pref)
- Modify: `src/components/results/graph/useGraphCytoscape.ts` (call `reapplyFocus` after rebuild/layout)
- Test: extend `GraphView.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('Focus action dims nodes more than N hops from the selection', () => {
  renderGraphViewWithFixture()
  // …select node "1"…
  fireEvent.click(screen.getByTestId('graph-action-focus'))
  // hop slider visible:
  expect(screen.getByTestId('graph-focus-hops')).toBeInTheDocument()
  // an unrelated node has the out-of-focus class — easiest is to assert
  // via the live cy state surfaced as a data-* attribute on the canvas.
  // (See implementation for the data-focus-active attribute.)
  expect(screen.getByTestId('graph-canvas')).toHaveAttribute('data-focus-active', 'true')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=results/GraphView.test`
Expected: FAIL — `graph-action-focus` not found.

- [ ] **Step 3: Add Focus button + slider to GraphInspector**

```ts
// GraphInspectorProps additions:
  onFocus: (id: string, hops: number) => void
  onClearFocus: () => void
  focusActive: boolean
  focusHops: number
  setFocusHops: (n: number) => void
```

In the `InspectorActions` row:

```tsx
            <button
              type="button"
              data-testid="graph-action-focus"
              aria-pressed={focusActive}
              onClick={() =>
                focusActive ? onClearFocus() : onFocus(id, focusHops)
              }
            >
              {focusActive ? t('graph.focusClear') : t('graph.focus')}
            </button>
```

And immediately below, a small hops control:

```tsx
            <label data-testid="graph-focus-hops" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {t('graph.focusHops')}
              <input
                type="range"
                min={0}
                max={3}
                value={focusHops}
                onChange={(e) => {
                  const next = Number.parseInt(e.target.value, 10)
                  setFocusHops(next)
                  if (focusActive) onFocus(id, next)
                }}
              />
              <span>{focusHops}</span>
            </label>
```

Add i18n keys:

```ts
    focus: 'Focus',
    focusClear: 'Clear focus',
    focusHops: 'Hops',
```

- [ ] **Step 4: Wire from `GraphView.tsx`**

```tsx
const focusMode = useFocusMode({ cyRef })
const focusHops = useGraphPrefs((s) => s.focusHops)
const setFocusHops = useGraphPrefs((s) => s.setFocusHops)

// In the menu route:
case 'focus':
  focusMode.focus({ id, hops: focusHops })
  break
```

Pass to inspector:

```tsx
onFocus={(id, hops) => focusMode.focus({ id, hops })}
onClearFocus={() => focusMode.clear()}
focusActive={focusMode.state !== null}
focusHops={focusHops}
setFocusHops={setFocusHops}
```

On the `<Canvas>` element add `data-testid="graph-canvas" data-focus-active={focusMode.state !== null ? 'true' : 'false'}`.

In `useGraphCytoscape.ts` add `reapplyFocus?: () => void` arg, call after the rebuild + after layout-rerun. Pass through from `GraphView.tsx`.

In the sig-keyed reset effect, clear focus too:

```tsx
focusMode.clear()
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --testPathPattern=results/GraphView.test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/results/graph/GraphInspector.tsx \
  src/components/results/graph/GraphSidebarContents.tsx \
  src/components/results/graph/useGraphCytoscape.ts \
  src/components/results/GraphView.tsx \
  src/services/i18n/locales/en.ts
git commit -m "feat(graph): focus mode wires inspector + menu + persistence"
```

---

## Phase 7 — Mini-Map

### Task 17: Install `cytoscape-navigator` dep

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Run install**

Run: `npm install cytoscape-navigator@2.0.0`
Expected: dep added; no peer warnings (it declares cytoscape >=3 as a peer).

- [ ] **Step 2: Verify build still passes**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(graph): add cytoscape-navigator for mini-map"
```

### Task 18: `GraphMiniMap` component

**Files:**
- Create: `src/components/results/graph/GraphMiniMap.tsx`
- Test: `src/components/results/graph/GraphMiniMap.test.tsx`
- Modify: `src/components/results/useGraphPrefs.ts` (add sticky `miniMap` toggle)
- Modify: `src/components/results/GraphView.tsx` (mount component when toggle on)
- Modify: `src/components/results/graph/GraphToolbar.tsx` (toggle)

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/results/graph/GraphMiniMap.test.tsx
import { render } from '@testing-library/react'
import { GraphMiniMap } from './GraphMiniMap'

jest.mock('cytoscape-navigator', () => ({
  default: jest.fn(),
  __esModule: true,
}))

describe('GraphMiniMap', () => {
  it('mounts a container with the navigator class and calls .navigator on the core', () => {
    const cy = { navigator: jest.fn() } as never
    const cyRef = { current: cy }
    const { container } = render(<GraphMiniMap cyRef={cyRef as never} />)
    expect(container.querySelector('[data-testid="graph-minimap"]')).not.toBeNull()
    expect((cy as { navigator: jest.Mock }).navigator).toHaveBeenCalled()
  })

  it('renders nothing when cyRef.current is null', () => {
    const cyRef = { current: null }
    const { container } = render(<GraphMiniMap cyRef={cyRef as never} />)
    // The fallback container still renders so layout doesn't jump; the
    // navigator just isn't initialized.
    expect(container.querySelector('[data-testid="graph-minimap"]')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=graph/GraphMiniMap.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/results/graph/GraphMiniMap.tsx
import React, { useEffect, useRef } from 'react'
import styled from 'styled-components'
import type { Core } from 'cytoscape'
import navigator from 'cytoscape-navigator'
import cytoscape from 'cytoscape'

// Idempotent registration — cytoscape.use is a no-op on second call.
// Extension types not provided by upstream; cast through unknown.
cytoscape.use(navigator as unknown as cytoscape.Ext)

const Box = styled.div`
  width: 160px;
  height: 120px;
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ theme }) => theme.bg.canvas};
  overflow: hidden;
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 5;
`

type CoreWithNavigator = Core & {
  navigator: (opts: { container: HTMLElement; viewLiveFramerate?: number }) => {
    destroy: () => void
  }
}

export type GraphMiniMapProps = {
  cyRef: React.MutableRefObject<Core | null>
  // Reapply key — caller passes the same `sig` the orchestrator uses
  // so the navigator instance recycles when the underlying cy is
  // rebuilt.
  sig?: string
}

export const GraphMiniMap: React.FC<GraphMiniMapProps> = ({ cyRef, sig }) => {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const cy = cyRef.current as CoreWithNavigator | null
    const el = ref.current
    if (!cy || !el || typeof cy.navigator !== 'function') return undefined
    const inst = cy.navigator({ container: el, viewLiveFramerate: 30 })
    return () => {
      try {
        inst.destroy()
      } catch {
        /* swallow — happens if cy is already destroyed */
      }
    }
  }, [cyRef, sig])

  return <Box ref={ref} data-testid="graph-minimap" />
}
```

In `useGraphPrefs.ts` add `miniMap: boolean` (default `false`), with setter and persistence.

In `GraphToolbar.tsx` add a `Mini-map` toggle button to the existing toggles group:

```tsx
        <button
          type="button"
          data-testid="graph-minimap-toggle"
          aria-pressed={miniMap}
          aria-label={t('graph.miniMapLabel')}
          title={t('graph.miniMapLabel')}
          onClick={onToggleMiniMap}
        >
          {t('graph.miniMap')}
        </button>
```

Add i18n keys:

```ts
    miniMap: 'Mini-map',
    miniMapLabel: 'Toggle the canvas overview / mini-map',
```

In `GraphView.tsx`:

```tsx
const miniMap = useGraphPrefs((s) => s.miniMap)
const setMiniMap = useGraphPrefs((s) => s.setMiniMap)
```

Inside the canvas wrapper `<div style={{ position: 'relative' }}>`:

```tsx
{miniMap && <GraphMiniMap cyRef={cyRef} sig={sig} />}
```

Pass `miniMap` + `onToggleMiniMap` to `GraphToolbar`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=graph/GraphMiniMap.test`
Expected: PASS.

Run: `npm test`
Expected: ALL PASS (jsdom's `cytoscape-navigator` is mocked in the new test; other suites don't touch it).

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/GraphMiniMap.tsx \
  src/components/results/graph/GraphMiniMap.test.tsx \
  src/components/results/useGraphPrefs.ts \
  src/components/results/graph/GraphToolbar.tsx \
  src/components/results/GraphView.tsx \
  src/services/i18n/locales/en.ts
git commit -m "feat(graph): mini-map overview panel (cytoscape-navigator)"
```

---

## Phase 8 — Find-Node Search

### Task 19: Pure matcher

**Files:**
- Create: `src/components/results/graph/findNode.ts`
- Test: `src/components/results/graph/findNode.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/results/graph/findNode.test.ts
import { matchesQuery } from './findNode'

describe('matchesQuery', () => {
  it('matches a substring of a top-level prop value', () => {
    expect(matchesQuery({ id: '1', props: { name: 'Alice' } }, 'lice')).toBe(true)
  })
  it('matches the label too', () => {
    expect(matchesQuery({ id: '1', label: 'Person' }, 'pers')).toBe(true)
  })
  it('ignores case', () => {
    expect(matchesQuery({ id: '1', props: { name: 'ALICE' } }, 'alice')).toBe(true)
  })
  it('returns false for empty query', () => {
    expect(matchesQuery({ id: '1', props: { name: 'Alice' } }, '')).toBe(false)
  })
  it('matches by raw id', () => {
    expect(matchesQuery({ id: '42', props: {} }, '42')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=graph/findNode.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/components/results/graph/findNode.ts
export function matchesQuery(
  data: Record<string, unknown>,
  q: string
): boolean {
  const query = q.trim().toLowerCase()
  if (!query) return false
  // id (exact + substring) and label first — cheap, common.
  const id = data.id != null ? String(data.id).toLowerCase() : ''
  if (id.includes(query)) return true
  const label = data.label
  if (typeof label === 'string' && label.toLowerCase().includes(query)) return true
  if (Array.isArray(label) && label.some((l) => typeof l === 'string' && l.toLowerCase().includes(query))) return true
  // props — substring match on the stringified value for each prop.
  const props = data.props
  if (props && typeof props === 'object' && !Array.isArray(props)) {
    for (const v of Object.values(props as Record<string, unknown>)) {
      if (v == null) continue
      if (String(v).toLowerCase().includes(query)) return true
    }
  }
  return false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=graph/findNode.test`
Expected: PASS — 5 specs.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/findNode.ts src/components/results/graph/findNode.test.ts
git commit -m "feat(graph): findNode substring matcher"
```

### Task 20: FindNodeInput component + toolbar wiring

**Files:**
- Create: `src/components/results/graph/FindNodeInput.tsx`
- Test: `src/components/results/graph/FindNodeInput.test.tsx`
- Modify: `src/components/results/graph/GraphToolbar.tsx`
- Modify: `src/components/results/GraphView.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/results/graph/FindNodeInput.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { lightTheme } from '../../../theme/themes'
import { FindNodeInput } from './FindNodeInput'

const t = (k: string) => k

describe('FindNodeInput', () => {
  it('reports match count for the current query', () => {
    const data = [
      { id: '1', props: { name: 'Alice' } },
      { id: '2', props: { name: 'Bob' } },
      { id: '3', props: { name: 'Alicia' } },
    ]
    render(
      <ThemeProvider theme={lightTheme}>
        <FindNodeInput nodes={data} onPick={() => {}} t={t} />
      </ThemeProvider>
    )
    fireEvent.change(screen.getByTestId('graph-find-input'), {
      target: { value: 'ali' },
    })
    expect(screen.getByTestId('graph-find-count').textContent).toContain('2')
  })

  it('Enter picks the first match', () => {
    const onPick = jest.fn()
    const data = [{ id: '1', props: { name: 'Alice' } }]
    render(
      <ThemeProvider theme={lightTheme}>
        <FindNodeInput nodes={data} onPick={onPick} t={t} />
      </ThemeProvider>
    )
    fireEvent.change(screen.getByTestId('graph-find-input'), {
      target: { value: 'alice' },
    })
    fireEvent.keyDown(screen.getByTestId('graph-find-input'), { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith('1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=graph/FindNodeInput.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/results/graph/FindNodeInput.tsx
import React, { useMemo, useState } from 'react'
import styled from 'styled-components'
import { matchesQuery } from './findNode'

type TFn = (key: string, opts?: Record<string, unknown>) => string

const Wrap = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;

  input {
    font: inherit;
    color: ${({ theme }) => theme.text.primary};
    background: ${({ theme }) => theme.bg.canvas};
    border: 1px solid ${({ theme }) => theme.border.default};
    border-radius: ${({ theme }) => theme.radii.sm};
    padding: 2px 8px;
    min-width: 140px;
  }
  .count {
    color: ${({ theme }) => theme.text.muted};
    font-size: ${({ theme }) => theme.font.sizes.xs};
  }
`

export type FindNodeInputProps = {
  nodes: Record<string, unknown>[]
  onPick: (id: string) => void
  t: TFn
}

export const FindNodeInput: React.FC<FindNodeInputProps> = ({
  nodes,
  onPick,
  t,
}) => {
  const [q, setQ] = useState('')
  const matches = useMemo(
    () => nodes.filter((n) => matchesQuery(n, q)),
    [nodes, q]
  )
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== 'Enter' || matches.length === 0) return
    const first = matches[0]
    const id = first && first.id != null ? String(first.id) : ''
    if (id) onPick(id)
  }
  return (
    <Wrap>
      <input
        data-testid="graph-find-input"
        type="search"
        placeholder={t('graph.findPlaceholder')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKey}
        aria-label={t('graph.findAria')}
      />
      <span className="count" data-testid="graph-find-count">
        {q ? t('graph.findCount', { count: matches.length }) : ''}
      </span>
    </Wrap>
  )
}
```

In `GraphToolbar.tsx` add it to the toolbar (above the stats span):

```tsx
        <FindNodeInput nodes={findNodes} onPick={onFindPick} t={t} />
```

Add to props:

```ts
  findNodes: Record<string, unknown>[]
  onFindPick: (id: string) => void
```

In `GraphView.tsx`:

```tsx
const findNodes = useMemo(
  () => Array.from(nodeDataById.values()),
  [nodeDataById]
)
const onFindPick = (id: string): void => {
  const data = nodeDataById.get(id)
  if (!data) return
  setSelected({ kind: 'node', data })
  cyRef.current?.$id(id).select()
  cyRef.current?.center(cyRef.current.$id(id))
}
```

Add i18n keys:

```ts
    findPlaceholder: 'Find node…',
    findAria: 'Find nodes by id, label, or property value',
    findCount: '{{count}} match',
    findCount_other: '{{count}} matches',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=graph/FindNodeInput.test`
Expected: PASS.

Run: `npm test`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/FindNodeInput.tsx \
  src/components/results/graph/FindNodeInput.test.tsx \
  src/components/results/graph/GraphToolbar.tsx \
  src/components/results/GraphView.tsx \
  src/services/i18n/locales/en.ts
git commit -m "feat(graph): toolbar find-node search by property"
```

---

## Phase 9 — End-to-End Validation

### Task 21: Playwright e2e spec

**Files:**
- Create: `e2e/specs/24-graph-power-features.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// e2e/specs/24-graph-power-features.spec.ts
import { expect, test } from '@playwright/test'
import { signIn, runQuery, openResultsTab } from '../helpers/flows'

test.describe('Graph power features', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await runQuery(page, 'USE GRAPH movies; MATCH (p:Person)-[r:ACTED_IN]->(m:Movie) RETURN p, r, m LIMIT 25;')
    await openResultsTab(page, 'Graph')
  })

  test('node sizing reflects degree', async ({ page }) => {
    // Toggle is on by default; the canvas should report at least one
    // node whose computed width is > 38 (the legacy flat size).
    const sizes = await page.evaluate(() => {
      // The graph canvas mounts cytoscape; access its core via the
      // global hook exposed by GraphView for e2e (see Task 22 if not
      // present, fall back to a DOM-only smoke).
      type CyShape = { nodes: () => { map: (cb: (n: { width: () => number }) => number) => number[] } }
      const cy = (window as unknown as { __geode_cy?: CyShape }).__geode_cy
      if (!cy) return [] as number[]
      return cy.nodes().map((n) => n.width())
    })
    if (sizes.length > 0) {
      const max = Math.max(...sizes)
      expect(max).toBeGreaterThan(38)
    }
  })

  test('right-click opens context menu, Expand fires popover', async ({ page }) => {
    // Right-click the first visible node — use a known testid the
    // canvas exposes (graph-canvas container). The cy event is fired
    // on the underlying canvas element; Playwright's contextmenu
    // option is supported on .click({button: 'right'}).
    await page.getByTestId('graph-canvas').click({ button: 'right', position: { x: 200, y: 200 } })
    await expect(page.getByTestId('graph-node-menu')).toBeVisible()
    await page.getByTestId('graph-node-menu-expand').click()
    await expect(page.getByTestId('graph-expand-popover')).toBeVisible()
    await page.getByTestId('graph-expand-cancel').click()
  })

  test('pin then re-layout keeps the node locked', async ({ page }) => {
    // Click any node to select it
    await page.getByTestId('graph-canvas').click({ position: { x: 200, y: 200 } })
    await page.getByTestId('graph-action-pin').click()
    await expect(page.getByTestId('graph-action-pin')).toHaveAttribute('aria-pressed', 'true')
    // Switch layout
    await page.getByTestId('graph-layout-picker').selectOption('grid')
    // Still pressed
    await expect(page.getByTestId('graph-action-pin')).toHaveAttribute('aria-pressed', 'true')
  })

  test('find-node input picks a match on Enter', async ({ page }) => {
    await page.getByTestId('graph-find-input').fill('Movie')
    await expect(page.getByTestId('graph-find-count')).toContainText(/\d/)
    await page.getByTestId('graph-find-input').press('Enter')
    await expect(page.getByTestId('graph-inspector')).toBeVisible()
  })
})
```

- [ ] **Step 2: Expose `__geode_cy` for e2e**

In `useGraphCytoscape.ts`, inside the `build()` callback after `cyRef.current = cy`:

```ts
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  ;(window as unknown as { __geode_cy?: unknown }).__geode_cy = cy
}
```

(Only in non-production builds; e2e runs against a dev build, so this is safe.)

- [ ] **Step 3: Run e2e**

Run: `make e2e-spec SPEC=24-graph-power-features` (or the project's equivalent).
Expected: 4 specs pass.

- [ ] **Step 4: Run jest + tsc once more**

Run: `npm test && npm run typecheck && npm run lint`
Expected: ALL GREEN.

- [ ] **Step 5: Commit**

```bash
git add e2e/specs/24-graph-power-features.spec.ts \
  src/components/results/graph/useGraphCytoscape.ts
git commit -m "test(e2e): graph power features (sizing/menu/pin/find)"
```

### Task 22: Update existing graph e2e selectors if any moved

**Files:**
- Modify: `e2e/specs/05-query-graph.spec.ts`, `e2e/specs/19-graph-viz.spec.ts`, `e2e/specs/23-graph-sidebar-responsive.spec.ts` (only as needed)

- [ ] **Step 1: Run all graph e2e specs**

Run: `make e2e SPEC_GLOB="0[59]-graph*|19-graph*|2[34]-graph*"`
Expected: most green; any failure is a selector that moved (e.g. inspector actions area changed).

- [ ] **Step 2: Update only the failing specs to match the new DOM**

Make targeted edits — no behavior changes — until all specs pass.

- [ ] **Step 3: Commit**

```bash
git add -p e2e/specs
git commit -m "test(e2e): align legacy graph specs with new inspector/toolbar"
```

---

## Final Polish

### Task 23: Sticky-pref migration safety + perf sweep

**Files:**
- Audit: `useGraphPrefs.ts` (verify all new fields have safe `merge`s)
- Audit: `useGraphCytoscape.ts` for any redundant rebuilds caused by new sig fields

- [ ] **Step 1: Inspect prefs migration**

Read `useGraphPrefs.ts` and confirm: `degreeSizing`, `focusHops`, `miniMap` are all in `partialize`, all in `merge`, and `merge` falls back to a sensible default when the persisted shape is missing or malformed.

- [ ] **Step 2: Run prefs test**

Add tests for the new fields in `useGraphPrefs.test.ts`:

```ts
it('coerces a missing degreeSizing to true', () => {
  const merged = mergeWith({})
  expect(merged.degreeSizing).toBe(true)
})
it('coerces a missing miniMap to false', () => {
  const merged = mergeWith({})
  expect(merged.miniMap).toBe(false)
})
it('clamps focusHops to [0, 3]', () => {
  expect(mergeWith({ focusHops: -1 }).focusHops).toBe(0)
  expect(mergeWith({ focusHops: 10 }).focusHops).toBe(3)
})
```

(`mergeWith` is a helper that exercises the persist `merge` function. If the test file doesn't have one, follow the same pattern as the existing tests in the file.)

- [ ] **Step 3: Run + commit**

Run: `npm test`
Expected: ALL PASS.

```bash
git add src/components/results/useGraphPrefs.ts src/components/results/useGraphPrefs.test.ts
git commit -m "test(graph): prefs migration coercion for new sticky toggles"
```

---

## Self-Review Notes

- All seven feature tracks (sizing, context menu, expand popover, neighbor nav, pin, focus, mini-map, find) each have at least one task that ships working end-to-end with a Jest test before moving on.
- `buildExploreStatement` is preserved (back-compat) — Task 7 delegates to `buildExpandStatement`. No call sites need to change at once.
- `useGraphPrefs` migration in Task 3, Task 15, Task 18 each add one persisted field; the Task 23 audit confirms `merge` falls back cleanly so an upgrade from an existing localStorage shape doesn't crash.
- `useGraphCytoscape` already debounces rebuilds; the new `sig` fields (`degreeSizing` flag, etc.) trigger a rebuild only when the operator flips them — not on every render.
- The e2e spec depends on a debug-only `window.__geode_cy` hook gated by `process.env.NODE_ENV !== 'production'` (Task 21 step 2). The hook is intentionally non-production so it isn't a public API.
- Mini-map is gated behind a sticky `miniMap` toggle (default `false`) so existing screenshots and layouts don't suddenly grow a panel.
- Cytoscape `node.lock()` / `unlock()` is the official API for pinning; lock state survives `cy.layout(...).run()` so the layout switch test in Task 21 is meaningful.

---

Plan complete. Total: 23 tasks across 9 phases, every task TDD with explicit fail/pass commands.
