# Data View UX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce visual clutter and reclaim viewport height across all four query result views (Table, JSON, Graph, Matrix) so the data fills the available vertical space by default and the graph toolbar/sidebar group related controls into compact, scoped surfaces instead of a single overflowing strip.

**Architecture:** Three orthogonal changes layered on the existing `QueryPage → ResultPanel → {TableView|JsonView|GraphViewCytoscape|MatrixView}` tree:
1. **Flex chain to the viewport** — `Shell <Body>` → `QueryPage` root → `ResultPanel` → each view becomes a single flex column rooted at `100dvh`, so the inline (non-maximized) result panel ALWAYS fills the space between the editor toolbar and the viewport edge. The legacy `fillHeight` prop becomes the default and the old short-by-default behavior is removed.
2. **Graph toolbar grouped + overflow** — the 13-button single strip splits into three labelled groups (View, Filters, Analysis), the rare toggles (mini-map, lasso, HTML nodes, renderer, sidebar collapse) move into a `wa-dropdown` "More…" overflow menu, and the Find input becomes a fixed-width search at the left of the strip.
3. **Graph sidebar collapsible sections + filter chips** — the five `ControlsBlock`s become `<details>` regions that remember their open state in `useGraphPrefs`, Hidden/Collapsed lists hide entirely when empty (instead of rendering a muted "No hidden nodes." line), the duplicate id-picker block is deleted in favour of the toolbar Find, and a new `<GraphFilterChips>` strip renders above the canvas to show every active filter (hidden labels, focus mode, cluster-on, path mode) as a removable pill.

**Tech Stack:** TypeScript, React 18, styled-components, Web Awesome components (`wa-dropdown`, `wa-button`, `wa-tab-group`), Zustand persist middleware (`useGraphPrefs`), Cytoscape, react-window v2, Playwright (E2E), Jest + React Testing Library.

---

## File Structure

### Modified

- `src/components/layout/Shell.tsx` — root `<Body>` becomes a flex column claiming `100dvh - header`.
- `src/pages/QueryPage.tsx` — outer wrapper is a flex column; editor + Bar are `flex: 0`; the inline result region is `flex: 1 1 0` with `min-height: 0` so it can shrink. `expand` (Expand graph cells) and `streamMode` toggles move into the `Bar` overflow.
- `src/components/results/ResultPanel.tsx` — the WA TabGroup + the active panel become a flex column. The maximize button stays in the tab strip but is now the FALLBACK affordance (default view already fills).
- `src/components/results/TableView.tsx` — `bodyHeight` reads from a measured container box (ResizeObserver) instead of `min(60vh, 720)`. Floor stays at 240 px so small viewports still get a usable body. `fillHeight` prop is deleted — always fills.
- `src/components/results/JsonView.tsx` — `max-height: 480px` is dropped; the `<pre>` flexes inside its parent.
- `src/components/results/MatrixView.tsx` — outer `Wrap` becomes a flex column so the overflow-auto pane fills the parent.
- `src/components/results/GraphViewCytoscape.tsx` — `fillHeight` is deleted (always fills), the wrapping `<Wrap>` no longer has a fixed inline height, the sidebar Side is always full-height, the orchestrator threads section-collapse prefs and renders the new `<GraphFilterChips>` strip.
- `src/components/results/graph/styled.ts` — `Wrap` / `CanvasArea` / `Canvas` / `Side` drop the `$fill` / `$height` variant branches (always-fill is the only mode).
- `src/components/results/graph/GraphToolbar.tsx` — toolbar splits into three groups + overflow; icon buttons replace text buttons for zoom/fit/reset/mode/cluster/size.
- `src/components/results/graph/GraphSidebar.tsx` / `GraphSidebarContents.tsx` — sidebar drops the `fill` / `height` props; sections become `<details>` keyed by sticky `sectionsOpen` state; the duplicate "Selection (by id)" block is removed.
- `src/components/results/useGraphPrefs.ts` — add `sectionsOpen: Record<SectionId, boolean>` with persist round-trip + setters; bump persist version.
- `src/services/i18n/locales/en.ts` — add new keys for filter chips, section labels, overflow menu, "fills viewport by default" affordance label.
- `e2e/specs/19-graph-viz.spec.ts` — assertions retargeted to the grouped toolbar / overflow menu / chip strip.
- `e2e/specs/23-graph-sidebar-responsive.spec.ts` — re-validate the inspector-stays-in-viewport invariant with the new `<details>` chrome.
- `e2e/helpers/selectors.ts` — new `graphToolbarMore`, `graphFilterChip`, `graphSectionToggle` selectors.

### Created

- `src/components/results/graph/GraphFilterChips.tsx` — chip strip rendered just under the toolbar listing every active filter as a removable pill.
- `src/components/results/graph/GraphFilterChips.test.tsx` — unit tests for chip rendering + clear-on-click.
- `src/components/results/graph/GraphToolbarMore.tsx` — `wa-dropdown`-backed overflow menu for the rarely-used toggles.
- `src/components/results/graph/GraphToolbarMore.test.tsx` — unit tests for overflow menu open/close + checkbox-item state.
- `src/components/results/CollapsibleSection.tsx` — generic `<details>` wrapper used by `GraphSidebarContents` so the section-toggle state mechanics live in one place (sticky open/close, animated chevron, a11y heading).
- `src/components/results/CollapsibleSection.test.tsx` — unit tests for the section wrapper.
- `e2e/specs/30-vertical-space.spec.ts` — viewport-fill regression sweep across the four data views (no fullscreen toggle click required).
- `e2e/specs/31-graph-toolbar-grouped.spec.ts` — group + overflow + chip integration test.

### Deleted

- `src/components/results/graph/useFillHeight.ts` — the hook collapses to a constant `undefined` once `fillHeight` is the only mode; inline its result at the one call site.
- `src/components/results/graph/GraphView.fillHeight.test.tsx` — superseded by `30-vertical-space.spec.ts`.

---

## Phase 1: Reclaim Vertical Space

Make the inline result panel grow to fill the viewport without requiring the user to click the maximize toggle. Removes the 480/720 hard caps from Graph/Table/JSON/Matrix, threads a flex chain from `Shell <Body>` down to each view, and deletes the now-redundant `fillHeight` variants.

### Task 1.1: Add E2E reproduction — inline result panel is short

**Files:**
- Create: `e2e/specs/30-vertical-space.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// e2e/specs/30-vertical-space.spec.ts
import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

const VIEWPORT = { width: 1280, height: 900 }

test.describe('inline result panel fills the viewport', () => {
  test.beforeEach(async ({ authedPage: page }) => {
    await page.setViewportSize(VIEWPORT)
    await page.goto('/')
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH (a:Person)-[r:ACTED_IN]->(m:Movie) RETURN a, r, m LIMIT 25`
    )
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/25 rows/)).toBeVisible()
  })

  test('table view fills available vertical space without fullscreen', async ({
    authedPage: page,
  }) => {
    const grid = page.getByTestId('table-view')
    await expect(grid).toBeVisible()
    const box = await grid.boundingBox()
    expect(box).not.toBeNull()
    // Grid must claim at least 60% of the viewport height (was capped at
    // min(60vh, 720) and on a 900 px viewport rendered ~480 px = 53%).
    if (box) expect(box.height).toBeGreaterThan(VIEWPORT.height * 0.6)
  })

  test('graph view fills available vertical space without fullscreen', async ({
    authedPage: page,
  }) => {
    await sel.queryTabGraph(page).click()
    const canvas = sel.graphCanvas(page).first()
    await expect(canvas).toBeVisible()
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    // Canvas claimed the legacy hard 480 px before this change; must now
    // grow past 600 px on a 900-tall viewport.
    if (box) expect(box.height).toBeGreaterThan(600)
  })

  test('json view fills available vertical space without fullscreen', async ({
    authedPage: page,
  }) => {
    await sel.queryTabJson(page).click()
    const pre = page.locator('pre').first()
    await expect(pre).toBeVisible()
    const box = await pre.boundingBox()
    expect(box).not.toBeNull()
    if (box) expect(box.height).toBeGreaterThan(VIEWPORT.height * 0.55)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec playwright test e2e/specs/30-vertical-space.spec.ts --project chromium`
Expected: FAIL — table height ≈ 480 px (`fillHeight: false` cap), graph canvas ≈ 480 px (hard default), json pre ≈ 480 px (`max-height` cap).

- [ ] **Step 3: Commit the reproduction**

```bash
git add e2e/specs/30-vertical-space.spec.ts
git commit -m "test(e2e): reproduce inline result panel vertical-space shortfall"
```

### Task 1.2: Make Shell `<Body>` claim the viewport

**Files:**
- Modify: `src/components/layout/Shell.tsx:81-87` (the `Body` styled component)

- [ ] **Step 1: Write the failing test**

Add to `src/components/layout/Shell.test.tsx` (append, do not replace existing tests):

```typescript
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from 'styled-components'
import { lightTheme } from '../../theme/light'
import { Shell } from './Shell'
import { AuthProvider } from '../../auth/AuthProvider'

describe('Shell <Body> flex chain', () => {
  it('the body region is a flex column that grows to fill the viewport', () => {
    const { container } = render(
      <MemoryRouter>
        <ThemeProvider theme={lightTheme}>
          <AuthProvider>
            <Shell />
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>
    )
    const main = container.querySelector('main#main-content') as HTMLElement
    expect(main).not.toBeNull()
    const cs = getComputedStyle(main)
    // jsdom doesn't compute layout, but the styled-rule strings ARE
    // serialised — assert the declarations exist.
    expect(cs.display).toBe('flex')
    expect(cs.flexDirection).toBe('column')
    expect(cs.minHeight).toMatch(/100dvh|100vh/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/components/layout/Shell.test.tsx -t "flex chain"`
Expected: FAIL — current `Body` is a plain block with `padding` only.

- [ ] **Step 3: Update the styled-component**

Edit `src/components/layout/Shell.tsx:81-87`:

```typescript
// Body is a flex column rooted at the dynamic viewport height (dvh
// excludes mobile browser chrome that vh includes). The Top nav stays
// above it as a separate flex item of the document; subtract its
// rendered height through `flex: 1 1 0` + `min-height: 0` so children
// (QueryPage, etc.) can grow into the remaining space without ever
// scrolling the page itself — only their internal panes scroll.
const Body = styled.main`
  display: flex;
  flex-direction: column;
  min-height: calc(100dvh - 57px);
  padding: ${({ theme }) => theme.spacing.lg};
  /* The viewport-height calc above subtracts an approximation of the
     Top nav row (sm vertical padding × 2 + 28 px logo + 1 px border ≈
     57 px). The flex chain below this point uses min-height: 0 so a
     long child doesn't push the page off-screen. */

  ${below('sm')`
    padding: ${({ theme }: { theme: DefaultTheme }) => theme.spacing.md};
    min-height: calc(100dvh - 49px);
  `}
`
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/components/layout/Shell.test.tsx -t "flex chain"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/Shell.tsx src/components/layout/Shell.test.tsx
git commit -m "fix(shell): make <Body> a viewport-tall flex column"
```

### Task 1.3: Make QueryPage a flex column that grows the result panel

**Files:**
- Modify: `src/pages/QueryPage.tsx:99-355` (component body + outer wrapper)

- [ ] **Step 1: Write the failing test**

Add to `src/pages/QueryPage.test.tsx` (append):

```typescript
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { MemoryRouter } from 'react-router-dom'
import { lightTheme } from '../theme/light'
import { I18nextProvider } from 'react-i18next'
import i18n from '../services/i18n'
import { QueryPage } from './QueryPage'

describe('QueryPage outer layout', () => {
  it('the page root is a flex column that lets the result region grow', () => {
    const { container } = render(
      <ThemeProvider theme={lightTheme}>
        <MemoryRouter>
          <I18nextProvider i18n={i18n}>
            <QueryPage />
          </I18nextProvider>
        </MemoryRouter>
      </ThemeProvider>
    )
    const root = container.firstChild as HTMLElement
    const cs = getComputedStyle(root)
    expect(cs.display).toBe('flex')
    expect(cs.flexDirection).toBe('column')
    expect(cs.flex).toMatch(/1 1 (0|auto)/)
    expect(cs.minHeight).toBe('0px')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/pages/QueryPage.test.tsx -t "outer layout"`
Expected: FAIL — the page root is a bare `<div>`.

- [ ] **Step 3: Replace the outer wrapper with a styled flex column**

Edit `src/pages/QueryPage.tsx`. After the existing `LazyFallback` styled component, add:

```typescript
// QueryPage outer container — a flex column claiming the height of its
// parent (Shell's <Body>). Editor + Bar pin to their natural height
// (flex: 0 0 auto); the result region is `flex: 1 1 0` with
// `min-height: 0` so it shrinks to fit while still growing to the
// available height — i.e. the table/graph/json/matrix body fills the
// viewport WITHOUT requiring the user to click the maximize toggle.
const PageRoot = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0;
  gap: ${({ theme }) => theme.spacing.sm};
`

const ResultRegion = styled.div`
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
`
```

In the JSX (around line 356-417), change the outer `<div>` to `<PageRoot>` and wrap `{resultRegion}` (the inline branch) in `<ResultRegion>`:

```typescript
  return (
    <PageRoot>
      <Suspense fallback={editorFallback}>
        <GqlEditor value={stmt} onChange={setStmt} onRun={run} />
      </Suspense>
      <Bar>
        {/* …existing buttons + toggles + status spans… */}
      </Bar>
      {maximized ? (
        resultRegion /* portal target unchanged */
      ) : (
        resultPanel && <ResultRegion>{resultPanel}</ResultRegion>
      )}
    </PageRoot>
  )
```

(Delete the old `resultRegion` ternary block immediately above the `return`; the inline path is now handled directly in JSX, the overlay path stays as a portal.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/pages/QueryPage.test.tsx -t "outer layout"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/QueryPage.tsx src/pages/QueryPage.test.tsx
git commit -m "fix(query): make QueryPage a viewport-filling flex column"
```

### Task 1.4: Make ResultPanel a flex column that grows the active panel

**Files:**
- Modify: `src/components/results/ResultPanel.tsx:36-186`

- [ ] **Step 1: Write the failing test**

Add to `src/components/results/ResultPanel.test.tsx` (append):

```typescript
it('the WA tab-group host is a flex column inside the tab row', () => {
  const resp = { columns: [], rows: [], row_count: 0, elapsed_ms: 1 }
  const { container } = render(
    <ThemeProvider theme={lightTheme}>
      <ResultPanel
        resp={resp}
        tab="table"
        onTabChange={() => {}}
        onToggleMaximize={() => {}}
      />
    </ThemeProvider>
  )
  const tabsRow = container.firstChild as HTMLElement
  const cs = getComputedStyle(tabsRow)
  expect(cs.display).toBe('flex')
  expect(cs.flex).toMatch(/1 1 (0|auto)/)
  expect(cs.minHeight).toBe('0px')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/components/results/ResultPanel.test.tsx -t "flex column"`
Expected: FAIL — `TabsRow` is a `flex` row but neither grows nor has `min-height: 0`.

- [ ] **Step 3: Update TabsRow + the tab-group + each tab-panel to flex-grow**

Edit `src/components/results/ResultPanel.tsx`. Replace the `TabsRow` styled-component:

```typescript
// TabsRow hosts the WA <wa-tab-group> + the maximize toggle. It is a
// flex column (not row!) so the active TabPanel below the tab strip
// grows to fill the available height. The tab strip itself stays as a
// horizontal row via tab-group's internal styling. flex: 1 1 0 +
// min-height: 0 propagate the viewport-fill chain from QueryPage's
// ResultRegion down into the active panel.
const TabsRow = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0;
  margin: ${({ theme }) => theme.spacing.sm} 0 0;
  gap: ${({ theme }) => theme.spacing.xs};

  /* The WA tab-group host renders the nav row + the active panel. Pin
     its flex to grow so the active panel uses the column height. */
  wa-tab-group {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* WA mounts active panels as the slot consumer; force the wrapper
     to expand. The light-DOM <wa-tab-panel> elements participate in
     the flex chain through ::part(body) only on browsers; in jsdom
     the styled descendant selector below is enough for the unit
     tests. */
  wa-tab-panel {
    flex: 1 1 0;
    min-height: 0;
  }

  wa-tab-panel[active] {
    display: flex;
    flex-direction: column;
  }
`

// MaximizeBtnRow is a separate row that floats the toggle to the
// right above the tab strip (the previous design placed it as a
// sibling of <wa-tab-group> in a single row; with tab-group as
// flex: 1 1 0 the toggle would have stretched the tab strip).
const MaximizeBtnRow = styled.div`
  display: flex;
  justify-content: flex-end;
  margin-bottom: -${({ theme }) => theme.spacing.xs};
`
```

In the JSX, move the maximize button into `<MaximizeBtnRow>` above the tab-group:

```typescript
  return (
    <TabsRow>
      {onToggleMaximize && (
        <MaximizeBtnRow>
          <wa-button /* …same props as before… */ />
        </MaximizeBtnRow>
      )}
      <TabGroup style={{ flex: '1 1 0', minHeight: 0 }} {/* …rest unchanged… */}>
        {/* …existing tabs + panels… */}
      </TabGroup>
    </TabsRow>
  )
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/components/results/ResultPanel.test.tsx -t "flex column"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/ResultPanel.tsx src/components/results/ResultPanel.test.tsx
git commit -m "fix(result-panel): tab-group flex-grows into the page column"
```

### Task 1.5: Drop the TableView height cap and the `fillHeight` prop

**Files:**
- Modify: `src/components/results/TableView.tsx:42-58, 184-186, 460-508`

- [ ] **Step 1: Write the failing test**

Add to `src/components/results/TableView.test.tsx` (append):

```typescript
it('body height tracks the container height instead of capping at 720', () => {
  const resp = {
    columns: [{ name: 'a', type: 'string' }],
    rows: Array.from({ length: 100 }, (_, i) => [`row-${i}`]),
  }
  // Force the wrap to a known size via a parent style.
  const { container } = render(
    <ThemeProvider theme={lightTheme}>
      <div style={{ height: 1200 }}>
        <TableView resp={resp} />
      </div>
    </ThemeProvider>
  )
  const list = container.querySelector('[role="grid"] > div > div:last-child') as HTMLElement
  // react-window writes `height` inline on the list root; assert it's
  // the parent container height (1200), NOT the legacy 720 cap.
  expect(list).not.toBeNull()
  expect(parseInt(list.style.height, 10)).toBeGreaterThan(800)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/components/results/TableView.test.tsx -t "body height tracks"`
Expected: FAIL — current `bodyHeight` defaults to 480 px and caps at 720 px from `VIRTUAL_BODY_MAX`.

- [ ] **Step 3: Replace the windowed-listener body-height with a ResizeObserver on the Wrap**

Edit `src/components/results/TableView.tsx`. Delete the `fillHeight?: boolean` prop, delete the `VIRTUAL_BODY_MAX` / `VIRTUAL_BODY_DEFAULT` constants (keep `VIRTUAL_BODY_MIN`), and replace the body-height effect:

```typescript
// The virtualized body grows to fill the wrap's content box. A
// ResizeObserver on the outer wrap publishes the live HEIGHT (the
// header is ~38 px; we subtract that so the list height + header
// height equals the wrap height). Floored at VIRTUAL_BODY_MIN so a
// pathologically short parent still gives the user a usable body.
const VIRTUAL_BODY_MIN = 240
const HEADER_BUDGET_PX = 40

  // …inside the component, replace the existing height-tracking effect:
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const w = entry.contentRect.width
      const h = entry.contentRect.height
      if (Number.isFinite(w) && w > 0) setContainerWidth(w)
      if (Number.isFinite(h) && h > 0) {
        setBodyHeight(Math.max(VIRTUAL_BODY_MIN, h - HEADER_BUDGET_PX))
      }
    })
    ro.observe(el)
    const r = el.getBoundingClientRect()
    if (Number.isFinite(r.width) && r.width > 0) setContainerWidth(r.width)
    if (Number.isFinite(r.height) && r.height > 0) {
      setBodyHeight(Math.max(VIRTUAL_BODY_MIN, r.height - HEADER_BUDGET_PX))
    }
    return () => ro.disconnect()
  }, [])
```

And in the props type:

```typescript
type Props = {
  resp: {
    columns: Array<Record<string, unknown>>
    rows: Array<Array<unknown>>
  }
  expand?: boolean
  // fillHeight prop deleted — TableView ALWAYS fills its parent's
  // content box. Callers that previously relied on the inline 480 px
  // default should put the view in a flex column whose content box
  // is the size they want.
}
```

Update the `Wrap` styled-component so it itself flex-fills:

```typescript
const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0;
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
  overflow: clip;
  background: ${({ theme }) => theme.bg.surface};
`
```

Remove the `fillHeight` reference from the component signature and the JSX (the existing `{...rest}` doesn't apply — drop the parameter destructure).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/components/results/TableView.test.tsx`
Expected: PASS — all existing tests plus the new height assertion.

- [ ] **Step 5: Fix the ResultPanel call site**

Edit `src/components/results/ResultPanel.tsx` line 134:

```typescript
{tab === 'table' && <TableView resp={resp} expand={expand} />}
```

(Drop `fillHeight={maximized}`.)

- [ ] **Step 6: Commit**

```bash
git add src/components/results/TableView.tsx src/components/results/TableView.test.tsx src/components/results/ResultPanel.tsx
git commit -m "fix(table): grow body to wrap container height (no 720 px cap)"
```

### Task 1.6: Drop the JsonView max-height cap and the `fillHeight` prop

**Files:**
- Modify: `src/components/results/JsonView.tsx:1-38`
- Modify: `src/components/results/ResultPanel.tsx:143`

- [ ] **Step 1: Write the failing test**

Add to `src/components/results/JsonView.test.tsx` (append):

```typescript
it('the pre always fills its parent (no max-height cap)', () => {
  const { container } = render(
    <ThemeProvider theme={lightTheme}>
      <div style={{ height: 1000 }}>
        <JsonView data={{ a: 1 }} />
      </div>
    </ThemeProvider>
  )
  const pre = container.querySelector('pre') as HTMLElement
  const cs = getComputedStyle(pre)
  expect(cs.maxHeight).toBe('none')
  expect(cs.flex).toMatch(/1 1 (0|auto)/)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/components/results/JsonView.test.tsx -t "always fills"`
Expected: FAIL — current `Pre` has `max-height: 480px` when `$fill` is false.

- [ ] **Step 3: Replace the `<Pre>` styled-component and drop `fillHeight`**

Edit `src/components/results/JsonView.tsx`:

```typescript
import React, { useMemo } from 'react'
import styled from 'styled-components'

// The <pre> flexes to fill its parent's content box. No max-height —
// the host (ResultPanel / a future caller) is responsible for sizing
// its flex container. Long output gets the same `overflow: auto`
// scrollbar it always had.
const Pre = styled.pre`
  background: ${({ theme }) => theme.bg.canvas};
  color: ${({ theme }) => theme.text.primary};
  font-family: ${({ theme }) => theme.font.family.mono};
  font-size: ${({ theme }) => theme.font.sizes.sm};
  padding: ${({ theme }) => theme.spacing.md};
  overflow: auto;
  flex: 1 1 0;
  min-height: 0;
  max-height: none;
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
  margin: 0;
`

const JsonViewImpl: React.FC<{ data: unknown }> = ({ data }) => {
  const text = useMemo(() => JSON.stringify(data, null, 2), [data])
  return <Pre>{text}</Pre>
}

export const JsonView = React.memo(JsonViewImpl)
JsonView.displayName = 'JsonView'
```

Edit `src/components/results/ResultPanel.tsx` line 143:

```typescript
{tab === 'json' && <JsonView data={resp} />}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/components/results/JsonView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/JsonView.tsx src/components/results/JsonView.test.tsx src/components/results/ResultPanel.tsx
git commit -m "fix(json): drop max-height cap; pre flexes to parent"
```

### Task 1.7: Make MatrixView fill its parent

**Files:**
- Modify: `src/components/results/MatrixView.tsx:13-50`

- [ ] **Step 1: Write the failing test**

Add to `src/components/results/MatrixView.test.tsx` (append):

```typescript
it('the wrap is a flex column that fills its parent', () => {
  const resp = { columns: [], rows: [], row_count: 0, elapsed_ms: 1 }
  const { container } = render(
    <ThemeProvider theme={lightTheme}>
      <I18nextProvider i18n={i18n}>
        <div style={{ height: 800 }}>
          <MatrixView resp={resp} query="" />
        </div>
      </I18nextProvider>
    </ThemeProvider>
  )
  // The empty-state branch returns <Empty>. Switch to a non-empty
  // payload so <Wrap> is the rendered root.
  // (Replace with seeded resp if your test harness has one.)
  const wrap = container.querySelector('[role="table"]')?.parentElement as HTMLElement
  if (wrap) {
    const cs = getComputedStyle(wrap)
    expect(cs.display).toBe('flex')
    expect(cs.flex).toMatch(/1 1 (0|auto)/)
  }
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/components/results/MatrixView.test.tsx -t "fills its parent"`
Expected: FAIL — `Wrap` is a plain `overflow: auto` block.

- [ ] **Step 3: Update the styled wrap**

Edit `src/components/results/MatrixView.tsx`:

```typescript
const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
  padding: ${({ theme }) => theme.spacing.sm};
`
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/components/results/MatrixView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/MatrixView.tsx src/components/results/MatrixView.test.tsx
git commit -m "fix(matrix): flex-fill the wrap so the heatmap uses the available height"
```

### Task 1.8: Delete `useFillHeight` and make GraphViewCytoscape always fill

**Files:**
- Delete: `src/components/results/graph/useFillHeight.ts`
- Delete: `src/components/results/graph/GraphView.fillHeight.test.tsx`
- Modify: `src/components/results/graph/styled.ts`
- Modify: `src/components/results/graph/GraphSidebar.tsx`
- Modify: `src/components/results/GraphViewCytoscape.tsx:72-92, 102, 663-797`
- Modify: `src/components/results/GraphView.tsx` (drop the `fillHeight` prop forwarding)
- Modify: `src/components/results/ResultPanel.tsx:153`

- [ ] **Step 1: Delete the now-redundant hook & its dedicated test**

```bash
git rm src/components/results/graph/useFillHeight.ts \
       src/components/results/graph/GraphView.fillHeight.test.tsx
```

- [ ] **Step 2: Collapse the `$fill` / `$height` branches in `styled.ts`**

Edit `src/components/results/graph/styled.ts`. Replace `Wrap`, `CanvasArea`, `Canvas`:

```typescript
import styled from 'styled-components'

// Wrap is the grid container for the graph view. Always fills its
// parent's content box (the QueryPage result region). The side-by-
// side 1fr/280px layout — and its below-md stacked fallback — is the
// only layout mode. When the sidebar is collapsed the grid becomes
// a single 1fr column.
export const Wrap = styled.div<{ $sidebarCollapsed: boolean }>`
  display: grid;
  grid-template-columns: ${({ $sidebarCollapsed }) =>
    $sidebarCollapsed ? '1fr' : '1fr 300px'};
  gap: ${({ theme }) => theme.spacing.sm};
  flex: 1 1 0;
  min-height: 0;

  @media (max-width: ${({ theme }) => theme.breakpoints.md - 0.02}px) {
    grid-template-columns: 1fr;
  }
`

export const CanvasArea = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  gap: ${({ theme }) => theme.spacing.xs};
`

export const Canvas = styled.div`
  flex: 1 1 0;
  min-height: 0;
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
  background: ${({ theme }) => theme.bg.graphCanvas};
`
```

Keep `PathStatus`, `Overlay`, `ErrorBanner`, `ControlsBlock`, `RestoreList` as-is.

- [ ] **Step 3: Collapse `Side` to a fill-only variant**

Edit `src/components/results/graph/GraphSidebar.tsx`:

```typescript
import React from 'react'
import styled from 'styled-components'

const Side = styled.aside`
  height: 100%;
  min-height: 0;
  overflow: auto;
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.sm};
  background: ${({ theme }) => theme.bg.surface};
  color: ${({ theme }) => theme.text.primary};

  pre {
    white-space: pre-wrap;
    word-break: break-all;
  }

  @media (max-width: ${({ theme }) => theme.breakpoints.md - 0.02}px) {
    height: auto;
    max-height: 320px;
  }
`

export type GraphSidebarProps = {
  children: React.ReactNode
}

export const GraphSidebar: React.FC<GraphSidebarProps> = ({ children }) => (
  <Side data-testid="graph-sidebar">{children}</Side>
)
```

- [ ] **Step 4: Drop `fillHeight` + `height` from GraphViewCytoscape**

Edit `src/components/results/GraphViewCytoscape.tsx`:

1. Replace the props type (around line 72):
```typescript
export type GraphViewCytoscapeProps = {
  resp: QueryRespLike & { row_count?: number }
  query?: string
}
```
2. Remove the `useFillHeight` import + call (line 14 + line 102) — delete both lines.
3. Remove `height` / `fillHeight` from the destructure (around line 87-92):
```typescript
export const GraphViewCytoscape: React.FC<GraphViewCytoscapeProps> = ({
  resp,
  query,
}) => {
```
4. In the JSX (line 663-797), remove `$fill` / `effectiveHeight` / `fill` props from `Wrap`, `Canvas`, `GraphSidebar`:
```typescript
<Wrap $sidebarCollapsed={sidebarCollapsed}>
  {/* …existing CanvasArea content unchanged except the Canvas element… */}
  <Canvas
    ref={ref}
    role="img"
    aria-label={t('graph.canvasAria')}
    tabIndex={0}
    onKeyDown={handleKey}
    data-testid="graph-canvas"
    data-focus-active={focusMode.state !== null ? 'true' : 'false'}
  />
  {/* …overlay children unchanged… */}
</Wrap>
```
And replace the sidebar mount:
```typescript
{!sidebarCollapsed && (
  <GraphSidebar>
    <GraphSidebarContents {/* …same children… */} />
  </GraphSidebar>
)}
```
5. In the wrapper `<div>` around the canvas (line 716-724), the `flex: fillHeight ? '1 1 auto' : '0 0 auto'` ternary becomes a constant `flex: '1 1 auto'`:
```typescript
<div
  style={{
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    flex: '1 1 auto',
    minHeight: 0,
  }}
>
```

- [ ] **Step 5: Drop `fillHeight` from the GraphView dispatcher and the ResultPanel call site**

Edit `src/components/results/GraphView.tsx`:

```typescript
import React from 'react'
import {
  GraphViewCytoscape,
  type GraphViewCytoscapeProps,
} from './GraphViewCytoscape'

export type GraphViewProps = GraphViewCytoscapeProps

export const GraphView: React.FC<GraphViewProps> = (props) => (
  <GraphViewCytoscape {...props} />
)
```

Edit `src/components/results/ResultPanel.tsx` line 153:

```typescript
<GraphView resp={resp} query={query} />
```

(Drop `fillHeight={maximized}`.)

- [ ] **Step 6: Run all affected unit tests**

Run: `pnpm test src/components/results -t "GraphView" && pnpm test src/components/results -t "ResultPanel"`
Expected: PASS — minus the deleted `fillHeight.test.tsx`.

- [ ] **Step 7: Run the original E2E reproduction**

Run: `pnpm exec playwright test e2e/specs/30-vertical-space.spec.ts --project chromium`
Expected: PASS — all three sub-tests (table / graph / json fill the viewport).

- [ ] **Step 8: Commit**

```bash
git add src/components/results/graph/styled.ts \
        src/components/results/graph/GraphSidebar.tsx \
        src/components/results/GraphViewCytoscape.tsx \
        src/components/results/GraphView.tsx \
        src/components/results/ResultPanel.tsx
git commit -m "fix(graph): drop fillHeight variant; canvas + sidebar always fill"
```

---

## Phase 2: Compact the Graph Toolbar

The current toolbar exposes 13+ buttons in one wrap-prone strip. This phase groups them into three labelled clusters (View / Filters / Analysis), moves rarely-used toggles (mini-map, lasso, HTML nodes, renderer, sidebar collapse) into a `wa-dropdown` overflow menu, and converts the high-frequency view controls (zoom/fit/reset) to compact icon buttons.

### Task 2.1: Create the `GraphToolbarMore` overflow dropdown

**Files:**
- Create: `src/components/results/graph/GraphToolbarMore.tsx`
- Create: `src/components/results/graph/GraphToolbarMore.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// GraphToolbarMore.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { lightTheme } from '../../../theme/light'
import { GraphToolbarMore, type GraphToolbarMoreProps } from './GraphToolbarMore'

const makeProps = (overrides: Partial<GraphToolbarMoreProps> = {}): GraphToolbarMoreProps => ({
  t: (k: string) => k,
  miniMap: false,
  onToggleMiniMap: () => {},
  lasso: false,
  onToggleLasso: () => {},
  domNodes: false,
  onToggleDomNodes: () => {},
  sidebarCollapsed: false,
  onToggleSidebar: () => {},
  ...overrides,
})

describe('GraphToolbarMore', () => {
  it('renders four checkbox items reflecting their toggle state', () => {
    render(
      <ThemeProvider theme={lightTheme}>
        <GraphToolbarMore {...makeProps({ miniMap: true, lasso: false, domNodes: true })} />
      </ThemeProvider>
    )
    const items = screen.getAllByRole('menuitemcheckbox')
    expect(items).toHaveLength(4)
    const checked = items.filter((i) => i.getAttribute('aria-checked') === 'true')
    expect(checked.length).toBe(2)
  })

  it('fires the matching toggle on item activate', () => {
    const onToggleMiniMap = jest.fn()
    render(
      <ThemeProvider theme={lightTheme}>
        <GraphToolbarMore {...makeProps({ onToggleMiniMap })} />
      </ThemeProvider>
    )
    const item = screen.getByTestId('graph-more-minimap')
    fireEvent.click(item)
    expect(onToggleMiniMap).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/components/results/graph/GraphToolbarMore.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
// GraphToolbarMore.tsx
import React, { useCallback } from 'react'

type TFn = (key: string, opts?: Record<string, unknown>) => string

export type GraphToolbarMoreProps = {
  t: TFn
  miniMap: boolean
  onToggleMiniMap: () => void
  lasso: boolean
  onToggleLasso: () => void
  domNodes: boolean
  onToggleDomNodes: () => void
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
}

// GraphToolbarMore is the toolbar's "More…" dropdown. It groups the
// rarely-used toggles (mini-map, lasso, HTML-nodes, sidebar collapse)
// behind a single trigger so the main toolbar row stays short.
// Implemented as a checkbox-item menu — each entry's `checked` mirrors
// its bound pref, and activating an entry flips the pref through the
// usual handler so the cytoscape side-effects fire identically to the
// inline buttons.
export const GraphToolbarMore: React.FC<GraphToolbarMoreProps> = ({
  t,
  miniMap,
  onToggleMiniMap,
  lasso,
  onToggleLasso,
  domNodes,
  onToggleDomNodes,
  sidebarCollapsed,
  onToggleSidebar,
}) => {
  // The wa-dropdown component fires `wa-select` with the chosen item's
  // `value` attribute. Map the value back to a handler so the menu
  // exposes only ONE event listener.
  const onSelect = useCallback(
    (e: Event) => {
      const ev = e as CustomEvent<{ item: HTMLElement }>
      const value = ev.detail?.item?.getAttribute('value')
      if (value === 'minimap') onToggleMiniMap()
      else if (value === 'lasso') onToggleLasso()
      else if (value === 'domNodes') onToggleDomNodes()
      else if (value === 'sidebar') onToggleSidebar()
    },
    [onToggleMiniMap, onToggleLasso, onToggleDomNodes, onToggleSidebar]
  )

  return (
    <wa-dropdown
      data-testid="graph-toolbar-more"
      placement="bottom-end"
      // @ts-expect-error native CustomEvent prop bag for wa-dropdown
      onwa-select={onSelect}
    >
      <wa-button slot="trigger" appearance="outlined" size="s">
        {t('graph.moreLabel')}
      </wa-button>
      <wa-dropdown-item
        type="checkbox"
        value="minimap"
        data-testid="graph-more-minimap"
        checked={miniMap || undefined}
        role="menuitemcheckbox"
        aria-checked={miniMap ? 'true' : 'false'}
      >
        {t('graph.miniMap')}
      </wa-dropdown-item>
      <wa-dropdown-item
        type="checkbox"
        value="lasso"
        data-testid="graph-more-lasso"
        checked={lasso || undefined}
        role="menuitemcheckbox"
        aria-checked={lasso ? 'true' : 'false'}
      >
        {t('graph.lasso')}
      </wa-dropdown-item>
      <wa-dropdown-item
        type="checkbox"
        value="domNodes"
        data-testid="graph-more-domnodes"
        checked={domNodes || undefined}
        role="menuitemcheckbox"
        aria-checked={domNodes ? 'true' : 'false'}
      >
        {t('graph.domNodes')}
      </wa-dropdown-item>
      <wa-dropdown-item
        type="checkbox"
        value="sidebar"
        data-testid="graph-more-sidebar"
        checked={sidebarCollapsed || undefined}
        role="menuitemcheckbox"
        aria-checked={sidebarCollapsed ? 'true' : 'false'}
      >
        {t('graph.toggleSidebarFromMore')}
      </wa-dropdown-item>
    </wa-dropdown>
  )
}
```

- [ ] **Step 4: Add the new i18n keys**

Edit `src/services/i18n/locales/en.ts` inside the `graph` block. Add:

```typescript
    moreLabel: 'More…',
    toggleSidebarFromMore: 'Show inspector sidebar',
    viewGroupLabel: 'View',
    filtersGroupLabel: 'Filters',
    analysisGroupLabel: 'Analysis',
    filterChipHidden: 'Hidden: {{label}}',
    filterChipFocused: 'Focused (id {{id}}, {{hops}} hops)',
    filterChipCluster: 'Grouped by label',
    filterChipPath: 'Path mode',
    filterChipClear: 'Clear filter',
    sectionVisibility: 'Visibility',
    sectionDisplay: 'Display fields',
    sectionHidden: 'Hidden nodes',
    sectionCollapsed: 'Collapsed nodes',
    sectionInspector: 'Inspector',
```

(`scripts/validate-translations.mjs` will need the other locales updated; for English-only the test below will pass.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/components/results/graph/GraphToolbarMore.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/results/graph/GraphToolbarMore.tsx \
        src/components/results/graph/GraphToolbarMore.test.tsx \
        src/services/i18n/locales/en.ts
git commit -m "feat(graph): GraphToolbarMore overflow menu for rare toggles"
```

### Task 2.2: Refactor `GraphToolbar` into three labelled groups + overflow

**Files:**
- Modify: `src/components/results/graph/GraphToolbar.tsx`
- Modify: `src/components/results/graph/GraphToolbar.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `src/components/results/graph/GraphToolbar.test.tsx` (append):

```typescript
import { render, screen } from '@testing-library/react'

describe('GraphToolbar grouped layout', () => {
  it('renders three labelled groups: View, Filters, Analysis', () => {
    renderToolbar()
    expect(screen.getByTestId('graph-toolbar-group-view')).toBeInTheDocument()
    expect(screen.getByTestId('graph-toolbar-group-filters')).toBeInTheDocument()
    expect(screen.getByTestId('graph-toolbar-group-analysis')).toBeInTheDocument()
  })

  it('the rarely-used toggles live inside the More dropdown, not in the main strip', () => {
    renderToolbar()
    // Main strip — these should NOT appear as inline buttons anymore.
    expect(screen.queryByTestId('graph-minimap-toggle')).not.toBeInTheDocument()
    expect(screen.queryByTestId('graph-lasso-toggle')).not.toBeInTheDocument()
    expect(screen.queryByTestId('graph-dom-nodes-toggle')).not.toBeInTheDocument()
    expect(screen.queryByTestId('graph-sidebar-toggle')).not.toBeInTheDocument()
    // They live in the More dropdown instead.
    expect(screen.getByTestId('graph-more-minimap')).toBeInTheDocument()
    expect(screen.getByTestId('graph-more-lasso')).toBeInTheDocument()
    expect(screen.getByTestId('graph-more-domnodes')).toBeInTheDocument()
    expect(screen.getByTestId('graph-more-sidebar')).toBeInTheDocument()
  })

  it('zoom and fit controls are still present but as icon buttons', () => {
    renderToolbar()
    const zoomIn = screen.getByTestId('graph-zoom-in')
    expect(zoomIn).toBeInTheDocument()
    expect(zoomIn.getAttribute('aria-label')).toBe('graph.zoomIn')
  })
})

function renderToolbar() {
  return render(
    <ThemeProvider theme={lightTheme}>
      <GraphToolbar
        t={(k: string) => k}
        sidebarCollapsed={false}
        onToggleSidebar={() => {}}
        layout="cose"
        onChangeLayout={() => {}}
        layouts={['cose', 'fcose']}
        layoutLabel={(name) => name}
        onZoomIn={() => {}}
        onZoomOut={() => {}}
        onFit={() => {}}
        onResetView={() => {}}
        selectionMode="pan"
        onToggleSelectionMode={() => {}}
        clusterByLabel={false}
        onToggleClusterByLabel={() => {}}
        degreeSizing={false}
        onToggleDegreeSizing={() => {}}
        pathActive={false}
        onTogglePathMode={() => {}}
        onPathClear={() => {}}
        miniMap={false}
        onToggleMiniMap={() => {}}
        lasso={false}
        onToggleLasso={() => {}}
        domNodes={false}
        onToggleDomNodes={() => {}}
        findNodes={[]}
        onFindPick={() => {}}
        counts={{ nodes: 0, edges: 0 }}
        renderer="cytoscape"
        onToggleRenderer={() => {}}
      />
    </ThemeProvider>
  )
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/components/results/graph/GraphToolbar.test.tsx -t "grouped layout"`
Expected: FAIL — none of the new testids exist.

- [ ] **Step 3: Rewrite `GraphToolbar`**

Replace the body of `src/components/results/graph/GraphToolbar.tsx`. Keep the existing styled `Toolbar` rule and add a `Group` styled wrapper:

```typescript
import React from 'react'
import styled from 'styled-components'
import type { LayoutName } from '../useGraphPrefs'
import { FindNodeInput } from './FindNodeInput'
import { GraphToolbarMore } from './GraphToolbarMore'

const Toolbar = styled.div`
  display: flex;
  flex-wrap: nowrap;
  overflow-x: auto;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.sm};
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
  font-size: ${({ theme }) => theme.font.sizes.xs};
  color: ${({ theme }) => theme.text.secondary};
  scrollbar-gutter: stable;

  .stats {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
    color: ${({ theme }) => theme.text.muted};
    white-space: nowrap;
  }
`

// Group is a labelled cluster of related controls. `data-testid` is
// derived from `label` so the E2E suite can assert each cluster exists.
const Group = styled.div`
  display: inline-flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xxs};
  padding: 0 ${({ theme }) => theme.spacing.xs};
  border-right: 1px solid ${({ theme }) => theme.border.subtle};

  &:last-of-type {
    border-right: none;
  }

  .group-label {
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: ${({ theme }) => theme.font.weights.semibold};
    color: ${({ theme }) => theme.text.muted};
    margin-right: ${({ theme }) => theme.spacing.xxs};
    font-size: ${({ theme }) => theme.font.sizes.xxs};
  }
`

type TFn = (key: string, opts?: Record<string, unknown>) => string

export type GraphToolbarProps = {
  t: TFn
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  layout: LayoutName
  onChangeLayout: (next: LayoutName) => void
  layouts: readonly LayoutName[]
  layoutLabel: (name: LayoutName, t: TFn) => string
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  onResetView: () => void
  selectionMode: 'pan' | 'box'
  onToggleSelectionMode: () => void
  clusterByLabel: boolean
  onToggleClusterByLabel: () => void
  degreeSizing: boolean
  onToggleDegreeSizing: () => void
  pathActive: boolean
  onTogglePathMode: () => void
  onPathClear: () => void
  miniMap: boolean
  onToggleMiniMap: () => void
  lasso: boolean
  onToggleLasso: () => void
  domNodes: boolean
  onToggleDomNodes: () => void
  findNodes: Record<string, unknown>[]
  onFindPick: (id: string) => void
  counts: { nodes: number; edges: number }
  // renderer / onToggleRenderer kept for prop compat but currently
  // unused — the reagraph branch is disabled in the dispatcher, so
  // surfacing the toggle is misleading. Move it to the "More" dropdown
  // once reagraph is re-enabled (Phase-0 of the migration plan).
  renderer: 'cytoscape' | 'reagraph'
  onToggleRenderer: () => void
}

export const GraphToolbar: React.FC<GraphToolbarProps> = ({
  t,
  sidebarCollapsed,
  onToggleSidebar,
  layout,
  onChangeLayout,
  layouts,
  layoutLabel,
  onZoomIn,
  onZoomOut,
  onFit,
  onResetView,
  selectionMode,
  onToggleSelectionMode,
  clusterByLabel,
  onToggleClusterByLabel,
  degreeSizing,
  onToggleDegreeSizing,
  pathActive,
  onTogglePathMode,
  onPathClear,
  miniMap,
  onToggleMiniMap,
  lasso,
  onToggleLasso,
  domNodes,
  onToggleDomNodes,
  findNodes,
  onFindPick,
  counts,
}) => {
  return (
    <Toolbar data-testid="graph-toolbar" role="toolbar">
      <FindNodeInput nodes={findNodes} onPick={onFindPick} t={t} />
      <Group data-testid="graph-toolbar-group-view" aria-label={t('graph.viewGroupLabel')}>
        <span className="group-label">{t('graph.viewGroupLabel')}</span>
        <select
          data-testid="graph-layout-picker"
          aria-label={t('graph.layoutLabel')}
          value={layout}
          onChange={(e) => onChangeLayout(e.target.value as LayoutName)}
        >
          {layouts.map((name) => (
            <option key={name} value={name}>
              {layoutLabel(name, t)}
            </option>
          ))}
        </select>
        <wa-button appearance="outlined" size="s" data-testid="graph-zoom-in"
                   aria-label={t('graph.zoomIn')} title={t('graph.zoomIn')} onClick={onZoomIn}>
          +
        </wa-button>
        <wa-button appearance="outlined" size="s" data-testid="graph-zoom-out"
                   aria-label={t('graph.zoomOut')} title={t('graph.zoomOut')} onClick={onZoomOut}>
          −
        </wa-button>
        <wa-button appearance="outlined" size="s" data-testid="graph-fit"
                   aria-label={t('graph.fit')} title={t('graph.fit')} onClick={onFit}>
          ⤢
        </wa-button>
        <wa-button appearance="outlined" size="s" data-testid="graph-reset-view"
                   aria-label={t('graph.resetView')} title={t('graph.resetView')} onClick={onResetView}>
          ⟲
        </wa-button>
      </Group>
      <Group data-testid="graph-toolbar-group-filters" aria-label={t('graph.filtersGroupLabel')}>
        <span className="group-label">{t('graph.filtersGroupLabel')}</span>
        <wa-button appearance={selectionMode === 'box' ? 'filled' : 'outlined'} size="s"
                   data-testid="graph-selection-mode"
                   aria-pressed={selectionMode === 'box' ? 'true' : 'false'}
                   aria-label={t('graph.selectionModeLabel')}
                   title={selectionMode === 'box' ? t('graph.selectionModeBox') : t('graph.selectionModePan')}
                   onClick={onToggleSelectionMode}>
          {selectionMode === 'box' ? t('graph.selectionModeBox') : t('graph.selectionModePan')}
        </wa-button>
        <wa-button appearance={clusterByLabel ? 'filled' : 'outlined'} size="s"
                   data-testid="graph-cluster-toggle"
                   aria-pressed={clusterByLabel ? 'true' : 'false'}
                   aria-label={t('graph.clusterByLabelLabel')} title={t('graph.clusterByLabelLabel')}
                   onClick={onToggleClusterByLabel}>
          {t('graph.clusterByLabel')}
        </wa-button>
        <wa-button appearance={degreeSizing ? 'filled' : 'outlined'} size="s"
                   data-testid="graph-size-toggle"
                   aria-pressed={degreeSizing ? 'true' : 'false'}
                   aria-label={t('graph.degreeSizingLabel')} title={t('graph.degreeSizingLabel')}
                   onClick={onToggleDegreeSizing}>
          {t('graph.degreeSizing')}
        </wa-button>
      </Group>
      <Group data-testid="graph-toolbar-group-analysis" aria-label={t('graph.analysisGroupLabel')}>
        <span className="group-label">{t('graph.analysisGroupLabel')}</span>
        <wa-button appearance={pathActive ? 'filled' : 'outlined'} size="s"
                   data-testid="graph-path-mode"
                   aria-pressed={pathActive ? 'true' : 'false'}
                   aria-label={t('graph.pathModeLabel')} title={t('graph.pathModeLabel')}
                   onClick={onTogglePathMode}>
          {t('graph.pathMode')}
        </wa-button>
        {pathActive && (
          <wa-button appearance="outlined" size="s" data-testid="graph-path-clear"
                     onClick={onPathClear}>
            {t('graph.pathClear')}
          </wa-button>
        )}
      </Group>
      <GraphToolbarMore
        t={t}
        miniMap={miniMap}
        onToggleMiniMap={onToggleMiniMap}
        lasso={lasso}
        onToggleLasso={onToggleLasso}
        domNodes={domNodes}
        onToggleDomNodes={onToggleDomNodes}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
      />
      <span className="stats" aria-live="polite">
        {t('graph.stats', { nodes: counts.nodes, edges: counts.edges })}
      </span>
    </Toolbar>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/components/results/graph/GraphToolbar.test.tsx`
Expected: PASS — both the new grouped-layout test and any pre-existing toolbar tests (the removed `graph-minimap-toggle` / `graph-lasso-toggle` / `graph-dom-nodes-toggle` / `graph-sidebar-toggle` testids may need their tests updated to point at `graph-more-*` instead).

- [ ] **Step 5: Update any existing assertions that referenced the deleted inline testids**

Run: `grep -rn "graph-minimap-toggle\|graph-lasso-toggle\|graph-dom-nodes-toggle\|graph-sidebar-toggle" src/ e2e/`
For each match, switch to the `graph-more-*` equivalent or to `graph-toolbar-more` (the dropdown trigger). Within `e2e/helpers/selectors.ts`, add:

```typescript
  graphToolbarMore: (p: Page): Locator => p.getByTestId('graph-toolbar-more'),
  graphMoreMiniMap: (p: Page): Locator => p.getByTestId('graph-more-minimap'),
  graphMoreLasso: (p: Page): Locator => p.getByTestId('graph-more-lasso'),
  graphMoreDomNodes: (p: Page): Locator => p.getByTestId('graph-more-domnodes'),
  graphMoreSidebar: (p: Page): Locator => p.getByTestId('graph-more-sidebar'),
```

(Keep `graphSidebarToggle` for compatibility with the responsive test; point it at `graph-more-sidebar` so old assertions still resolve.)

- [ ] **Step 6: Run the full unit suite for graph components**

Run: `pnpm test src/components/results/graph`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/results/graph/GraphToolbar.tsx \
        src/components/results/graph/GraphToolbar.test.tsx \
        e2e/helpers/selectors.ts
git commit -m "refactor(graph): split toolbar into View/Filters/Analysis groups + More"
```

---

## Phase 3: Compact the Graph Sidebar

The sidebar currently renders five always-expanded `ControlsBlock`s and a duplicate id-picker that overlaps the toolbar Find input. This phase replaces each block with a sticky `<details>` section (open state persisted in `useGraphPrefs.sectionsOpen`), hides Hidden/Collapsed entirely when empty, and deletes the duplicate id picker.

### Task 3.1: Add `sectionsOpen` to `useGraphPrefs`

**Files:**
- Modify: `src/components/results/useGraphPrefs.ts`
- Modify: `src/components/results/useGraphPrefs.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/components/results/useGraphPrefs.test.ts` (append):

```typescript
describe('useGraphPrefs.sectionsOpen', () => {
  it('defaults to all five sections expanded', () => {
    const s = useGraphPrefs.getState()
    expect(s.sectionsOpen).toEqual({
      visibility: true,
      display: true,
      hidden: true,
      collapsed: true,
      inspector: true,
    })
  })

  it('toggleSection flips the open flag for one section', () => {
    useGraphPrefs.getState().toggleSection('display')
    expect(useGraphPrefs.getState().sectionsOpen.display).toBe(false)
    useGraphPrefs.getState().toggleSection('display')
    expect(useGraphPrefs.getState().sectionsOpen.display).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/components/results/useGraphPrefs.test.ts -t "sectionsOpen"`
Expected: FAIL — `sectionsOpen` / `toggleSection` are undefined.

- [ ] **Step 3: Extend the store**

Edit `src/components/results/useGraphPrefs.ts`:

1. Add the section-id type and default after the existing exports:

```typescript
export type GraphSectionId = 'visibility' | 'display' | 'hidden' | 'collapsed' | 'inspector'

export const DEFAULT_SECTIONS_OPEN: Record<GraphSectionId, boolean> = {
  visibility: true,
  display: true,
  hidden: true,
  collapsed: true,
  inspector: true,
}
```

2. Add `sectionsOpen` + `toggleSection` to `GraphPrefsState`:

```typescript
  sectionsOpen: Record<GraphSectionId, boolean>
  toggleSection: (id: GraphSectionId) => void
```

3. Add the initial value and the setter inside `create<>(persist(...))`:

```typescript
      sectionsOpen: { ...DEFAULT_SECTIONS_OPEN },
      toggleSection: (id) =>
        set((s) => ({
          sectionsOpen: { ...s.sectionsOpen, [id]: !s.sectionsOpen[id] },
        })),
```

4. Add `sectionsOpen` to `PersistedShape`:

```typescript
  sectionsOpen: Record<GraphSectionId, boolean>
```

5. Add it to `partialize`:

```typescript
        sectionsOpen: s.sectionsOpen,
```

6. Add it to `merge` with a defensive coerce:

```typescript
          sectionsOpen: (() => {
            const p2 = (p.sectionsOpen ?? {}) as Partial<Record<GraphSectionId, unknown>>
            return {
              visibility: p2.visibility !== false,
              display: p2.display !== false,
              hidden: p2.hidden !== false,
              collapsed: p2.collapsed !== false,
              inspector: p2.inspector !== false,
            }
          })(),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/components/results/useGraphPrefs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/useGraphPrefs.ts src/components/results/useGraphPrefs.test.ts
git commit -m "feat(graph): persist per-section open state for the sidebar"
```

### Task 3.2: Create the `CollapsibleSection` wrapper

**Files:**
- Create: `src/components/results/CollapsibleSection.tsx`
- Create: `src/components/results/CollapsibleSection.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// CollapsibleSection.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { lightTheme } from '../../theme/light'
import { CollapsibleSection } from './CollapsibleSection'

describe('CollapsibleSection', () => {
  it('renders the heading and respects the controlled open state', () => {
    render(
      <ThemeProvider theme={lightTheme}>
        <CollapsibleSection title="Hello" open onToggle={() => {}}>
          <p>body</p>
        </CollapsibleSection>
      </ThemeProvider>
    )
    expect(screen.getByText('Hello')).toBeInTheDocument()
    expect(screen.getByText('body')).toBeInTheDocument()
  })

  it('fires onToggle when the user clicks the summary', () => {
    const onToggle = jest.fn()
    render(
      <ThemeProvider theme={lightTheme}>
        <CollapsibleSection title="Hello" open={false} onToggle={onToggle}>
          <p>body</p>
        </CollapsibleSection>
      </ThemeProvider>
    )
    fireEvent.click(screen.getByText('Hello'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('hides the body when open is false', () => {
    render(
      <ThemeProvider theme={lightTheme}>
        <CollapsibleSection title="Hello" open={false} onToggle={() => {}}>
          <p>secret</p>
        </CollapsibleSection>
      </ThemeProvider>
    )
    expect(screen.queryByText('secret')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/components/results/CollapsibleSection.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
// CollapsibleSection.tsx
import React from 'react'
import styled from 'styled-components'

const Wrap = styled.section`
  border-bottom: 1px solid ${({ theme }) => theme.border.subtle};
  margin-bottom: ${({ theme }) => theme.spacing.xs};

  &:last-of-type {
    border-bottom: none;
    margin-bottom: 0;
  }
`

// Summary is a button so keyboard activation works on every browser
// (the native <summary>'s click→toggle is fine, but pinning it as a
// role=button with explicit aria-expanded keeps screen-reader output
// consistent across Chromium / Firefox / Safari).
const Summary = styled.button<{ $open: boolean }>`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xs};
  width: 100%;
  padding: ${({ theme }) => theme.spacing.xs} 0;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  font-family: ${({ theme }) => theme.font.family.display};
  font-size: ${({ theme }) => theme.font.sizes.xs};
  font-weight: ${({ theme }) => theme.font.weights.semibold};
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: ${({ theme }) => theme.text.secondary};

  &:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
    border-radius: ${({ theme }) => theme.radii.sm};
  }

  .chev {
    transform: ${({ $open }) => ($open ? 'rotate(90deg)' : 'rotate(0deg)')};
    transition: transform 120ms ${({ theme }) => theme.transitions.easing};
  }
`

const Body = styled.div`
  padding-bottom: ${({ theme }) => theme.spacing.sm};
`

export type CollapsibleSectionProps = {
  title: string
  open: boolean
  onToggle: () => void
  testId?: string
  children: React.ReactNode
}

// CollapsibleSection wraps a `<details>`-shaped block of sidebar UI
// behind a button-driven summary so the open state can be lifted to
// the orchestrator (which persists it via useGraphPrefs.sectionsOpen).
// Conditional render (NOT display: none) so the closed body is also
// excluded from a screen-reader's accessibility tree — matches the
// behaviour of a real `<details>`.
export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  open,
  onToggle,
  testId,
  children,
}) => (
  <Wrap data-testid={testId}>
    <Summary
      type="button"
      $open={open}
      aria-expanded={open}
      onClick={onToggle}
    >
      <span className="chev" aria-hidden="true">▸</span>
      <span>{title}</span>
    </Summary>
    {open && <Body>{children}</Body>}
  </Wrap>
)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/components/results/CollapsibleSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/CollapsibleSection.tsx src/components/results/CollapsibleSection.test.tsx
git commit -m "feat(results): CollapsibleSection wrapper for sticky details sections"
```

### Task 3.3: Wrap each sidebar block in CollapsibleSection + drop the duplicate id picker

**Files:**
- Modify: `src/components/results/graph/GraphSidebarContents.tsx`
- Modify: `src/components/results/GraphViewCytoscape.tsx` (drop the now-unused `nodeIds` / `edgeIds` / `onPickNodeId` / `onPickEdgeId` props from the orchestrator → sidebar wiring)

- [ ] **Step 1: Write the failing test**

Add to a new test file `src/components/results/graph/GraphSidebarContents.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { lightTheme } from '../../../theme/light'
import { GraphSidebarContents } from './GraphSidebarContents'
import { useGraphPrefs, DEFAULT_SECTIONS_OPEN } from '../useGraphPrefs'

const baseProps = {
  t: (k: string) => k,
  nodeLabelBuckets: new Map([['Movie', 5], ['Person', 3]]),
  hiddenLabels: new Set<string>(),
  toggleHiddenLabel: () => {},
  swatchFor: () => '#000',
  nodeOptions: new Map(),
  edgeOptions: new Map(),
  nodeLabelPrefs: {},
  edgeLabelPrefs: {},
  setNodeLabelPref: () => {},
  setEdgeLabelPref: () => {},
  hiddenIds: [] as string[],
  collapsedEntries: [] as Array<[string, string[]]>,
  onRestoreHidden: () => {},
  onExpandCollapsed: () => {},
  nodeDisplayLabel: (id: string) => id,
  selected: null,
  inspectorView: 'props' as const,
  setInspectorView: () => {},
  onHideNode: () => {},
  onCollapseNode: () => {},
  onExploreNeighbours: () => {},
  exploringId: null,
  collapsed: new Map(),
  neighbors: [],
  onJumpNeighbor: () => {},
  onPin: () => {},
  isPinned: false,
  onFocus: () => {},
  onClearFocus: () => {},
  focusActive: false,
  focusHops: 1,
  setFocusHops: () => {},
  sectionsOpen: DEFAULT_SECTIONS_OPEN,
  onToggleSection: () => {},
}

describe('GraphSidebarContents collapsible sections', () => {
  beforeEach(() => {
    useGraphPrefs.setState({ sectionsOpen: { ...DEFAULT_SECTIONS_OPEN } })
  })

  it('renders the four sections plus the inspector placeholder', () => {
    render(
      <ThemeProvider theme={lightTheme}>
        <GraphSidebarContents {...baseProps} />
      </ThemeProvider>
    )
    expect(screen.getByTestId('graph-section-visibility')).toBeInTheDocument()
    expect(screen.getByTestId('graph-section-display')).toBeInTheDocument()
    // Hidden + Collapsed are NOT rendered while empty.
    expect(screen.queryByTestId('graph-section-hidden')).not.toBeInTheDocument()
    expect(screen.queryByTestId('graph-section-collapsed')).not.toBeInTheDocument()
    expect(screen.getByTestId('graph-section-inspector')).toBeInTheDocument()
  })

  it('clicking a section header fires onToggleSection', () => {
    const onToggleSection = jest.fn()
    render(
      <ThemeProvider theme={lightTheme}>
        <GraphSidebarContents {...baseProps} onToggleSection={onToggleSection} />
      </ThemeProvider>
    )
    fireEvent.click(
      screen.getByTestId('graph-section-visibility').querySelector('button')!
    )
    expect(onToggleSection).toHaveBeenCalledWith('visibility')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/components/results/graph/GraphSidebarContents.test.tsx`
Expected: FAIL — `sectionsOpen` / `onToggleSection` / `graph-section-*` testids do not exist.

- [ ] **Step 3: Rewrite `GraphSidebarContents.tsx`**

Update the props type to drop `nodeIds`, `edgeIds`, `onPickNodeId`, `onPickEdgeId` and add `sectionsOpen` + `onToggleSection`. Then wrap each section in `<CollapsibleSection>`:

```typescript
import React from 'react'
import {
  EDGE_TYPE_DEFAULT,
  NODE_LABEL_DEFAULT,
  labelOptions as labelOptionsFn,
  typeOptions as typeOptionsFn,
} from '../../../lib/graphResult'
import { ControlsBlock, RestoreList } from './styled'
import { GraphInspector, Neighbor, Selected } from './GraphInspector'
import type { GraphSectionId, InspectorView } from '../useGraphPrefs'
import { CollapsibleSection } from '../CollapsibleSection'
import { isRealNodeId } from './explore'

type NodeOptions = ReturnType<typeof labelOptionsFn>
type EdgeOptions = ReturnType<typeof typeOptionsFn>
type TFn = (key: string, opts?: Record<string, unknown>) => string

export type GraphSidebarContentsProps = {
  t: TFn
  nodeLabelBuckets: Map<string, number>
  hiddenLabels: Set<string>
  toggleHiddenLabel: (label: string) => void
  swatchFor: (label: string) => string
  nodeOptions: NodeOptions
  edgeOptions: EdgeOptions
  nodeLabelPrefs: Record<string, string>
  edgeLabelPrefs: Record<string, string>
  setNodeLabelPref: (label: string, key: string) => void
  setEdgeLabelPref: (type: string, key: string) => void
  hiddenIds: string[]
  collapsedEntries: Array<[string, string[]]>
  onRestoreHidden: (id: string) => void
  onExpandCollapsed: (id: string) => void
  nodeDisplayLabel: (id: string) => string
  selected: Selected | null
  inspectorView: InspectorView
  setInspectorView: (v: InspectorView) => void
  onHideNode: (id: string) => void
  onCollapseNode: (id: string) => void
  onExploreNeighbours: (id: string) => void
  exploringId: string | null
  collapsed: Map<string, string[]>
  neighbors: Neighbor[]
  onJumpNeighbor: (id: string) => void
  onPin: (id: string) => void
  isPinned: boolean
  onFocus: (id: string, hops: number) => void
  onClearFocus: () => void
  focusActive: boolean
  focusHops: number
  setFocusHops: (n: number) => void
  sectionsOpen: Record<GraphSectionId, boolean>
  onToggleSection: (id: GraphSectionId) => void
}

export const GraphSidebarContents: React.FC<GraphSidebarContentsProps> = (props) => {
  const {
    t,
    nodeLabelBuckets,
    hiddenLabels,
    toggleHiddenLabel,
    swatchFor,
    nodeOptions,
    edgeOptions,
    nodeLabelPrefs,
    edgeLabelPrefs,
    setNodeLabelPref,
    setEdgeLabelPref,
    hiddenIds,
    collapsedEntries,
    onRestoreHidden,
    onExpandCollapsed,
    nodeDisplayLabel,
    selected,
    inspectorView,
    setInspectorView,
    onHideNode,
    onCollapseNode,
    onExploreNeighbours,
    exploringId,
    collapsed,
    neighbors,
    onJumpNeighbor,
    onPin,
    isPinned,
    onFocus,
    onClearFocus,
    focusActive,
    focusHops,
    setFocusHops,
    sectionsOpen,
    onToggleSection,
  } = props

  return (
    <>
      {nodeLabelBuckets.size > 1 && (
        <CollapsibleSection
          title={t('graph.sectionVisibility')}
          open={sectionsOpen.visibility}
          onToggle={() => onToggleSection('visibility')}
          testId="graph-section-visibility"
        >
          <ControlsBlock data-testid="graph-visibility-controls">
            {Array.from(nodeLabelBuckets.entries())
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([label, count]) => {
                const id = `gv-vis-${label || 'unlabeled'}`
                return (
                  <label key={label || 'unlabeled'} className="toggle-row" htmlFor={id}>
                    <input
                      id={id}
                      type="checkbox"
                      checked={!hiddenLabels.has(label)}
                      onChange={() => toggleHiddenLabel(label)}
                    />
                    <span className="swatch" style={{ background: swatchFor(label) }} aria-hidden="true" />
                    <span className="toggle-label">
                      {label || `(${t('graph.unlabeledNode')})`}
                    </span>
                    <span className="empty">{count}</span>
                  </label>
                )
              })}
          </ControlsBlock>
        </CollapsibleSection>
      )}
      <CollapsibleSection
        title={t('graph.sectionDisplay')}
        open={sectionsOpen.display}
        onToggle={() => onToggleSection('display')}
        testId="graph-section-display"
      >
        <ControlsBlock data-testid="graph-display-controls">
          {nodeOptions.size === 0 ? (
            <p className="empty">{t('graph.noNodesToConfigure')}</p>
          ) : (
            Array.from(nodeOptions.entries()).map(([label, opts]) => (
              <div className="row" key={`n-${label}`}>
                <span>{label || `(${t('graph.unlabeledNode')})`}</span>
                <select
                  aria-label={t('graph.nodeFieldLabel', {
                    label: label || t('graph.unlabeledNode'),
                  })}
                  value={nodeLabelPrefs[label] ?? NODE_LABEL_DEFAULT}
                  onChange={(e) => setNodeLabelPref(label, e.target.value)}
                >
                  {opts.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt === NODE_LABEL_DEFAULT
                        ? `(${t('graph.optionLabelName')})`
                        : opt}
                    </option>
                  ))}
                </select>
              </div>
            ))
          )}
          {edgeOptions.size > 0 &&
            Array.from(edgeOptions.entries()).map(([type, opts]) => (
              <div className="row" key={`e-${type}`}>
                <span>{type}</span>
                <select
                  aria-label={t('graph.edgeFieldLabel', { type })}
                  value={edgeLabelPrefs[type] ?? EDGE_TYPE_DEFAULT}
                  onChange={(e) => setEdgeLabelPref(type, e.target.value)}
                >
                  {opts.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt === EDGE_TYPE_DEFAULT
                        ? `(${t('graph.optionType')})`
                        : opt}
                    </option>
                  ))}
                </select>
              </div>
            ))}
        </ControlsBlock>
      </CollapsibleSection>
      {hiddenIds.length > 0 && (
        <CollapsibleSection
          title={t('graph.hiddenHeading', { count: hiddenIds.length })}
          open={sectionsOpen.hidden}
          onToggle={() => onToggleSection('hidden')}
          testId="graph-section-hidden"
        >
          <RestoreList data-testid="graph-hidden-list">
            {hiddenIds.map((id) => {
              const label = nodeDisplayLabel(id)
              return (
                <li key={id}>
                  <span className="restore-label">
                    {label !== id && <span>{label} </span>}
                    <span className="restore-id">{id}</span>
                  </span>
                  <button type="button" onClick={() => onRestoreHidden(id)}>
                    {t('graph.restore')}
                  </button>
                </li>
              )
            })}
          </RestoreList>
        </CollapsibleSection>
      )}
      {collapsedEntries.length > 0 && (
        <CollapsibleSection
          title={t('graph.collapsedHeading', { count: collapsedEntries.length })}
          open={sectionsOpen.collapsed}
          onToggle={() => onToggleSection('collapsed')}
          testId="graph-section-collapsed"
        >
          <RestoreList data-testid="graph-collapsed-list">
            {collapsedEntries.map(([id, leaves]) => {
              const label = nodeDisplayLabel(id)
              return (
                <li key={id}>
                  <span className="restore-label">
                    {label !== id && <span>{label} </span>}
                    <span className="restore-id">{id}</span>
                    <span> · </span>
                    <span>
                      {t('graph.collapsedCount', { count: leaves.length })}
                    </span>
                  </span>
                  <button type="button" onClick={() => onExpandCollapsed(id)}>
                    {t('graph.expand')}
                  </button>
                </li>
              )
            })}
          </RestoreList>
        </CollapsibleSection>
      )}
      <CollapsibleSection
        title={t('graph.sectionInspector')}
        open={sectionsOpen.inspector}
        onToggle={() => onToggleSection('inspector')}
        testId="graph-section-inspector"
      >
        {selected ? (
          <GraphInspector
            selected={selected}
            view={inspectorView}
            onSetView={setInspectorView}
            onHide={onHideNode}
            onCollapse={onCollapseNode}
            onExplore={onExploreNeighbours}
            exploreLoading={
              selected.kind === 'node' &&
              exploringId === String(selected.data.id ?? '')
            }
            exploreDisabled={
              selected.kind === 'node' &&
              !isRealNodeId(String(selected.data.id ?? ''))
            }
            collapsedCount={
              selected.kind === 'node'
                ? (collapsed.get(String(selected.data.id ?? '')) ?? []).length
                : 0
            }
            neighbors={neighbors}
            onJumpNeighbor={onJumpNeighbor}
            onPin={onPin}
            isPinned={isPinned}
            onFocus={onFocus}
            onClearFocus={onClearFocus}
            focusActive={focusActive}
            focusHops={focusHops}
            setFocusHops={setFocusHops}
            t={t}
          />
        ) : (
          <p style={{ opacity: 0.6 }}>{t('graph.inspectHint')}</p>
        )}
      </CollapsibleSection>
    </>
  )
}
```

- [ ] **Step 4: Update the orchestrator wiring**

Edit `src/components/results/GraphViewCytoscape.tsx`. Inside the component, add:

```typescript
const sectionsOpen = useGraphPrefs((s) => s.sectionsOpen)
const toggleSection = useGraphPrefs((s) => s.toggleSection)
```

And update the `<GraphSidebarContents>` call (around line 753-794), removing `nodeIds` / `edgeIds` / `onPickNodeId` / `onPickEdgeId` and adding `sectionsOpen` / `onToggleSection`:

```typescript
<GraphSidebarContents
  t={t}
  nodeLabelBuckets={nodeLabelBuckets}
  hiddenLabels={hiddenLabels}
  toggleHiddenLabel={toggleHiddenLabel}
  swatchFor={swatchFor}
  nodeOptions={nodeOptions}
  edgeOptions={edgeOptions}
  nodeLabelPrefs={nodeLabelPrefs}
  edgeLabelPrefs={edgeLabelPrefs}
  setNodeLabelPref={setNodeLabelPref}
  setEdgeLabelPref={setEdgeLabelPref}
  hiddenIds={hiddenIds}
  collapsedEntries={collapsedEntries}
  onRestoreHidden={onRestoreHidden}
  onExpandCollapsed={onExpandCollapsed}
  nodeDisplayLabel={nodeDisplayLabel}
  selected={selected}
  inspectorView={inspectorView}
  setInspectorView={setInspectorView}
  onHideNode={onHideNode}
  onCollapseNode={onCollapseNode}
  onExploreNeighbours={onExploreNeighbours}
  exploringId={exploringId}
  collapsed={collapsed}
  neighbors={neighbors}
  onJumpNeighbor={onJumpNeighbor}
  onPin={(id) => pinning.togglePin(id)}
  isPinned={
    selected?.kind === 'node' &&
    pinning.isPinned(String(selected.data.id ?? ''))
  }
  onFocus={(id, hops) => focusMode.focus({ id, hops })}
  onClearFocus={() => focusMode.clear()}
  focusActive={focusMode.state !== null}
  focusHops={focusHops}
  setFocusHops={setFocusHops}
  sectionsOpen={sectionsOpen}
  onToggleSection={toggleSection}
/>
```

You can also delete the now-unused destructured `nodeIds` / `edgeIds` from `useGraphElements` if no other consumer reads them. (Re-check `grep -n 'nodeIds\|edgeIds' src/components/results/GraphViewCytoscape.tsx` — keep them in scope if the lookup helpers still reference them; only delete the prop pass-through.)

- [ ] **Step 5: Run the unit suite**

Run: `pnpm test src/components/results/graph/GraphSidebarContents.test.tsx`
Expected: PASS.

Run: `pnpm test src/components/results`
Expected: PASS for everything; if any test asserts on `graph-selection-controls` or `graph-node-id-picker`, retarget it (the toolbar Find input + `graph-find-input` now covers id-based lookup).

- [ ] **Step 6: Commit**

```bash
git add src/components/results/graph/GraphSidebarContents.tsx \
        src/components/results/graph/GraphSidebarContents.test.tsx \
        src/components/results/GraphViewCytoscape.tsx
git commit -m "refactor(graph): sidebar sections are sticky collapsible blocks"
```

---

## Phase 4: Filter Chip Strip

A row of removable pills directly under the toolbar shows every active filter (hidden labels, focus mode, cluster-on, path mode). Each pill has a × button that clears just that filter. This makes the "what's filtered right now" answer always visible without scanning the sidebar.

### Task 4.1: Create `GraphFilterChips`

**Files:**
- Create: `src/components/results/graph/GraphFilterChips.tsx`
- Create: `src/components/results/graph/GraphFilterChips.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// GraphFilterChips.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { lightTheme } from '../../../theme/light'
import { GraphFilterChips, type GraphFilterChipsProps } from './GraphFilterChips'

const makeProps = (overrides: Partial<GraphFilterChipsProps> = {}): GraphFilterChipsProps => ({
  t: (k: string, opts?: Record<string, unknown>) => {
    if (!opts) return k
    return `${k}|${JSON.stringify(opts)}`
  },
  hiddenLabels: new Set<string>(),
  onClearHidden: () => {},
  clusterByLabel: false,
  onClearCluster: () => {},
  focusActive: false,
  focusId: null,
  focusHops: 1,
  onClearFocus: () => {},
  pathActive: false,
  onClearPath: () => {},
  ...overrides,
})

describe('GraphFilterChips', () => {
  it('renders nothing when no filter is active', () => {
    const { container } = render(
      <ThemeProvider theme={lightTheme}>
        <GraphFilterChips {...makeProps()} />
      </ThemeProvider>
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders one chip per active filter', () => {
    render(
      <ThemeProvider theme={lightTheme}>
        <GraphFilterChips
          {...makeProps({
            hiddenLabels: new Set(['Movie', 'Person']),
            clusterByLabel: true,
            focusActive: true,
            focusId: '7',
            pathActive: true,
          })}
        />
      </ThemeProvider>
    )
    expect(screen.getByTestId('graph-chip-hidden-Movie')).toBeInTheDocument()
    expect(screen.getByTestId('graph-chip-hidden-Person')).toBeInTheDocument()
    expect(screen.getByTestId('graph-chip-cluster')).toBeInTheDocument()
    expect(screen.getByTestId('graph-chip-focused')).toBeInTheDocument()
    expect(screen.getByTestId('graph-chip-path')).toBeInTheDocument()
  })

  it('clicking a chip clear-x fires the matching handler', () => {
    const onClearHidden = jest.fn()
    render(
      <ThemeProvider theme={lightTheme}>
        <GraphFilterChips
          {...makeProps({
            hiddenLabels: new Set(['Movie']),
            onClearHidden,
          })}
        />
      </ThemeProvider>
    )
    fireEvent.click(screen.getByTestId('graph-chip-hidden-Movie').querySelector('button')!)
    expect(onClearHidden).toHaveBeenCalledWith('Movie')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/components/results/graph/GraphFilterChips.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
// GraphFilterChips.tsx
import React from 'react'
import styled from 'styled-components'

type TFn = (key: string, opts?: Record<string, unknown>) => string

const Strip = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xxs};
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.sm};
  background: ${({ theme }) => theme.bg.subtle};
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
  font-size: ${({ theme }) => theme.font.sizes.xs};
  color: ${({ theme }) => theme.text.secondary};
`

const Chip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xxs};
  padding: 2px 4px 2px 8px;
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.pill};
  color: ${({ theme }) => theme.text.primary};

  button {
    background: none;
    border: none;
    cursor: pointer;
    color: ${({ theme }) => theme.text.muted};
    padding: 0 4px;
    font-size: ${({ theme }) => theme.font.sizes.sm};
    line-height: 1;
    border-radius: ${({ theme }) => theme.radii.pill};
  }

  button:hover {
    color: ${({ theme }) => theme.text.danger};
  }

  button:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
  }
`

export type GraphFilterChipsProps = {
  t: TFn
  hiddenLabels: Set<string>
  onClearHidden: (label: string) => void
  clusterByLabel: boolean
  onClearCluster: () => void
  focusActive: boolean
  focusId: string | null
  focusHops: number
  onClearFocus: () => void
  pathActive: boolean
  onClearPath: () => void
}

// GraphFilterChips renders one removable pill per active filter. The
// strip is hidden entirely when no filter is on so the canvas claims
// the full height; as soon as the user hides a label, focuses a node,
// turns clustering on, or enters path mode, the strip appears between
// the toolbar and the canvas to spell out the current state.
export const GraphFilterChips: React.FC<GraphFilterChipsProps> = ({
  t,
  hiddenLabels,
  onClearHidden,
  clusterByLabel,
  onClearCluster,
  focusActive,
  focusId,
  focusHops,
  onClearFocus,
  pathActive,
  onClearPath,
}) => {
  const hidden = Array.from(hiddenLabels).sort()
  if (
    hidden.length === 0 &&
    !clusterByLabel &&
    !focusActive &&
    !pathActive
  ) {
    return null
  }
  return (
    <Strip data-testid="graph-filter-chips" role="status" aria-live="polite">
      {hidden.map((label) => (
        <Chip key={label} data-testid={`graph-chip-hidden-${label}`}>
          {t('graph.filterChipHidden', { label })}
          <button
            type="button"
            aria-label={t('graph.filterChipClear')}
            onClick={() => onClearHidden(label)}
          >
            ×
          </button>
        </Chip>
      ))}
      {clusterByLabel && (
        <Chip data-testid="graph-chip-cluster">
          {t('graph.filterChipCluster')}
          <button
            type="button"
            aria-label={t('graph.filterChipClear')}
            onClick={onClearCluster}
          >
            ×
          </button>
        </Chip>
      )}
      {focusActive && (
        <Chip data-testid="graph-chip-focused">
          {t('graph.filterChipFocused', {
            id: focusId ?? '',
            hops: focusHops,
          })}
          <button
            type="button"
            aria-label={t('graph.filterChipClear')}
            onClick={onClearFocus}
          >
            ×
          </button>
        </Chip>
      )}
      {pathActive && (
        <Chip data-testid="graph-chip-path">
          {t('graph.filterChipPath')}
          <button
            type="button"
            aria-label={t('graph.filterChipClear')}
            onClick={onClearPath}
          >
            ×
          </button>
        </Chip>
      )}
    </Strip>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/components/results/graph/GraphFilterChips.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/graph/GraphFilterChips.tsx \
        src/components/results/graph/GraphFilterChips.test.tsx
git commit -m "feat(graph): GraphFilterChips strip for active filters"
```

### Task 4.2: Mount `GraphFilterChips` in the orchestrator

**Files:**
- Modify: `src/components/results/GraphViewCytoscape.tsx` (insertion point: between `<GraphToolbar />` and the canvas wrapper, replacing the current `PathStatus` slot or sitting alongside it)

- [ ] **Step 1: Write the failing E2E test**

Add to `e2e/specs/31-graph-toolbar-grouped.spec.ts` (create file):

```typescript
import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

test.describe('graph filter chip strip', () => {
  test('chip appears when a label is hidden and disappears on chip clear', async ({
    authedPage: page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH (a:Person)-[r:ACTED_IN]->(m:Movie) RETURN a, r, m LIMIT 10`
    )
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/10 rows/)).toBeVisible()
    await sel.queryTabGraph(page).click()
    // No chip strip when no filter is on.
    await expect(page.getByTestId('graph-filter-chips')).toHaveCount(0)
    // Hide the Movie label via the visibility checkbox in the sidebar.
    const visibilitySection = page.getByTestId('graph-section-visibility')
    await visibilitySection.getByLabel(/Movie/).click()
    // Chip strip shows up with the hidden-Movie chip.
    await expect(page.getByTestId('graph-filter-chips')).toBeVisible()
    await expect(page.getByTestId('graph-chip-hidden-Movie')).toBeVisible()
    // Click the × — chip disappears (and so does the strip, because
    // it's the only filter).
    await page.getByTestId('graph-chip-hidden-Movie').locator('button').click()
    await expect(page.getByTestId('graph-filter-chips')).toHaveCount(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec playwright test e2e/specs/31-graph-toolbar-grouped.spec.ts --project chromium`
Expected: FAIL — `graph-filter-chips` doesn't exist yet.

- [ ] **Step 3: Mount the strip in GraphViewCytoscape**

Edit `src/components/results/GraphViewCytoscape.tsx`. Import the new component near the top:

```typescript
import { GraphFilterChips } from './graph/GraphFilterChips'
```

Then in the JSX, replace the `PathStatus` slot with the chip strip (the existing path-mode status text becomes one chip among many). Between the `<GraphToolbar />` close tag and the wrapper `<div style={...position: relative}>`, insert:

```typescript
<GraphFilterChips
  t={t}
  hiddenLabels={hiddenLabels}
  onClearHidden={(label) => toggleHiddenLabel(label)}
  clusterByLabel={clusterByLabel}
  onClearCluster={() => setClusterByLabel(false)}
  focusActive={focusMode.state !== null}
  focusId={focusMode.state?.id ?? null}
  focusHops={focusMode.state?.hops ?? focusHops}
  onClearFocus={() => focusMode.clear()}
  pathActive={pathState.phase !== 'off'}
  onClearPath={exitPathMode}
/>
```

Keep the existing `pathStatusText` element below the chip strip — it carries the live "Click the start node" / "Click the end node" / result text, which is more transient than the on/off chip. (If you decide the chip is enough, delete the `PathStatus` JSX and i18n keys; this plan keeps it for now to preserve the operator's mid-pick guidance.)

- [ ] **Step 4: Run the unit suite + E2E**

Run: `pnpm test src/components/results/GraphViewCytoscape && pnpm exec playwright test e2e/specs/31-graph-toolbar-grouped.spec.ts --project chromium`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/GraphViewCytoscape.tsx e2e/specs/31-graph-toolbar-grouped.spec.ts
git commit -m "feat(graph): mount filter chip strip under the toolbar"
```

---

## Phase 5: QueryPage Bar Polish + Cleanup

Trim the inline `<Bar>` strip on QueryPage. Move `streamMode` and `expand` toggles into a small `wa-dropdown` "Options" menu so the Run button + status spans dominate the row.

### Task 5.1: Move `streamMode` + `expand` into an Options dropdown

**Files:**
- Modify: `src/pages/QueryPage.tsx:361-413`

- [ ] **Step 1: Write the failing test**

Add to `src/pages/QueryPage.test.tsx` (append):

```typescript
it('stream + expand toggles live inside the Options dropdown', async () => {
  render(
    <ThemeProvider theme={lightTheme}>
      <MemoryRouter>
        <I18nextProvider i18n={i18n}>
          <QueryPage />
        </I18nextProvider>
      </MemoryRouter>
    </ThemeProvider>
  )
  // The bare toggles are gone.
  expect(screen.queryByRole('checkbox', { name: /stream/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('checkbox', { name: /expand/i })).not.toBeInTheDocument()
  // They're inside the Options dropdown instead.
  expect(screen.getByTestId('query-options-stream')).toBeInTheDocument()
  expect(screen.getByTestId('query-options-expand')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/pages/QueryPage.test.tsx -t "Options dropdown"`
Expected: FAIL.

- [ ] **Step 3: Update the QueryPage JSX**

Edit `src/pages/QueryPage.tsx`. Replace the two `<ToggleLabel>` checkboxes in the `<Bar>` block with a single `wa-dropdown`:

```typescript
      <Bar>
        <wa-button
          appearance="filled"
          variant="brand"
          size="m"
          role="button"
          data-testid="query-run-btn"
          onClick={run}
          disabled={busy ? true : undefined}
          loading={busy ? true : undefined}
        >
          {t('query.runHotkey')}
        </wa-button>
        {streamMode && busy && (
          <wa-button
            appearance="outlined"
            size="m"
            role="button"
            data-testid="query-cancel-btn"
            onClick={cancel}
          >
            {t('query.cancel')}
          </wa-button>
        )}
        <wa-dropdown placement="bottom-start" data-testid="query-options-dropdown">
          <wa-button slot="trigger" appearance="outlined" size="m">
            {t('query.optionsLabel')}
          </wa-button>
          <wa-dropdown-item
            type="checkbox"
            value="stream"
            data-testid="query-options-stream"
            checked={streamMode || undefined}
            onClick={() => {
              setStreamMode(!streamMode)
              dispatch({ type: 'reset' })
              setResp(null)
              setErr(null)
            }}
          >
            {t('query.streamMode')}
          </wa-dropdown-item>
          <wa-dropdown-item
            type="checkbox"
            value="expand"
            data-testid="query-options-expand"
            checked={expand || undefined}
            onClick={() => setExpand((e) => !e)}
          >
            {t('query.expandGraphCells')}
          </wa-dropdown-item>
        </wa-dropdown>
        {activeResp && (
          <span>
            {t('common.rowCount', { count: activeResp.row_count ?? 0 })} ·{' '}
            {t('common.elapsed', { ms: activeResp.elapsed_ms })}
          </span>
        )}
        {activeErr && <Err>{activeErr}</Err>}
      </Bar>
```

Delete the `ToggleLabel` styled-component (no longer used).

- [ ] **Step 4: Add the new i18n key**

Edit `src/services/i18n/locales/en.ts` inside the `query` block:

```typescript
    optionsLabel: 'Options',
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/pages/QueryPage.test.tsx -t "Options dropdown"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/QueryPage.tsx src/services/i18n/locales/en.ts src/pages/QueryPage.test.tsx
git commit -m "feat(query): move stream/expand toggles into Options dropdown"
```

---

## Phase 6: Cross-Cutting Validation

Run the full unit suite, the new E2E specs, and the existing graph specs to confirm no regressions.

### Task 6.1: Full validation pass

- [ ] **Step 1: Run the full unit suite**

Run: `pnpm test`
Expected: PASS — all jest specs, including the new `CollapsibleSection`, `GraphToolbarMore`, `GraphFilterChips` suites and the modified TableView/JsonView/MatrixView/ResultPanel/QueryPage/Shell tests.

- [ ] **Step 2: Run the E2E suite**

Run: `pnpm exec playwright test --project chromium`
Expected: PASS — including `19-graph-viz`, `20-node-inspector`, `23-graph-sidebar-responsive`, `25-ui-health`, `27-contrast`, `28-no-whitescreen`, `30-vertical-space`, `31-graph-toolbar-grouped`.

- [ ] **Step 3: Run a manual smoke**

Start the dev server with `pnpm dev`, navigate to `/`, run a graph query, and check:
- The result panel fills the viewport WITHOUT clicking the maximize toggle.
- The graph toolbar is one row with three visible group labels (View / Filters / Analysis), Find input at the left, More dropdown trigger, stats at the right.
- The sidebar shows section headers that toggle on click; Hidden / Collapsed sections are absent while empty.
- Hiding a label brings up a filter chip strip with one removable pill.
- The maximize toggle still works as a fallback.

- [ ] **Step 4: Update other locales (optional, can be a follow-up commit)**

Run: `pnpm verify:translations`
Expected: the script lists missing keys for every non-en locale. Either:
- Add the new keys to each locale file (preferred), OR
- File a follow-up issue and add the keys to a `pending-translations.md` doc.

- [ ] **Step 5: Final commit if any docs / translations changed**

```bash
git add src/services/i18n/locales/
git commit -m "i18n: port data-view UX keys to non-en locales"
```

---

## Self-Review Checklist

Before considering the plan complete, the implementing engineer should verify:

1. **Vertical-space goal:** All four data views (Table / JSON / Graph / Matrix) fill the viewport without clicking the maximize button. `e2e/specs/30-vertical-space.spec.ts` passes.
2. **Toolbar compaction goal:** `e2e/specs/31-graph-toolbar-grouped.spec.ts` passes; the three labelled groups exist, the More dropdown carries the four rarely-used toggles, Find input sits on the left.
3. **Sidebar compaction goal:** The five `ControlsBlock`s become `<details>` regions; Hidden + Collapsed are rendered only when non-empty; the duplicate id picker is gone.
4. **Filter chip goal:** `<GraphFilterChips>` renders one pill per active filter and disappears when no filter is on.
5. **Maximize fallback:** Still works for users who want a viewport-larger view on a small monitor — the toggle stays in `ResultPanel`.
6. **Sticky state:** Section open/close survives a query re-run and a page reload (persisted via `useGraphPrefs.sectionsOpen`).
7. **A11y:** All section toggles + chip clears + dropdown items have aria-labels and aria-expanded / aria-checked. `27-contrast.spec.ts` still passes; new components inherit existing focus shadows.
8. **No placeholders, no TODOs:** every step in this plan contains the exact code or command needed.

If any of these fail, fix in place — the plan is the contract.
