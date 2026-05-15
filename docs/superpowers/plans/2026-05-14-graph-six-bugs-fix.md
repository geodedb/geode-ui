# Six Graph Bugs Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix six independently-reported bugs in the graph view subsystem: graph re-renders on every editor keystroke, mini-map "white box" leaking to body, full-height layout broken for canvas + sidebar, cxtmenu radial pie unreadable on light theme, expand popover broken (downstream of keystroke bug), and add the missing e2e coverage for the radial menu → expand flow.

**Architecture:** Each bug gets its own task with a failing reproduction test FIRST (jest unit/integration or playwright e2e), then a minimal fix, then a green re-run. Bugs #2 and #3 share a root family (layout heuristics) and fix together. Bug #6 fix unblocks Bug #5 verification, so #6 runs before #5.

**Tech Stack:** React 18 + TypeScript, styled-components, Cytoscape 3.x + extensions (cytoscape-navigator, cytoscape-cxtmenu, cytoscape-popper, cytoscape-dom-node), Jest + Testing Library, Playwright (e2e).

---

## File Structure (mapped by bug)

**Bug #6 — graph re-renders on keystroke:**
- Modify: `src/pages/QueryPage.tsx` — track `submittedStmt` separately from live `stmt`; forward `submittedStmt` to `<ResultPanel>`.
- Modify: `src/pages/QueryPage.test.tsx` (or whichever test file covers it) — assert that typing in the editor does NOT change the prop forwarded to ResultPanel.

**Bug #1 — mini-map white box:**
- Modify: `src/components/results/graph/GraphMiniMap.tsx` — pass a string id selector (`#graph-minimap-panel`) instead of an HTMLElement to `cy.navigator()`.
- Modify: `src/components/results/graph/GraphMiniMap.test.tsx` — verify the id+selector contract.
- Create: `src/components/results/graph/GraphMiniMap.css` (or inline via styled-components) — override `.cytoscape-navigator { position: absolute !important; inset: auto; }` as defense-in-depth.

**Bug #4 — cxtmenu contrast:**
- Modify: `src/components/results/graph/useCxtMenu.ts` — swap `fillColor: theme.bg.overlay` → `theme.bg.inverse`; swap `itemColor: theme.text.onPrimary` → `theme.text.inverse`.
- Modify: `src/components/results/graph/useCxtMenu.test.ts` — assert the passed `fillColor` and `itemColor` resolve from the new tokens.

**Bugs #2 + #3 — fill-mode layout:**
- Modify: `src/components/results/graph/styled.ts` — `Wrap`, `CanvasArea`, `Canvas` become a real flex chain in fill mode.
- Modify: `src/components/results/graph/GraphSidebar.tsx` — drop `max-height: 40vh` in fill mode; set `height: 100%; min-height: 0; overflow: auto`.
- Modify: `src/components/results/graph/useFillHeight.ts` — return `undefined` (or `null`) when fill mode is active, so `Canvas` falls back to its flex `height: auto`.
- Modify: `src/components/results/GraphView.tsx` — pass `effectiveHeight` only when not in fill mode; in fill mode, the canvas relies on the flex chain.

**Bug #5 — expand popover:**
- E2E spec only — add a test that reproduces and confirms the fix (which lands automatically once #6 ships).

**Test additions:**
- Extend `e2e/specs/24-graph-power-features.spec.ts` with:
  - Mini-map visibility test (only ONE panel rendered, anchored to the canvas wrapper, not pinned to `document.body`).
  - Expand popover round-trip: right-click → click Expand → set options → Run → assert merged nodes.

---

## Phase 1 — Stop the keystroke rebuild (Bug #6)

This is the highest-impact fix and unblocks Bug #5. Fix it first.

### Task 1: Capture submittedStmt in QueryPage; forward to ResultPanel

**Files:**
- Modify: `src/pages/QueryPage.tsx`
- Create or extend: `src/pages/QueryPage.submittedStmt.test.tsx` (a focused test for this one regression)

- [ ] **Step 1: Write the failing test**

Inspect `src/pages/QueryPage.tsx` first to understand the existing structure:

```bash
grep -n "stmt\|submittedStmt\|runSync\|runStream\|setStmt\|<ResultPanel" /data/home/benji/src/devnw/codepros/geode/geode-ui/src/pages/QueryPage.tsx | head -30
```

Then create `src/pages/QueryPage.submittedStmt.test.tsx`:

```tsx
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../test-utils/theme'

// QueryPage forwards a `query` prop into <ResultPanel>. We mock
// ResultPanel to capture every `query` value it receives over the
// component's lifetime; the regression we're guarding against is
// the live editor buffer flowing through on every keystroke.
const capturedQueries: string[] = []
jest.mock('../components/results/ResultPanel', () => ({
  ResultPanel: (props: { query?: string }) => {
    capturedQueries.push(props.query ?? '')
    return <div data-testid="result-panel-mock">{props.query ?? ''}</div>
  },
}))

// Mock the Monaco editor surface to a textarea we can drive with
// fireEvent.change. The editor's onChange must mirror Monaco's
// "as the user types, fire onChange per keystroke" behavior.
jest.mock('../components/editor/GqlEditor', () => ({
  GqlEditor: ({
    value,
    onChange,
  }: {
    value: string
    onChange: (v: string) => void
  }) => (
    <textarea
      data-testid="editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}))

// Import after mocks.
// Adjust path if QueryPage lives elsewhere.
import { QueryPage } from './QueryPage'

describe('QueryPage forwards SUBMITTED statement, not live buffer, to ResultPanel', () => {
  beforeEach(() => {
    capturedQueries.length = 0
  })

  it('does not forward live editor keystrokes to ResultPanel.query', () => {
    render(
      <ThemeProvider theme={theme}>
        <QueryPage />
      </ThemeProvider>
    )
    const editor = screen.getByTestId('editor') as HTMLTextAreaElement
    // Type 3 characters. Each fires the editor's onChange.
    fireEvent.change(editor, { target: { value: 'M' } })
    fireEvent.change(editor, { target: { value: 'MA' } })
    fireEvent.change(editor, { target: { value: 'MAT' } })
    // Strip the initial render's empty query. Every recorded `query`
    // value should be IDENTICAL — the submitted snapshot is unchanged
    // until Run fires. Pre-fix, this assertion fails: ResultPanel
    // receives 'M', 'MA', 'MAT' as the user types.
    const distinct = Array.from(new Set(capturedQueries))
    expect(distinct).toEqual([''])
  })
})
```

NOTE: the import path `./QueryPage` may need adjustment depending on the file's actual export shape. If `QueryPage` is a default export, use `import QueryPage from './QueryPage'`. If the file is in `src/pages/QueryPage/index.tsx`, adjust accordingly.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=QueryPage.submittedStmt`
Expected: FAIL — `expect(distinct).toEqual([''])` shows distinct is `['', 'M', 'MA', 'MAT']` or similar.

If the test fails to even render (e.g., missing mocks for the connections context, auth, react-router), add minimal stubs:

```tsx
jest.mock('../contexts/Connections', () => ({
  useConnections: () => ({ activeConn: { id: 'c1' }, connections: [] }),
  useActiveConnection: () => ({ id: 'c1' }),
}))
jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
  useLocation: () => ({ pathname: '/query' }),
}))
```

(Tune to whatever QueryPage actually depends on — read the file.)

- [ ] **Step 3: Implement the fix in `QueryPage.tsx`**

Find the existing `stmt` state (a `useState<string>` or similar holding the live editor buffer). Find the `<ResultPanel ... query={stmt} />` JSX site. Find the `runSync`/`runStream` (or equivalent) handler that fires when the user clicks Run.

Add a second piece of state for the submitted statement:

```ts
const [submittedStmt, setSubmittedStmt] = useState<string>('')
```

Inside the Run handler(s), capture the snapshot:

```ts
const onRun = async (): Promise<void> => {
  setSubmittedStmt(stmt)
  // …existing run logic…
}
```

If the run path is split (sync + stream + retry-after-CSRF, etc.), set `submittedStmt` in EACH path so submission is consistent. Look for `runStmtRef.current = stmt` — that's the canonical capture point. Wherever that ref is set, also call `setSubmittedStmt(stmt)`.

Change the `<ResultPanel>` prop:

```tsx
<ResultPanel query={submittedStmt} ... />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=QueryPage.submittedStmt`
Expected: PASS.

Run: `npm test`
Expected: ALL pass.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/pages/QueryPage.tsx src/pages/QueryPage.submittedStmt.test.tsx
git commit -m "fix(query): forward submitted statement, not live editor buffer, to ResultPanel"
```

---

## Phase 2 — Mini-map white box (Bug #1)

### Task 2: Pass a string-selector id to cy.navigator + CSS override

**Files:**
- Modify: `src/components/results/graph/GraphMiniMap.tsx`
- Modify: `src/components/results/graph/GraphMiniMap.test.tsx`

- [ ] **Step 1: Write the failing assertion**

In `src/components/results/graph/GraphMiniMap.test.tsx`, ADD a new spec at the end:

```tsx
it('passes a string CSS-selector to cy.navigator (not the raw HTMLElement)', () => {
  const navigator = jest.fn(() => ({ destroy: jest.fn() }))
  const cy = { navigator } as unknown as { navigator: jest.Mock }
  const cyRef = { current: cy as never }
  render(
    <ThemeProvider theme={theme}>
      <GraphMiniMap cyRef={cyRef as never} />
    </ThemeProvider>
  )
  expect(navigator).toHaveBeenCalled()
  const opts = navigator.mock.calls[0][0] as { container?: unknown }
  // The bug: cytoscape-navigator's _initPanel only honors
  // options.container when it's a STRING CSS selector. Passing an
  // HTMLElement causes the library to create + append its own panel
  // to document.body, leaking a 400x400 white box to the viewport
  // bottom-right.
  expect(typeof opts.container).toBe('string')
  expect(opts.container).toMatch(/^#/)
})
```

- [ ] **Step 2: Run to verify fails**

Run: `npm test -- --testPathPattern=graph/GraphMiniMap.test`
Expected: FAIL — `opts.container` is currently an HTMLElement.

- [ ] **Step 3: Fix the source**

In `src/components/results/graph/GraphMiniMap.tsx`:

a) Add a stable id to the rendered `<Box>`:

```tsx
const PANEL_ID = 'graph-minimap-panel'

// ...

return <Box ref={ref} id={PANEL_ID} data-testid="graph-minimap" />
```

b) Inside the existing `useEffect`, pass the selector string instead of the element:

```ts
const inst = cy.navigator({ container: `#${PANEL_ID}`, viewLiveFramerate: 30 })
```

c) Add a defensive CSS override via styled-components on the `Box` so the library's CSS can't escape:

```ts
const Box = styled.div`
  position: absolute;
  bottom: 12px;
  right: 12px;
  width: 160px;
  height: 120px;
  z-index: 5;
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.sm};
  overflow: hidden;

  /* Defense: cytoscape-navigator's stylesheet positions
   * .cytoscape-navigator as fixed bottom-right with hard-coded
   * width/height. Override here so it stays inside our panel even
   * if the library mounts an internal wrapper with that class. */
  & .cytoscape-navigator {
    position: absolute !important;
    inset: 0 !important;
    width: 100% !important;
    height: 100% !important;
    bottom: auto !important;
    right: auto !important;
  }
`
```

(The exact existing `Box` style may be different — preserve what's there and add the inner `.cytoscape-navigator` override.)

- [ ] **Step 4: Run test to verify passes**

Run: `npm test -- --testPathPattern=graph/GraphMiniMap.test`
Expected: PASS — all 4 specs (3 existing + 1 new).

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/GraphMiniMap.tsx \
  src/components/results/graph/GraphMiniMap.test.tsx
git commit -m "fix(graph): pass string-selector to cy.navigator and override panel CSS"
```

---

## Phase 3 — Cxtmenu contrast (Bug #4)

### Task 3: Swap fillColor + itemColor to inverse-theme tokens

**Files:**
- Modify: `src/components/results/graph/useCxtMenu.ts`
- Modify: `src/components/results/graph/useCxtMenu.test.ts`

- [ ] **Step 1: Update the test**

In `src/components/results/graph/useCxtMenu.test.ts`, find the existing spec that asserts cxtmenu was mounted with specific options. Add an assertion that `fillColor` resolves to `theme.bg.inverse` and `itemColor` resolves to `theme.text.inverse`:

```ts
// After the existing mount assertion, ADD:
it('uses inverse-theme tokens for fillColor + itemColor (legibility on light theme)', () => {
  const cy = makeCxtCy()
  const cyRef = { current: cy as never }
  const stubTheme = {
    bg: { inverse: '#1c0f2e' },
    text: { inverse: '#f7f2ff' },
    colors: { primary: '#5b34c7' },
  }
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
    useCxtMenu({
      cyRef: cyRef as never,
      handlers,
      t: (k) => k,
      sig: 's1',
      theme: stubTheme as never,
    })
  )
  const opts = cy.cxtmenu.mock.calls[0][0] as {
    fillColor: string
    itemColor: string
  }
  expect(opts.fillColor).toBe('#1c0f2e')
  expect(opts.itemColor).toBe('#f7f2ff')
})
```

The existing test passes `theme: stubTheme` — match the existing stub or extend it. Read the file first.

- [ ] **Step 2: Run to verify fails**

Run: `npm test -- --testPathPattern=graph/useCxtMenu.test`
Expected: FAIL — current code uses `theme.bg.overlay` / `theme.text.onPrimary`.

- [ ] **Step 3: Fix the source**

In `src/components/results/graph/useCxtMenu.ts`, find the `cy.cxtmenu({...})` call. Change:

```ts
fillColor: theme.bg.overlay,
```

To:

```ts
fillColor: theme.bg.inverse,
```

Change:

```ts
itemColor: theme.text.onPrimary,
```

To:

```ts
itemColor: theme.text.inverse,
```

Leave `activeFillColor: theme.colors.primary` unchanged — it's correct (the brand purple).

- [ ] **Step 4: Run test to verify passes**

Run: `npm test -- --testPathPattern=graph/useCxtMenu.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/useCxtMenu.ts \
  src/components/results/graph/useCxtMenu.test.ts
git commit -m "fix(graph): use bg.inverse/text.inverse for cxtmenu (light-theme legibility)"
```

---

## Phase 4 — Full-height layout (Bugs #2 + #3)

### Task 4: Replace pixel/vh heuristics with a real flex chain

**Files:**
- Modify: `src/components/results/graph/styled.ts`
- Modify: `src/components/results/graph/GraphSidebar.tsx`
- Modify: `src/components/results/graph/useFillHeight.ts`
- Modify: `src/components/results/GraphView.tsx`

- [ ] **Step 1: Write a failing visual-contract integration test**

Create `src/components/results/graph/GraphView.fillHeight.test.tsx`:

```tsx
import React from 'react'
import { render } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../test-utils/theme'

// Mock the heavy graph internals so we can render fast — we only
// care about the fill-mode CSS contract.
jest.mock('./graph/useCxtMenu', () => ({
  useCxtMenu: jest.fn(),
  buildCommands: () => [],
}))
jest.mock('./graph/useLasso', () => ({ useLasso: jest.fn() }))
jest.mock('./graph/useGraphCytoscape', () => ({
  useGraphCytoscape: jest.fn(),
}))
jest.mock('./graph/useNodeTooltip', () => ({
  useNodeTooltip: () => ({ targetData: null }),
}))
jest.mock('./graph/useDomNodes', () => ({ useDomNodes: jest.fn() }))

import { GraphView } from './GraphView'

const emptyResp = { columns: [], rows: [], graph_summary: { nodes: [], edges: [] } }

describe('GraphView fill-mode layout', () => {
  it('does NOT impose a fixed-pixel height on the Canvas when fillHeight=true', () => {
    const { container } = render(
      <ThemeProvider theme={theme}>
        <GraphView resp={emptyResp} query="" fillHeight />
      </ThemeProvider>
    )
    // Find the cytoscape canvas wrapper. Its computed style.height
    // must be a percentage / auto / 100% — never a fixed pixel value.
    const canvas = container.querySelector('[data-testid="graph-canvas"]') as HTMLElement
    expect(canvas).toBeTruthy()
    const styleAttr = canvas.getAttribute('style') ?? ''
    expect(styleAttr).not.toMatch(/height:\s*\d+px/)
  })

  it('does NOT cap GraphSidebar to 40vh in fill mode', () => {
    const { container } = render(
      <ThemeProvider theme={theme}>
        <GraphView resp={emptyResp} query="" fillHeight />
      </ThemeProvider>
    )
    // The GraphSidebar root element should NOT include a 40vh max-height
    // when fillHeight=true.
    const sidebar = container.querySelector('[data-testid="graph-sidebar"]') as HTMLElement | null
    if (!sidebar) return // sidebar may be conditionally hidden; either way, no 40vh inline
    const styleAttr = sidebar.getAttribute('style') ?? ''
    expect(styleAttr).not.toMatch(/max-height:\s*40vh/)
  })
})
```

(The `data-testid="graph-canvas"` already exists on the Canvas element. Add `data-testid="graph-sidebar"` to GraphSidebar if it isn't already there.)

- [ ] **Step 2: Run to verify fails**

Run: `npm test -- --testPathPattern=GraphView.fillHeight.test`
Expected: FAIL — current code sets `style="height: <px>px"` on Canvas in fill mode AND GraphSidebar applies `max-height: 40vh`.

- [ ] **Step 3: Fix the flex chain**

a) **`src/components/results/graph/styled.ts`** — make `Wrap`, `CanvasArea`, `Canvas` flex-friendly in fill mode.

```ts
export const Wrap = styled.div<{ $fill?: boolean; $sidebarCollapsed?: boolean }>`
  display: ${({ $fill }) => ($fill ? 'grid' : 'grid')};
  grid-template-columns: ${({ $sidebarCollapsed, $fill }) =>
    $sidebarCollapsed ? '1fr' : $fill ? '1fr 280px' : '1fr 280px'};
  /* Was: gap, etc. Preserve what's there. */
  ${({ $fill }) =>
    $fill
      ? `
        height: 100%;
        min-height: 0;
      `
      : ''}
`

export const CanvasArea = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
`

export const Canvas = styled.div<{ $height?: number }>`
  flex: 1 1 auto;
  min-height: 0;
  ${({ $height }) => ($height !== undefined ? `height: ${$height}px;` : '')}
  background: ${({ theme }) => theme.bg.graphCanvas};
  position: relative;
`
```

Key changes:
- `Wrap` keeps a 2-column grid in fill mode (not collapsed to single column).
- `CanvasArea` is a vertical flex column with `min-height: 0` so it can shrink.
- `Canvas` is `flex: 1 1 auto` and only sets a pixel height when explicitly passed `$height`.

b) **`src/components/results/graph/GraphSidebar.tsx`** — drop the 40vh cap in fill mode:

```tsx
const Aside = styled.aside<{ $fill?: boolean; $height?: number }>`
  ${({ $fill, $height }) =>
    $fill
      ? `
        height: 100%;
        min-height: 0;
        overflow: auto;
      `
      : `
        height: ${$height ?? 480}px;
        overflow: auto;
      `}
  ...rest of existing styles
`
```

(Match the existing prop names — the actual file may differ. Preserve other style declarations; only the fill-mode height path changes.)

c) **`src/components/results/graph/useFillHeight.ts`** — in fill mode, return `undefined` so the Canvas doesn't get an inline px height:

```ts
export function useFillHeight({ fillHeight, height }: UseFillHeightArgs): number | undefined {
  if (fillHeight) return undefined
  return height
}
```

(Strip the `window.innerHeight - 320` math entirely. The flex chain handles it.)

d) **`src/components/results/GraphView.tsx`** — pass `$height` only when non-fill:

Find:
```tsx
<Canvas ref={ref} $height={effectiveHeight} ... />
```

If `useFillHeight` now returns `undefined` in fill mode, `effectiveHeight` will be `undefined`, and the `Canvas` styled-component already skips the height declaration when `$height` is undefined. No change needed at this site IF the prior step is done right.

- [ ] **Step 4: Run test to verify passes**

Run: `npm test -- --testPathPattern=GraphView.fillHeight.test`
Expected: PASS.

Run: `npm test`
Expected: ALL pass (no other suite is asserting on the px height contract).

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/styled.ts \
  src/components/results/graph/GraphSidebar.tsx \
  src/components/results/graph/useFillHeight.ts \
  src/components/results/GraphView.tsx \
  src/components/results/graph/GraphView.fillHeight.test.tsx
git commit -m "fix(graph): replace fill-mode px heuristics with real flex chain"
```

---

## Phase 5 — End-to-end coverage (Bugs #1, #5, sanity)

### Task 5: Extend e2e specs to cover mini-map + expand popover

**Files:**
- Modify: `e2e/specs/24-graph-power-features.spec.ts`

- [ ] **Step 1: Add a mini-map test that asserts only ONE panel exists, anchored to the canvas wrapper**

Append to the existing `test.describe('graph power features', ...)`:

```ts
test('mini-map toggle renders ONE panel inside the canvas wrapper (no body leak)', async ({
  authedPage: page,
}) => {
  // Default off → toggle on.
  await page.getByTestId('graph-minimap-toggle').click()
  await expect(page.getByTestId('graph-minimap-toggle')).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  // Exactly one #graph-minimap-panel exists.
  await expect(page.locator('#graph-minimap-panel')).toHaveCount(1)
  // It is INSIDE the canvas wrapper (not pinned to document.body).
  const isInsideCanvas = await page.evaluate(() => {
    const panel = document.getElementById('graph-minimap-panel')
    if (!panel) return false
    const canvasWrap = panel.closest('[data-testid="graph-canvas"]')?.parentElement
    return canvasWrap?.contains(panel) ?? false
  })
  expect(isInsideCanvas).toBe(true)
  // No stray .cytoscape-navigator pinned to body.
  const bodyChildren = await page.locator('body > .cytoscape-navigator').count()
  expect(bodyChildren).toBe(0)
})

test('expand popover opens from the radial menu and runs an explore', async ({
  authedPage: page,
}) => {
  const pos = await firstNodePosition(page)
  const canvas = page.getByTestId('graph-canvas')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('canvas not laid out')
  // Right-click to open the radial menu, then dispatch "Expand".
  await canvas.click({
    button: 'right',
    position: { x: pos.x - box.x, y: pos.y - box.y },
  })
  await expect(page.locator('.cxtmenu')).toBeVisible()
  // Dispatch the expand action programmatically (the radial menu's
  // items don't expose per-command testids; we trigger the same
  // handler the radial select would fire).
  await page.evaluate(() => {
    // Find the cy core via the debug hook.
    type CyShape = {
      getElementById: (id: string) => { trigger: (e: string) => void }
      $: (sel: string) => { length: number; first: () => { trigger: (e: string) => void } }
    }
    const cy = (window as unknown as { __geode_cy?: CyShape }).__geode_cy
    if (!cy) throw new Error('cy not ready')
    // Programmatic shortcut: open the popover by clicking the
    // menu's Expand command. cxtmenu doesn't expose this as a DOM
    // API, but we have a stable path through the orchestrator's
    // own onExpand handler — bypass cxtmenu for the e2e and open
    // the popover state directly via the same testid the user
    // would eventually hit.
  })
  // Fallback path: the e2e for cxtmenu radial commands is brittle;
  // instead, verify the popover machinery via inspector route.
  // (If cxtmenu's DOM is testable in your stack, replace this with
  // a real DOM click on the radial slice.)
})
```

NOTE: cxtmenu's radial commands render in a canvas-like surface that's NOT straightforwardly clickable via Playwright. A more reliable path is to skip the radial-menu-click portion and verify only that the popover machinery (Task 1's downstream `setExpandFor`) works end-to-end via the inspector's "Expand neighbours" button OR via a synthetic event:

Replace the popover test body with a synthetic-event approach:

```ts
test('expand popover opens and Run fires onExploreNeighbours', async ({
  authedPage: page,
}) => {
  const pos = await firstNodePosition(page)
  // Set selection via the id picker, then dispatch Expand via the
  // inspector's existing path (the radial menu's Expand command
  // calls the SAME handler).
  await page.getByTestId('graph-node-id-picker').fill(pos.id)
  await page.getByTestId('graph-action-explore').click()
  // Note: 'graph-action-explore' is the inspector's existing direct
  // explore button (pre-cxtmenu). If that testid doesn't exist,
  // use whichever button the inspector exposes.
  // After the click, the popover OR a direct explore should fire.
  // For this test we assert the popover appeared.
  await expect(page.getByTestId('graph-expand-popover')).toBeVisible()
  // Set limit + run.
  await page.getByTestId('graph-expand-limit').fill('5')
  await page.getByTestId('graph-expand-run').click()
  // Verify the popover dismissed.
  await expect(page.getByTestId('graph-expand-popover')).toBeHidden()
})
```

CAUTION: this spec is sensitive to whether the inspector has a button that opens the popover directly. After the cxtmenu migration, the inspector's old "Explore neighbours" button may have been removed. Read `src/components/results/graph/GraphInspector.tsx` first to confirm what button (if any) is still there. If none, the e2e for the popover is genuinely only reachable via cxtmenu — in which case, document that the radial-menu e2e is a known coverage gap and add a UNIT test instead that calls `setExpandFor` directly on a rendered GraphView and asserts the popover appears.

- [ ] **Step 2: Rebuild the geode-ui container**

```bash
docker compose -f deploy/docker-compose.test.yml build geode-ui
docker compose -f deploy/docker-compose.test.yml up -d geode-ui
until wget -qO- http://localhost:8080/healthz 2>/dev/null | grep -q ok; do sleep 2; done
```

- [ ] **Step 3: Run the affected spec**

Run: `npx playwright test --config=e2e/playwright.config.ts e2e/specs/24-graph-power-features.spec.ts --reporter=list`
Expected: all pass, including the two new tests.

If the expand-popover spec is brittle (cxtmenu DOM unreachable), accept it as a known gap and document. The mini-map test should be solid because it doesn't touch cxtmenu.

- [ ] **Step 4: Run the full e2e suite**

Run: `npx playwright test --config=e2e/playwright.config.ts --reporter=list`
Expected: clean. Pre-existing flakes acceptable.

- [ ] **Step 5: Final jest + tsc + lint**

```bash
npm test && npx tsc --noEmit && npm run lint
```

Expected: ALL green.

- [ ] **Step 6: Commit**

```bash
git add e2e/specs/24-graph-power-features.spec.ts
git commit -m "test(e2e): cover mini-map panel anchoring + expand popover"
```

---

## Self-Review Notes

- **Bug ordering is deliberate.** Fixing Bug #6 first makes Bug #5 verifiable (the cy-rebuild churn stops). Fixing Bug #1 + Bug #4 are isolated one-file fixes. Fixing Bugs #2 + #3 together preserves the layout contract and is the most invasive change.
- **The query-buffer fix** in Phase 1 has the highest user-impact: every keystroke currently triggers a debounced cytoscape rebuild + cxtmenu remount + lasso re-apply + tooltip rebind + dom-node re-mount + sig-keyed reset effect. After the fix, the editor types silently and the graph stays put until Run.
- **The fill-mode flex chain** in Phase 4 removes the `useFillHeight` heuristic entirely. The cytoscape `ResizeObserver` (already wired in `useGraphCytoscape`) handles the re-fit on container resize, so no JS layout math is needed.
- **The mini-map fix** uses a string CSS selector (`#graph-minimap-panel`) because `cytoscape-navigator` requires it; the inner-Box CSS override is defense-in-depth so the library's stylesheet can't escape the panel.
- **The cxtmenu contrast fix** changes two theme-token references. The existing test will need its stub theme to include `bg.inverse` and `text.inverse` — both already exist in the real theme.
- **No new dependencies** for any phase.

---

Plan complete. Total: 5 tasks across 5 phases. Each task TDD where applicable (Tasks 1, 2, 3, 4 follow strict fail-first; Task 5 is e2e coverage with one new spec per visible regression).
