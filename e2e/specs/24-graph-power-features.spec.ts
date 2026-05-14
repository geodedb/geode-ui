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

  test('right-click opens context menu, Expand fires popover', async ({
    authedPage: page,
  }) => {
    const pos = await firstNodePosition(page)
    // Wait for the useNodeContextMenu effect to register its cxttap
    // listener; the hook polls for cy because the rebuild is debounced.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            type Listener = { type: string; qualifier: unknown }
            type CyShape = {
              emitter: () => { listeners: Listener[] }
            }
            // eslint-disable-next-line no-underscore-dangle
            const cy = (window as unknown as { __geode_cy?: CyShape })
              .__geode_cy
            if (!cy || !cy.emitter) return 0
            return cy.emitter().listeners.filter((l) => l.type === 'cxttap')
              .length
          }),
        { timeout: 5000 }
      )
      .toBeGreaterThan(0)
    // The Cytoscape canvas needs the right-click to land on the node;
    // we use the explicit page-coordinates returned by firstNodePosition.
    const canvas = page.getByTestId('graph-canvas')
    const box = await canvas.boundingBox()
    if (!box) throw new Error('canvas not laid out')
    await canvas.click({
      button: 'right',
      position: { x: pos.x - box.x, y: pos.y - box.y },
    })
    await expect(page.getByTestId('graph-node-menu')).toBeVisible()
    await page.getByTestId('graph-node-menu-expand').click()
    await expect(page.getByTestId('graph-expand-popover')).toBeVisible()
    await page.getByTestId('graph-expand-cancel').click()
    await expect(page.getByTestId('graph-expand-popover')).toBeHidden()
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
    await page.getByTestId('graph-find-input').fill('Movie')
    await expect(page.getByTestId('graph-find-count')).toContainText(/\d/)
    await page.getByTestId('graph-find-input').press('Enter')
    await expect(page.getByTestId('graph-inspector')).toBeVisible()
  })
})
