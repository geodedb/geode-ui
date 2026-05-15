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
