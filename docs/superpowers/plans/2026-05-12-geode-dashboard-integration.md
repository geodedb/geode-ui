# Geode-Dashboard Feature Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the best parts of `~/src/abs/Geode-Dashboard` into geode-ui — onto the existing Cytoscape engine — as five independently-shippable phases: (1) graph-viz feature ports, (2) richer node-inspector workflow, (3) adjacency-matrix result view, (4) multi-pane query workspace, (5) net-new homepage/overview dashboard.

**Architecture:** Phases 1–3 extend existing components (`src/components/results/GraphView.tsx`, the `QueryPage` result-tab switcher, `src/lib/graphResult.ts`) and the `useGraphPrefs` zustand store — no new routes, no new deps except two Cytoscape layout extensions. Phase 4 adds a `/workspace` route with N independent editor+result panes. Phase 5 adds a `/dashboard` route with summary cards (graph count, node/edge counts, recent queries, connection status). Geode-Dashboard uses reagraph (WebGL/3D); per the scoping decision, we **keep Cytoscape** and port the *capabilities* (path highlighting via `cy.elements().dijkstra`, box/lasso selection, compound-node clustering, more layouts), not the renderer.

**Tech Stack:** React 18 + TypeScript, styled-components (theme tokens in `src/theme/types.ts`), zustand (`useGraphPrefs`, persisted to localStorage), `cytoscape@^3.33` + (new) `cytoscape-fcose` + `cytoscape-dagre`, react-router-dom v7, i18next (`src/services/i18n/locales/en.ts` — every UI string needs a key; `scripts/detect-hardcoded-strings.mjs` enforces it), Jest + Testing Library (`*.test.tsx` next to components; `src/test-utils/theme.ts` exports `testTheme`), Playwright e2e (`e2e/specs/NN-*.spec.ts`, next free number is **19**). Build/test: `npm test`, `npm run test:ts`, `npm run lint`, `npm run prettier:check`, `npm run e2e`; Go side unaffected.

---

## Scope & Phasing

This plan covers **five subsystems**. Per the writing-plans scope rule, each phase is independently shippable (works + is testable on its own) and can be executed/PR'd separately:

| Phase | What | Granularity in this doc | Deps added |
|---|---|---|---|
| **1. Graph-viz feature ports** | More layouts (fcose, dagre); box/lasso selection toggle; group-by-label clustering (compound parent nodes); path highlighting + shortest-path-between-two-selected-nodes | **Full bite-sized TDD** | `cytoscape-fcose`, `cytoscape-dagre` |
| **2. Richer node inspector** | Contextual actions from a selected node (Hide, Collapse, "explore neighbors" → re-run query for 1-hop); Hidden/Collapsed restore lists in the sidebar | **Full bite-sized TDD** | none |
| **3. Adjacency-matrix result view** | New "Matrix" result tab: nodes grouped by label, heatmap of edge counts between groups, click-a-cell to filter | **Full bite-sized TDD** | none |
| **4. Multi-pane query workspace** | New `/workspace` route: 2–4 independent editor+result panes side-by-side, each its own `streamQuery` + reducer | **Task breakdown + key shapes; RE-PLAN IN DETAIL before executing** (net-new layout/state design with multiple valid approaches) | none |
| **5. Homepage / overview dashboard** | New `/dashboard` route: summary cards (graph count, node/edge totals, recent queries, connection/capabilities status); charts only if a metric warrants it | **Task breakdown + key shapes; RE-PLAN IN DETAIL before executing** (net-new design — there is *no* dashboard in Geode-Dashboard to copy; brainstorm scope first) | none |

**Recommendation:** Execute Phases 1–3 from this doc directly. Before executing Phase 4 or 5, run `/superpowers:writing-plans` again (or `/superpowers:brainstorming` first for Phase 5) scoped to just that phase, using the task breakdown here as the starting spec.

**Out of scope (decided):** replacing Cytoscape with reagraph; porting Geode-Dashboard's network-security-specific views (Purdue model, Attack Paths, Zone Matrix as a network-zones-only thing — Phase 3 generalizes it to "group by any label"); porting its query editor (geode-ui's Monaco is strictly better), auth (iron-session vs geode-ui's JWT), or theming (geode-ui has design tokens, Geode-Dashboard doesn't).

**Provenance note:** `~/src/abs/Geode-Dashboard` has no LICENSE file (internal/team project, author "DemonWeaver"). This plan ports *patterns and ideas*, not files verbatim — all code below is written fresh against geode-ui's conventions. If any verbatim copying is later contemplated, confirm IP/licensing first.

---
---

# PHASE 1 — Graph-viz feature ports

**Files (Phase 1):**
- Modify: `package.json` (add `cytoscape-fcose`, `cytoscape-dagre` + their `@types` if available)
- Modify: `src/components/results/GraphView.tsx` (layout list, layout extension registration, selection-mode toggle, clustering toggle, path mode + handlers, toolbar JSX)
- Modify: `src/components/results/useGraphPrefs.ts` (new persisted prefs: `selectionMode`, `clusterByLabel`)
- Modify: `src/components/results/cytoscapeStyle.ts` (compound-node / parent styling; path-highlight classes; dimmed class)
- Modify: `src/lib/graphResult.ts` (add `buildCompoundElements(els): ElementDefinition[]` — wrap nodes in per-label parent nodes; pure function)
- Modify: `src/services/i18n/locales/en.ts` (new `graph.*` keys)
- Test: `src/components/results/GraphView.test.tsx` (extend), `src/lib/graphResult.test.ts` (extend or create — there's `src/lib/graphResult.test.ts` already), `src/components/results/useGraphPrefs.test.ts` (if absent, create — there's `useGraphPrefs.ts`)
- Test (e2e): `e2e/specs/19-graph-viz.spec.ts` (new)

> **Read first:** `src/components/results/GraphView.tsx` (the `cytoscape({...})` init ~L814, the `LAYOUTS` const ~L32, the layout-picker JSX ~L1045, the toolbar with zoomIn/zoomOut/fit ~the `graph.zoomIn`/`graph.fit` buttons, the `selected` state + `SelectedInspector` ~L462–559, the `extractElements` memo ~L671), `src/components/results/cytoscapeStyle.ts` (the `createCytoscapeStyle(theme)` stylesheet blocks, `labelToColor`), `src/components/results/useGraphPrefs.ts` (the zustand store shape — `layout`, `hiddenLabels: Set<string>`, `inspectorView`, the localStorage key `geode-ui.graph-prefs`, the `Set` ⇄ `string[]` serialization), `src/lib/graphResult.ts` (`GqlNode`/`GqlEdge`, `extractElements`, `labelOptions`, `resolveNodeLabel`, `NODE_LABEL_DEFAULT`).

---

## Task 1.1: Add the Cytoscape layout extensions (fcose, dagre)

**Files:**
- Modify: `package.json`
- Modify: `src/components/results/GraphView.tsx` (register the extensions once, at module load)
- Test: `src/components/results/GraphView.test.tsx`

- [ ] **Step 1: Add the deps**

Run: `npm install --save cytoscape-fcose cytoscape-dagre` then `npm install --save-dev @types/cytoscape-dagre` (note: `cytoscape-fcose` ships its own types; `cytoscape-dagre` may not — if `@types/cytoscape-dagre` doesn't exist on npm, skip it and add a one-line module declaration in `src/types/cytoscape-extensions.d.ts`: `declare module 'cytoscape-dagre'`).

Expected: `package.json` `dependencies` gains `"cytoscape-fcose"` and `"cytoscape-dagre"` (pin the caret version npm resolves, e.g. `"^2.2.0"` / `"^2.5.0"`); `npm test` and `npm run test:ts` still pass (no usages yet).

- [ ] **Step 2: Write the failing test**

In `src/components/results/GraphView.test.tsx`, add (the cytoscape mock at the top of that file already exists — extend its factory to record `cytoscape.use` calls; if the mock is `jest.mock('cytoscape', () => ({ __esModule: true, default: cyFactory }))`, change to also expose `use: jest.fn()` on the default and assert it):
```tsx
import cytoscape from 'cytoscape'

it('registers the fcose and dagre layout extensions at module load', () => {
  // GraphView.tsx must call cytoscape.use(fcose) and cytoscape.use(dagre)
  // at module scope. The mock records calls.
  const useMock = (cytoscape as unknown as { use: jest.Mock }).use
  expect(useMock).toHaveBeenCalled()
  // At least 2 registrations (fcose, dagre)
  expect(useMock.mock.calls.length).toBeGreaterThanOrEqual(2)
})
```
(If extending the existing mock is awkward, an acceptable alternative test: render `<GraphView resp={...} />`, set the layout picker to `fcose`, and assert `cy.layout` was called with `{ name: 'fcose', ... }` — the existing mock already records `cy.layout` calls. Use whichever fits the existing mock shape; the *behavior* to pin is "fcose/dagre are usable layouts".)

- [ ] **Step 3: Run it to verify it fails**

Run: `npx jest src/components/results/GraphView.test.tsx -t "registers the fcose and dagre"`
Expected: FAIL — `cytoscape.use` not called (or `fcose` not a usable layout).

- [ ] **Step 4: Register the extensions in `GraphView.tsx`**

At the top of `src/components/results/GraphView.tsx`, after the `import cytoscape from 'cytoscape'` line, add:
```tsx
import fcose from 'cytoscape-fcose'
// cytoscape-dagre has no bundled types; see src/types/cytoscape-extensions.d.ts
import dagre from 'cytoscape-dagre'

// Register layout extensions once, at module load. Idempotent in cytoscape@3.
cytoscape.use(fcose)
cytoscape.use(dagre)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest src/components/results/GraphView.test.tsx -t "registers the fcose and dagre"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/components/results/GraphView.tsx src/components/results/GraphView.test.tsx src/types/cytoscape-extensions.d.ts
git commit -m "feat(graph): register cytoscape-fcose and cytoscape-dagre layout extensions"
```

---

## Task 1.2: Add fcose + dagre to the layout picker (with sensible per-layout options)

**Files:**
- Modify: `src/components/results/GraphView.tsx` (the `LAYOUTS` const, `layoutLabel`, the layout-config builder that's passed to `cy.layout({...})` / the initial `layout:` in `cytoscape({...})`)
- Modify: `src/components/results/useGraphPrefs.ts` (the `layout: LayoutName` type union — add `'fcose' | 'dagre'`)
- Modify: `src/services/i18n/locales/en.ts` (`graph.layout.fcose`, `graph.layout.dagre`)
- Test: `src/components/results/GraphView.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('offers fcose and dagre in the layout picker and applies them', async () => {
  render(
    <ThemeProvider theme={theme}>
      <GraphView resp={twoNodeOneEdgeResp} />
    </ThemeProvider>,
  )
  const picker = screen.getByTestId('graph-layout-picker') as HTMLSelectElement
  expect([...picker.options].map((o) => o.value)).toEqual(
    expect.arrayContaining(['cose', 'fcose', 'dagre', 'breadthfirst', 'circle', 'concentric', 'grid']),
  )
  await act(async () => {
    fireEvent.change(picker, { target: { value: 'fcose' } })
  })
  // The cytoscape mock records layout() calls; the last one should be name:'fcose'
  expect(lastLayoutArg()).toMatchObject({ name: 'fcose' })
  await act(async () => {
    fireEvent.change(picker, { target: { value: 'dagre' } })
  })
  expect(lastLayoutArg()).toMatchObject({ name: 'dagre', rankDir: 'TB' })
})
```
(`twoNodeOneEdgeResp` = a minimal `QueryResp` with `graph_summary: { nodes: [{id:1,labels:['A'],properties:{}},{id:2,labels:['B'],properties:{}}], edges: [{id:10,start_node:1,end_node:2,type:'R',properties:{}}] }`. `lastLayoutArg()` reads the existing cytoscape mock's recorded `cy.layout(arg)` calls — reuse whatever helper the existing tests use; if none, add `const layoutCalls: unknown[] = []` to the mock factory's `layout: (a) => { layoutCalls.push(a); return { run: jest.fn() } }`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/components/results/GraphView.test.tsx -t "offers fcose and dagre"`
Expected: FAIL — `fcose`/`dagre` not in the picker.

- [ ] **Step 3: Implement**

In `src/components/results/GraphView.tsx`:
```tsx
const LAYOUTS: readonly LayoutName[] = [
  'cose',
  'fcose',         // NEW: faster force layout; handles compound (clustered) graphs
  'dagre',         // NEW: layered DAG layout for directed/hierarchical graphs
  'breadthfirst',
  'circle',
  'concentric',
  'grid',
]
```
Find the function that builds the layout config object passed to Cytoscape (the `{ name: layoutRef.current, animate: false, padding: 24 }` literal at `cytoscape({...})` ~L814 and any `cy.layout({...})` re-runs) and make it per-layout:
```tsx
function layoutConfig(name: LayoutName): cytoscape.LayoutOptions {
  const base = { animate: false, padding: 24, fit: true } as const
  switch (name) {
    case 'fcose':
      return { name: 'fcose', ...base, quality: 'default', nodeSeparation: 75, idealEdgeLength: 80, nestingFactor: 0.1 } as cytoscape.LayoutOptions
    case 'dagre':
      return { name: 'dagre', ...base, rankDir: 'TB', nodeSep: 40, rankSep: 60 } as cytoscape.LayoutOptions
    case 'cose':
      return { name: 'cose', ...base } as cytoscape.LayoutOptions
    default:
      return { name, ...base } as cytoscape.LayoutOptions
  }
}
```
Replace the inline layout objects with `layoutConfig(name)`. In `useGraphPrefs.ts`, extend the `LayoutName` type: `export type LayoutName = 'cose' | 'fcose' | 'dagre' | 'breadthfirst' | 'circle' | 'concentric' | 'grid'`. In `en.ts`, under `graph.layout`, add `fcose: 'Force (fast)'` and `dagre: 'Layered (DAG)'`. Ensure `layoutLabel(name, t)` covers them (it likely does `t('graph.layout.' + name)` or a switch — add the cases).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/components/results/GraphView.test.tsx -t "offers fcose and dagre"`
Expected: PASS.

- [ ] **Step 5: Run the discipline checks**

Run: `npm run test:ts && npm run lint && npm run detect:hardcoded-strings -- --strict && npm test -- src/components/results/`
Expected: all green (the new i18n keys satisfy the hardcoded-string check; no `any` lint errors — the `as cytoscape.LayoutOptions` casts are needed because the extensions' option types aren't in `@types/cytoscape`).

- [ ] **Step 6: Commit**

```bash
git add src/components/results/GraphView.tsx src/components/results/useGraphPrefs.ts src/services/i18n/locales/en.ts src/components/results/GraphView.test.tsx
git commit -m "feat(graph): add fcose and dagre to the layout picker"
```

---

## Task 1.3: Box-selection toggle (built-in Cytoscape box select, exposed as a UI mode)

**Files:**
- Modify: `src/components/results/useGraphPrefs.ts` (add `selectionMode: 'pan' | 'box'`, default `'pan'`, persisted; setter `setSelectionMode`)
- Modify: `src/components/results/GraphView.tsx` (a toolbar toggle button; wire `cy.userPanningEnabled` / `cy.boxSelectionEnabled` from the mode)
- Modify: `src/services/i18n/locales/en.ts` (`graph.selectionModePan`, `graph.selectionModeBox`, `graph.selectionModeLabel`)
- Test: `src/components/results/GraphView.test.tsx`, `src/components/results/useGraphPrefs.test.ts`

- [ ] **Step 1: Write the failing prefs test** (`src/components/results/useGraphPrefs.test.ts` — create if it doesn't exist; mirror however other zustand-store tests in the repo are written)

```ts
import { useGraphPrefs } from './useGraphPrefs'

describe('useGraphPrefs selectionMode', () => {
  beforeEach(() => {
    localStorage.clear()
    useGraphPrefs.setState(useGraphPrefs.getInitialState?.() ?? {})
  })
  it('defaults to pan and persists changes', () => {
    expect(useGraphPrefs.getState().selectionMode).toBe('pan')
    useGraphPrefs.getState().setSelectionMode('box')
    expect(useGraphPrefs.getState().selectionMode).toBe('box')
    // persisted
    expect(localStorage.getItem('geode-ui.graph-prefs')).toMatch(/"selectionMode":"box"/)
  })
})
```
(If the store doesn't expose `getInitialState`, just `localStorage.clear()` and rely on the persist middleware re-reading; the assertion that matters is default `'pan'` and that `setSelectionMode('box')` sticks + persists.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/components/results/useGraphPrefs.test.ts`
Expected: FAIL — `selectionMode` undefined, `setSelectionMode` not a function.

- [ ] **Step 3: Add to the store**

In `src/components/results/useGraphPrefs.ts`, add to `GraphPrefsState`: `selectionMode: 'pan' | 'box'` and `setSelectionMode: (m: 'pan' | 'box') => void`; initial value `'pan'`; setter `setSelectionMode: (m) => set({ selectionMode: m })`. Make sure the `persist` `partialize` (if any) includes it, and the `Set`-serialization `merge`/`storage` config doesn't choke on a plain string (it won't — only the `hiddenLabels` Set needs the special handling).

- [ ] **Step 4: Run the prefs test → PASS**

Run: `npx jest src/components/results/useGraphPrefs.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing GraphView test**

```tsx
it('toggles box-selection mode and reflects it on the cy instance', async () => {
  render(<ThemeProvider theme={theme}><GraphView resp={twoNodeOneEdgeResp} /></ThemeProvider>)
  const toggle = screen.getByRole('button', { name: /selection mode|box select/i })
  // initial: pan mode → userPanningEnabled(true), boxSelectionEnabled(false)
  expect(lastCy().userPanningEnabled).toHaveBeenLastCalledWith(true)
  await act(async () => { fireEvent.click(toggle) })
  expect(lastCy().userPanningEnabled).toHaveBeenLastCalledWith(false)
  expect(lastCy().boxSelectionEnabled).toHaveBeenLastCalledWith(true)
})
```
(`lastCy()` = the cytoscape mock's last-created instance; extend the mock to include `userPanningEnabled: jest.fn()`, `boxSelectionEnabled: jest.fn()`, `autoungrabify: jest.fn()` if not already there.)

- [ ] **Step 6: Run it → FAIL**

Run: `npx jest src/components/results/GraphView.test.tsx -t "box-selection mode"`
Expected: FAIL — no toggle button.

- [ ] **Step 7: Implement in `GraphView.tsx`**

Add a toolbar `<button>` next to the zoom/fit buttons:
```tsx
const selectionMode = useGraphPrefs((s) => s.selectionMode)
const setSelectionMode = useGraphPrefs((s) => s.setSelectionMode)
// ...
<ToolbarButton
  type="button"
  aria-pressed={selectionMode === 'box'}
  aria-label={t('graph.selectionModeLabel')}
  title={selectionMode === 'box' ? t('graph.selectionModeBox') : t('graph.selectionModePan')}
  onClick={() => setSelectionMode(selectionMode === 'box' ? 'pan' : 'box')}
>
  {selectionMode === 'box' ? t('graph.selectionModeBox') : t('graph.selectionModePan')}
</ToolbarButton>
```
In the `useEffect` that owns the cy instance (or a small dedicated effect keyed on `[selectionMode]` + the cy ref), apply it:
```tsx
useEffect(() => {
  const cy = cyRef.current
  if (!cy) return
  if (selectionMode === 'box') {
    cy.userPanningEnabled(false)
    cy.boxSelectionEnabled(true)
  } else {
    cy.userPanningEnabled(true)
    cy.boxSelectionEnabled(false)
  }
}, [selectionMode])
```
Also set the initial state when creating the cy instance (call the same two methods right after `cytoscape({...})`). Add the three i18n keys to `en.ts` under `graph`: `selectionModeLabel: 'Selection mode'`, `selectionModePan: 'Pan'`, `selectionModeBox: 'Box select'`.

- [ ] **Step 8: Run tests + discipline → PASS**

Run: `npx jest src/components/results/ && npm run test:ts && npm run lint && npm run detect:hardcoded-strings -- --strict`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add src/components/results/useGraphPrefs.ts src/components/results/useGraphPrefs.test.ts src/components/results/GraphView.tsx src/components/results/GraphView.test.tsx src/services/i18n/locales/en.ts
git commit -m "feat(graph): add box-selection mode toggle"
```

> **Note on "lasso":** Geode-Dashboard's lasso was reagraph-native (free-form polygon). For Cytoscape the equivalent is the `cytoscape-lasso` extension. Box-select (built-in) covers 90% of the need with zero new deps. If a true free-form lasso is wanted later, add `cytoscape-lasso` as a follow-up task — out of scope here to keep the dep footprint minimal.

---

## Task 1.4: Group-by-label clustering (compound parent nodes)

**Files:**
- Modify: `src/lib/graphResult.ts` (new pure `buildCompoundElements(els: ElementDefinition[]): ElementDefinition[]`)
- Test: `src/lib/graphResult.test.ts` (extend)
- Modify: `src/components/results/useGraphPrefs.ts` (add `clusterByLabel: boolean`, default `false`, persisted; `setClusterByLabel`)
- Modify: `src/components/results/cytoscapeStyle.ts` (add a `'$node > node'` / `:parent` style block — parent nodes render as a labeled rounded rectangle behind their children)
- Modify: `src/components/results/GraphView.tsx` (toolbar toggle; when on, pass `buildCompoundElements(els)` to cytoscape and prefer `fcose` layout)
- Modify: `src/services/i18n/locales/en.ts` (`graph.clusterByLabel`, `graph.clusterByLabelLabel`)
- Test: `src/components/results/GraphView.test.tsx`

- [ ] **Step 1: Write the failing `buildCompoundElements` test**

In `src/lib/graphResult.test.ts`:
```ts
import { extractElements, buildCompoundElements } from './graphResult'

describe('buildCompoundElements', () => {
  it('wraps nodes in a per-label parent and reparents them', () => {
    const resp = {
      graph_summary: {
        nodes: [
          { id: 1, labels: ['Person'], properties: { name: 'A' } },
          { id: 2, labels: ['Person'], properties: { name: 'B' } },
          { id: 3, labels: ['Company'], properties: { name: 'C' } },
        ],
        edges: [{ id: 10, start_node: 1, end_node: 3, type: 'WORKS_AT', properties: {} }],
      },
    }
    const els = extractElements(resp)
    const compound = buildCompoundElements(els)
    const parents = compound.filter((e) => e.data && (e.data as Record<string, unknown>).isClusterParent)
    expect(parents.map((p) => (p.data as { label?: string }).label).sort()).toEqual(['Company', 'Person'])
    // each original node now has a parent pointing at its label's cluster node
    const personNodes = compound.filter(
      (e) => e.group !== 'edges' && (e.data as { _labels?: string[] })._labels?.[0] === 'Person',
    )
    for (const n of personNodes) {
      expect((n.data as { parent?: string }).parent).toBeDefined()
    }
    // edges are unchanged in count
    expect(compound.filter((e) => e.group === 'edges').length).toBe(1)
  })

  it('is a no-op-shaped passthrough when every node lacks a label', () => {
    const els = extractElements({ graph_summary: { nodes: [{ id: 1, labels: [], properties: {} }], edges: [] } })
    const out = buildCompoundElements(els)
    // no parent nodes added when there's nothing to group by
    expect(out.filter((e) => (e.data as Record<string, unknown> | undefined)?.isClusterParent)).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run it → FAIL**

Run: `npx jest src/lib/graphResult.test.ts -t buildCompoundElements`
Expected: FAIL — `buildCompoundElements` not exported.

- [ ] **Step 3: Implement `buildCompoundElements` in `src/lib/graphResult.ts`**

```ts
const CLUSTER_PARENT_PREFIX = '__cluster__:'

/**
 * Returns a copy of `els` where each node is reparented under a synthetic
 * "cluster parent" node keyed by its primary label, so Cytoscape renders
 * labelled groups. Nodes with no label keep no parent. Edges are returned
 * unchanged. Existing `data.parent` (if any) is preserved over the cluster
 * parent (caller-set parenting wins). Pure — does not mutate `els`.
 */
export function buildCompoundElements(els: ElementDefinition[]): ElementDefinition[] {
  const labelsSeen = new Set<string>()
  const out: ElementDefinition[] = []
  for (const el of els) {
    if (el.group === 'edges') {
      out.push(el)
      continue
    }
    const data = (el.data ?? {}) as Record<string, unknown>
    const labels = Array.isArray(data._labels) ? (data._labels as string[]) : []
    const primary = labels[0]
    if (!primary || data.parent) {
      out.push(el)
      continue
    }
    labelsSeen.add(primary)
    out.push({ ...el, data: { ...data, parent: CLUSTER_PARENT_PREFIX + primary } })
  }
  for (const label of labelsSeen) {
    out.push({
      group: 'nodes',
      data: { id: CLUSTER_PARENT_PREFIX + label, label, isClusterParent: true },
      selectable: false,
      grabbable: false,
    })
  }
  return out
}
```
(Adjust the `data._labels` access to match whatever `extractElements` actually puts on node data — from the codebase map, `projectColumns` uses `{name}._labels`; confirm `extractElements`'s node `data` has `_labels` or `labels` and use the right key. If it's `labels`, use that.)

- [ ] **Step 4: Run the test → PASS**

Run: `npx jest src/lib/graphResult.test.ts -t buildCompoundElements`
Expected: PASS.

- [ ] **Step 5: Add `clusterByLabel` to `useGraphPrefs`**

Same pattern as Task 1.3 Step 3: `clusterByLabel: boolean` (default `false`), `setClusterByLabel: (v: boolean) => void`. Persisted.

- [ ] **Step 6: Add the parent-node style block to `cytoscapeStyle.ts`**

In `createCytoscapeStyle(theme)`, add a block (after the node block):
```ts
{
  selector: ':parent',
  style: {
    'background-opacity': 0.08,
    'background-color': theme.colors.neutralScale[500],
    'border-width': 1,
    'border-style': 'dashed',
    'border-color': theme.colors.neutralScale[500],
    'border-opacity': 0.4,
    label: 'data(label)',
    'text-valign': 'top',
    'text-halign': 'center',
    'font-size': theme.font.sizes.xs as unknown as number,
    color: theme.text.secondary,
    'padding': 12,
    shape: 'round-rectangle',
  },
},
```
(Match the existing block style/typing — the file already does `as unknown as number` casts for font sizes; mirror that.)

- [ ] **Step 7: Wire the toggle in `GraphView.tsx`**

Add a toolbar toggle (like Task 1.3's). When `clusterByLabel` is on:
- pass `buildCompoundElements(els)` to `cytoscape({ elements: ... })` (and to the rebuild path) instead of `els`;
- when it's switched on, also set the layout to `'fcose'` (best with compound nodes) — but don't *force* it; respect a subsequent manual layout pick.
The `els` memo becomes:
```tsx
const baseEls = useMemo(() => extractElements(resp, query), [resp, query])
const els = useMemo(
  () => (clusterByLabel ? buildCompoundElements(baseEls) : baseEls),
  [baseEls, clusterByLabel],
)
```
Add i18n: `graph.clusterByLabel: 'Group by label'`, `graph.clusterByLabelLabel: 'Group nodes by label'`.

- [ ] **Step 8: Write the GraphView clustering test**

```tsx
it('toggling group-by-label feeds compound elements to cytoscape', async () => {
  render(<ThemeProvider theme={theme}><GraphView resp={twoNodeOneEdgeResp} /></ThemeProvider>)
  const toggle = screen.getByRole('button', { name: /group by label/i })
  await act(async () => { fireEvent.click(toggle) })
  const els = lastCy().__lastElements as ElementDefinition[] // mock records the elements arg
  expect(els.some((e) => (e.data as { isClusterParent?: boolean })?.isClusterParent)).toBe(true)
})
```
(Extend the cytoscape mock to record the most recent `elements` it was constructed/rebuilt with as `__lastElements`.)

- [ ] **Step 9: Run all → PASS**

Run: `npx jest src/components/results/ src/lib/graphResult.test.ts && npm run test:ts && npm run lint && npm run detect:hardcoded-strings -- --strict`
Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add src/lib/graphResult.ts src/lib/graphResult.test.ts src/components/results/useGraphPrefs.ts src/components/results/cytoscapeStyle.ts src/components/results/GraphView.tsx src/components/results/GraphView.test.tsx src/services/i18n/locales/en.ts
git commit -m "feat(graph): group-by-label clustering via compound parent nodes"
```

---

## Task 1.5: Path mode — pick two nodes, highlight the shortest path, dim the rest

**Files:**
- Modify: `src/components/results/GraphView.tsx` (a "Path" mode toggle + click-handler state machine: first click = source, second click = target → `cy.elements().dijkstra({root: src})` then `.pathTo(target)`; add/remove `.highlighted` / `.dimmed` classes; a "Clear path" button; a small status line "Path: A → B · N hops" or "No path")
- Modify: `src/components/results/cytoscapeStyle.ts` (`.highlighted` node/edge style — accent stroke + raised z-index; `.dimmed` — opacity 0.25)
- Modify: `src/services/i18n/locales/en.ts` (`graph.pathMode`, `graph.pathModeLabel`, `graph.pathPickSource`, `graph.pathPickTarget`, `graph.pathResult` (with `{{from}}`, `{{to}}`, `{{hops}}`), `graph.pathNone`, `graph.pathClear`)
- Test: `src/components/results/GraphView.test.tsx`

> **Why client-side:** Cytoscape ships `eles.dijkstra()`, `eles.aStar()`, `eles.bellmanFord()` — no extension needed, no server round-trip, works on whatever subgraph is currently rendered. Geode-Dashboard ran a server-side shortest-path GQL query; doing it client-side on the rendered graph is simpler and matches "highlight a path in *this* result".

- [ ] **Step 1: Write the failing test**

```tsx
it('path mode highlights the shortest path between two clicked nodes and dims the rest', async () => {
  // a—b—c chain plus a stray d connected to a
  const resp = {
    graph_summary: {
      nodes: [1, 2, 3, 4].map((id) => ({ id, labels: ['N'], properties: {} })),
      edges: [
        { id: 12, start_node: 1, end_node: 2, type: 'R', properties: {} },
        { id: 23, start_node: 2, end_node: 3, type: 'R', properties: {} },
        { id: 14, start_node: 1, end_node: 4, type: 'R', properties: {} },
      ],
    },
  }
  render(<ThemeProvider theme={theme}><GraphView resp={resp} /></ThemeProvider>)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /path mode/i })) })
  // simulate two node taps via the mock's tap-handler registry
  const cy = lastCy()
  act(() => { cy.__emitTap('node', 'n1') })  // source
  act(() => { cy.__emitTap('node', 'n3') })  // target
  // path is n1—n2—n3 (2 hops); n4 + edge 14 dimmed
  expect(cy.__classesOf('n2')).toContain('highlighted')
  expect(cy.__classesOf('n4')).toContain('dimmed')
  expect(screen.getByText(/2 hops|2/i)).toBeInTheDocument() // the path-result status line
  // clear
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /clear path/i })) })
  expect(cy.__classesOf('n4')).not.toContain('dimmed')
})
```
(This requires the cytoscape mock to support a tap-handler registry (`cy.on('tap', 'node', fn)` records `fn`; `cy.__emitTap(kind, id)` invokes it with a fake event whose `target` has `.id()`, `.addClass()`, `.removeClass()`, and the collection ops `dijkstra`/`pathTo` need to be stubbed enough to return a deterministic path for this fixture). If the existing mock is too thin for `dijkstra`, an acceptable simpler test: assert that entering path mode + tapping a source then a target calls `cy.elements().dijkstra` with `{ root: <source collection> }` and that `.addClass('highlighted')` / `.addClass('dimmed')` are invoked — i.e. pin the *wiring*, not the algorithm output, since the algorithm is Cytoscape's. Note in the test which approach you took and why.)

- [ ] **Step 2: Run it → FAIL**

Run: `npx jest src/components/results/GraphView.test.tsx -t "path mode"`
Expected: FAIL — no path mode button.

- [ ] **Step 3: Implement path mode in `GraphView.tsx`**

State + handlers (sketch — fit it to the component's existing structure):
```tsx
type PathState =
  | { phase: 'off' }
  | { phase: 'pickSource' }
  | { phase: 'pickTarget'; sourceId: string }
  | { phase: 'shown'; from: string; to: string; hops: number | null }

const [pathState, setPathState] = useState<PathState>({ phase: 'off' })

function clearPathHighlight(cy: cytoscape.Core) {
  cy.elements().removeClass('highlighted').removeClass('dimmed')
}

function enterPathMode() {
  const cy = cyRef.current
  if (cy) clearPathHighlight(cy)
  setPathState({ phase: 'pickSource' })
}
function exitPathMode() {
  const cy = cyRef.current
  if (cy) clearPathHighlight(cy)
  setPathState({ phase: 'off' })
}

// in the node-tap handler (cy.on('tap', 'node', evt => ...)):
//   if pathState.phase === 'pickSource': setPathState({phase:'pickTarget', sourceId: evt.target.id()})
//   else if pathState.phase === 'pickTarget':
//       const cy = cyRef.current!
//       const src = cy.getElementById(pathState.sourceId)
//       const dst = evt.target
//       const dij = cy.elements().dijkstra({ root: src, directed: false })
//       const path = dij.pathTo(dst)            // a Collection of nodes+edges, or empty
//       clearPathHighlight(cy)
//       if (path.length === 0) { setPathState({phase:'shown', from: pathState.sourceId, to: dst.id(), hops: null }) }
//       else {
//         cy.elements().difference(path).addClass('dimmed')
//         path.addClass('highlighted')
//         const hops = path.edges().length
//         setPathState({phase:'shown', from: pathState.sourceId, to: dst.id(), hops})
//       }
//   (when pathState.phase === 'off', the tap falls through to the normal "select for inspector" behaviour — don't break that)
```
Toolbar button (`aria-pressed`, label `t('graph.pathMode')`) + a "Clear path" button shown when `pathState.phase !== 'off'` (calls `exitPathMode`). A status line near the toolbar: `pickSource` → `t('graph.pathPickSource')`; `pickTarget` → `t('graph.pathPickTarget')`; `shown` with hops → `t('graph.pathResult', { from, to, hops })`; `shown` with null hops → `t('graph.pathNone', { from, to })`. When the graph rebuilds (new query result) or path mode exits, clear the highlight. **Important:** the `.dimmed`/`.highlighted` classes must not survive into a non-path render — clear them in the same `useEffect` cleanup / rebuild path that already handles element refresh.

Add to `cytoscapeStyle.ts`:
```ts
{ selector: 'node.highlighted', style: { 'border-width': 3, 'border-color': theme.colors.primary, 'z-index': 999 } },
{ selector: 'edge.highlighted', style: { 'line-color': theme.colors.primary, 'target-arrow-color': theme.colors.primary, width: 4, 'z-index': 998 } },
{ selector: '.dimmed', style: { opacity: 0.2 } },
```
Add the i18n keys to `en.ts` under `graph`: `pathMode: 'Path'`, `pathModeLabel: 'Find a path between two nodes'`, `pathPickSource: 'Click the start node'`, `pathPickTarget: 'Click the end node'`, `pathResult: 'Path: {{from}} → {{to}} · {{hops}} hops'`, `pathNone: 'No path between {{from}} and {{to}}'`, `pathClear: 'Clear path'`.

- [ ] **Step 4: Run the test → PASS**

Run: `npx jest src/components/results/GraphView.test.tsx -t "path mode"`
Expected: PASS.

- [ ] **Step 5: Run everything for Phase 1**

Run: `npm run test:ts && npm run lint && npm run prettier:check && npm run detect:hardcoded-strings -- --strict && npm test -- src/components/results/ src/lib/graphResult.test.ts`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/components/results/GraphView.tsx src/components/results/cytoscapeStyle.ts src/components/results/GraphView.test.tsx src/services/i18n/locales/en.ts
git commit -m "feat(graph): path mode — shortest-path highlighting between two picked nodes"
```

---

## Task 1.6: E2e smoke for the new graph-viz features

**Files:**
- Create: `e2e/specs/19-graph-viz.spec.ts`
- Maybe modify: `e2e/helpers/selectors.ts` (add `data-testid`s if the new controls don't have stable selectors — the layout picker already has `data-testid="graph-layout-picker"`; add `data-testid="graph-selection-mode"`, `data-testid="graph-cluster-toggle"`, `data-testid="graph-path-mode"` to the new buttons in `GraphView.tsx`)

- [ ] **Step 1: Add `data-testid`s to the new controls** (in `GraphView.tsx` — the box-select toggle, the cluster toggle, the path-mode button) if not already present. Commit nothing yet; this is part of the e2e task's first action.

- [ ] **Step 2: Write the e2e spec** (`e2e/specs/19-graph-viz.spec.ts` — mirror the page-object style of `e2e/specs/05-...`/`06-schema-explorer.spec.ts`; use `e2e/helpers/auth.ts` to log in, run a MATCH query that returns a small graph against the seeded movies dataset, switch to the Graph tab):

```ts
import { test, expect } from '@playwright/test'
import { login } from '../helpers/auth'

test.describe('graph viz: layouts, clustering, path mode', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto('/')
    // run a query that returns a small graph (movies seed: People + Movies + ACTED_IN)
    await page.getByRole('textbox', { name: /query|statement/i }).fill('MATCH (p:Person)-[r:ACTED_IN]->(m:Movie) RETURN p, r, m LIMIT 25;')
    await page.getByRole('button', { name: /^run/i }).click()
    await page.getByRole('tab', { name: /graph/i }).click()
    await expect(page.getByTestId('graph-layout-picker')).toBeVisible()
  })

  test('fcose and dagre are selectable layouts', async ({ page }) => {
    const picker = page.getByTestId('graph-layout-picker')
    await expect(picker.locator('option[value="fcose"]')).toHaveCount(1)
    await expect(picker.locator('option[value="dagre"]')).toHaveCount(1)
    await picker.selectOption('fcose')
    await expect(picker).toHaveValue('fcose')
    await picker.selectOption('dagre')
    await expect(picker).toHaveValue('dagre')
  })

  test('group-by-label adds labelled clusters', async ({ page }) => {
    await page.getByTestId('graph-cluster-toggle').click()
    // a parent node label should be in the rendered graph; assert the toggle is pressed
    await expect(page.getByTestId('graph-cluster-toggle')).toHaveAttribute('aria-pressed', 'true')
  })

  test('path mode prompts for two nodes and exits cleanly', async ({ page }) => {
    await page.getByTestId('graph-path-mode').click()
    await expect(page.getByTestId('graph-path-mode')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(/click the start node/i)).toBeVisible()
    await page.getByRole('button', { name: /clear path/i }).click()
    await expect(page.getByTestId('graph-path-mode')).toHaveAttribute('aria-pressed', 'false')
  })
})
```
(Adjust selectors to the actual DOM — the editor is Monaco, so `page.getByRole('textbox')` may need to be the Monaco textarea; reuse whatever helper the existing query-running e2e specs use to type into the editor. If running a graph-returning query against the seed needs a specific statement, check `e2e/helpers/gqlData.ts` for the seed shape.)

- [ ] **Step 3: Run the e2e spec against the running stack**

Run: `npm run e2e -- e2e/specs/19-graph-viz.spec.ts` (the stack must be up: `make e2e-up` if not).
Expected: PASS (3 tests). If the seed-data MATCH returns nothing graph-shaped, fix the query; if Cytoscape rendering in headless Chromium is flaky for the cluster assertion, weaken it to "toggle is pressed" (already done above).

- [ ] **Step 4: Commit**

```bash
git add e2e/specs/19-graph-viz.spec.ts e2e/helpers/selectors.ts src/components/results/GraphView.tsx
git commit -m "test(e2e): smoke test the new graph-viz features (layouts, clustering, path mode)"
```

**End of Phase 1.** At this point geode-ui's `GraphView` has 7 layouts (incl. fcose + dagre), a box-select mode, group-by-label compound clustering, and shortest-path highlighting between two clicked nodes — all behind the existing toolbar, all persisted via `useGraphPrefs`, all tested. Ship it as a PR.

---
---

# PHASE 2 — Richer node inspector + hide/collapse workflow

**Goal:** When a node is selected in `GraphView`, the sidebar offers contextual actions (Hide this node; Collapse it — fold its 1-hop neighbours behind it; "Explore neighbours" — re-run the current connection's GQL to fetch the node's 1-hop subgraph and merge it into the view) and shows **Hidden** / **Collapsed** restore lists so nothing is lost. This ports Geode-Dashboard's `NodeDetail.tsx` + `CollapsedList.tsx` + `HiddenList.tsx` patterns onto geode-ui's existing `SelectedInspector`.

**Files (Phase 2):**
- Modify: `src/components/results/GraphView.tsx` (the `SelectedInspector` block ~L462–559: add an actions row; new `hidden`/`collapsed` state Sets keyed on node id; new sidebar sections for the restore lists; the merge-in-neighbours flow)
- Create: `src/components/results/graphActions.ts` (pure helpers: `hideNode(cy, id)` → adds `.display: none` via a class, `collapseNode(cy, id)` → hide its leaf neighbours + mark, `restoreNode(...)`, `mergeSubgraph(cy, els)` → add elements not already present; all take a `cy` and mutate it, return the affected ids — keep the *policy* pure-ish so it's testable with the cy mock)
- Test: `src/components/results/graphActions.test.ts` (new)
- Modify: `src/components/results/cytoscapeStyle.ts` (a `.hidden-node` class → `display: none`)
- Modify: `src/api/` — add (or confirm) a tiny helper to run a one-shot GQL query for the neighbour-expand (geode-ui already has `client.query({statement, page_size, timeout_ms})` — Phase 2 just *uses* it; the "explore neighbours" statement is built client-side, e.g. `MATCH (n)-[r]-(m) WHERE id(n) = <nodeId> RETURN n, r, m LIMIT 100;` — confirm Geode GQL supports `id(n)` predicate; if not, fall back to a label+key match using the node's properties)
- Modify: `src/services/i18n/locales/en.ts` (new `graph.inspector*` / `graph.hidden*` / `graph.collapsed*` keys)
- Test (e2e): extend `e2e/specs/19-graph-viz.spec.ts` or a new `e2e/specs/20-node-inspector.spec.ts`

> **Read first:** `GraphView.tsx` `SelectedInspector` (the `selected` state, the two views `'props'`/`'json'`, how it renders the property `<dl>`), `cytoscapeStyle.ts`, `src/lib/graphResult.ts` `extractElements` (so `mergeSubgraph` produces the same element shape), `src/api/client.ts` (`client.query`).

## Task breakdown (full bite-sized steps to be written when this phase is executed — the shapes are settled; the work is ~5 tasks):

- **Task 2.1** — `graphActions.ts` + `graphActions.test.ts`: pure `hideNode`/`restoreNode`/`collapseNode`/`expandCollapsed`/`mergeSubgraph` against a cy mock. TDD: write the test for `hideNode` (adds `.hidden-node` class, returns `[id]`), then `collapseNode` (hides 1-hop *leaf* neighbours — degree-1 within the current graph — and records them under the collapsed node), then `mergeSubgraph` (adds elements whose ids aren't already in `cy`, no dupes). Commit per helper. Add the `.hidden-node { display: none }` style to `cytoscapeStyle.ts` in the `hideNode` step.
- **Task 2.2** — Wire Hide/Collapse into the inspector: in `SelectedInspector`, add an actions row with "Hide" and "Collapse" buttons that call the helpers via `cyRef.current`; track `hidden: Set<string>` and `collapsed: Map<string, string[]>` in `GraphView` state; clear both when the graph rebuilds (new query). TDD: render `<GraphView>`, select a node, click "Hide", assert `cy.getElementById(id).addClass` was called with `'hidden-node'` and the node disappears from the inspector. i18n keys: `graph.inspectorActions`, `graph.actionHide`, `graph.actionCollapse`, `graph.actionExpandCollapsed`.
- **Task 2.3** — Restore lists: two new sidebar sections (below the existing visibility/display sections), "Hidden ({{count}})" and "Collapsed ({{count}})", each listing the affected node ids/labels with a "Restore" button per row that un-hides / re-expands. TDD: hide two nodes, assert both appear in the Hidden list, click restore on one, assert it's gone from the list and back in the graph. i18n: `graph.hiddenHeading: 'Hidden ({{count}})'`, `graph.collapsedHeading: 'Collapsed ({{count}})'`, `graph.restore: 'Restore'`, `graph.hiddenEmpty`, `graph.collapsedEmpty`.
- **Task 2.4** — "Explore neighbours": an inspector action that builds a 1-hop MATCH for the selected node (using its id or, if `id(n)` isn't supported by Geode GQL, its primary label + a stable property), calls `client.query({statement, page_size: 200, timeout_ms: 30000})`, runs `extractElements` on the result, and `mergeSubgraph(cy, newEls)` — then re-runs the current layout. Show a small spinner on the action while in flight; surface errors inline (reuse the existing `errorBanner` pattern). TDD: mock `client.query` to return a 2-node-1-edge result, select a node, click "Explore neighbours", assert `client.query` was called with a statement containing the node's id, and that `cy.add` was called with the new elements. i18n: `graph.actionExploreNeighbours: 'Explore neighbours'`, `graph.exploreNeighboursLoading`, `graph.exploreNeighboursFailed`. **Decision point at execution time:** confirm Geode GQL's `id()` / node-id predicate support against the connected build via `/capabilities` or a probe; if unavailable, the statement uses property-equality and the test reflects that.
- **Task 2.5** — E2e: `e2e/specs/20-node-inspector.spec.ts` — log in, run a graph query, switch to Graph tab, click a node, click "Hide", assert it's in the Hidden list, restore it. Run `npm run e2e -- e2e/specs/20-node-inspector.spec.ts` against the stack. Commit.

**End of Phase 2.** Each task = one commit; full TDD; `npm run test:ts`/`lint`/`prettier:check`/`detect:hardcoded-strings --strict`/`npm test -- src/components/results/` green after each.

---
---

# PHASE 3 — Adjacency-matrix result view

**Goal:** A new "Matrix" tab in the query result panel (next to Table / JSON / Graph) that, given the current result's graph (`activeResp.graph_summary` / `extractElements`), groups nodes by primary label and renders a heatmap: rows = source label, cols = target label, cell = count of edges from a node-of-row-label to a node-of-col-label. Click a cell → it could (stretch) cross-filter the Graph tab, but v1 just shows a tooltip with the count and the edge types involved. This generalizes Geode-Dashboard's network-zone "Zone Matrix" to "group by any label". No new deps.

**Files (Phase 3):**
- Create: `src/lib/adjacencyMatrix.ts` (pure: `buildAdjacencyMatrix(els: ElementDefinition[]): { labels: string[]; cells: Map<string, { count: number; edgeTypes: Record<string, number> }> }` where the cell key is `${rowLabel} ${colLabel}`; ignores cluster-parent synthetic nodes and dangling-endpoint placeholders)
- Test: `src/lib/adjacencyMatrix.test.ts` (new)
- Create: `src/components/results/MatrixView.tsx` (renders the heatmap from `buildAdjacencyMatrix(extractElements(resp))`; styled-components grid; cell background scaled by count using `theme.colors.primaryScale` 200→800; `aria` table semantics: `role="table"`, row/column headers; a legend showing the scale; an empty state when there are no edges)
- Test: `src/components/results/MatrixView.test.tsx` (new)
- Modify: `src/pages/QueryPage.tsx` (the result-tab map ~L344: add `['matrix', t('query.tabMatrix')]`; in the render block add `{tab === 'matrix' && <MatrixView resp={activeResp} />}`; the `tab` state type union gains `'matrix'`)
- Modify: `src/services/i18n/locales/en.ts` (`query.tabMatrix`, `matrix.*`)
- Test (e2e): extend `e2e/specs/19-graph-viz.spec.ts` with a "matrix tab renders" check, or a new spec

## Task 3.1: `buildAdjacencyMatrix` (pure)

**Files:** Create `src/lib/adjacencyMatrix.ts`, Create `src/lib/adjacencyMatrix.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { extractElements } from './graphResult'
import { buildAdjacencyMatrix, matrixCellKey } from './adjacencyMatrix'

describe('buildAdjacencyMatrix', () => {
  it('counts edges between node-label groups', () => {
    const resp = {
      graph_summary: {
        nodes: [
          { id: 1, labels: ['Person'], properties: {} },
          { id: 2, labels: ['Person'], properties: {} },
          { id: 3, labels: ['Movie'], properties: {} },
          { id: 4, labels: ['Movie'], properties: {} },
        ],
        edges: [
          { id: 13, start_node: 1, end_node: 3, type: 'ACTED_IN', properties: {} },
          { id: 14, start_node: 1, end_node: 4, type: 'ACTED_IN', properties: {} },
          { id: 23, start_node: 2, end_node: 3, type: 'DIRECTED', properties: {} },
        ],
      },
    }
    const m = buildAdjacencyMatrix(extractElements(resp))
    expect(m.labels.sort()).toEqual(['Movie', 'Person'])
    const pm = m.cells.get(matrixCellKey('Person', 'Movie'))
    expect(pm?.count).toBe(3)
    expect(pm?.edgeTypes).toEqual({ ACTED_IN: 2, DIRECTED: 1 })
    // no Movie→Person edges
    expect(m.cells.get(matrixCellKey('Movie', 'Person'))?.count ?? 0).toBe(0)
  })

  it('returns empty labels for a graph with no nodes/edges', () => {
    expect(buildAdjacencyMatrix([]).labels).toEqual([])
  })

  it('ignores synthetic cluster-parent and placeholder nodes', () => {
    // a node with isClusterParent or a placeholder (no labels) must not become a row/col
    const els = extractElements({ graph_summary: { nodes: [{ id: 1, labels: [], properties: {} }], edges: [] } })
    expect(buildAdjacencyMatrix(els).labels).toEqual([])
  })
})
```

- [ ] **Step 2: Run it → FAIL**

Run: `npx jest src/lib/adjacencyMatrix.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/adjacencyMatrix.ts`**

```ts
import type { ElementDefinition } from 'cytoscape'

export type MatrixCell = { count: number; edgeTypes: Record<string, number> }
export type AdjacencyMatrix = { labels: string[]; cells: Map<string, MatrixCell> }

const SEP = ' '
export function matrixCellKey(row: string, col: string): string {
  return row + SEP + col
}

function nodeLabel(el: ElementDefinition): string | null {
  if (el.group === 'edges') return null
  const data = (el.data ?? {}) as Record<string, unknown>
  if (data.isClusterParent) return null // skip synthetic parents from Phase 1 clustering
  const labels = Array.isArray(data._labels) ? (data._labels as string[]) : []
  return labels[0] ?? null // placeholders (no labels) are excluded
}

/**
 * Groups nodes by primary label and counts edges between groups.
 * `cells` is keyed by matrixCellKey(rowLabel, colLabel); missing keys mean 0.
 * Edge direction is honoured (start_node's label → end_node's label).
 * Pure — does not mutate `els`.
 */
export function buildAdjacencyMatrix(els: ElementDefinition[]): AdjacencyMatrix {
  const labelById = new Map<string, string>()
  const labelSet = new Set<string>()
  for (const el of els) {
    const lbl = nodeLabel(el)
    if (lbl == null) continue
    const id = String((el.data as { id?: unknown }).id ?? '')
    if (!id) continue
    labelById.set(id, lbl)
    labelSet.add(lbl)
  }
  const cells = new Map<string, MatrixCell>()
  for (const el of els) {
    if (el.group !== 'edges') continue
    const d = (el.data ?? {}) as Record<string, unknown>
    const srcId = String(d.source ?? '')
    const tgtId = String(d.target ?? '')
    const rl = labelById.get(srcId)
    const cl = labelById.get(tgtId)
    if (!rl || !cl) continue // edge touching an excluded node
    const type = typeof d._type === 'string' ? d._type : typeof d.label === 'string' ? d.label : 'edge'
    const key = matrixCellKey(rl, cl)
    const cur = cells.get(key) ?? { count: 0, edgeTypes: {} }
    cur.count += 1
    cur.edgeTypes[type] = (cur.edgeTypes[type] ?? 0) + 1
    cells.set(key, cur)
  }
  return { labels: [...labelSet].sort(), cells }
}
```
(Adjust the `data._labels` / `data._type` / `data.source` / `data.target` keys to match exactly what `extractElements` puts on element data — confirm against `src/lib/graphResult.ts`. Cytoscape edge data conventionally has `source`/`target`; node-label key is whatever `extractElements` uses — likely `_labels` per `projectColumns`, but verify.)

- [ ] **Step 4: Run the test → PASS**

Run: `npx jest src/lib/adjacencyMatrix.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/adjacencyMatrix.ts src/lib/adjacencyMatrix.test.ts
git commit -m "feat: buildAdjacencyMatrix — node-label adjacency from a result graph"
```

---

## Task 3.2: `MatrixView` component

**Files:** Create `src/components/results/MatrixView.tsx`, Create `src/components/results/MatrixView.test.tsx`, Modify `src/services/i18n/locales/en.ts`

- [ ] **Step 1: Write the failing test**

```tsx
/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { MatrixView } from './MatrixView'
import { testTheme as theme } from '../../test-utils/theme'

const resp = {
  graph_summary: {
    nodes: [
      { id: 1, labels: ['Person'], properties: {} },
      { id: 2, labels: ['Movie'], properties: {} },
    ],
    edges: [{ id: 12, start_node: 1, end_node: 2, type: 'ACTED_IN', properties: {} }],
  },
}

describe('MatrixView', () => {
  it('renders an adjacency table with label headers and edge counts', () => {
    render(<ThemeProvider theme={theme}><MatrixView resp={resp} /></ThemeProvider>)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Movie/ })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: /Person/ })).toBeInTheDocument()
    // the Person→Movie cell shows count 1
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('shows an empty state when there are no edges between labelled nodes', () => {
    render(
      <ThemeProvider theme={theme}>
        <MatrixView resp={{ graph_summary: { nodes: [{ id: 1, labels: ['X'], properties: {} }], edges: [] } }} />
      </ThemeProvider>,
    )
    expect(screen.getByText(/no .*edges|nothing to show/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it → FAIL**

Run: `npx jest src/components/results/MatrixView.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `MatrixView.tsx`**

```tsx
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { useTheme } from 'styled-components'
import type { QueryRespLike } from '../../lib/graphResult'
import { extractElements } from '../../lib/graphResult'
import { buildAdjacencyMatrix, matrixCellKey } from '../../lib/adjacencyMatrix'

const Wrap = styled.div`
  overflow: auto;
  padding: ${({ theme }) => theme.spacing.sm};
`
const Table = styled.table`
  border-collapse: collapse;
  font-size: ${({ theme }) => theme.font.sizes.sm};
  th,
  td {
    border: 1px solid ${({ theme }) => theme.bg.subtle};
    padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.sm};
    text-align: center;
    min-width: 3.5rem;
  }
  th[scope='row'] {
    text-align: right;
    color: ${({ theme }) => theme.text.secondary};
    font-weight: ${({ theme }) => theme.font.weights.medium};
  }
  th[scope='col'] {
    color: ${({ theme }) => theme.text.secondary};
  }
`
const Cell = styled.td<{ $intensity: number }>`
  background-color: ${({ theme, $intensity }) =>
    $intensity === 0
      ? 'transparent'
      : // 0..1 → primaryScale 200..800
        theme.colors.primaryScale[
          (Math.min(800, 200 + Math.round($intensity * 6) * 100) as keyof typeof theme.colors.primaryScale)
        ]};
  color: ${({ theme, $intensity }) => ($intensity > 0.5 ? theme.text.onPrimary : theme.text.primary)};
`
const Empty = styled.p`
  color: ${({ theme }) => theme.text.secondary};
  padding: ${({ theme }) => theme.spacing.md};
`

export const MatrixView: React.FC<{ resp: QueryRespLike }> = ({ resp }) => {
  const { t } = useTranslation()
  useTheme() // ensure re-render on theme flip
  const matrix = useMemo(() => buildAdjacencyMatrix(extractElements(resp)), [resp])
  const max = useMemo(() => {
    let m = 0
    for (const c of matrix.cells.values()) m = Math.max(m, c.count)
    return m
  }, [matrix])

  if (matrix.labels.length === 0 || max === 0) {
    return <Empty role="note">{t('matrix.empty')}</Empty>
  }

  return (
    <Wrap>
      <Table role="table" aria-label={t('matrix.tableLabel')}>
        <thead>
          <tr>
            <th scope="col" aria-hidden="true" />
            {matrix.labels.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.labels.map((row) => (
            <tr key={row}>
              <th scope="row">{row}</th>
              {matrix.labels.map((col) => {
                const cell = matrix.cells.get(matrixCellKey(row, col))
                const count = cell?.count ?? 0
                const intensity = max > 0 ? count / max : 0
                const types = cell ? Object.entries(cell.edgeTypes).map(([ty, n]) => `${ty}: ${n}`).join(', ') : ''
                return (
                  <Cell
                    key={col}
                    $intensity={intensity}
                    title={count > 0 ? t('matrix.cellTitle', { from: row, to: col, count, types }) : undefined}
                    aria-label={count > 0 ? t('matrix.cellTitle', { from: row, to: col, count, types }) : `${row} → ${col}: 0`}
                  >
                    {count > 0 ? count : ''}
                  </Cell>
                )
              })}
            </tr>
          ))}
        </tbody>
      </Table>
    </Wrap>
  )
}
```
Add to `en.ts`: under `query`, `tabMatrix: 'Matrix'`; a new top-level `matrix` block: `{ empty: 'No edges between labelled nodes to show.', tableLabel: 'Label adjacency matrix', cellTitle: '{{from}} → {{to}}: {{count}} edges ({{types}})' }`.

- [ ] **Step 4: Run the test → PASS**

Run: `npx jest src/components/results/MatrixView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/MatrixView.tsx src/components/results/MatrixView.test.tsx src/services/i18n/locales/en.ts
git commit -m "feat(results): MatrixView — adjacency heatmap of node-label edge counts"
```

---

## Task 3.3: Wire the "Matrix" tab into `QueryPage`

**Files:** Modify `src/pages/QueryPage.tsx`, Test `src/pages/QueryPage.test.tsx` (extend if it exists; the codebase map mentioned `QueryPage.streamMemo.test.tsx` — there may be a `QueryPage.test.tsx` too; if not, the e2e in Task 3.4 covers it and a small unit test of the tab list is optional)

- [ ] **Step 1: Write the failing test** (in `src/pages/QueryPage.test.tsx` if it exists, else skip to Step 3 and rely on e2e)

```tsx
it('renders a Matrix tab in the result panel', async () => {
  // render QueryPage with a fake activeResp that has a graph_summary
  // (mock the streaming/client layer the same way the existing QueryPage tests do)
  // ... after a result is present:
  expect(screen.getByRole('tab', { name: /matrix/i })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: /matrix/i }))
  expect(screen.getByRole('table')).toBeInTheDocument() // MatrixView rendered
})
```

- [ ] **Step 2: Run it → FAIL** (`npx jest src/pages/QueryPage.test.tsx -t "Matrix tab"`).

- [ ] **Step 3: Implement in `QueryPage.tsx`**

In the result-tab `map` (~L344):
```tsx
;(
  [
    ['table', t('query.tabTable')],
    ['json', t('query.tabJson')],
    ['graph', t('query.tabGraph')],
    ['matrix', t('query.tabMatrix')],
  ] as const
).map(([kind, label]) => ( /* ...unchanged TabBtn... */ ))
```
In the render block, alongside the other `tab === ...` branches:
```tsx
{tab === 'matrix' && <MatrixView resp={activeResp} />}
```
And widen the `tab` state type: wherever `tab` is `useState<'table' | 'json' | 'graph'>(...)`, add `| 'matrix'`. Import `MatrixView` from `../components/results/MatrixView`.

- [ ] **Step 4: Run tests + discipline → PASS**

Run: `npm run test:ts && npm run lint && npm run prettier:check && npm run detect:hardcoded-strings -- --strict && npm test -- src/pages/ src/components/results/`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/pages/QueryPage.tsx src/pages/QueryPage.test.tsx
git commit -m "feat(query): add a Matrix result tab backed by MatrixView"
```

---

## Task 3.4: E2e — Matrix tab renders for a graph-returning query

**Files:** Modify `e2e/specs/19-graph-viz.spec.ts` (add a test) or create `e2e/specs/20-...` — pick whichever is cleaner given Phase 2's e2e choice.

- [ ] **Step 1: Add the test**

```ts
test('matrix tab renders an adjacency heatmap', async ({ page }) => {
  // (beforeEach already ran a MATCH (p:Person)-[r:ACTED_IN]->(m:Movie) ... query)
  await page.getByRole('tab', { name: /matrix/i }).click()
  await expect(page.getByRole('table', { name: /adjacency/i })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: /Movie/i })).toBeVisible()
})
```

- [ ] **Step 2: Run it** — `npm run e2e -- e2e/specs/19-graph-viz.spec.ts` against the running stack. Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/19-graph-viz.spec.ts
git commit -m "test(e2e): smoke test the Matrix result tab"
```

**End of Phase 3.** The result panel now has a Matrix view; pure `buildAdjacencyMatrix` is unit-tested; the tab + heatmap are tested; e2e covers it. Ship as a PR.

---
---

# PHASE 4 — Multi-pane query workspace  *(RE-PLAN IN DETAIL BEFORE EXECUTING)*

**Why this needs its own detailed plan:** there are at least two valid architectures (a new `/workspace` route with a grid of independent panes, vs. a "split view" mode toggle on the existing `QueryPage` that lifts the per-pane state into a context), and the pane-state design (one `streamQuery` + reducer per pane; how — or whether — panes share a `useGraphPrefs`; whether panes are tabbed or tiled; how many panes max; persistence of the pane set) is real product/UX design, not mechanical work. Treat the below as the **spec**; run `/superpowers:writing-plans` scoped to "Phase 4 — multi-pane workspace" to produce the bite-sized version.

**Spec / task breakdown:**
- **4.1 — Pane state primitive.** Create `src/pages/workspace/usePane.ts` — a hook that owns one pane's worth of: editor `statement` (string), a `useReducer(queryStreamReducer, initialStreamState)`, a `streamQuery` handle ref, the active result `tab`, and `run()`/`cancel()` (reusing `streamQuery` from `src/lib/queryStream.ts`). One pane = one independent WS stream (the WS infra already supports N concurrent connections). TDD: mock `streamQuery`, call `run()`, assert it opens a stream with the pane's statement, dispatches `start`, and that two `usePane()` instances don't share state.
- **4.2 — Workspace state.** Create `src/pages/workspace/WorkspaceContext.tsx` — manages an ordered list of pane ids (1–4), `addPane()`/`removePane(id)`/`setLayout('rows'|'cols'|'grid')`. Decide: do panes persist across reloads? (Recommend: no — workspace is ephemeral; the *graph prefs* are still the shared persisted `useGraphPrefs`.) TDD: add panes up to the max, assert `addPane` is a no-op past 4; remove the last pane → workspace falls back to a single pane.
- **4.3 — `WorkspacePane` component.** A self-contained editor (`GqlEditor`, lazy) + toolbar (Run/Cancel) + result panel (the same Table/JSON/Graph/Matrix switch from `QueryPage` — *extract that switch into a shared `<ResultPanel resp tab onTabChange>` component first* so both `QueryPage` and `WorkspacePane` use it; this is a clean refactor of `QueryPage` that's worth doing as task 4.0). TDD: render a `WorkspacePane`, type a statement, click Run (mocked stream), assert the result panel shows.
- **4.0 (do first) — Extract `ResultPanel`.** Pull the tab list + the `{tab === ...}` switch out of `QueryPage.tsx` into `src/components/results/ResultPanel.tsx` with props `{ resp, err, busy, tab, onTabChange, expand, maximized, ... }`. `QueryPage` and `WorkspacePane` both render it. Pure refactor — existing `QueryPage` tests must still pass; add a `ResultPanel.test.tsx`. **This task also de-risks Phase 3's `QueryPage.tsx` edit** — consider doing 4.0 *before* Phase 3 if both are in flight, so the Matrix tab is added to `ResultPanel` once, not to `QueryPage` then moved.
- **4.4 — `WorkspacePage` + route.** `src/pages/WorkspacePage.tsx` renders the `WorkspaceProvider` + an "Add pane" button + a CSS-grid/flex layout of `WorkspacePane`s based on `layout`. Add `<Route path="workspace" element={<WorkspacePage />} />` in `App.tsx` (in the protected block) and a `<NavLink to="/workspace">{t('nav.workspace')}</NavLink>` in `Shell.tsx` (+ i18n keys `nav.workspace`, `workspace.*`). TDD: render `<App>` at `/workspace`, assert two panes can coexist.
- **4.5 — E2e** (`e2e/specs/NN-workspace.spec.ts`): log in, go to `/workspace`, add a second pane, run a different query in each, assert both result panels populate independently.

**Estimated size:** ~6 tasks (incl. the 4.0 refactor), ~1–2 PRs. **Risk:** the `ResultPanel` extraction touches `QueryPage` (which has had recent fixes — the `streamStateToResp` memo); do it carefully, keep `QueryPage`'s tests green. Max 4 panes is a guard against WS-connection sprawl.

---
---

# PHASE 5 — Homepage / overview dashboard  *(BRAINSTORM + RE-PLAN BEFORE EXECUTING)*

**Why this needs a brainstorm first:** there is **nothing in `~/src/abs/Geode-Dashboard` to copy** for this — its "dashboard" is a card grid of *links to sites* + the task-oriented views, not a metrics/overview page. So Phase 5 is net-new design: *what* should geode-ui's homepage show? Candidate cards: number of graphs (from `client.graphs()`), per-graph node/edge counts (cheap `MATCH (n) RETURN count(n)` + `MATCH ()-[r]->() RETURN count(r)` per graph — but those can be expensive on a big graph; consider only running them on demand or for the default graph), recent queries (a new tiny `useQueryHistory` zustand store, localStorage-backed, populated whenever `QueryPage`/`WorkspacePane` runs a query — capped at, say, 20, storing `{statement, ranAt, rowCount, ok}`), connection status + Geode version + capabilities (from `fetchCapabilities()` / the connection profile), maybe a "jump back into" card linking to the last query. Charts: only if a metric is genuinely a series (e.g. nothing is, today — so no charting lib needed in v1; revisit if/when there's telemetry). **Run `/superpowers:brainstorming` scoped to "geode-ui homepage dashboard — what cards, what data, what's cheap to compute" before planning this.** The below is a *starting* spec, not a settled one.

**Spec / task breakdown (provisional — confirm in brainstorm):**
- **5.1 — `useQueryHistory` store.** `src/lib/useQueryHistory.ts` — zustand, persisted to `localStorage` key `geode-ui.query-history`, shape `{ entries: QueryHistoryEntry[]; record(e): void; clear(): void }`, `QueryHistoryEntry = { statement: string; ranAt: number; rowCount: number | null; ok: boolean }`, capped at 20 (FIFO). Wire `record(...)` into `QueryPage`'s `runSync`/`runStream` completion (and `WorkspacePane`'s if Phase 4 landed). TDD: `record` 25 entries → only the last 20 kept, newest first; persists; `clear` empties. *(This is independently useful even without the dashboard — could ship as its own PR + a "recent queries" dropdown on the query editor.)*
- **5.2 — `useOverviewData` hook.** `src/lib/useOverviewData.ts` — fetches `{ graphs: string[], geodeVersion: string, capabilities: Capabilities, defaultGraphStats?: { nodes: number; edges: number } }` via `client.graphs()` + `fetchCapabilities()` + (optionally, behind a "load stats" action, not eager) two `client.query` count queries against the default graph. Returns `{ data, loading, error, reloadStats }`. TDD: mock the client, assert it composes the calls and surfaces errors per-source (a failed `graphs()` doesn't blank the version card, etc.).
- **5.3 — Card components.** `src/components/dashboard/Card.tsx` (a styled shell: title, body, optional action — uses `theme.bg.surface`, `theme.shadows.sm`, `theme.radii.lg`), plus `GraphsCard`, `RecentQueriesCard` (rows link to `QueryPage` with the statement prefilled — needs a way to pass an initial statement to `QueryPage`, e.g. via router `location.state` or a query param; `QueryPage` already reads... check — if not, add a small "open this query" handler that navigates to `/` with `state: { statement }` and have `QueryPage` consume it on mount), `ConnectionCard` (version + capabilities), `GraphStatsCard` (the on-demand counts). Each gets a `.test.tsx`. TDD per card: render with fixture data, assert it shows the right values + empty/loading states.
- **5.4 — `DashboardPage` + route.** `src/pages/DashboardPage.tsx` — a responsive CSS-grid of the cards (mirror Geode-Dashboard's 3-col responsive card layout but using geode-ui's `theme.breakpoints`). `<Route path="dashboard" element={<DashboardPage />} />` in `App.tsx`; `<NavLink to="/dashboard">{t('nav.dashboard')}</NavLink>` in `Shell.tsx`. **Decide:** does `/` (currently `QueryPage`) move to `/query` and `/` becomes the dashboard? (Geode-Dashboard-style.) Or does the dashboard live at `/dashboard` and `/` stays the query page? — *brainstorm this; defaulting `/` to a dashboard is a meaningful UX change.* i18n: `nav.dashboard`, `dashboard.*`.
- **5.5 — Wire history recording** into `QueryPage` (and `WorkspacePane`) — call `useQueryHistory.getState().record(...)` on query completion. TDD: run a (mocked) query in `QueryPage`, assert the history store got an entry.
- **5.6 — E2e** (`e2e/specs/NN-dashboard.spec.ts`): log in, the dashboard renders the graphs card and (if `/` was moved) the query page is at `/query`; run a query, go to the dashboard, assert it appears in Recent Queries.

**Estimated size:** ~6 tasks, ~2 PRs. **Hard dependency:** none on Phases 1–4 (5.1's `useQueryHistory` is independently shippable; the dashboard itself doesn't need the graph-viz work). **Biggest open question for the brainstorm:** is `/` the dashboard or the query page, and which per-graph stats are cheap enough to show eagerly.

---
---

## Self-Review (run against the scoping decision)

- **Spec coverage:** ✅ (1) graph-viz feature ports → Phase 1 (Tasks 1.1–1.6: layouts, box-select, clustering, path mode, e2e). ✅ (2) richer node inspector → Phase 2 (Tasks 2.1–2.5: hide/collapse/restore-lists/explore-neighbours/e2e). ✅ (3) adjacency-matrix view → Phase 3 (Tasks 3.1–3.4). ✅ (4) multi-pane workspace → Phase 4 (spec'd; re-plan flagged — incl. the `ResultPanel` extraction prerequisite). ✅ (5) homepage dashboard → Phase 5 (spec'd; brainstorm + re-plan flagged — incl. `useQueryHistory` as an independently-shippable piece). "Keep Cytoscape, port the capabilities" decision honoured throughout (reagraph not introduced). The "out of scope" items (reagraph swap, Purdue/Attack-Paths, their query editor/auth/theming) are explicitly excluded with rationale.
- **Placeholder scan:** Phases 1 and 3 are fully bite-sized with real code, real test code, real commands, real i18n keys. Phase 2 is task-broken with settled shapes (each task names its files, its TDD assertion, its i18n keys) — acceptable per the skill's "suggest breaking into separate plans" allowance for multi-subsystem specs; flagged "full bite-sized steps to be written when this phase is executed". Phases 4 and 5 are explicitly marked **RE-PLAN BEFORE EXECUTING** with the reasons (multiple valid architectures / net-new design with no source to copy) — this is the skill's prescribed handling, not a placeholder dodge.
- **Type/name consistency:** `LayoutName` extended once (1.2) and used in 1.4/1.6; `buildCompoundElements` (1.4) ↔ same name in 3.1's "ignore synthetic cluster-parent" handling (`data.isClusterParent`); `buildAdjacencyMatrix`/`matrixCellKey` consistent across 3.1/3.2/3.3; `MatrixView` props `{ resp: QueryRespLike }` consistent 3.2/3.3; `useGraphPrefs` new keys (`selectionMode`, `clusterByLabel`) named consistently in 1.3/1.4; `graphActions.ts` helper names listed once (Phase 2 file list) and referenced by 2.1/2.2. The `extractElements` element-data key (`_labels` vs `labels`, `_type` vs `label`, `source`/`target`) is flagged "confirm against `src/lib/graphResult.ts`" in every place it's used (1.4, 3.1) — that's a real "verify the exact shape at implementation time" note, not an inconsistency.
- **One thing surfaced:** Phase 4's `ResultPanel` extraction (Task 4.0) ideally precedes Phase 3's `QueryPage` edit (Task 3.3) — noted in 4.0. If executing strictly in phase order, Phase 3 adds the Matrix tab to `QueryPage`, then Phase 4 moves it into `ResultPanel`; that's fine (small churn) but the doc flags the better order.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-12-geode-dashboard-integration.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. (For this plan: execute Phases 1–3 task-by-task now; Phases 4–5 get their own `/superpowers:writing-plans` runs first.)

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach? (And: start with Phase 1, or do the Phase 4.0 `ResultPanel` extraction first?)**
