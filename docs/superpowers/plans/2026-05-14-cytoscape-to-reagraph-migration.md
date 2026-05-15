# Cytoscape → Reagraph Migration — Phase 0: Spike, Feature Flag, Perf Validation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a second graph renderer (reagraph) behind a feature toggle, prove or disprove that reagraph's WebGL renderer beats cytoscape's canvas renderer at 5k+ nodes, and produce a written go/no-go decision before committing to the multi-week feature-parity migration.

**Architecture:** Add a `renderer: 'cytoscape' | 'reagraph'` pref to `useGraphPrefs`. `GraphView` becomes a thin dispatcher that branches to `GraphViewCytoscape` (the existing 757-line orchestrator, renamed) or a new `GraphViewReagraph` skeleton. Reagraph renders the same elements via its built-in WebGL force-directed layout — no parity features yet. A new `/dev/graph-bench` route + Playwright benchmark harness captures FPS / first-paint / steady-state memory at N ∈ {500, 2 000, 5 000, 10 000} nodes for both renderers and writes JSON results to `docs/performance/`. Phase 0 ends with a written decision in `docs/performance/2026-05-14-cytoscape-vs-reagraph.md`.

**Tech Stack:** React 18.2 + TypeScript, zustand+localStorage, styled-components 6, cytoscape 3.33 (incumbent), reagraph ^4 (challenger, WebGL via three.js), Jest + Testing Library (unit), Playwright (e2e + perf), Webpack 5.

---

## Why this is Phase 0 and not the whole migration

The cytoscape footprint in `src/components/results/graph/` is **~50 files** (50 `.ts`/`.tsx` modules touch cytoscape directly), and there are **9 cytoscape packages** (`cytoscape`, `cytoscape-cxtmenu`, `cytoscape-dagre`, `cytoscape-dom-node`, `cytoscape-fcose`, `cytoscape-lasso`, `cytoscape-navigator`, `cytoscape-popper`, `cytoscape-spread`) on the dependency surface. A full-parity migration is multi-week.

Cytoscape's API surface that reagraph has no direct equivalent for:
- `cytoscape-lasso` — freeform polygon select (reagraph has no built-in lasso)
- `cytoscape-cxtmenu` — radial context menu (reagraph has `contextMenu` prop but a different model)
- `cytoscape-dom-node` — HTML overlay per node painted into the canvas (reagraph's `renderNode` returns a three.js group, not an HTMLElement)
- Collection traversals (`node.neighborhood('node')`, BFS, edge collections) used in path-mode, focus-mode, expand-query, and inspector neighbours — reagraph exposes raw nodes/edges arrays only

The wrong move is to start ripping out cytoscape before we've confirmed reagraph's WebGL renderer is *actually* faster at the scales we care about (5k–10k nodes). The spike either justifies the migration or kills it.

## Future plans (NOT part of P0 — separate `/superpowers:writing-plans` invocations once P0 lands)

Each future plan produces working / testable software on its own and is shippable behind the same feature flag.

| Plan | Scope | Key risks |
|---|---|---|
| **P1 — Layouts parity** | Map all 8 cytoscape layouts (`cose`, `fcose`, `dagre`, `breadthfirst`, `circle`, `concentric`, `grid`, `spread`) to reagraph's 14 built-in layouts. Wire `LAYOUTS` const + toolbar picker to swap reagraph's `layoutType`. Verify `clusterByLabel` + `degreeSizing` interactions still work. | `spread` (anti-overlap pass) has no reagraph equivalent — likely a custom post-layout pass. `concentric` (by degree) needs a custom preset using `useGraphElements`' degree map. |
| **P2 — Selection + interactions parity** | Single click, shift+multi-click, marquee/box selection (replacement for cytoscape's box mode), drag, pan, zoom, fit, reset. Wire `useGraphKeyboardNav` against reagraph's node refs. Replace lasso with reagraph's marquee or custom WebGL hit-testing. | Lasso replacement is the hardest piece. Reagraph's selection model is hook-based (`useSelection`) — different mental model from cytoscape's classes. |
| **P3 — Context menus + custom node overlays** | Port `useCxtMenu` (7 radial actions) to reagraph's `contextMenu` prop. Port `useDomNodes` + `CustomNodeTemplate` from cytoscape-dom-node to reagraph's HTML2D overlay via three.js bridge (or sibling absolutely-positioned DOM that reads node screen positions from a `useGraph` ref). | The HTML overlay approach is the bulk of the work. Reagraph's `renderNode` returns three.js geometry, not HTML; HTML overlays require a parallel positioning system. |
| **P4 — Focus mode + path mode + minimap + find + badges + tooltip** | Port `useFocusMode`, `useGraphPathMode`, `useGraphBadges`, `useNodeTooltip`, `FindNodeInput`, `GraphMiniMap`, `ExpandQueryPopover` anchoring. Re-implement neighborhood traversal on raw nodes/edges arrays (no cytoscape collection API). | The traversal-heavy hooks need a new helper module (`reagraph/traversal.ts`) that builds adjacency maps once per element-set update. |
| **P5 — Test migration + cytoscape removal** | Port `GraphView.test.tsx`, `GraphView.fillHeight.test.tsx`, and all `graph/*.test.{ts,tsx}` to mock reagraph instead of cytoscape. Update Playwright specs 14–18 to assert against reagraph's WebGL canvas + DOM overlays. Remove `cytoscape` + 8 extension packages from `package.json`. Delete `cytoscapeStyle.ts`, `useGraphCytoscape.ts`, all `cy*.ts` helpers, and the cytoscape branch of the dispatcher. | E2E perf-regression watch: removing the feature flag is one-way. Verify perf on `geode-ui:e2e` after deletion before merging. |

---

## File Structure (Phase 0)

This is the file map for **Phase 0 only**. Later phases will add/touch additional files.

| File | Responsibility | Action |
|---|---|---|
| `package.json` | Add `reagraph` runtime dep | Modify |
| `src/components/results/useGraphPrefs.ts` | Add `renderer: 'cytoscape' \| 'reagraph'` pref (sticky, default cytoscape) | Modify (extend) |
| `src/components/results/GraphView.tsx` | Becomes a thin dispatcher — moves the existing 757-line body to GraphViewCytoscape.tsx and branches by pref | Modify |
| `src/components/results/GraphViewCytoscape.tsx` | The existing GraphView body, renamed | Create (move) |
| `src/components/results/GraphViewReagraph.tsx` | New reagraph renderer — minimal: nodes + edges + force layout + theme colors. NO parity features (no context menu, no lasso, no DOM nodes, no focus mode, no minimap, no find, no badges, no tooltip, no path mode, no expand-query). | Create |
| `src/components/results/graph/GraphToolbar.tsx` | Add renderer toggle (`<wa-tab-group>` or compact toggle button — toolbar pattern already exists) | Modify |
| `src/components/results/graph/useGraphElements.ts` | Already returns `elements` in cytoscape's `{data:{...}}` shape; add a derived `reagraphNodes` / `reagraphEdges` projection for the new renderer | Modify |
| `src/components/results/graph/reagraphElements.ts` | Pure projection helper: `toReagraphNodes(elements)` / `toReagraphEdges(elements)` (so it's unit-testable independently of React) | Create |
| `src/components/results/graph/reagraphElements.test.ts` | Unit tests for the projection (3 fixtures: empty, simple, clustered) | Create |
| `src/components/results/GraphViewReagraph.test.tsx` | Unit tests for the new renderer (mocks reagraph, asserts elements + theme wiring) | Create |
| `src/pages/dev/GraphBenchPage.tsx` | Dev-only route (NODE_ENV !== 'production') that generates N seeded nodes/edges and mounts the requested renderer. Reads `?n=` and `?renderer=` from URL. Logs FPS samples to console for the harness to capture. | Create |
| `src/lib/seededGraph.ts` | Pure helper: `seededGraph(n: number, seed = 42)` returns deterministic `{nodes, edges}` shaped for `useGraphElements`. Average degree ~3. | Create |
| `src/lib/seededGraph.test.ts` | Unit tests: determinism, node count, edge count bounds, no self-loops | Create |
| `e2e/specs/19-graph-bench.spec.ts` | Playwright perf harness: navigates to `/dev/graph-bench?n=N&renderer=R`, waits for first frame, samples FPS for 5 s, captures `performance.memory.usedJSHeapSize`, writes one row per combo to `docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json`. | Create |
| `docs/performance/2026-05-14-cytoscape-vs-reagraph.md` | Final decision report. Sections: methodology, results table, observations, go/no-go decision, signed by date + commit SHA. | Create |
| `docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json` | Machine-readable bench output (the harness writes this) | Create (via harness) |

---

## Pre-flight (do once before Task 1)

- [ ] **Read the existing GraphView orchestrator end-to-end** so the dispatcher split is informed.

Run: `wc -l src/components/results/GraphView.tsx` → expected output: `757 src/components/results/GraphView.tsx`. Then open it in an editor.

- [ ] **Confirm the existing test gates are green on `main` before any changes.**

Run:
```
make ci
```
Expected: `tsc` clean, ESLint clean (`--max-warnings=0`), Jest 644/644, Prettier clean. If anything is red, STOP and fix `main` first — don't migrate on top of a broken base.

- [ ] **Verify the dev container builds & runs the current cytoscape UI on http://localhost:8080.**

Run:
```
PWD=$(pwd -P) docker compose -f deploy/docker-compose.test.yml up -d geode-ui
curl -fsS http://localhost:8080/ | head -1
```
Expected: HTML response starting with `<!DOCTYPE html>`. If not, the symlink workaround in PRIOR-COMMIT `0402ece` may need re-applying.

---

### Task 1: Add the `renderer` pref + toolbar toggle (no renderer impl yet)

This task ships a working toggle that does nothing — clicking it flips a localStorage value but the canvas keeps showing cytoscape. That's intentional: it isolates the pref + toolbar wiring from the renderer swap, so a regression in either is bisectable.

**Files:**
- Modify: `src/components/results/useGraphPrefs.ts:23-50` (add `Renderer` type + default + persisted-shape field)
- Modify: `src/components/results/useGraphPrefs.ts:52-225` (add `renderer` field + setter + persist round-trip)
- Modify: `src/components/results/graph/GraphToolbar.tsx` (add toggle button + props)
- Modify: `src/components/results/GraphView.tsx` (pass `renderer` + `setRenderer` to toolbar; orchestrator stays cytoscape-only this task)
- Test: `src/components/results/useGraphPrefs.test.ts` (new; tests below)
- Test: `src/components/results/graph/GraphToolbar.test.tsx` (extend if exists, else create)

- [ ] **Step 1: Write the failing pref-store test**

Create `src/components/results/useGraphPrefs.test.ts`:

```typescript
import { useGraphPrefs } from './useGraphPrefs'

describe('useGraphPrefs renderer pref', () => {
  beforeEach(() => {
    window.localStorage.clear()
    // Reset zustand store to defaults — re-importing isn't enough because
    // the module-level create() runs once. Pull setRenderer and call it.
    useGraphPrefs.getState().setRenderer('cytoscape')
  })

  it('defaults to cytoscape', () => {
    expect(useGraphPrefs.getState().renderer).toBe('cytoscape')
  })

  it('switches to reagraph and persists', () => {
    useGraphPrefs.getState().setRenderer('reagraph')
    expect(useGraphPrefs.getState().renderer).toBe('reagraph')
    const raw = window.localStorage.getItem('geode-ui.graph-prefs')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw as string)
    expect(parsed.state.renderer).toBe('reagraph')
  })

  it('coerces garbage values back to cytoscape on rehydrate', () => {
    // Simulate a stale persisted shape with a bogus renderer string.
    window.localStorage.setItem(
      'geode-ui.graph-prefs',
      JSON.stringify({
        state: { renderer: 'totally-not-a-renderer' },
        version: 0,
      })
    )
    // Force the store to re-merge from storage. zustand's persist
    // exposes `rehydrate()` for this.
    useGraphPrefs.persist.rehydrate()
    expect(useGraphPrefs.getState().renderer).toBe('cytoscape')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --testPathPattern=useGraphPrefs.test`
Expected: FAIL — `renderer` is not a field on the store; `setRenderer` does not exist; TypeScript compile error.

- [ ] **Step 3: Extend `useGraphPrefs` to add the `renderer` pref**

In `src/components/results/useGraphPrefs.ts`:

After the `SelectionMode` block around line 47, add:

```typescript
// Which graph renderer to use. `cytoscape` is the incumbent canvas
// renderer (current default). `reagraph` is the WebGL challenger being
// validated under the cytoscape→reagraph migration (Phase 0). Sticky so
// switching survives a re-run remount and a page reload — the toggle
// lives in the graph toolbar and lets the user (and the perf harness)
// flip between renderers without changing code.
export type Renderer = 'cytoscape' | 'reagraph'

export const DEFAULT_RENDERER: Renderer = 'cytoscape'
```

In `GraphPrefsState` (around line 52), add:

```typescript
  // See Renderer type above.
  renderer: Renderer
  setRenderer: (r: Renderer) => void
```

In `PersistedShape` (around line 104):

```typescript
  renderer: Renderer
```

In the `coerce*` helpers section, add:

```typescript
function coerceRenderer(v: unknown): Renderer {
  return v === 'reagraph' ? 'reagraph' : DEFAULT_RENDERER
}
```

In the `create<GraphPrefsState>` body (around line 128), add to the initial state:

```typescript
      renderer: DEFAULT_RENDERER,
```

…and the setter:

```typescript
      setRenderer: (r) => set({ renderer: r }),
```

In `partialize` (around line 169):

```typescript
        renderer: s.renderer,
```

In `merge` (around line 187):

```typescript
          renderer: coerceRenderer(p.renderer),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --testPathPattern=useGraphPrefs.test`
Expected: PASS — all three cases green.

- [ ] **Step 5: Write the toolbar toggle test**

Open `src/components/results/graph/GraphToolbar.test.tsx`. If the file doesn't exist, create it. Append (or wrap in `describe`):

```typescript
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from 'styled-components'
import { theme } from '../../../themes/theme'
import { GraphToolbar } from './GraphToolbar'

// Stub out every other toolbar prop with the existing test helper or
// inline minimal stubs. Only the renderer toggle is exercised here.
const toolbarProps = (overrides: Record<string, unknown> = {}) => ({
  t: ((k: string) => k) as never,
  sidebarCollapsed: false,
  onToggleSidebar: jest.fn(),
  layout: 'cose' as const,
  onChangeLayout: jest.fn(),
  layouts: ['cose'] as const,
  layoutLabel: (k: string) => k,
  onZoomIn: jest.fn(),
  onZoomOut: jest.fn(),
  onFit: jest.fn(),
  onResetView: jest.fn(),
  selectionMode: 'pan' as const,
  onToggleSelectionMode: jest.fn(),
  clusterByLabel: false,
  onToggleClusterByLabel: jest.fn(),
  degreeSizing: false,
  onToggleDegreeSizing: jest.fn(),
  pathActive: false,
  onTogglePathMode: jest.fn(),
  onPathClear: jest.fn(),
  miniMap: false,
  onToggleMiniMap: jest.fn(),
  lasso: false,
  onToggleLasso: jest.fn(),
  domNodes: false,
  onToggleDomNodes: jest.fn(),
  findNodes: [],
  onFindPick: jest.fn(),
  counts: { nodes: 0, edges: 0 },
  renderer: 'cytoscape' as const,
  onToggleRenderer: jest.fn(),
  ...overrides,
})

describe('GraphToolbar renderer toggle', () => {
  it('renders a toggle showing the current renderer', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphToolbar {...(toolbarProps() as never)} />
      </ThemeProvider>
    )
    const btn = screen.getByTestId('graph-renderer-toggle')
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    expect(btn).toHaveAccessibleName(/renderer.*cytoscape/i)
  })

  it('reflects pressed state when renderer is reagraph', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphToolbar
          {...(toolbarProps({ renderer: 'reagraph' }) as never)}
        />
      </ThemeProvider>
    )
    const btn = screen.getByTestId('graph-renderer-toggle')
    expect(btn).toHaveAttribute('aria-pressed', 'true')
  })

  it('fires onToggleRenderer when clicked', async () => {
    const user = userEvent.setup()
    const onToggle = jest.fn()
    render(
      <ThemeProvider theme={theme}>
        <GraphToolbar
          {...(toolbarProps({ onToggleRenderer: onToggle }) as never)}
        />
      </ThemeProvider>
    )
    await user.click(screen.getByTestId('graph-renderer-toggle'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test -- --testPathPattern=GraphToolbar.test`
Expected: FAIL — `renderer` / `onToggleRenderer` are unknown props; `data-testid="graph-renderer-toggle"` not in the DOM.

- [ ] **Step 7: Wire the toggle into `GraphToolbar.tsx`**

Open `src/components/results/graph/GraphToolbar.tsx`. Locate the `GraphToolbarProps` type and add at the end of its fields:

```typescript
  renderer: 'cytoscape' | 'reagraph'
  onToggleRenderer: () => void
```

Locate where the other toolbar toggle buttons are rendered (look for `data-testid="graph-toolbar-minimap"` or similar). Add a new toggle adjacent to it:

```tsx
<button
  type="button"
  data-testid="graph-renderer-toggle"
  aria-pressed={renderer === 'reagraph'}
  aria-label={`Renderer: ${renderer === 'reagraph' ? 'reagraph (WebGL)' : 'cytoscape (canvas)'}`}
  title="Toggle graph renderer (cytoscape ↔ reagraph)"
  onClick={onToggleRenderer}
>
  {renderer === 'reagraph' ? 'WebGL' : 'Canvas'}
</button>
```

Destructure `renderer` and `onToggleRenderer` from props at the top of the function body alongside the other props.

- [ ] **Step 8: Wire the toggle into `GraphView.tsx`**

In `src/components/results/GraphView.tsx` around line 148 (where other prefs are read), add:

```typescript
  const renderer = useGraphPrefs((s) => s.renderer)
  const setRenderer = useGraphPrefs((s) => s.setRenderer)
```

In the `<GraphToolbar />` JSX (around line 632), add the two new props:

```tsx
          renderer={renderer}
          onToggleRenderer={() =>
            setRenderer(renderer === 'reagraph' ? 'cytoscape' : 'reagraph')
          }
```

- [ ] **Step 9: Run unit tests to verify everything passes**

Run: `npm test -- --testPathPattern='useGraphPrefs|GraphToolbar'`
Expected: PASS for both files.

- [ ] **Step 10: Run the full unit suite + tsc + lint to verify no regressions**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: All green. 644+3 tests passing (the 3 new renderer tests).

- [ ] **Step 11: Commit**

```bash
git add src/components/results/useGraphPrefs.ts src/components/results/useGraphPrefs.test.ts src/components/results/graph/GraphToolbar.tsx src/components/results/graph/GraphToolbar.test.tsx src/components/results/GraphView.tsx
git commit -m "feat(graph): add renderer pref (cytoscape|reagraph) + toolbar toggle"
```

---

### Task 2: Install reagraph and verify it loads

**Files:**
- Modify: `package.json` (add `reagraph` runtime dep)
- Modify: `package-lock.json` (npm install regenerates)

- [ ] **Step 1: Install reagraph**

Run: `npm install --save reagraph`
Expected: Adds `"reagraph": "^4.x.x"` to `dependencies` in `package.json`. No peer-dep warnings on React 18.2.

- [ ] **Step 2: Verify the import resolves**

Create a temporary `src/_smoke.ts`:

```typescript
import { GraphCanvas } from 'reagraph'
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _ = GraphCanvas
```

Run: `npx tsc --noEmit`
Expected: Clean — no `Cannot find module 'reagraph'` or missing type errors.

- [ ] **Step 3: Delete the smoke file**

Run: `rm src/_smoke.ts`

- [ ] **Step 4: Verify webpack can bundle it**

Run: `npm run build`
Expected: Webpack build succeeds. (We won't import reagraph from any production code yet — this build just confirms the dep tree resolves.)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(deps): add reagraph for cytoscape migration spike"
```

---

### Task 3: Project elements into reagraph's shape

Reagraph wants flat `{ id, label, fill?, size? }` nodes and `{ id, source, target, label? }` edges — not cytoscape's `{ data: {...} }` wrapper. Build the projection as a pure helper so it's unit-testable without React.

**Files:**
- Create: `src/components/results/graph/reagraphElements.ts`
- Create: `src/components/results/graph/reagraphElements.test.ts`

- [ ] **Step 1: Write the failing projection test**

Create `src/components/results/graph/reagraphElements.test.ts`:

```typescript
import { toReagraphElements } from './reagraphElements'
import type { ElementDefinition } from 'cytoscape'

const variant = 'light' as const

describe('toReagraphElements', () => {
  it('returns empty arrays for empty input', () => {
    const { nodes, edges } = toReagraphElements([], variant)
    expect(nodes).toEqual([])
    expect(edges).toEqual([])
  })

  it('projects a simple two-node one-edge cytoscape shape', () => {
    const els: ElementDefinition[] = [
      { data: { id: 'a', label: 'Person', name: 'Alice' } },
      { data: { id: 'b', label: 'Person', name: 'Bob' } },
      { data: { id: 'a->b', source: 'a', target: 'b', type: 'KNOWS' } },
    ]
    const { nodes, edges } = toReagraphElements(els, variant)
    expect(nodes).toHaveLength(2)
    expect(edges).toHaveLength(1)
    expect(nodes[0]).toMatchObject({
      id: 'a',
      label: 'Person',
      data: { name: 'Alice' },
    })
    expect(nodes[0].fill).toMatch(/^#[0-9a-f]{6}$/i)
    expect(edges[0]).toMatchObject({
      id: 'a->b',
      source: 'a',
      target: 'b',
      label: 'KNOWS',
    })
  })

  it('coerces array-shaped labels to their first string', () => {
    const els: ElementDefinition[] = [
      { data: { id: 'x', label: ['Movie', 'Film'] } },
    ]
    const { nodes } = toReagraphElements(els, variant)
    expect(nodes[0].label).toBe('Movie')
  })

  it('drops elements with missing/empty id (defensive)', () => {
    const els: ElementDefinition[] = [
      { data: { id: '', label: 'X' } },
      { data: { source: 'a', target: 'b' } },
    ]
    const { nodes, edges } = toReagraphElements(els, variant)
    expect(nodes).toHaveLength(0)
    expect(edges).toHaveLength(0)
  })

  it('uses labelToColor so fills match the cytoscape palette exactly', async () => {
    const { labelToColor } = await import('../cytoscapeStyle')
    const els: ElementDefinition[] = [{ data: { id: 'a', label: 'Person' } }]
    const { nodes } = toReagraphElements(els, variant)
    expect(nodes[0].fill).toBe(labelToColor('Person', variant))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --testPathPattern=reagraphElements.test`
Expected: FAIL — `Cannot find module './reagraphElements'`.

- [ ] **Step 3: Implement the projection**

Create `src/components/results/graph/reagraphElements.ts`:

```typescript
import type { ElementDefinition } from 'cytoscape'
import { labelToColor } from '../cytoscapeStyle'

// Minimal reagraph element shapes. We intentionally keep these to the
// fields GraphViewReagraph actually reads in Phase 0 — `id` + `label`
// for display, `fill` for theme parity, and `data` so downstream
// selection / inspector code can recover the original cytoscape data
// bag. Full type parity (size, icons, subLabel, etc.) lands in P3 with
// the custom-node-overlay port.
export type ReagraphNode = {
  id: string
  label: string
  fill: string
  data: Record<string, unknown>
}

export type ReagraphEdge = {
  id: string
  source: string
  target: string
  label?: string
}

// Project a cytoscape element-set (the shape `useGraphElements`
// produces) into the flat `{nodes, edges}` reagraph wants. The
// `variant` argument is the active theme variant ('light' | 'dark')
// so labelToColor returns the right palette entry.
//
// Defensive on input: an element with an empty/missing id is dropped
// rather than rendered as an orphan, and an edge with a missing source
// or target is treated the same way. Label arrays (Neo4j multi-label)
// collapse to the first string entry so node-coloring is deterministic.
export function toReagraphElements(
  elements: ElementDefinition[],
  variant: 'light' | 'dark'
): { nodes: ReagraphNode[]; edges: ReagraphEdge[] } {
  const nodes: ReagraphNode[] = []
  const edges: ReagraphEdge[] = []
  for (const el of elements) {
    const data = el.data ?? {}
    const id = data.id != null ? String(data.id) : ''
    if (!id) continue
    const source = data.source != null ? String(data.source) : ''
    const target = data.target != null ? String(data.target) : ''
    if (source && target) {
      const typeRaw = data.type ?? data.label
      const label = typeof typeRaw === 'string' ? typeRaw : undefined
      edges.push({ id, source, target, label })
      continue
    }
    const labelField = data.label
    let label = ''
    if (typeof labelField === 'string') label = labelField
    else if (Array.isArray(labelField) && typeof labelField[0] === 'string')
      label = labelField[0]
    nodes.push({
      id,
      label,
      fill: labelToColor(label, variant),
      data,
    })
  }
  return { nodes, edges }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --testPathPattern=reagraphElements.test`
Expected: PASS — all five cases green.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/reagraphElements.ts src/components/results/graph/reagraphElements.test.ts
git commit -m "feat(graph): add reagraph element projection helper"
```

---

### Task 4: Split GraphView into a dispatcher + GraphViewCytoscape

Move the 757-line GraphView body into `GraphViewCytoscape.tsx` verbatim, then make `GraphView.tsx` a 30-line dispatcher that picks the renderer based on the pref.

**Files:**
- Create: `src/components/results/GraphViewCytoscape.tsx` (moved body)
- Modify: `src/components/results/GraphView.tsx` (becomes thin dispatcher)
- Modify: `src/components/results/GraphView.test.tsx` (point at the renamed component or the dispatcher — pick one and verify)

- [ ] **Step 1: Copy GraphView body verbatim into GraphViewCytoscape**

```bash
cp src/components/results/GraphView.tsx src/components/results/GraphViewCytoscape.tsx
```

Open `src/components/results/GraphViewCytoscape.tsx` and rename the exported component:

Replace `export const GraphView: React.FC<Props>` with `export const GraphViewCytoscape: React.FC<Props>`.

Also rename the `Props` type to `GraphViewCytoscapeProps` AND **export** it (the dispatcher will import it):

```typescript
export type GraphViewCytoscapeProps = {
  resp: QueryRespLike & { row_count?: number }
  query?: string
  height?: number
  fillHeight?: boolean
}
```

- [ ] **Step 2: Rewrite `GraphView.tsx` as a dispatcher**

Open `src/components/results/GraphView.tsx` and replace its entire contents with:

```typescript
import React, { lazy, Suspense } from 'react'
import { useGraphPrefs } from './useGraphPrefs'
import {
  GraphViewCytoscape,
  type GraphViewCytoscapeProps,
} from './GraphViewCytoscape'

// Reagraph pulls in three.js (~600 KB minified) — lazy-load it so the
// cytoscape default path doesn't pay the bundle cost. The chunk is
// fetched the first time the user flips the renderer toggle. Suspense
// fallback is a single-frame placeholder; in practice the chunk is in
// cache after the first toggle.
const GraphViewReagraph = lazy(() =>
  import('./GraphViewReagraph').then((m) => ({ default: m.GraphViewReagraph }))
)

export type GraphViewProps = GraphViewCytoscapeProps

// Thin dispatcher that picks the active graph renderer from the sticky
// pref in useGraphPrefs. Both branches receive identical props — the
// renderer choice is intentionally invisible to the caller (QueryPage,
// the maximised overlay, etc.) so a future feature-flag flip or rollback
// is a one-line change here.
export const GraphView: React.FC<GraphViewProps> = (props) => {
  const renderer = useGraphPrefs((s) => s.renderer)
  if (renderer === 'reagraph') {
    return (
      <Suspense fallback={<div data-testid="graph-renderer-loading" />}>
        <GraphViewReagraph {...props} />
      </Suspense>
    )
  }
  return <GraphViewCytoscape {...props} />
}
```

- [ ] **Step 3: Verify the existing GraphView test suite still passes**

Run: `npm test -- --testPathPattern='GraphView'`
Expected: PASS — `GraphView.test.tsx` still works because the dispatcher defaults to cytoscape (which is what the existing tests assert against). `GraphView.fillHeight.test.tsx` likewise still passes.

If a test imports the renamed cytoscape body directly (unlikely), update the import.

- [ ] **Step 4: Verify tsc + lint pass**

Run: `npx tsc --noEmit && npm run lint`
Expected: tsc fails — `Cannot find module './GraphViewReagraph'`. That's the next task. Stop here.

Note: We do NOT commit a half-broken state. Tasks 4 and 5 are committed together at the end of Task 5.

---

### Task 5: Build the minimal GraphViewReagraph

Spike-level renderer: nodes + edges + force layout + theme fill. No parity features. Just enough to load 10k nodes and not crash.

**Files:**
- Create: `src/components/results/GraphViewReagraph.tsx`
- Create: `src/components/results/GraphViewReagraph.test.tsx`

- [ ] **Step 1: Write the failing renderer test**

Create `src/components/results/GraphViewReagraph.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { theme } from '../../themes/theme'
import { GraphViewReagraph } from './GraphViewReagraph'
import type { QueryRespLike } from '../../lib/graphResult'

// Mock reagraph so jsdom doesn't try to instantiate WebGL. We assert
// against the props we pass into <GraphCanvas/> — that's the
// integration boundary that matters at the renderer level.
const mockGraphCanvas = jest.fn(() => <div data-testid="reagraph-canvas" />)
jest.mock('reagraph', () => ({
  __esModule: true,
  GraphCanvas: (props: unknown) => mockGraphCanvas(props),
}))

const resp: QueryRespLike = {
  rows: [],
  cols: [],
  graph_summary: {
    nodes: [
      { id: 'a', labels: ['Person'], properties: { name: 'Alice' } },
      { id: 'b', labels: ['Person'], properties: { name: 'Bob' } },
    ],
    edges: [
      { id: 'a->b', source: 'a', target: 'b', type: 'KNOWS' },
    ],
  },
}

const renderWithTheme = () =>
  render(
    <ThemeProvider theme={theme}>
      <GraphViewReagraph resp={resp} />
    </ThemeProvider>
  )

describe('GraphViewReagraph', () => {
  beforeEach(() => mockGraphCanvas.mockClear())

  it('mounts the reagraph canvas', () => {
    renderWithTheme()
    expect(screen.getByTestId('reagraph-canvas')).toBeInTheDocument()
  })

  it('forwards projected nodes and edges to GraphCanvas', () => {
    renderWithTheme()
    expect(mockGraphCanvas).toHaveBeenCalled()
    const props = mockGraphCanvas.mock.calls[0][0] as {
      nodes: { id: string }[]
      edges: { id: string }[]
    }
    expect(props.nodes.map((n) => n.id).sort()).toEqual(['a', 'b'])
    expect(props.edges.map((e) => e.id)).toEqual(['a->b'])
  })

  it('uses forceDirected2d layout by default', () => {
    renderWithTheme()
    const props = mockGraphCanvas.mock.calls[0][0] as {
      layoutType: string
    }
    expect(props.layoutType).toBe('forceDirected2d')
  })

  it('shows the empty-state overlay when there are no elements', () => {
    const empty: QueryRespLike = {
      rows: [],
      cols: [],
      graph_summary: { nodes: [], edges: [] },
    }
    render(
      <ThemeProvider theme={theme}>
        <GraphViewReagraph resp={empty} />
      </ThemeProvider>
    )
    expect(screen.getByTestId('graph-empty-state')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --testPathPattern=GraphViewReagraph.test`
Expected: FAIL — `Cannot find module './GraphViewReagraph'`.

- [ ] **Step 3: Implement the renderer**

Create `src/components/results/GraphViewReagraph.tsx`:

```typescript
import React, { useMemo } from 'react'
import { useTheme } from 'styled-components'
import { GraphCanvas } from 'reagraph'
import { useGraphElements } from './graph/useGraphElements'
import { toReagraphElements } from './graph/reagraphElements'
import type { QueryRespLike } from '../../lib/graphResult'
import { Canvas, Overlay, Wrap } from './graph/styled'

// Phase 0 — spike renderer. Mounts a <GraphCanvas/> with the projected
// element set and a default force-directed 2D layout. Theme parity (node
// fills) lands here; everything else (selection, context menu, focus
// mode, lasso, minimap, custom DOM nodes, find, badges, tooltip,
// expand-query, path mode, sidebar, ResizeObserver re-fit) is
// intentionally absent — those land in plans P1–P4 once perf is proven.
//
// The component shares the same Props shape as GraphViewCytoscape so the
// dispatcher (GraphView.tsx) is a drop-in branch.

export type GraphViewReagraphProps = {
  resp: QueryRespLike & { row_count?: number }
  query?: string
  height?: number
  fillHeight?: boolean
}

export const GraphViewReagraph: React.FC<GraphViewReagraphProps> = ({
  resp,
  query,
  height = 480,
  fillHeight = false,
}) => {
  const theme = useTheme()
  // Reuse the existing element extractor so the same `resp` produces the
  // same element-set regardless of renderer. clusterByLabel / degreeSizing
  // are forced off in Phase 0 — they map to reagraph features that don't
  // exist yet.
  const { elements } = useGraphElements({
    resp,
    query,
    clusterByLabel: false,
    degreeSizing: false,
  })
  const { nodes, edges } = useMemo(
    () => toReagraphElements(elements, theme.variant),
    [elements, theme.variant]
  )
  const empty = nodes.length === 0
  const canvasHeight = fillHeight ? undefined : height
  return (
    <Wrap $fill={fillHeight} $sidebarCollapsed={true}>
      <Canvas
        $height={canvasHeight}
        role="img"
        aria-label="Graph (reagraph WebGL renderer)"
        data-testid="graph-canvas"
        data-renderer="reagraph"
      >
        <GraphCanvas
          nodes={nodes}
          edges={edges}
          layoutType="forceDirected2d"
          theme={{
            canvas: { background: theme.bg.surface },
            node: {
              fill: theme.fg.muted,
              activeFill: theme.fg.primary,
              opacity: 1,
              selectedOpacity: 1,
              label: {
                color: theme.text.primary,
                stroke: theme.bg.surface,
                activeColor: theme.text.primary,
              },
            },
            edge: {
              fill: theme.border.subtle,
              activeFill: theme.fg.primary,
              opacity: 1,
              selectedOpacity: 1,
              label: { color: theme.text.muted, stroke: theme.bg.surface },
            },
          }}
        />
      </Canvas>
      {empty && (
        <Overlay data-testid="graph-empty-state">No graph data.</Overlay>
      )}
    </Wrap>
  )
}
```

> **Note on theme keys:** The theme keys (`bg.surface`, `fg.muted`, etc.) MUST match the actual `Theme` type defined in `src/themes/theme.ts`. If a key doesn't exist there, fix the reference — don't invent. Run `grep -E "^\s+(bg|fg|text|border)\s*:" src/themes/theme.ts` to enumerate the available keys before editing this block.

- [ ] **Step 4: Run the renderer test to verify it passes**

Run: `npm test -- --testPathPattern=GraphViewReagraph.test`
Expected: PASS — all four cases green.

- [ ] **Step 5: Run the full suite + tsc + lint**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: All green. 644+3+5 = 652 tests passing (3 from Task 1, 5 from Tasks 3+5).

- [ ] **Step 6: Commit both the split and the new renderer atomically**

```bash
git add src/components/results/GraphView.tsx src/components/results/GraphViewCytoscape.tsx src/components/results/GraphViewReagraph.tsx src/components/results/GraphViewReagraph.test.tsx
git commit -m "feat(graph): add minimal reagraph renderer behind feature flag

- Split GraphView into a dispatcher + GraphViewCytoscape (existing body).
- Add GraphViewReagraph with nodes/edges/force layout/theme parity only.
- Lazy-load reagraph chunk to keep cytoscape default path bundle stable.
- No parity features yet (Phase 0 spike) — coming in P1-P4."
```

---

### Task 6: Build the seeded graph fixture helper

Pure helper that generates deterministic `{nodes, edges}` at a chosen size. Used by both the benchmark page and any future stress tests.

**Files:**
- Create: `src/lib/seededGraph.ts`
- Create: `src/lib/seededGraph.test.ts`

- [ ] **Step 1: Write the failing fixture test**

Create `src/lib/seededGraph.test.ts`:

```typescript
import { seededGraph } from './seededGraph'

describe('seededGraph', () => {
  it('returns the requested node count', () => {
    const { nodes } = seededGraph(100)
    expect(nodes).toHaveLength(100)
  })

  it('is deterministic for the same seed', () => {
    const a = seededGraph(50, 7)
    const b = seededGraph(50, 7)
    expect(a.nodes.map((n) => n.id)).toEqual(b.nodes.map((n) => n.id))
    expect(a.edges).toEqual(b.edges)
  })

  it('produces different outputs for different seeds', () => {
    const a = seededGraph(50, 1)
    const b = seededGraph(50, 2)
    expect(a.edges).not.toEqual(b.edges)
  })

  it('respects expected edge bounds (avg degree ≈ 3, no self-loops)', () => {
    const { nodes, edges } = seededGraph(1000)
    // ~3 edges/node ⇒ ~1500 unique undirected; we keep them directed in
    // the source array but dedupe by (source,target) — call it 1000-1500.
    expect(edges.length).toBeGreaterThanOrEqual(800)
    expect(edges.length).toBeLessThanOrEqual(2000)
    for (const e of edges) {
      expect(e.source).not.toBe(e.target)
    }
    const ids = new Set(nodes.map((n) => n.id))
    for (const e of edges) {
      expect(ids.has(e.source)).toBe(true)
      expect(ids.has(e.target)).toBe(true)
    }
  })

  it('labels nodes across a few buckets so coloring is exercised', () => {
    const { nodes } = seededGraph(200)
    const labels = new Set(nodes.map((n) => n.label))
    expect(labels.size).toBeGreaterThanOrEqual(3)
    expect(labels.size).toBeLessThanOrEqual(10)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --testPathPattern=seededGraph.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `src/lib/seededGraph.ts`:

```typescript
// Deterministic graph fixture generator for benchmarks and stress
// tests. Uses a tiny xorshift32 PRNG (no dependency on Math.random or
// crypto) so the same (n, seed) always produces the same output across
// runs and machines.

const LABEL_BUCKETS = [
  'Person',
  'Movie',
  'Company',
  'Place',
  'Topic',
  'Tag',
] as const

// xorshift32 — a small, fast, well-known PRNG suitable for fixture
// generation (NOT cryptographically secure, intentionally so).
function makeRand(seed: number): () => number {
  let x = seed | 0 || 1
  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    // Return a float in [0, 1).
    return ((x >>> 0) % 1_000_000) / 1_000_000
  }
}

export type SeededNode = {
  id: string
  label: string
  properties: Record<string, string | number>
}

export type SeededEdge = {
  id: string
  source: string
  target: string
  type: string
}

// Generate a deterministic graph of `n` nodes with an average degree of
// ~3 (each node gets up to 3 outgoing edges to random other nodes,
// deduped). Each node is assigned a label from LABEL_BUCKETS by hash so
// label coloring is exercised at every scale.
export function seededGraph(
  n: number,
  seed = 42
): { nodes: SeededNode[]; edges: SeededEdge[] } {
  if (n < 0 || !Number.isFinite(n)) return { nodes: [], edges: [] }
  const rand = makeRand(seed)
  const nodes: SeededNode[] = []
  for (let i = 0; i < n; i++) {
    const label = LABEL_BUCKETS[i % LABEL_BUCKETS.length]
    nodes.push({
      id: `n${i}`,
      label,
      properties: { name: `${label} ${i}`, index: i },
    })
  }
  const seen = new Set<string>()
  const edges: SeededEdge[] = []
  for (let i = 0; i < n; i++) {
    // 1–3 outgoing edges per node (random count, random targets).
    const k = 1 + Math.floor(rand() * 3)
    for (let j = 0; j < k; j++) {
      const tgt = Math.floor(rand() * n)
      if (tgt === i) continue
      const key = `${i}->${tgt}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({
        id: key,
        source: `n${i}`,
        target: `n${tgt}`,
        type: 'EDGE',
      })
    }
  }
  return { nodes, edges }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --testPathPattern=seededGraph.test`
Expected: PASS — all five cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/seededGraph.ts src/lib/seededGraph.test.ts
git commit -m "test(graph): add seeded fixture generator for renderer benchmarks"
```

---

### Task 7: Build the dev-only `/graph-bench` route

Mountable page that runs a chosen renderer against N seeded nodes. Reads `?n=` and `?renderer=` from URL. Console-logs FPS samples + first-paint + JS heap on a 5-second interval. Playwright (next task) drives this.

**Files:**
- Create: `src/pages/dev/GraphBenchPage.tsx`
- Modify: `src/App.tsx` (add route — guarded by `process.env.NODE_ENV !== 'production'`)

> **Approach:** GraphBench wraps the existing `<GraphView/>` dispatcher and synthesises a `QueryRespLike` from the seeded graph. That way it stresses the **real** renderer pipeline (including the `useGraphElements` extractor and the same theme wiring) rather than a parallel test-only path.

- [ ] **Step 1: Locate the App router and verify the route conventions**

Read: `src/App.tsx`
Look for: existing `<Route path="..." element={...} />` entries. If routes use React Router v6 paths, follow that pattern. If lazy-loaded, follow that pattern. Note the path naming convention (e.g. `/login`, `/query`).

- [ ] **Step 2: Implement the bench page**

Create `src/pages/dev/GraphBenchPage.tsx`:

```typescript
import React, { useEffect, useMemo } from 'react'
import { GraphView } from '../../components/results/GraphView'
import { seededGraph } from '../../lib/seededGraph'
import { useGraphPrefs } from '../../components/results/useGraphPrefs'
import type { QueryRespLike } from '../../lib/graphResult'

// Dev-only benchmark host for the cytoscape→reagraph spike. Reads
// `n` and `renderer` from the URL query string; the renderer choice
// is pushed into useGraphPrefs so the GraphView dispatcher picks it
// up on next render. Logs `[graph-bench]` records to the console
// every 200 ms — the Playwright harness in e2e/specs/19 listens for
// these and aggregates them into the benchmark JSON.
//
// IMPORTANT: This page is ONLY mounted in non-production builds. The
// App router gates the route accordingly.

function readQuery(): { n: number; renderer: 'cytoscape' | 'reagraph' } {
  const params = new URLSearchParams(window.location.search)
  const nRaw = parseInt(params.get('n') ?? '1000', 10)
  const n = Number.isFinite(nRaw) && nRaw > 0 ? Math.min(nRaw, 50_000) : 1000
  const r = params.get('renderer')
  const renderer = r === 'reagraph' ? 'reagraph' : 'cytoscape'
  return { n, renderer }
}

function toQueryRespLike(
  graph: ReturnType<typeof seededGraph>
): QueryRespLike & { row_count: number } {
  return {
    rows: [],
    cols: [],
    row_count: graph.nodes.length + graph.edges.length,
    graph_summary: {
      nodes: graph.nodes.map((n) => ({
        id: n.id,
        labels: [n.label],
        properties: n.properties,
      })),
      edges: graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type,
      })),
    },
  }
}

export const GraphBenchPage: React.FC = () => {
  const { n, renderer } = useMemo(readQuery, [])
  const setRenderer = useGraphPrefs((s) => s.setRenderer)
  const resp = useMemo(() => toQueryRespLike(seededGraph(n)), [n])
  // Push the URL choice into the pref store so the dispatcher branches
  // correctly. Synchronous in useMemo would race with first render —
  // setState in useEffect is the right shape.
  useEffect(() => {
    setRenderer(renderer)
  }, [renderer, setRenderer])

  // Frame-time sampler. requestAnimationFrame fires once per displayed
  // frame; we average frame-times into FPS over a 200ms window and
  // console.log the result for the Playwright harness.
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let frames = 0
    const start = performance.now()
    // eslint-disable-next-line no-console
    console.log(
      `[graph-bench] init renderer=${renderer} n=${n} ts=${start.toFixed(0)}`
    )
    const tick = (now: number) => {
      frames++
      if (now - last >= 200) {
        const fps = (frames * 1000) / (now - last)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mem = (performance as any).memory?.usedJSHeapSize ?? -1
        // eslint-disable-next-line no-console
        console.log(
          `[graph-bench] sample fps=${fps.toFixed(1)} mem=${mem} elapsed=${(now - start).toFixed(0)}`
        )
        last = now
        frames = 0
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [renderer, n])

  return (
    <div style={{ height: '100vh' }} data-testid="graph-bench-page">
      <GraphView resp={resp} fillHeight />
    </div>
  )
}
```

- [ ] **Step 3: Register the dev-only route in `App.tsx`**

In `src/App.tsx`, locate the `<Routes>` block and add (lazy-loaded to keep prod bundle clean):

```tsx
const GraphBenchPage = React.lazy(() =>
  process.env.NODE_ENV !== 'production'
    ? import('./pages/dev/GraphBenchPage').then((m) => ({
        default: m.GraphBenchPage,
      }))
    : Promise.resolve({ default: () => null })
)
```

…and inside `<Routes>`:

```tsx
{process.env.NODE_ENV !== 'production' && (
  <Route
    path="/dev/graph-bench"
    element={
      <React.Suspense fallback={<div />}>
        <GraphBenchPage />
      </React.Suspense>
    }
  />
)}
```

- [ ] **Step 4: Verify tsc + lint pass**

Run: `npx tsc --noEmit && npm run lint`
Expected: Clean.

- [ ] **Step 5: Smoke-test the route in the dev container**

Run:
```
PWD=$(pwd -P) docker compose -f deploy/docker-compose.test.yml build geode-ui
PWD=$(pwd -P) docker compose -f deploy/docker-compose.test.yml up -d geode-ui
sleep 5
curl -fsS 'http://localhost:8080/dev/graph-bench?n=100&renderer=cytoscape' | head -1
```
Expected: HTML response. Then open it in a real browser at `http://localhost:8080/dev/graph-bench?n=100&renderer=cytoscape` — verify the graph renders. Then flip to `?renderer=reagraph` — verify the reagraph WebGL canvas renders.

If the browser test fails, capture the console error and fix before proceeding. Common causes: missing reagraph peer dep, theme keys in `GraphViewReagraph.tsx` don't match `theme.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/pages/dev/GraphBenchPage.tsx src/App.tsx
git commit -m "feat(dev): add /dev/graph-bench route for renderer perf harness"
```

---

### Task 8: Playwright perf harness

Loops over `(renderer, n)` ∈ {cytoscape, reagraph} × {500, 2 000, 5 000, 10 000}, navigates to `/dev/graph-bench`, captures FPS samples + first-paint + heap, writes one JSON record per combo.

**Files:**
- Create: `e2e/specs/19-graph-bench.spec.ts`
- Modify: `Makefile` or `scripts/` (add a `bench-graph` target that exports `GIT_COMMIT_SHA` and runs the spec)
- Create: `docs/performance/.gitkeep` (just so the dir exists)

- [ ] **Step 1: Confirm the existing Playwright config**

Read: `e2e/playwright.config.ts`
Note: `baseURL` (should be `http://localhost:8080`), worker count, `use.headless` setting. The bench spec needs `workers: 1` so the runs aren't competing for GPU/CPU.

- [ ] **Step 2: Make the perf-results directory**

```bash
mkdir -p docs/performance
touch docs/performance/.gitkeep
```

- [ ] **Step 3: Write the harness spec**

Create `e2e/specs/19-graph-bench.spec.ts`:

```typescript
import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

// Phase 0 perf harness — see docs/superpowers/plans/2026-05-14-cytoscape-
// to-reagraph-migration.md. For each (renderer, n) combo we navigate to
// /dev/graph-bench?n=N&renderer=R, wait for first paint, collect FPS
// samples logged to the console for 5 s after first paint, capture the
// JS heap size at the same instant, and write one row to the JSON
// results file. The companion markdown report is hand-authored in Task 9
// against this JSON.
//
// The commit SHA is read from the GIT_COMMIT_SHA env var. The caller
// (the make target / wrapper script) is responsible for setting it.
// We deliberately do NOT shell out to `git rev-parse` here — that's a
// command-injection footgun and the project standard is to keep raw
// child_process out of test code.

type Sample = { fps: number; mem: number; elapsed: number }
type Record = {
  renderer: 'cytoscape' | 'reagraph'
  n: number
  firstPaintMs: number
  samples: Sample[]
  avgFps: number
  p5Fps: number
  peakHeapBytes: number
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

const RESULTS_PATH = path.resolve(
  __dirname,
  '../../docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json'
)

const SAMPLE_WINDOW_MS = 5000

async function runOne(
  page: import('@playwright/test').Page,
  combo: { renderer: 'cytoscape' | 'reagraph'; n: number }
): Promise<Record> {
  const samples: Sample[] = []
  let firstSample = -1
  page.on('console', (msg) => {
    const txt = msg.text()
    if (!txt.startsWith('[graph-bench] sample')) return
    const fps = Number(txt.match(/fps=(\S+)/)?.[1] ?? 'NaN')
    const mem = Number(txt.match(/mem=(\S+)/)?.[1] ?? 'NaN')
    const elapsed = Number(txt.match(/elapsed=(\S+)/)?.[1] ?? 'NaN')
    if (!Number.isFinite(fps) || !Number.isFinite(elapsed)) return
    if (firstSample < 0) firstSample = elapsed
    samples.push({ fps, mem, elapsed: elapsed - firstSample })
  })
  const navStart = Date.now()
  await page.goto(`/dev/graph-bench?n=${combo.n}&renderer=${combo.renderer}`)
  await expect(page.getByTestId('graph-bench-page')).toBeVisible({
    timeout: 30_000,
  })
  const firstPaintMs = Date.now() - navStart
  await page.waitForTimeout(SAMPLE_WINDOW_MS)
  const fpsVals = samples.map((s) => s.fps).sort((a, b) => a - b)
  const avgFps =
    fpsVals.reduce((s, v) => s + v, 0) / Math.max(fpsVals.length, 1)
  const p5Fps = fpsVals[Math.floor(fpsVals.length * 0.05)] ?? 0
  const peakHeapBytes = samples.reduce((m, s) => Math.max(m, s.mem), 0)
  return {
    renderer: combo.renderer,
    n: combo.n,
    firstPaintMs,
    samples,
    avgFps: Number(avgFps.toFixed(2)),
    p5Fps: Number(p5Fps.toFixed(2)),
    peakHeapBytes,
  }
}

test.describe.configure({ mode: 'serial' })
test('graph renderer benchmark', async ({ page }) => {
  const records: Record[] = []
  for (const combo of COMBOS) {
    const rec = await runOne(page, combo)
    records.push(rec)
    // eslint-disable-next-line no-console
    console.log(
      `[harness] ${combo.renderer} n=${combo.n} firstPaint=${rec.firstPaintMs}ms avgFps=${rec.avgFps} p5Fps=${rec.p5Fps} peakHeap=${rec.peakHeapBytes}`
    )
  }
  // Commit SHA must come from the env var set by the wrapper target.
  // Fall back to "unknown" so the test never fails for that reason —
  // the wrapper script is responsible for never running without it.
  const commit = process.env.GIT_COMMIT_SHA?.trim() || 'unknown'
  fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true })
  fs.writeFileSync(
    RESULTS_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        commit,
        sampleWindowMs: SAMPLE_WINDOW_MS,
        records,
      },
      null,
      2
    )
  )
})
```

- [ ] **Step 4: Add a make target that exports `GIT_COMMIT_SHA` and runs the spec**

Read `Makefile` to find the existing target style. Add a target shaped like the existing ones:

```makefile
.PHONY: bench-graph
bench-graph:
	GIT_COMMIT_SHA=$$(git rev-parse HEAD) npx playwright test e2e/specs/19-graph-bench.spec.ts --workers=1 --project=chromium
```

(Make's `$(shell …)` is acceptable here because the Makefile is checked-in code, not user input, and `git rev-parse HEAD` has no injection surface — the value is opaque hex. Avoid `$(shell …)` inside the recipe and prefer the `$$(…)` form so the shell evaluates it at recipe runtime, not at parse time.)

- [ ] **Step 5: Run the harness against the running container**

Verify the container is up:
```
docker compose ps | grep geode-ui
```

Run the bench:
```
make bench-graph
```
Expected: A single passing test, ~50 seconds of runtime (8 combos × ~6 s each). On completion, `docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json` exists, contains 8 records, and `commit` is the current HEAD SHA.

- [ ] **Step 6: Sanity-check the results**

Run: `cat docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json | python3 -m json.tool | head -60`
Expected: Each record has non-zero `avgFps`, `firstPaintMs` < 30 000, `peakHeapBytes` > 0. If any record has `avgFps === 0`, the renderer froze — that's data, but verify it's not a harness bug first by re-running just that combo via URL.

- [ ] **Step 7: Commit the harness + results**

```bash
git add e2e/specs/19-graph-bench.spec.ts Makefile docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json docs/performance/.gitkeep
git commit -m "test(perf): add cytoscape vs reagraph benchmark harness + initial run"
```

> **Headless / GPU note:** Playwright's default Chromium runs in headless mode with software WebGL by default. That's OK for comparing renderers because both renderers pay the same software-WebGL cost — but the absolute FPS numbers will be lower than on real hardware. Note this in the decision report (Task 9).

---

### Task 9: Author the decision report

Read the JSON, produce a human-readable comparison, write a clear go/no-go.

**Files:**
- Create: `docs/performance/2026-05-14-cytoscape-vs-reagraph.md`

- [ ] **Step 1: Read the bench results**

Run: `cat docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json`

Verify the records cover all 8 combos. Compute (you can do this in your head or with `jq`):

- For each renderer at each n, the avgFps and p5Fps
- The crossover point (the n at which reagraph's avgFps first exceeds cytoscape's)
- First-paint time delta
- Peak-heap delta

- [ ] **Step 2: Write the decision report**

Create `docs/performance/2026-05-14-cytoscape-vs-reagraph.md`:

```markdown
# Cytoscape vs Reagraph — Renderer Benchmark

**Date:** 2026-05-14
**Commit:** <fill in from results JSON>
**Harness:** `e2e/specs/19-graph-bench.spec.ts`
**Page:** `/dev/graph-bench`
**Method:** Playwright + Chromium headless. Per (renderer, n): seeded
graph generated by `src/lib/seededGraph.ts`, navigated to the bench
page, waited for `data-testid="graph-bench-page"` to mount, then
sampled FPS + JS-heap for 5 000 ms via a `requestAnimationFrame`-driven
console log. The Playwright spec parses the console output and writes
one record per combo to a JSON file.

## Caveats

- **Headless software WebGL.** Both renderers pay the same cost, so the
  comparison is fair — but absolute FPS is lower than on real hardware.
- **Cold-start only.** No warmup; first paint is included in the first
  ~200 ms of samples. The p5 figure mitigates that.
- **No drag/zoom interaction.** Steady-state idle measurement.

## Results

| Renderer | n     | First paint (ms) | Avg FPS | p5 FPS | Peak heap (MB) |
|----------|-------|------------------|---------|--------|----------------|
| <fill in 8 rows from the results JSON> |

## Observations

<write 3-5 bullets describing what stands out. Examples of what to look for:
- Where does reagraph win? (typically n ≥ 5000)
- Where does cytoscape win? (typically small graphs — less overhead)
- Does either renderer cross the 30 FPS interactivity threshold at any n?
- Does the peak-heap delta scale linearly or super-linearly with n?>

## Decision

<one of three options — be explicit:>

- **GO** — reagraph hits ≥ 30 FPS at n = 5 000 AND ≥ 15 FPS at n = 10 000
  with peak heap within 2× cytoscape's. Proceed to Plan P1.
- **GO-WITH-CAVEAT** — reagraph wins at scale but loses at small graphs.
  Keep both renderers; add a heuristic that auto-picks reagraph above a
  threshold (e.g. `clusterByLabel` is on OR `nodeCount > 2000`). Re-plan
  P1-P5 to ship the dispatcher as a permanent surface, not a flag to
  be removed.
- **NO-GO** — reagraph does NOT beat cytoscape at any tested n, OR
  reagraph's WebGL renderer crashes / OOMs at our target scale. Stop the
  migration. Open a separate investigation for cytoscape perf tuning
  (could batch-update strategy, layout caching, off-main-thread fcose).

## Next steps (if GO or GO-WITH-CAVEAT)

Invoke `/superpowers:writing-plans` with these scope prompts, one at a
time:

1. **P1 — Layouts parity:** Map all 8 cytoscape layouts to reagraph's
   built-ins; wire toolbar layout picker into reagraph; preserve
   clusterByLabel / degreeSizing semantics; close perf-regression
   coverage for the dagre and fcose paths.
2. **P2 — Selection + interactions:** Single click, shift-multi-click,
   marquee/box, hover, drag, pan, zoom, fit, reset, keyboard nav.
   Replace lasso (or document its removal).
3. **P3 — Context menu + custom node overlays:** Port useCxtMenu
   (7 actions) to reagraph's contextMenu prop; port useDomNodes +
   CustomNodeTemplate via a sibling HTML overlay positioned from a
   `useGraph` ref.
4. **P4 — Focus / path / minimap / find / badges / tooltip /
   expand-query:** Port the traversal-heavy hooks against a new
   `reagraph/traversal.ts` adjacency-map helper.
5. **P5 — Test migration + cytoscape removal:** Port every cytoscape
   unit test to mock reagraph; update Playwright specs 14-18; remove
   the 9 cytoscape packages; delete the cytoscape branch of the
   dispatcher; ship behind a tagged release.
```

- [ ] **Step 3: Fill in the report**

Replace every `<fill in …>` placeholder with real data from the JSON. Don't ship a report with placeholders.

- [ ] **Step 4: Commit the report**

```bash
git add docs/performance/2026-05-14-cytoscape-vs-reagraph.md
git commit -m "docs(perf): document cytoscape vs reagraph benchmark + decision"
```

---

### Task 10: Rebuild container + run full quality gates one final time

**Files:** None modified.

- [ ] **Step 1: Rebuild the e2e container with all changes**

Run:
```
PWD=$(pwd -P) docker compose -f deploy/docker-compose.test.yml build geode-ui
PWD=$(pwd -P) docker compose -f deploy/docker-compose.test.yml up -d geode-ui
sleep 8
curl -fsS http://localhost:8080/ | head -1
```
Expected: HTML response. The new bundle includes the renderer toggle, the dispatcher, and the dev bench route.

- [ ] **Step 2: Run the full quality gates**

Run: `make ci`
Expected: Jest 644 + 11 new tests passing. tsc clean. ESLint clean (`--max-warnings=0`). Prettier clean.

- [ ] **Step 3: Re-run the bench harness once for a final-state baseline**

Run: `make bench-graph`
Expected: Results JSON is updated with the post-build numbers (should match the report's data within noise). If numbers shifted materially, update the report.

- [ ] **Step 4: Final commit (only if numbers updated)**

```bash
git add docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json docs/performance/2026-05-14-cytoscape-vs-reagraph.md
git commit -m "perf(graph): rebaseline cytoscape vs reagraph after container rebuild"
```

If nothing changed, skip the commit.

- [ ] **Step 5: Verify branch state**

Run: `git log --oneline main~10..HEAD`
Expected: ~9 commits added on top of the prior `main` head, all green. Confirm with the user that you're ready to hand off the decision to them.

---

## Phase 0 acceptance criteria

Phase 0 is **DONE** when ALL of the following are true:

- ✅ Both renderers render the same `seededGraph(N)` for N ∈ {500, 2 000, 5 000, 10 000}.
- ✅ Toggle works in the toolbar; pref persists across reload; pref dispatches the correct renderer.
- ✅ `docs/performance/2026-05-14-cytoscape-vs-reagraph.results.json` exists with 8 records.
- ✅ `docs/performance/2026-05-14-cytoscape-vs-reagraph.md` contains a real results table (no placeholders) and a clear GO / GO-WITH-CAVEAT / NO-GO decision.
- ✅ `make ci` passes (Jest, tsc, lint, prettier).
- ✅ The e2e dev container at `http://localhost:8080` serves the new bundle and `/dev/graph-bench` is reachable.
- ✅ Cytoscape default path's bundle size has NOT regressed by > 5 KB gzipped (reagraph is in its own lazy chunk).

If the decision is NO-GO, Phase 0 still counts as success — the spike answered the question. The dispatcher and bench harness stay in (low-cost), the unused reagraph branch can be deleted in a single follow-up commit if desired.

---

## What this plan deliberately does NOT include

- Selection, hover, drag, zoom, fit on the reagraph branch
- Context menu, lasso, focus mode, path mode, minimap, find input, badges, tooltip, expand-query on reagraph
- Custom DOM-node overlays on reagraph
- Multiple layout algorithms on reagraph (only forceDirected2d)
- Removing cytoscape

All of those are deliberately deferred to Plans P1–P5. The point of Phase 0 is a fast, narrow spike that produces a decision — not a half-built migration.
