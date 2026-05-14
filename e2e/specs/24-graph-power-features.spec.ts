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
// All assertions are stable data-testid-based; cytoscape's internal
// canvas is reached only through the development-only window.__geode_cy
// hook for the sizing assertion.
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
    // The 'size by edges' toggle defaults on. Read node widths via
    // the debug hook; at least one node should be larger than the
    // legacy flat size (38px) when degree > 0.
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
    // Right-click the canvas at a position likely to land on a node.
    // The seeded query has 25 rows; positions vary by layout but the
    // canvas viewport is large enough that the centre is on a node.
    await page
      .getByTestId('graph-canvas')
      .click({ button: 'right', position: { x: 200, y: 200 } })
    await expect(page.getByTestId('graph-node-menu')).toBeVisible()
    await page.getByTestId('graph-node-menu-expand').click()
    await expect(page.getByTestId('graph-expand-popover')).toBeVisible()
    // Cancel without firing the explore.
    await page.getByTestId('graph-expand-cancel').click()
    await expect(page.getByTestId('graph-expand-popover')).toBeHidden()
  })

  test('pin survives a layout switch', async ({ authedPage: page }) => {
    // Click any node to select it.
    await page
      .getByTestId('graph-canvas')
      .click({ position: { x: 200, y: 200 } })
    // Click Pin in the inspector actions.
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
    // The inspector should now show a node header.
    await expect(page.getByTestId('graph-inspector')).toBeVisible()
  })
})
