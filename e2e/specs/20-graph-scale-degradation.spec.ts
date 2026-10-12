import { test, expect } from '@playwright/test'

test.describe.configure({ mode: 'serial', retries: 0 })

test('scale degradation: large tier disables cxtmenu / tooltip / badges / domNodes', async ({
  page,
}) => {
  // 3x on CI's contended shared VM, as in playwright.config.ts.
  test.setTimeout(process.env.CI ? 180_000 : 60_000)
  await page.goto('/dev/graph-bench?n=6000&renderer=cytoscape')
  // Warmup for layout to complete + tier write to land.
  await page.waitForTimeout(5_000)

  // Tier write should have produced a graph:tier:large mark.
  const hadLargeTier = await page.evaluate(() => {
    const entries = performance.getEntriesByName('graph:tier:large', 'mark')
    return entries.length > 0
  })
  expect(hadLargeTier).toBe(true)

  // cxtmenu trigger: a right-click on a node in "large" tier should NOT
  // open the context menu (its consumer is mounted but tier-gated off).
  // Probe via the DOM: cxtmenu root element should not exist.
  await page
    .locator('[data-testid="graph-bench-page"] canvas')
    .first()
    .click({ button: 'right' })
  const cxtmenu = page.locator('.cy-cxtmenu')
  await expect(cxtmenu).toHaveCount(0)

  // Tooltip: hover a node area — tooltip body should not appear.
  await page.locator('[data-testid="graph-bench-page"] canvas').first().hover()
  await expect(page.locator('[data-testid="graph-tooltip"]')).toHaveCount(0)

  // Badges: badge root has data-testid="graph-badges-root"; should not be in DOM.
  await expect(page.locator('[data-testid="graph-badges-root"]')).toHaveCount(0)

  // domNodes: asserting no DOM-node card hosts exist on top of the canvas.
  await expect(page.locator('.gv-custom-node-host')).toHaveCount(0)
})
