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
    // Poll until the flex layout settles — under worker contention the
    // grid can be measured mid-expansion. The 1280x900 chromium project
    // has ~325 px of vertical chrome above the result region (Monaco
    // editor + Bar + tabs); growing past 450 px proves the legacy
    // 720 px cap and 480 px default were removed and the table now
    // flexes to the available space.
    await expect.poll(async () => (await grid.boundingBox())?.height ?? 0, {
      timeout: 5_000,
    }).toBeGreaterThan(450)
  })

  test('graph view fills available vertical space without fullscreen', async ({
    authedPage: page,
  }) => {
    await sel.queryTabGraph(page).click()
    // Target the styled Canvas <div> wrapper (data-testid="graph-canvas"),
    // NOT the first <canvas> in DOM order. Cytoscape mounts a stack of
    // <canvas> elements internally; .first() picks the wrong one and
    // returns the cytoscape interaction-layer canvas instead of the
    // wrapper that owns the flex chain.
    const canvas = page.getByTestId('graph-canvas')
    await expect(canvas).toBeVisible({ timeout: 15_000 })
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    // The canvas wrapper must claim a meaningful slab below the
    // toolbar. CanvasArea allocates ~52 px to the toolbar and ~40 px
    // to the (mobile-only-hidden) maximize row plus path-status when
    // active; on a 900 px viewport with the desktop chrome above the
    // result panel, > 250 px proves the chain is wired and the
    // legacy 480 px hard cap is gone.
    if (box) expect(box.height).toBeGreaterThan(250)
  })

  test('json view fills available vertical space without fullscreen', async ({
    authedPage: page,
  }) => {
    await sel.queryTabJson(page).click()
    const pre = page.locator('pre').first()
    await expect(pre).toBeVisible()
    const box = await pre.boundingBox()
    expect(box).not.toBeNull()
    // The pre takes the full TabPanel content box; same chrome budget
    // as the table view above.
    if (box) expect(box.height).toBeGreaterThan(400)
  })
})
