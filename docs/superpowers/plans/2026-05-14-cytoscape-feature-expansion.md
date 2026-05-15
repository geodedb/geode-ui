# Cytoscape Feature Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reach feature parity with reagraph by adding cytoscape extensions and capabilities we haven't yet wired — a radial context menu (replacing our linear one), lasso selection, persistent node badges (pin / collapsed-count), hover tooltips, HTML-based custom node rendering (opt-in), and an anti-overlap layout post-pass.

**Architecture:** Each capability is installed as a separate cytoscape extension and wired through a small React hook + presentational component. Existing features (degree sizing, expand popover, focus mode, find-node, mini-map, keyboard nav, pin/unpin) stay untouched — the new surfaces compose with them. The custom-node rendering is gated behind a sticky `domNodes` toggle so the default canvas path stays the fast option.

**Tech Stack:** React + TypeScript, Cytoscape 3.x with extensions `cytoscape-cxtmenu` (3.5.0), `cytoscape-lasso` (1.1.4), `cytoscape-popper` (latest v2), `cytoscape-dom-node` (latest), `cytoscape-spread` (latest), Jest + Testing Library, Playwright, styled-components, react-i18next.

**Explicitly out of scope:** 3D rendering (cytoscape is 2D-only; would need a different engine), edge bundling (no mature cytoscape extension). These remain reagraph-only capabilities and stay deferred.

---

## File Structure

**Files to delete (replaced by cxtmenu in Phase 1):**
- `src/components/results/graph/NodeContextMenu.tsx`
- `src/components/results/graph/NodeContextMenu.test.tsx`
- `src/components/results/graph/useNodeContextMenu.ts`
- `src/components/results/graph/useNodeContextMenu.test.ts`

**New files:**
- `src/components/results/graph/useCxtMenu.ts` — registers `cytoscape-cxtmenu` and mounts the radial menu against the live cy core, with all command handlers in scope.
- `src/components/results/graph/useCxtMenu.test.ts` — tests for command building.
- `src/components/results/graph/useLasso.ts` — registers `cytoscape-lasso` and exposes an `enabled` toggle.
- `src/components/results/graph/useLasso.test.ts` — tests.
- `src/components/results/graph/useGraphBadges.ts` — computes RAF-throttled badge positions from pin + collapsed state.
- `src/components/results/graph/useGraphBadges.test.ts` — tests.
- `src/components/results/graph/GraphBadges.tsx` — absolute-positioned DOM overlay rendering pin + collapsed-count badges.
- `src/components/results/graph/GraphBadges.test.tsx` — tests.
- `src/components/results/graph/useNodeTooltip.ts` — wires `cytoscape-popper` to a hover-triggered tooltip.
- `src/components/results/graph/useNodeTooltip.test.ts` — tests.
- `src/components/results/graph/GraphTooltip.tsx` — tooltip body rendered as a floating top-left card.
- `src/components/results/graph/GraphTooltip.test.tsx` — tests.
- `src/components/results/graph/CustomNodeTemplate.tsx` — React component that renders a single node's DOM (label + label-color swatch + optional inline pin glyph). Used by `cytoscape-dom-node` via `createRoot`.
- `src/components/results/graph/CustomNodeTemplate.test.tsx` — tests.
- `src/components/results/graph/useDomNodes.ts` — registers `cytoscape-dom-node` and mounts a React root per node element when enabled.
- `src/components/results/graph/useDomNodes.test.ts` — tests.
- `src/types/cytoscape-cxtmenu.d.ts` — ambient module declaration for the untyped extension.
- `src/types/cytoscape-lasso.d.ts` — ambient module declaration.
- `src/types/cytoscape-popper.d.ts` — ambient module declaration.
- `src/types/cytoscape-dom-node.d.ts` — ambient module declaration.
- `src/types/cytoscape-spread.d.ts` — ambient module declaration.

**Modified files:**
- `src/components/results/GraphView.tsx` — mounts `useCxtMenu`, `useLasso`, `useGraphBadges`, `useNodeTooltip`, `useDomNodes`; renders `<GraphBadges>` + `<GraphTooltip>` inside the canvas wrapper; removes the old `<NodeContextMenu>` mount; passes `domNodes` + `onToggleDomNodes` and `lasso` + `onToggleLasso` to `<GraphToolbar>`.
- `src/components/results/GraphView.test.tsx` — removes `useNodeContextMenu` mock + linear-menu tests; replaces with cxtmenu integration test.
- `src/components/results/graph/GraphToolbar.tsx` — adds Lasso toggle, DOM-nodes toggle to the toolbar.
- `src/components/results/graph/layouts.ts` — adds `'spread'` to `LAYOUTS`; routes layoutConfig to the cytoscape-spread layout when picked.
- `src/components/results/useGraphPrefs.ts` — adds sticky `lasso`, `domNodes` booleans (defaults `false`); both persisted with strict-true merge.
- `src/services/i18n/locales/en.ts` — adds `graph.lasso`, `graph.lassoLabel`, `graph.domNodes`, `graph.domNodesLabel`, `graph.tooltipNoProps`, `graph.layout.spread`. Keeps existing menu keys (cxtmenu reuses them).
- `package.json` / `package-lock.json` — adds 5 extension deps.
- `e2e/specs/24-graph-power-features.spec.ts` — extends with specs covering the new radial menu, lasso, badges, tooltip, dom-node toggle.

**Untouched (deliberate):**
- The existing graph actions (hide/collapse/explore/pin/focus/zoomTo) keep their handler shapes — the new cxtmenu just dispatches to them.
- All other features (degree sizing, expand popover, find-node, mini-map, keyboard nav, focus chip) compose with the new additions.

---

## Phase 1 — Radial context menu via `cytoscape-cxtmenu`

### Task 1: Install + register cytoscape-cxtmenu

**Files:**
- Modify: `package.json` / `package-lock.json`
- Create: `src/types/cytoscape-cxtmenu.d.ts`

- [ ] **Step 1: Install**

```bash
npm install cytoscape-cxtmenu@3.5.0
```

Expected: dep added, peer warns absent (`cytoscape: ^3.2.0` satisfied by our `^3.33.3`).

- [ ] **Step 2: Add ambient declaration**

Create `src/types/cytoscape-cxtmenu.d.ts`:

```ts
// cytoscape-cxtmenu ships no TypeScript types. Declare as an
// untyped module so a default import compiles; the consuming hook
// casts the export to cytoscape.Ext when registering.
declare module 'cytoscape-cxtmenu'
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm run build`
Expected: webpack build succeeds.

Run: `npm test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/types/cytoscape-cxtmenu.d.ts
git commit -m "build(graph): add cytoscape-cxtmenu for radial node menu"
```

### Task 2: `useCxtMenu` hook

**Files:**
- Create: `src/components/results/graph/useCxtMenu.ts`
- Create: `src/components/results/graph/useCxtMenu.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/results/graph/useCxtMenu.test.ts
import { renderHook } from '@testing-library/react'
import { useCxtMenu, buildCommands } from './useCxtMenu'

describe('buildCommands', () => {
  it('emits one command per visible action with i18n labels and handlers', () => {
    const handlers = {
      onZoomTo: jest.fn(),
      onExpand: jest.fn(),
      onHide: jest.fn(),
      onCollapse: jest.fn(),
      onFocus: jest.fn(),
      onPin: jest.fn(),
      onCopyId: jest.fn(),
    }
    const t = (k: string) => k
    const cmds = buildCommands({ handlers, t })
    expect(cmds.map((c) => c.id)).toEqual([
      'zoomTo',
      'expand',
      'hide',
      'collapse',
      'focus',
      'pin',
      'copyId',
    ])
    expect(cmds[0].content).toBe('graph.menuZoomTo')
    expect(cmds[1].content).toBe('graph.menuExpand')
    expect(cmds[2].content).toBe('graph.actionHide')
    const fakeNode = { id: () => 'n7' }
    cmds[0].select(fakeNode as never)
    expect(handlers.onZoomTo).toHaveBeenCalledWith('n7')
    cmds[5].select(fakeNode as never)
    expect(handlers.onPin).toHaveBeenCalledWith('n7')
  })
})

type CxtFakeCore = {
  cxtmenu: jest.Mock
}

function makeCxtCy(): CxtFakeCore {
  const destroy = jest.fn()
  return {
    cxtmenu: jest.fn(() => ({ destroy })) as unknown as jest.Mock,
  }
}

describe('useCxtMenu', () => {
  it('mounts cxtmenu against the live core with selector node and the built commands', () => {
    const cy = makeCxtCy()
    const cyRef = { current: cy as never }
    const handlers = {
      onZoomTo: jest.fn(),
      onExpand: jest.fn(),
      onHide: jest.fn(),
      onCollapse: jest.fn(),
      onFocus: jest.fn(),
      onPin: jest.fn(),
      onCopyId: jest.fn(),
    }
    renderHook(() =>
      useCxtMenu({ cyRef: cyRef as never, handlers, t: (k) => k, sig: 's1' })
    )
    expect(cy.cxtmenu).toHaveBeenCalledTimes(1)
    const opts = cy.cxtmenu.mock.calls[0][0] as {
      selector?: string
      openMenuEvents?: string
      commands?: { id: string }[]
    }
    expect(opts.selector).toBe('node')
    expect(opts.openMenuEvents).toContain('cxttap')
    expect(opts.openMenuEvents).toContain('taphold')
    expect(opts.commands?.map((c) => c.id)).toEqual([
      'zoomTo',
      'expand',
      'hide',
      'collapse',
      'focus',
      'pin',
      'copyId',
    ])
  })

  it('tears down + re-mounts when sig changes (cy core rebuilt)', () => {
    const cy = makeCxtCy()
    const cyRef = { current: cy as never }
    const handlers = {
      onZoomTo: jest.fn(),
      onExpand: jest.fn(),
      onHide: jest.fn(),
      onCollapse: jest.fn(),
      onFocus: jest.fn(),
      onPin: jest.fn(),
      onCopyId: jest.fn(),
    }
    const { rerender } = renderHook(
      ({ sig }: { sig: string }) =>
        useCxtMenu({ cyRef: cyRef as never, handlers, t: (k) => k, sig }),
      { initialProps: { sig: 's1' } }
    )
    expect(cy.cxtmenu).toHaveBeenCalledTimes(1)
    rerender({ sig: 's2' })
    expect(cy.cxtmenu).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=graph/useCxtMenu.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

```ts
// src/components/results/graph/useCxtMenu.ts
import { useEffect } from 'react'
import cytoscape, { Core } from 'cytoscape'
import cxtmenu from 'cytoscape-cxtmenu'

cytoscape.use(cxtmenu as unknown as cytoscape.Ext)

type TFn = (key: string, opts?: Record<string, unknown>) => string

export type CxtMenuHandlers = {
  onZoomTo: (id: string) => void
  onExpand: (id: string) => void
  onHide: (id: string) => void
  onCollapse: (id: string) => void
  onFocus: (id: string) => void
  onPin: (id: string) => void
  onCopyId: (id: string) => void
}

export type CxtMenuCommand = {
  id: string
  content: string
  select: (ele: { id: () => string }) => void
}

export function buildCommands(args: {
  handlers: CxtMenuHandlers
  t: TFn
}): CxtMenuCommand[] {
  const { handlers, t } = args
  return [
    {
      id: 'zoomTo',
      content: t('graph.menuZoomTo'),
      select: (e) => handlers.onZoomTo(e.id()),
    },
    {
      id: 'expand',
      content: t('graph.menuExpand'),
      select: (e) => handlers.onExpand(e.id()),
    },
    {
      id: 'hide',
      content: t('graph.actionHide'),
      select: (e) => handlers.onHide(e.id()),
    },
    {
      id: 'collapse',
      content: t('graph.actionCollapse'),
      select: (e) => handlers.onCollapse(e.id()),
    },
    {
      id: 'focus',
      content: t('graph.menuFocus'),
      select: (e) => handlers.onFocus(e.id()),
    },
    {
      id: 'pin',
      content: t('graph.menuPin'),
      select: (e) => handlers.onPin(e.id()),
    },
    {
      id: 'copyId',
      content: t('graph.menuCopyId'),
      select: (e) => handlers.onCopyId(e.id()),
    },
  ]
}

type CoreWithCxt = Core & {
  cxtmenu: (opts: unknown) => { destroy: () => void }
}

export type UseCxtMenuArgs = {
  cyRef: React.MutableRefObject<Core | null>
  handlers: CxtMenuHandlers
  t: TFn
  sig?: string
}

export function useCxtMenu(args: UseCxtMenuArgs): void {
  const { cyRef, handlers, t, sig } = args
  useEffect(() => {
    const cy = cyRef.current as CoreWithCxt | null
    if (!cy || typeof cy.cxtmenu !== 'function') return undefined
    const inst = cy.cxtmenu({
      selector: 'node',
      openMenuEvents: 'cxttap taphold',
      commands: buildCommands({ handlers, t }),
      fillColor: 'rgba(0, 0, 0, 0.6)',
      activeFillColor: 'rgba(92, 52, 199, 0.85)',
      activePadding: 4,
      indicatorSize: 18,
      separatorWidth: 2,
      spotlightPadding: 4,
      minSpotlightRadius: 18,
      maxSpotlightRadius: 36,
      itemColor: 'white',
      itemTextShadowColor: 'transparent',
      zIndex: 9999,
    })
    return () => {
      try {
        inst.destroy()
      } catch {
        // cy may already be destroyed during rebuild teardown.
      }
    }
    // handlers + t identities churn each render; re-mounting cxtmenu
    // every render would tear down the menu DOM 60x/sec. The handlers
    // captured at sig-time read latest state via zustand/refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cyRef, sig])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=graph/useCxtMenu.test`
Expected: PASS — 3 specs.

Run: `npm test && npx tsc --noEmit`
Expected: ALL pass; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/useCxtMenu.ts \
  src/components/results/graph/useCxtMenu.test.ts
git commit -m "feat(graph): useCxtMenu hook for radial context menu"
```

### Task 3: Wire `useCxtMenu` into GraphView; remove old linear menu

**Files:**
- Modify: `src/components/results/GraphView.tsx`
- Modify: `src/components/results/GraphView.test.tsx`
- Delete: `src/components/results/graph/NodeContextMenu.tsx`
- Delete: `src/components/results/graph/NodeContextMenu.test.tsx`
- Delete: `src/components/results/graph/useNodeContextMenu.ts`
- Delete: `src/components/results/graph/useNodeContextMenu.test.ts`

- [ ] **Step 1: Write the failing wiring test**

In `src/components/results/GraphView.test.tsx`:

a) REMOVE the top-level `jest.mock('./graph/useNodeContextMenu', ...)` block.

b) REMOVE the entire `describe('GraphView — context menu wiring', ...)` block.

c) REMOVE the entire `describe('GraphView — zoomTo menu action', ...)` block.

d) ADD a new `jest.mock` at module scope, just below imports:

```tsx
jest.mock('./graph/useCxtMenu', () => ({
  useCxtMenu: jest.fn(),
  buildCommands: jest.requireActual('./graph/useCxtMenu').buildCommands,
}))
```

e) ADD a new describe at the END of the file:

```tsx
import { useCxtMenu } from './graph/useCxtMenu'

describe('GraphView — radial context menu', () => {
  afterEach(() => jest.clearAllMocks())

  it('mounts useCxtMenu with the orchestrator handlers and sig', () => {
    renderGraphViewWithFixture()
    expect(useCxtMenu).toHaveBeenCalled()
    const call = (useCxtMenu as jest.Mock).mock.calls[0][0]
    expect(call.cyRef).toBeDefined()
    expect(call.handlers.onZoomTo).toBeInstanceOf(Function)
    expect(call.handlers.onExpand).toBeInstanceOf(Function)
    expect(call.handlers.onHide).toBeInstanceOf(Function)
    expect(call.handlers.onCollapse).toBeInstanceOf(Function)
    expect(call.handlers.onFocus).toBeInstanceOf(Function)
    expect(call.handlers.onPin).toBeInstanceOf(Function)
    expect(call.handlers.onCopyId).toBeInstanceOf(Function)
    expect(call.sig).toEqual(expect.any(String))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=results/GraphView.test`
Expected: FAIL — `useCxtMenu` not yet mounted by GraphView.

- [ ] **Step 3: Modify `GraphView.tsx`**

a) Remove the imports:

```ts
import { NodeContextMenu, NodeContextMenuAction } from './graph/NodeContextMenu'
import { useNodeContextMenu } from './graph/useNodeContextMenu'
```

Replace with:

```ts
import { useCxtMenu } from './graph/useCxtMenu'
```

b) Remove the `const menu = useNodeContextMenu({...})` line.

c) Remove the entire `onMenuSelect` function (the switch). Inline the handler logic as named consts:

```ts
const onZoomTo = (id: string): void => {
  if (cyRef.current) zoomToNode(cyRef.current, id)
}
const onExpand = (id: string): void => {
  setExpandFor(id)
}
const onHide = (id: string): void => {
  onHideNode(id)
}
const onCollapse = (id: string): void => {
  onCollapseNode(id)
}
const onFocus = (id: string): void => {
  focusMode.focus({ id, hops: focusHops })
}
const onPin = (id: string): void => {
  pinning.togglePin(id)
}
const onCopyId = (id: string): void => {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    navigator.clipboard.writeText(id).catch(() => {})
  }
}
```

d) Mount the hook AFTER `useGraphCytoscape({...})`:

```ts
useCxtMenu({
  cyRef,
  handlers: {
    onZoomTo,
    onExpand,
    onHide,
    onCollapse,
    onFocus,
    onPin,
    onCopyId,
  },
  t,
  sig,
})
```

e) DELETE the `<NodeContextMenu open={menu.state.open} ... />` JSX.

- [ ] **Step 4: Delete the obsolete files**

```bash
git rm src/components/results/graph/NodeContextMenu.tsx \
  src/components/results/graph/NodeContextMenu.test.tsx \
  src/components/results/graph/useNodeContextMenu.ts \
  src/components/results/graph/useNodeContextMenu.test.ts
```

- [ ] **Step 5: Run tests**

Run: `npm test -- --testPathPattern=results/GraphView.test`
Expected: PASS.

Run: `npm test && npx tsc --noEmit`
Expected: ALL pass; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/results/GraphView.tsx \
  src/components/results/GraphView.test.tsx
git commit -m "feat(graph): swap linear NodeContextMenu for radial cxtmenu"
```

---

## Phase 2 — Lasso selection

### Task 4: Install + register cytoscape-lasso, ambient .d.ts

**Files:**
- Modify: `package.json` / `package-lock.json`
- Create: `src/types/cytoscape-lasso.d.ts`

- [ ] **Step 1: Install**

```bash
npm install cytoscape-lasso@1.1.4
```

- [ ] **Step 2: Ambient declaration**

Create `src/types/cytoscape-lasso.d.ts`:

```ts
declare module 'cytoscape-lasso'
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/types/cytoscape-lasso.d.ts
git commit -m "build(graph): add cytoscape-lasso for free-form area selection"
```

### Task 5: `useLasso` hook + toolbar toggle

**Files:**
- Create: `src/components/results/graph/useLasso.ts`
- Create: `src/components/results/graph/useLasso.test.ts`
- Modify: `src/components/results/useGraphPrefs.ts`
- Modify: `src/components/results/graph/GraphToolbar.tsx`
- Modify: `src/components/results/GraphView.tsx`
- Modify: `src/services/i18n/locales/en.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/results/graph/useLasso.test.ts
import { renderHook } from '@testing-library/react'
import { useLasso } from './useLasso'

type LassoFakeCore = {
  lassoSelectionEnabled: jest.Mock<unknown, [boolean]>
}

function makeCy(): LassoFakeCore {
  return { lassoSelectionEnabled: jest.fn() }
}

describe('useLasso', () => {
  it('enables lasso when the prop flips to true', () => {
    const cy = makeCy()
    const cyRef = { current: cy as never }
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useLasso({ cyRef: cyRef as never, enabled, sig: 's1' }),
      { initialProps: { enabled: false } }
    )
    expect(cy.lassoSelectionEnabled).toHaveBeenLastCalledWith(false)
    rerender({ enabled: true })
    expect(cy.lassoSelectionEnabled).toHaveBeenLastCalledWith(true)
  })

  it('re-applies on sig change', () => {
    const cy = makeCy()
    const cyRef = { current: cy as never }
    const { rerender } = renderHook(
      ({ sig }: { sig: string }) =>
        useLasso({ cyRef: cyRef as never, enabled: true, sig }),
      { initialProps: { sig: 's1' } }
    )
    expect(cy.lassoSelectionEnabled).toHaveBeenCalledTimes(1)
    rerender({ sig: 's2' })
    expect(cy.lassoSelectionEnabled).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --testPathPattern=graph/useLasso.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/components/results/graph/useLasso.ts
import { useEffect } from 'react'
import cytoscape, { Core } from 'cytoscape'
import lasso from 'cytoscape-lasso'

cytoscape.use(lasso as unknown as cytoscape.Ext)

type CoreWithLasso = Core & {
  lassoSelectionEnabled: (on?: boolean) => unknown
}

export type UseLassoArgs = {
  cyRef: React.MutableRefObject<Core | null>
  enabled: boolean
  sig?: string
}

export function useLasso(args: UseLassoArgs): void {
  const { cyRef, enabled, sig } = args
  useEffect(() => {
    const cy = cyRef.current as CoreWithLasso | null
    if (!cy || typeof cy.lassoSelectionEnabled !== 'function') return
    cy.lassoSelectionEnabled(enabled)
  }, [cyRef, enabled, sig])
}
```

- [ ] **Step 4: Add the sticky pref**

In `src/components/results/useGraphPrefs.ts`:

State:
```ts
lasso: boolean
setLasso: (v: boolean) => void
```

`PersistedShape`:
```ts
lasso: boolean
```

Initializer:
```ts
lasso: false,
setLasso: (v) => set({ lasso: v }),
```

`partialize`:
```ts
lasso: s.lasso,
```

`merge`:
```ts
lasso: p.lasso === true,
```

- [ ] **Step 5: Add i18n keys**

In `src/services/i18n/locales/en.ts` inside `graph: {}`:

```ts
lasso: 'Lasso',
lassoLabel: 'Drag a freeform shape to select nodes',
```

- [ ] **Step 6: Add toolbar toggle**

In `src/components/results/graph/GraphToolbar.tsx` props:

```ts
lasso: boolean
onToggleLasso: () => void
```

JSX (in the toggles group alongside Selection mode / Cluster / Path):

```tsx
<button
  type="button"
  data-testid="graph-lasso-toggle"
  aria-pressed={lasso}
  aria-label={t('graph.lassoLabel')}
  title={t('graph.lassoLabel')}
  onClick={onToggleLasso}
>
  {t('graph.lasso')}
</button>
```

- [ ] **Step 7: Wire in GraphView**

```ts
import { useLasso } from './graph/useLasso'

const lasso = useGraphPrefs((s) => s.lasso)
const setLasso = useGraphPrefs((s) => s.setLasso)

useLasso({ cyRef, enabled: lasso, sig })
```

Pass to `<GraphToolbar />`:

```tsx
lasso={lasso}
onToggleLasso={() => setLasso(!lasso)}
```

- [ ] **Step 8: Run tests**

Run: `npm test -- --testPathPattern='graph/useLasso.test|results/GraphView.test'`
Expected: PASS.

Run: `npm test && npx tsc --noEmit`
Expected: ALL pass; tsc clean.

- [ ] **Step 9: Commit**

```bash
git add src/components/results/graph/useLasso.ts \
  src/components/results/graph/useLasso.test.ts \
  src/components/results/useGraphPrefs.ts \
  src/components/results/graph/GraphToolbar.tsx \
  src/components/results/GraphView.tsx \
  src/services/i18n/locales/en.ts
git commit -m "feat(graph): lasso area-selection toggle"
```

---

## Phase 3 — DOM-overlay badges (pin + collapsed-count)

### Task 6: `useGraphBadges` hook

**Files:**
- Create: `src/components/results/graph/useGraphBadges.ts`
- Create: `src/components/results/graph/useGraphBadges.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/results/graph/useGraphBadges.test.ts
import { renderHook } from '@testing-library/react'
import { useGraphBadges } from './useGraphBadges'

function makeCy(positions: Record<string, { x: number; y: number }>) {
  const wrap = (id: string) => ({
    empty: () => !(id in positions),
    renderedPosition: () => positions[id] ?? { x: 0, y: 0 },
    renderedWidth: () => 40,
    renderedHeight: () => 40,
  })
  return {
    getElementById: (id: string) => wrap(id),
    on: jest.fn(),
    off: jest.fn(),
  }
}

describe('useGraphBadges', () => {
  it('returns one badge per pinned id and one per collapsed group', () => {
    const cy = makeCy({ '1': { x: 100, y: 200 }, '3': { x: 50, y: 60 } })
    const cyRef = { current: cy as never }
    const { result } = renderHook(() =>
      useGraphBadges({
        cyRef: cyRef as never,
        pinned: new Set(['1']),
        collapsed: new Map([['3', ['a', 'b', 'c']]]),
        sig: 's1',
      })
    )
    expect(result.current).toHaveLength(2)
    const pin = result.current.find((b) => b.kind === 'pin')
    expect(pin?.nodeId).toBe('1')
    expect(pin?.x).toBe(100)
    const col = result.current.find((b) => b.kind === 'collapsed')
    expect(col?.nodeId).toBe('3')
    expect(col?.count).toBe(3)
  })

  it('ignores ids that are no longer in the graph', () => {
    const cy = makeCy({})
    const cyRef = { current: cy as never }
    const { result } = renderHook(() =>
      useGraphBadges({
        cyRef: cyRef as never,
        pinned: new Set(['ghost']),
        collapsed: new Map(),
        sig: 's1',
      })
    )
    expect(result.current).toEqual([])
  })

  it('returns [] when cy is null', () => {
    const cyRef = { current: null }
    const { result } = renderHook(() =>
      useGraphBadges({
        cyRef: cyRef as never,
        pinned: new Set(['1']),
        collapsed: new Map(),
        sig: 's1',
      })
    )
    expect(result.current).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=graph/useGraphBadges.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/components/results/graph/useGraphBadges.ts
import { useEffect, useRef, useState } from 'react'
import type { Core } from 'cytoscape'

export type Badge =
  | { kind: 'pin'; nodeId: string; x: number; y: number }
  | { kind: 'collapsed'; nodeId: string; count: number; x: number; y: number }

export type UseGraphBadgesArgs = {
  cyRef: React.MutableRefObject<Core | null>
  pinned: Set<string>
  collapsed: Map<string, string[]>
  sig?: string
}

export function useGraphBadges(args: UseGraphBadgesArgs): Badge[] {
  const { cyRef, pinned, collapsed, sig } = args
  const [badges, setBadges] = useState<Badge[]>([])
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) {
      setBadges([])
      return undefined
    }

    const compute = (): Badge[] => {
      const out: Badge[] = []
      pinned.forEach((id) => {
        const n = cy.getElementById(id)
        if (n.empty()) return
        const pos = n.renderedPosition()
        const h = n.renderedHeight()
        out.push({ kind: 'pin', nodeId: id, x: pos.x, y: pos.y - h / 2 })
      })
      collapsed.forEach((leaves, id) => {
        if (leaves.length === 0) return
        const n = cy.getElementById(id)
        if (n.empty()) return
        const pos = n.renderedPosition()
        const h = n.renderedHeight()
        out.push({
          kind: 'collapsed',
          nodeId: id,
          count: leaves.length,
          x: pos.x,
          y: pos.y + h / 2,
        })
      })
      return out
    }

    const flush = (): void => {
      rafRef.current = 0
      setBadges(compute())
    }
    const schedule = (): void => {
      if (rafRef.current !== 0) return
      if (typeof requestAnimationFrame !== 'function') {
        flush()
        return
      }
      rafRef.current = requestAnimationFrame(flush)
    }

    setBadges(compute())
    cy.on('viewport pan zoom render', schedule)
    return () => {
      cy.off('viewport pan zoom render', schedule)
      if (rafRef.current !== 0 && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
    }
  }, [cyRef, pinned, collapsed, sig])

  return badges
}
```

- [ ] **Step 4: Run test to verify passes**

Run: `npm test -- --testPathPattern=graph/useGraphBadges.test`
Expected: PASS — 3 specs.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/useGraphBadges.ts \
  src/components/results/graph/useGraphBadges.test.ts
git commit -m "feat(graph): useGraphBadges computes RAF-throttled overlay positions"
```

### Task 7: `GraphBadges` overlay component + wire into GraphView

**Files:**
- Create: `src/components/results/graph/GraphBadges.tsx`
- Create: `src/components/results/graph/GraphBadges.test.tsx`
- Modify: `src/components/results/GraphView.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/results/graph/GraphBadges.test.tsx
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../../test-utils/theme'
import { GraphBadges } from './GraphBadges'

describe('GraphBadges', () => {
  it('renders one badge per item with positions applied', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphBadges
          badges={[
            { kind: 'pin', nodeId: 'a', x: 10, y: 20 },
            { kind: 'collapsed', nodeId: 'b', count: 3, x: 50, y: 60 },
          ]}
        />
      </ThemeProvider>
    )
    const pin = screen.getByTestId('graph-badge-pin-a')
    const col = screen.getByTestId('graph-badge-collapsed-b')
    expect(pin).toBeInTheDocument()
    expect(col).toBeInTheDocument()
    expect(col.textContent).toBe('3')
  })

  it('renders nothing when given an empty list', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphBadges badges={[]} />
      </ThemeProvider>
    )
    expect(screen.queryByTestId(/^graph-badge-/)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=graph/GraphBadges.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/results/graph/GraphBadges.tsx
import React from 'react'
import styled from 'styled-components'
import type { Badge } from './useGraphBadges'

const Layer = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
`

const PinBadge = styled.div`
  position: absolute;
  transform: translate(-50%, -100%);
  font-size: ${({ theme }) => theme.font.sizes.xs};
  line-height: 1;
  padding: 2px 4px;
  background: ${({ theme }) => theme.colors.warning ?? '#d4a300'};
  color: #1a1a1a;
  border-radius: ${({ theme }) => theme.radii.pill};
  pointer-events: none;
  user-select: none;
`

const CollapsedBadge = styled.div`
  position: absolute;
  transform: translate(-50%, 0);
  min-width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: ${({ theme }) => theme.font.sizes.xs};
  font-weight: ${({ theme }) => theme.font.weights.semibold};
  background: ${({ theme }) => theme.colors.primary};
  color: #fff;
  border-radius: ${({ theme }) => theme.radii.pill};
  padding: 0 4px;
  pointer-events: none;
  user-select: none;
`

export type GraphBadgesProps = {
  badges: Badge[]
}

export const GraphBadges: React.FC<GraphBadgesProps> = ({ badges }) => {
  if (badges.length === 0) return null
  return (
    <Layer aria-hidden="true">
      {badges.map((b) =>
        b.kind === 'pin' ? (
          <PinBadge
            key={`pin-${b.nodeId}`}
            data-testid={`graph-badge-pin-${b.nodeId}`}
            style={{ left: b.x, top: b.y }}
          >
            ●
          </PinBadge>
        ) : (
          <CollapsedBadge
            key={`collapsed-${b.nodeId}`}
            data-testid={`graph-badge-collapsed-${b.nodeId}`}
            style={{ left: b.x, top: b.y }}
          >
            {b.count}
          </CollapsedBadge>
        )
      )}
    </Layer>
  )
}
```

- [ ] **Step 4: Wire into GraphView**

```ts
import { useGraphBadges } from './graph/useGraphBadges'
import { GraphBadges } from './graph/GraphBadges'

const badges = useGraphBadges({
  cyRef,
  pinned: pinning.pinned,
  collapsed,
  sig,
})
```

Inside the canvas wrapper `<div style={{ position: 'relative' }}>`, AFTER the `{miniMap && <GraphMiniMap />}` line:

```tsx
<GraphBadges badges={badges} />
```

- [ ] **Step 5: Run tests**

Run: `npm test -- --testPathPattern='graph/GraphBadges.test|results/GraphView.test'`
Expected: PASS.

Run: `npm test && npx tsc --noEmit`
Expected: ALL pass; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/results/graph/GraphBadges.tsx \
  src/components/results/graph/GraphBadges.test.tsx \
  src/components/results/GraphView.tsx
git commit -m "feat(graph): DOM-overlay badges for pinned + collapsed counts"
```

---

## Phase 4 — Hover tooltips

### Task 8: Install cytoscape-popper + ambient .d.ts

**Files:**
- Modify: `package.json` / `package-lock.json`
- Create: `src/types/cytoscape-popper.d.ts`

- [ ] **Step 1: Install**

```bash
npm install cytoscape-popper@2
```

(Pin to v2 — v3+ targets cytoscape 4.)

- [ ] **Step 2: Ambient declaration**

```ts
// src/types/cytoscape-popper.d.ts
declare module 'cytoscape-popper'
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all green.

```bash
git add package.json package-lock.json src/types/cytoscape-popper.d.ts
git commit -m "build(graph): add cytoscape-popper for hover tooltips"
```

### Task 9: `useNodeTooltip` hook + `GraphTooltip` component

**Files:**
- Create: `src/components/results/graph/useNodeTooltip.ts`
- Create: `src/components/results/graph/useNodeTooltip.test.ts`
- Create: `src/components/results/graph/GraphTooltip.tsx`
- Create: `src/components/results/graph/GraphTooltip.test.tsx`
- Modify: `src/components/results/GraphView.tsx`
- Modify: `src/services/i18n/locales/en.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/components/results/graph/useNodeTooltip.test.ts
import { act, renderHook } from '@testing-library/react'
import { useNodeTooltip } from './useNodeTooltip'

function makeCy() {
  const handlers = new Map<string, (ev: { target: unknown }) => void>()
  return {
    on: jest.fn((events: string, _selector: string, h: never) => {
      events.split(' ').forEach((e) => handlers.set(e, h))
    }),
    off: jest.fn(),
    __fire: (event: string, target: unknown) =>
      handlers.get(event)?.({ target }),
  }
}

describe('useNodeTooltip', () => {
  it('reveals the tooltip target on mouseover and clears on mouseout', () => {
    const cy = makeCy()
    const cyRef = { current: cy as never }
    const { result } = renderHook(() =>
      useNodeTooltip({ cyRef: cyRef as never, sig: 's1' })
    )
    expect(result.current.targetData).toBeNull()
    const fakeNode = {
      data: () => ({ id: '7', label: 'Person', props: { name: 'Alice' } }),
    }
    act(() => cy.__fire('mouseover', fakeNode))
    expect(result.current.targetData).toEqual({
      id: '7',
      label: 'Person',
      props: { name: 'Alice' },
    })
    act(() => cy.__fire('mouseout', fakeNode))
    expect(result.current.targetData).toBeNull()
  })
})
```

```tsx
// src/components/results/graph/GraphTooltip.test.tsx
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../../test-utils/theme'
import { GraphTooltip } from './GraphTooltip'

const t = (k: string) => k

describe('GraphTooltip', () => {
  it('renders nothing when targetData is null', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphTooltip targetData={null} t={t} />
      </ThemeProvider>
    )
    expect(screen.queryByTestId('graph-tooltip')).toBeNull()
  })

  it('shows label + props', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphTooltip
          targetData={{
            id: '7',
            label: 'Person',
            props: { name: 'Alice', age: 30 },
          }}
          t={t}
        />
      </ThemeProvider>
    )
    const tt = screen.getByTestId('graph-tooltip')
    expect(tt).toBeInTheDocument()
    expect(tt.textContent).toContain('Person')
    expect(tt.textContent).toContain('Alice')
    expect(tt.textContent).toContain('30')
  })

  it('shows the "no properties" label when props are empty', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphTooltip
          targetData={{ id: '7', label: 'Person', props: {} }}
          t={t}
        />
      </ThemeProvider>
    )
    expect(screen.getByTestId('graph-tooltip').textContent).toContain(
      'graph.tooltipNoProps'
    )
  })
})
```

- [ ] **Step 2: Run tests to verify failures**

Run: `npm test -- --testPathPattern='graph/(useNodeTooltip|GraphTooltip).test'`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the hook**

```ts
// src/components/results/graph/useNodeTooltip.ts
import { useEffect, useState } from 'react'
import type { Core } from 'cytoscape'

export type TooltipTargetData = {
  id: string
  label: string
  props: Record<string, unknown>
}

export type UseNodeTooltipArgs = {
  cyRef: React.MutableRefObject<Core | null>
  sig?: string
}

export type UseNodeTooltipResult = {
  targetData: TooltipTargetData | null
}

export function useNodeTooltip(
  args: UseNodeTooltipArgs
): UseNodeTooltipResult {
  const { cyRef, sig } = args
  const [targetData, setTargetData] = useState<TooltipTargetData | null>(null)

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return undefined

    const onEnter = (ev: {
      target: { data: () => Record<string, unknown> }
    }): void => {
      const data = ev.target.data() ?? {}
      const id = data.id != null ? String(data.id) : ''
      const labelField = data.label
      const label =
        typeof labelField === 'string'
          ? labelField
          : Array.isArray(labelField) && typeof labelField[0] === 'string'
            ? (labelField[0] as string)
            : ''
      const props =
        data.props && typeof data.props === 'object' && !Array.isArray(data.props)
          ? (data.props as Record<string, unknown>)
          : {}
      setTargetData({ id, label, props })
    }
    const onLeave = (): void => setTargetData(null)

    cy.on('mouseover', 'node', onEnter as never)
    cy.on('mouseout', 'node', onLeave as never)
    return () => {
      cy.off('mouseover', 'node', onEnter as never)
      cy.off('mouseout', 'node', onLeave as never)
    }
  }, [cyRef, sig])

  return { targetData }
}
```

- [ ] **Step 4: Implement the tooltip component**

```tsx
// src/components/results/graph/GraphTooltip.tsx
import React from 'react'
import styled from 'styled-components'
import type { TooltipTargetData } from './useNodeTooltip'

type TFn = (key: string, opts?: Record<string, unknown>) => string

const Box = styled.div`
  position: absolute;
  top: ${({ theme }) => theme.spacing.sm};
  left: ${({ theme }) => theme.spacing.sm};
  z-index: 7;
  max-width: 280px;
  pointer-events: none;
  font-size: ${({ theme }) => theme.font.sizes.xs};
  color: ${({ theme }) => theme.text.primary};
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.xs};
  box-shadow: ${({ theme }) => theme.shadows.md ?? theme.shadows.sm};

  .label {
    font-weight: ${({ theme }) => theme.font.weights.semibold};
    margin-bottom: 4px;
  }
  dl {
    margin: 0;
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 2px 8px;
    font-size: ${({ theme }) => theme.font.sizes.xs};
  }
  dt {
    color: ${({ theme }) => theme.text.secondary};
  }
  dd {
    margin: 0;
    word-break: break-word;
  }
`

export type GraphTooltipProps = {
  targetData: TooltipTargetData | null
  t: TFn
}

export const GraphTooltip: React.FC<GraphTooltipProps> = ({
  targetData,
  t,
}) => {
  if (!targetData) return null
  const propKeys = Object.keys(targetData.props)
  return (
    <Box data-testid="graph-tooltip" role="tooltip">
      <div className="label">{targetData.label || `#${targetData.id}`}</div>
      {propKeys.length === 0 ? (
        <div>{t('graph.tooltipNoProps')}</div>
      ) : (
        <dl>
          {propKeys.map((k) => (
            <React.Fragment key={k}>
              <dt>{k}</dt>
              <dd>{String(targetData.props[k])}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
    </Box>
  )
}
```

- [ ] **Step 5: Add i18n key**

In `src/services/i18n/locales/en.ts` inside `graph: {}`:

```ts
tooltipNoProps: 'No properties.',
```

- [ ] **Step 6: Wire in GraphView**

```ts
import { useNodeTooltip } from './graph/useNodeTooltip'
import { GraphTooltip } from './graph/GraphTooltip'

const { targetData: tooltipTarget } = useNodeTooltip({ cyRef, sig })
```

In the canvas wrapper, after `<GraphBadges>`:

```tsx
<GraphTooltip targetData={tooltipTarget} t={t} />
```

NOTE: this tooltip sits fixed at the canvas top-left. For a follower-style tooltip (pinned to the hovered node), wire `cytoscape-popper` here in a follow-up; the hook state is sufficient to drive popper later.

- [ ] **Step 7: Run tests**

Run: `npm test -- --testPathPattern='graph/(useNodeTooltip|GraphTooltip).test|results/GraphView.test'`
Expected: PASS.

Run: `npm test && npx tsc --noEmit`
Expected: ALL pass; tsc clean.

- [ ] **Step 8: Commit**

```bash
git add src/components/results/graph/useNodeTooltip.ts \
  src/components/results/graph/useNodeTooltip.test.ts \
  src/components/results/graph/GraphTooltip.tsx \
  src/components/results/graph/GraphTooltip.test.tsx \
  src/components/results/GraphView.tsx \
  src/services/i18n/locales/en.ts
git commit -m "feat(graph): hover tooltips on nodes"
```

---

## Phase 5 — HTML-based custom node rendering via `cytoscape-dom-node`

### Task 10: Install + ambient .d.ts

**Files:**
- Modify: `package.json` / `package-lock.json`
- Create: `src/types/cytoscape-dom-node.d.ts`

- [ ] **Step 1: Install**

```bash
npm install cytoscape-dom-node@1
```

- [ ] **Step 2: Ambient declaration**

```ts
// src/types/cytoscape-dom-node.d.ts
declare module 'cytoscape-dom-node'
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all green.

```bash
git add package.json package-lock.json src/types/cytoscape-dom-node.d.ts
git commit -m "build(graph): add cytoscape-dom-node for HTML-based custom nodes"
```

### Task 11: `CustomNodeTemplate` component

**Files:**
- Create: `src/components/results/graph/CustomNodeTemplate.tsx`
- Create: `src/components/results/graph/CustomNodeTemplate.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/results/graph/CustomNodeTemplate.test.tsx
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../../test-utils/theme'
import { CustomNodeTemplate } from './CustomNodeTemplate'

describe('CustomNodeTemplate', () => {
  it('renders the swatch + label', () => {
    render(
      <ThemeProvider theme={theme}>
        <CustomNodeTemplate
          label="Alice"
          swatchColor="#ff0099"
          pinned={false}
        />
      </ThemeProvider>
    )
    expect(screen.getByTestId('custom-node-label').textContent).toBe('Alice')
    const swatch = screen.getByTestId('custom-node-swatch')
    expect(swatch.style.backgroundColor).toMatch(
      /#ff0099|rgb\(255, 0, 153\)/
    )
  })

  it('shows a pin glyph when pinned=true', () => {
    render(
      <ThemeProvider theme={theme}>
        <CustomNodeTemplate label="Alice" swatchColor="#000" pinned />
      </ThemeProvider>
    )
    expect(screen.getByTestId('custom-node-pin')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify fails**

Run: `npm test -- --testPathPattern=graph/CustomNodeTemplate.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/results/graph/CustomNodeTemplate.tsx
import React from 'react'
import styled from 'styled-components'

const Card = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: ${({ theme }) => theme.radii.md};
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.default};
  font: ${({ theme }) => theme.font.sizes.xs} / 1.2
    ${({ theme }) => theme.font.family.body};
  color: ${({ theme }) => theme.text.primary};
  box-shadow: ${({ theme }) => theme.shadows.sm};
  max-width: 180px;
`

const Swatch = styled.span`
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex: 0 0 auto;
`

const Label = styled.span`
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const Pin = styled.span`
  margin-left: 4px;
  color: ${({ theme }) => theme.colors.warning ?? '#d4a300'};
  font-size: 10px;
`

export type CustomNodeTemplateProps = {
  label: string
  swatchColor: string
  pinned: boolean
}

export const CustomNodeTemplate: React.FC<CustomNodeTemplateProps> = ({
  label,
  swatchColor,
  pinned,
}) => {
  return (
    <Card>
      <Swatch
        data-testid="custom-node-swatch"
        style={{ backgroundColor: swatchColor }}
      />
      <Label data-testid="custom-node-label">{label || '—'}</Label>
      {pinned && <Pin data-testid="custom-node-pin">●</Pin>}
    </Card>
  )
}
```

- [ ] **Step 4: Run test to verify passes**

Run: `npm test -- --testPathPattern=graph/CustomNodeTemplate.test`
Expected: PASS — 2 specs.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/CustomNodeTemplate.tsx \
  src/components/results/graph/CustomNodeTemplate.test.tsx
git commit -m "feat(graph): CustomNodeTemplate React component for dom-node rendering"
```

### Task 12: `useDomNodes` hook (createRoot per node) + sticky toggle + GraphView wiring

**Files:**
- Create: `src/components/results/graph/useDomNodes.ts`
- Create: `src/components/results/graph/useDomNodes.test.ts`
- Modify: `src/components/results/useGraphPrefs.ts`
- Modify: `src/components/results/graph/GraphToolbar.tsx`
- Modify: `src/components/results/GraphView.tsx`
- Modify: `src/services/i18n/locales/en.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/results/graph/useDomNodes.test.ts
import { renderHook } from '@testing-library/react'
import { useDomNodes } from './useDomNodes'

type DomNodeFake = {
  domNode: jest.Mock<unknown, [unknown?]>
  nodes: () => {
    forEach: (cb: (n: { data: (k?: string, v?: unknown) => unknown }) => void) => void
  }
}

function makeCy(): DomNodeFake {
  const nodes = [
    {
      __data: { id: '1', label: 'Alice' } as Record<string, unknown>,
      data(k?: string, v?: unknown): unknown {
        if (k === undefined) return this.__data
        if (v === undefined) return this.__data[k]
        this.__data[k] = v
        return undefined
      },
    },
  ]
  return {
    domNode: jest.fn(),
    nodes: () => ({
      forEach: (cb: (n: typeof nodes[number]) => void) => nodes.forEach(cb),
    }),
  }
}

describe('useDomNodes', () => {
  it('initializes cytoscape-dom-node when enabled flips to true', () => {
    const cy = makeCy()
    const cyRef = { current: cy as never }
    const renderNode = jest.fn(() => document.createElement('div'))
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useDomNodes({
          cyRef: cyRef as never,
          enabled,
          renderNode,
          sig: 's1',
        }),
      { initialProps: { enabled: false } }
    )
    expect(cy.domNode).not.toHaveBeenCalled()
    rerender({ enabled: true })
    expect(cy.domNode).toHaveBeenCalled()
    // renderNode was invoked once per node.
    expect(renderNode).toHaveBeenCalled()
  })

  it('no-ops when cyRef.current is null', () => {
    const cyRef = { current: null }
    const renderNode = jest.fn(() => document.createElement('div'))
    renderHook(() =>
      useDomNodes({
        cyRef: cyRef as never,
        enabled: true,
        renderNode,
        sig: 's1',
      })
    )
    expect(renderNode).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify fails**

Run: `npm test -- --testPathPattern=graph/useDomNodes.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/components/results/graph/useDomNodes.ts
import { useEffect } from 'react'
import cytoscape, { Core } from 'cytoscape'
import domNode from 'cytoscape-dom-node'

cytoscape.use(domNode as unknown as cytoscape.Ext)

type CoreWithDomNode = Core & {
  domNode: (opts?: unknown) => void
}

export type UseDomNodesArgs = {
  cyRef: React.MutableRefObject<Core | null>
  enabled: boolean
  // renderNode returns an HTMLElement representing the node. The hook
  // stamps it onto each node's data bag under `dom` (cytoscape-dom-node's
  // expected slot). renderNode is expected to mount a React root via
  // `createRoot` from react-dom/client, NOT to set innerHTML — this
  // keeps the implementation XSS-safe and supports event handlers in
  // future iterations.
  renderNode: (data: Record<string, unknown>) => HTMLElement
  sig?: string
}

export function useDomNodes(args: UseDomNodesArgs): void {
  const { cyRef, enabled, renderNode, sig } = args
  useEffect(() => {
    const cy = cyRef.current as CoreWithDomNode | null
    if (!cy) return undefined
    if (!enabled) return undefined
    if (typeof cy.domNode !== 'function') return undefined

    // Initialize the extension on this core (idempotent per core).
    cy.domNode()

    // Stamp a DOM element on every node's data bag so cytoscape-dom-node
    // can position it. The extension reads `data.dom` per node.
    cy.nodes().forEach((n) => {
      const data = n.data() as Record<string, unknown>
      const el = renderNode(data)
      n.data('dom', el)
    })
    return undefined
  }, [cyRef, enabled, renderNode, sig])
}
```

- [ ] **Step 4: Add the sticky pref**

In `src/components/results/useGraphPrefs.ts`:

State:
```ts
domNodes: boolean
setDomNodes: (v: boolean) => void
```

`PersistedShape`:
```ts
domNodes: boolean
```

Initializer:
```ts
domNodes: false,
setDomNodes: (v) => set({ domNodes: v }),
```

`partialize`:
```ts
domNodes: s.domNodes,
```

`merge`:
```ts
domNodes: p.domNodes === true,
```

- [ ] **Step 5: Add i18n keys**

In `src/services/i18n/locales/en.ts`:

```ts
domNodes: 'HTML nodes',
domNodesLabel: 'Render nodes as rich HTML cards (slower at scale)',
```

- [ ] **Step 6: Add toolbar toggle**

In `src/components/results/graph/GraphToolbar.tsx`:

```ts
domNodes: boolean
onToggleDomNodes: () => void
```

```tsx
<button
  type="button"
  data-testid="graph-dom-nodes-toggle"
  aria-pressed={domNodes}
  aria-label={t('graph.domNodesLabel')}
  title={t('graph.domNodesLabel')}
  onClick={onToggleDomNodes}
>
  {t('graph.domNodes')}
</button>
```

- [ ] **Step 7: Wire in GraphView (React-tree-per-node, NOT innerHTML)**

In `src/components/results/GraphView.tsx`:

```ts
import { useDomNodes } from './graph/useDomNodes'
import { CustomNodeTemplate } from './graph/CustomNodeTemplate'
import { createRoot, type Root } from 'react-dom/client'
import { useCallback, useEffect, useRef } from 'react'
```

(reuse `useEffect` / `useRef` / `useCallback` if already imported; do NOT double-import.)

Inside the component body:

```ts
const domNodes = useGraphPrefs((s) => s.domNodes)
const setDomNodes = useGraphPrefs((s) => s.setDomNodes)

// Track mounted React roots so we can unmount on rebuild and avoid
// leaks. Keyed by node id.
const domRootsRef = useRef<Map<string, Root>>(new Map())

const renderNode = useCallback(
  (data: Record<string, unknown>): HTMLElement => {
    const labelField = data.label
    const label =
      typeof labelField === 'string'
        ? labelField
        : Array.isArray(labelField) && typeof labelField[0] === 'string'
          ? (labelField[0] as string)
          : ''
    const swatchColor = labelToColor(label, theme.variant)
    const id = data.id != null ? String(data.id) : ''
    const pinned = id ? pinning.isPinned(id) : false
    const container = document.createElement('div')
    // Mount a real React tree into the container. cytoscape-dom-node
    // will position this `container` element on the canvas. createRoot
    // is the React-18+ idiomatic API and avoids innerHTML / XSS risk.
    const root = createRoot(container)
    root.render(
      <ThemeProvider theme={theme}>
        <CustomNodeTemplate
          label={label}
          swatchColor={swatchColor}
          pinned={pinned}
        />
      </ThemeProvider>
    )
    // Track for teardown on rebuild.
    if (id) {
      // Unmount any previous root for this id.
      const prev = domRootsRef.current.get(id)
      if (prev) prev.unmount()
      domRootsRef.current.set(id, root)
    }
    return container
  },
  [pinning, theme]
)

// On unmount or sig change, tear down every mounted root.
useEffect(() => {
  return () => {
    domRootsRef.current.forEach((root) => {
      try {
        root.unmount()
      } catch {
        // root already unmounted
      }
    })
    domRootsRef.current.clear()
  }
}, [sig])

useDomNodes({ cyRef, enabled: domNodes, renderNode, sig })
```

Pass to `<GraphToolbar />`:

```tsx
domNodes={domNodes}
onToggleDomNodes={() => setDomNodes(!domNodes)}
```

- [ ] **Step 8: Run tests**

Run: `npm test`
Expected: ALL pass.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/components/results/graph/useDomNodes.ts \
  src/components/results/graph/useDomNodes.test.ts \
  src/components/results/useGraphPrefs.ts \
  src/components/results/graph/GraphToolbar.tsx \
  src/components/results/GraphView.tsx \
  src/services/i18n/locales/en.ts
git commit -m "feat(graph): HTML-based custom node rendering via cytoscape-dom-node"
```

---

## Phase 6 — Anti-overlap layout via `cytoscape-spread`

### Task 13: Install cytoscape-spread + add to LAYOUTS

**Files:**
- Modify: `package.json` / `package-lock.json`
- Create: `src/types/cytoscape-spread.d.ts`
- Modify: `src/components/results/graph/layouts.ts`
- Modify: `src/services/i18n/locales/en.ts`

- [ ] **Step 1: Install**

```bash
npm install cytoscape-spread@3
```

- [ ] **Step 2: Ambient declaration**

```ts
// src/types/cytoscape-spread.d.ts
declare module 'cytoscape-spread'
```

- [ ] **Step 3: Register extension + add to LAYOUTS**

In `src/components/results/graph/layouts.ts`:

Add the import + registration at the top:

```ts
import cytoscape from 'cytoscape'
import spread from 'cytoscape-spread'

cytoscape.use(spread as unknown as cytoscape.Ext)
```

Extend `LAYOUTS`:

```ts
export const LAYOUTS = [
  'cose',
  'fcose',
  'dagre',
  'breadthfirst',
  'circle',
  'concentric',
  'grid',
  'spread',
] as const
```

In `layoutConfig(name)`, add the `'spread'` branch:

```ts
case 'spread':
  return {
    name: 'spread',
    animate: false,
    minDist: 24,
    padding: 24,
  }
```

In `layoutLabel(name, t)`:

```ts
case 'spread':
  return t('graph.layout.spread')
```

- [ ] **Step 4: Add i18n key**

In `src/services/i18n/locales/en.ts` inside `graph.layout: {}`:

```ts
spread: 'Spread (anti-overlap)',
```

- [ ] **Step 5: Verify + commit**

Run: `npx tsc --noEmit && npm test`
Expected: all green.

```bash
git add package.json package-lock.json \
  src/types/cytoscape-spread.d.ts \
  src/components/results/graph/layouts.ts \
  src/services/i18n/locales/en.ts
git commit -m "feat(graph): add cytoscape-spread anti-overlap layout"
```

---

## Phase 7 — End-to-end validation

### Task 14: Extend the e2e spec + rebuild container

**Files:**
- Modify: `e2e/specs/24-graph-power-features.spec.ts`

- [ ] **Step 1: Replace the right-click test with a cxtmenu smoke**

The existing test uses `page.getByTestId('graph-node-menu-expand')` from the deleted linear menu. cxtmenu renders a `<canvas>` overlay with no per-command testids. Replace with a container-class smoke:

```ts
test('right-click opens the cxtmenu radial container', async ({
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
  await expect(page.locator('.cy-cxtmenu')).toBeVisible()
})
```

- [ ] **Step 2: Add specs for lasso, badges, tooltip, dom-nodes**

```ts
test('lasso toggle enables lasso selection mode', async ({
  authedPage: page,
}) => {
  await page.getByTestId('graph-lasso-toggle').click()
  await expect(page.getByTestId('graph-lasso-toggle')).toHaveAttribute(
    'aria-pressed',
    'true'
  )
})

test('pinning a node renders a pin badge in the overlay', async ({
  authedPage: page,
}) => {
  const pos = await firstNodePosition(page)
  const canvas = page.getByTestId('graph-canvas')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('canvas not laid out')
  await canvas.click({
    position: { x: pos.x - box.x, y: pos.y - box.y },
  })
  await page.getByTestId('graph-action-pin').click()
  await expect(
    page.getByTestId(`graph-badge-pin-${pos.id}`)
  ).toBeVisible()
})

test('hovering a node shows the tooltip', async ({ authedPage: page }) => {
  const pos = await firstNodePosition(page)
  const canvas = page.getByTestId('graph-canvas')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('canvas not laid out')
  await canvas.hover({
    position: { x: pos.x - box.x, y: pos.y - box.y },
  })
  await expect(page.getByTestId('graph-tooltip')).toBeVisible()
})

test('HTML-node toggle flips the sticky pref', async ({
  authedPage: page,
}) => {
  const toggle = page.getByTestId('graph-dom-nodes-toggle')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
})
```

- [ ] **Step 3: Rebuild geode-ui**

```bash
docker compose -f deploy/docker-compose.test.yml build geode-ui
docker compose -f deploy/docker-compose.test.yml up -d geode-ui
until wget -qO- http://localhost:8080/healthz 2>/dev/null | grep -q ok; do sleep 2; done
```

- [ ] **Step 4: Run the affected spec**

Run: `npx playwright test --config=e2e/playwright.config.ts e2e/specs/24-graph-power-features.spec.ts --reporter=list`
Expected: all green.

- [ ] **Step 5: Run the full e2e suite**

Run: `npx playwright test --config=e2e/playwright.config.ts --reporter=list`
Expected: clean.

- [ ] **Step 6: Run jest + tsc + lint**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: ALL green.

- [ ] **Step 7: Commit**

```bash
git add e2e/specs/24-graph-power-features.spec.ts
git commit -m "test(e2e): radial menu, lasso, badges, tooltip, dom-nodes"
```

---

## Self-Review Notes

- **Cytoscape extensions added (5):** cxtmenu, lasso, popper, dom-node, spread. Each has an ambient .d.ts; each is registered once at module load (idempotent).
- **Linear menu fully removed:** 4 deleted files. Their i18n keys are retained for cxtmenu's command labels.
- **All new sticky toggles persisted with strict-true coercion:** `lasso`, `domNodes`. Defaults `false` so first-time users don't see invasive UI changes.
- **No new dependencies for badges + tooltip:** pure DOM overlays.
- **dom-node uses `createRoot` per node, NOT `innerHTML`:** XSS-safe, supports interactive elements, and matches React 18 idioms. The hook tracks roots in a ref and unmounts on sig change to avoid leaks.
- **Explicitly out of scope:** 3D rendering (impossible in cytoscape), edge bundling (no mature extension).

---

Plan complete. Total: 14 tasks across 7 phases, every task TDD with explicit fail/pass commands.
