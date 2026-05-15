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
    // Hide the Movie label via the Visibility section's checkbox.
    const visibilitySection = page.getByTestId('graph-section-visibility')
    await visibilitySection.getByLabel(/Movie/).click()
    // Chip strip appears with the hidden-Movie chip.
    await expect(page.getByTestId('graph-filter-chips')).toBeVisible()
    await expect(page.getByTestId('graph-chip-hidden-Movie')).toBeVisible()
    // Click the ×. The chip disappears (and so does the strip, since
    // it was the only active filter).
    await page.getByTestId('graph-chip-hidden-Movie').locator('button').click()
    await expect(page.getByTestId('graph-filter-chips')).toHaveCount(0)
  })
})
