import { Page } from '@playwright/test'
import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

// e2e smoke for Phase 1–8 of the graph power-features plan:
//   • degree-based node sizing
//   • long-press / right-click context menu
//   • the editable Expand-neighbours popover
//   • pin/unpin (locked positions survive a layout switch)
//   • find-node search (Enter picks the first match)
//
// Tests interact with the live cytoscape Core via window.__geode_cy
// so click coordinates land on actual nodes regardless of the layout
// algorithm's random initial seed.

type NodePosition = { x: number; y: number; id: string }

// Wait until cytoscape's debounced build has populated __geode_cy with
// a graph that has at least one node, then return the first node's
// page-rendered position. Used so click({position}) lands on a real
// node every time.
async function firstNodePosition(page: Page): Promise<NodePosition> {
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          type CyShape = {
            nodes: () => { length: number }
          }
          // eslint-disable-next-line no-underscore-dangle
          const cy = (window as unknown as { __geode_cy?: CyShape }).__geode_cy
          return cy ? cy.nodes().length : 0
        }),
      { timeout: 10000 }
    )
    .toBeGreaterThan(0)

  // Stop any in-flight cose animation and center the first node in the
  // cytoscape viewport. This ensures the node is in the page-visible
  // canvas region (no scrolling required) and that its rendered position
  // is stable for the duration of the test.
  const pos = await page.evaluate(() => {
    type Node = {
      id: () => string
      renderedPosition: () => { x: number; y: number }
    }
    type CyShape = {
      nodes: () => Node[] & { length: number }
      stop: () => void
      center: (eles?: unknown) => void
      zoom: (lvl: number) => void
    }
    // eslint-disable-next-line no-underscore-dangle
    const cy = (window as unknown as { __geode_cy?: CyShape }).__geode_cy
    if (!cy) return null
    cy.stop()
    // Modest zoom so the node is visibly large but not clipped.
    cy.zoom(1)
    const n = cy.nodes()[0]
    if (!n) return null
    // center(node) pans the viewport so the given node sits at the
    // centre of the cytoscape canvas.
    cy.center(n)
    const p = n.renderedPosition()
    return { x: p.x, y: p.y, id: n.id() }
  })

  // The rendered position is canvas-relative; the canvas element's
  // bounding rect translates to page-relative. Scroll the canvas into
  // view in case the page is taller than the viewport.
  await page.getByTestId('graph-canvas').scrollIntoViewIfNeeded()
  const box = await page.getByTestId('graph-canvas').boundingBox()
  if (!pos || !box) throw new Error('node position unavailable')
  return { x: pos.x + box.x, y: pos.y + box.y, id: pos.id }
}

test.describe('graph power features', () => {
  const GRAPH_QUERY = `USE GRAPH ${seed.graph}; MATCH (p:Person)-[r:ACTED_IN]->(m:Movie) RETURN p, r, m LIMIT 25`

  test.beforeEach(async ({ authedPage: page }) => {
    await page.goto('/')
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(GRAPH_QUERY)
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/(2[0-5]|1\d) rows/)).toBeVisible()
    await sel.queryTabGraph(page).click()
    await expect(page.getByTestId('graph-layout-picker')).toBeVisible()
  })

  test('node sizing reflects degree', async ({ authedPage: page }) => {
    // Wait for the build to settle and at least one node to exist.
    await firstNodePosition(page)
    const sizes = await page.evaluate(() => {
      type Sized = { width: () => number }
      type CyShape = {
        nodes: () => { map: (cb: (n: Sized) => number) => number[] }
      }
      // eslint-disable-next-line no-underscore-dangle
      const cy = (window as unknown as { __geode_cy?: CyShape }).__geode_cy
      if (!cy) return [] as number[]
      return cy.nodes().map((n) => n.width())
    })
    expect(sizes.length).toBeGreaterThan(0)
    const max = Math.max(...sizes)
    expect(max).toBeGreaterThan(38)
  })

  test('right-click opens the cxtmenu radial container', async ({
    authedPage: page,
  }) => {
    const pos = await firstNodePosition(page)
    const canvas = page.getByTestId('graph-canvas')
    const box = await canvas.boundingBox()
    if (!box) throw new Error('canvas not laid out')
    // cxtmenu opens on cytoscape's `cxttap` event. Playwright's
    // canvas.click({button: 'right'}) dispatches a native contextmenu
    // sequence; cytoscape forwards that to cxttap on the node under
    // the cursor. The radial menu creates `.cxtmenu-item` children
    // only when the menu opens; the parent `.cxtmenu` wrapper is
    // attached on first invocation.
    await canvas.click({
      button: 'right',
      position: { x: pos.x - box.x, y: pos.y - box.y },
    })
    await expect(page.locator('.cxtmenu-item').first()).toBeVisible({
      timeout: 5000,
    })
  })

  test('pin survives a layout switch', async ({ authedPage: page }) => {
    const pos = await firstNodePosition(page)
    const canvas = page.getByTestId('graph-canvas')
    const box = await canvas.boundingBox()
    if (!box) throw new Error('canvas not laid out')
    await canvas.click({
      position: { x: pos.x - box.x, y: pos.y - box.y },
    })
    // Inspector should now show; click Pin.
    await expect(page.getByTestId('graph-action-pin')).toBeVisible()
    await page.getByTestId('graph-action-pin').click()
    await expect(page.getByTestId('graph-action-pin')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    // Switch layouts — pinned state must persist on the new layout.
    await page.getByTestId('graph-layout-picker').selectOption('grid')
    await expect(page.getByTestId('graph-action-pin')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  test('find-node input picks a match on Enter', async ({
    authedPage: page,
  }) => {
    // FindNodeInput is now a <wa-input data-testid="graph-find-input">.
    // .fill()/.press() must target the real <input> inside its shadow
    // DOM — Playwright pierces shadow roots when chaining a locator.
    const input = page.getByTestId('graph-find-input').locator('input')
    await input.fill('Movie')
    await expect(page.getByTestId('graph-find-count')).toContainText(/\d/)
    await input.press('Enter')
    await expect(page.getByTestId('graph-inspector')).toBeVisible()
  })

  test('lasso toggle enables lasso selection mode', async ({
    authedPage: page,
  }) => {
    await page.getByTestId('graph-more-lasso').click()
    await expect(page.getByTestId('graph-more-lasso')).toHaveAttribute(
      'aria-checked',
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
    await expect(page.getByTestId(`graph-badge-pin-${pos.id}`)).toBeVisible()
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
    const toggle = page.getByTestId('graph-more-domnodes')
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
  })

  test('mini-map toggle renders ONE panel inside the canvas wrapper (no body leak)', async ({
    authedPage: page,
  }) => {
    // Default off → toggle on.
    await page.getByTestId('graph-more-minimap').click()
    await expect(page.getByTestId('graph-more-minimap')).toHaveAttribute(
      'aria-checked',
      'true'
    )
    // Exactly one #graph-minimap-panel exists.
    await expect(page.locator('#graph-minimap-panel')).toHaveCount(1)
    // It is anchored to the canvas wrapper — i.e. the panel and the
    // canvas share the same `position: relative` parent. The body-leak
    // failure mode would have the navigator panel pinned to document.body
    // via the library's default `position: fixed` fallback.
    const isAnchoredToCanvasWrapper = await page.evaluate(() => {
      const panel = document.getElementById('graph-minimap-panel')
      const canvas = document.querySelector('[data-testid="graph-canvas"]')
      if (!panel || !canvas) return false
      const wrap = panel.parentElement
      if (!wrap || wrap === document.body) return false
      return wrap.contains(canvas)
    })
    expect(isAnchoredToCanvasWrapper).toBe(true)
    // No stray .cytoscape-navigator pinned to body (the bug).
    const strayCount = await page.locator('body > .cytoscape-navigator').count()
    expect(strayCount).toBe(0)
  })

  test('wa-button renders with non-zero size (foundation CSS loaded)', async ({
    authedPage: page,
  }) => {
    // The toolbar contains multiple <wa-button> instances. If the
    // foundation CSS (dist/styles/webawesome.css) isn't imported,
    // these render as unstyled custom elements with collapsed
    // bounding boxes. Pin at least one button has a positive box.
    const button = page.getByTestId('graph-zoom-in')
    await expect(button).toBeVisible()
    const box = await button.boundingBox()
    expect(box).not.toBeNull()
    expect(box?.width ?? 0).toBeGreaterThan(8)
    expect(box?.height ?? 0).toBeGreaterThan(8)
  })

  test('typing in the editor after run does not reset the graph', async ({
    authedPage: page,
  }) => {
    // beforeEach already ran a query and switched to the Graph tab. The
    // mini-map toggle is sticky; turn it on so we can observe a stable
    // DOM marker.
    const pos = await firstNodePosition(page)
    // Capture cy.nodes().length BEFORE typing.
    const beforeCount = await page.evaluate(() => {
      type CyShape = { nodes: () => { length: number } }
      // eslint-disable-next-line no-underscore-dangle
      const cy = (window as unknown as { __geode_cy?: CyShape }).__geode_cy
      return cy ? cy.nodes().length : 0
    })
    expect(beforeCount).toBeGreaterThan(0)

    // Type a single character into the Monaco editor (it's already
    // focused after the beforeEach Run, but type anyway to be explicit).
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' -- extra text')

    // Wait for any potential debounced rebuild to settle.
    await page.waitForTimeout(400)

    // cy.nodes() should be UNCHANGED — the graph wasn't torn down.
    const afterCount = await page.evaluate(() => {
      type CyShape = { nodes: () => { length: number } }
      // eslint-disable-next-line no-underscore-dangle
      const cy = (window as unknown as { __geode_cy?: CyShape }).__geode_cy
      return cy ? cy.nodes().length : 0
    })
    expect(afterCount).toBe(beforeCount)

    // The originally-found node id is still present in the graph.
    const stillExists = await page.evaluate((id: string) => {
      type CyShape = {
        getElementById: (id: string) => { empty: () => boolean }
      }
      // eslint-disable-next-line no-underscore-dangle
      const cy = (window as unknown as { __geode_cy?: CyShape }).__geode_cy
      return cy ? !cy.getElementById(id).empty() : false
    }, pos.id)
    expect(stillExists).toBe(true)
  })
})
