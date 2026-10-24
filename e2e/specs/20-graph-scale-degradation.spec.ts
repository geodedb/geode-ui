import { test, expect } from '@playwright/test'

test.describe.configure({ mode: 'serial', retries: 0 })

test('scale degradation: large tier disables cxtmenu / tooltip / badges / domNodes', async ({
  page,
}) => {
  // The 6,000-node CI trace spent 100s on a browser evaluation and
  // another 73s on pointer actions; all degradation assertions succeeded.
  // Keep the full large-tier fixture and allow five bounded minutes on CI.
  test.setTimeout(process.env.CI ? 300_000 : 60_000)
  await page.goto('/dev/graph-bench?n=6000&renderer=cytoscape')
  // Wait for the actual tier write. Building the 6,000-node graph can
  // outlast a fixed five-second sleep on a shared CI runner.
  await page.waitForFunction(
    () => performance.getEntriesByName('graph:tier:large', 'mark').length > 0,
    undefined,
    { timeout: process.env.CI ? 120_000 : 30_000 }
  )

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
