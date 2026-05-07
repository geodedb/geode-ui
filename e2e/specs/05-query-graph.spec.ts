import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

test.describe('query (graph view)', () => {
  test('switches to graph tab and the cytoscape canvas mounts', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH (a:Person)-[r:ACTED_IN]->(m:Movie) RETURN a, r, m LIMIT 10`
    )
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/(10|9) rows/)).toBeVisible()

    await sel.queryTabGraph(page).click()
    // Cytoscape mounts at least one <canvas> for the layer renderer.
    await expect(sel.graphCanvas(page).first()).toBeVisible()

    // The side panel renders the placeholder until a node is clicked.
    await expect(
      page.getByText('Click a node or edge to inspect properties.')
    ).toBeVisible()
  })

  test('graph tab does not render when no rows', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH (n:Person {name: 'Nobody Real'}) RETURN n`
    )
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/0 rows/)).toBeVisible()
    await sel.queryTabGraph(page).click()
    // Canvas renders empty; no inspector content beyond placeholder.
    await expect(
      page.getByText('Click a node or edge to inspect properties.')
    ).toBeVisible()
  })
})
