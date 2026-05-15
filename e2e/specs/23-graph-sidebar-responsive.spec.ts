import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

// Regression: the graph view is a `1fr 280px` CSS grid (canvas +
// property-inspector sidebar). Collapsing the sidebar resized the
// Cytoscape <canvas> to the full width; on re-expand the `1fr` track
// could not shrink back below the <canvas>'s intrinsic width, so the
// 280px sidebar (the property inspector) was pushed off the right
// edge and the page grew a horizontal scrollbar. The fix gives the
// `1fr` grid item `min-width: 0`. This test reproduces the cycle and
// asserts nothing escapes the viewport.

const VIEWPORT = { width: 1024, height: 768 }

function pageOverflows(
  page: import('@playwright/test').Page
): Promise<boolean> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1
  )
}

test.describe('graph view sidebar responsiveness', () => {
  test('inspector stays on screen after collapsing and re-expanding the sidebar', async ({
    authedPage: page,
  }) => {
    await page.setViewportSize(VIEWPORT)
    await page.goto('/')
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH (a:Person)-[r:ACTED_IN]->(m:Movie) RETURN a, r, m LIMIT 10`
    )
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/(10|9) rows/)).toBeVisible()

    await sel.queryTabGraph(page).click()
    await expect(sel.graphCanvas(page).first()).toBeVisible()
    await expect(sel.graphSidebar(page)).toBeVisible()
    await expect.poll(() => pageOverflows(page)).toBe(false)

    // Collapse — the sidebar is unmounted, canvas claims the full width.
    await sel.graphSidebarToggle(page).click()
    await expect(sel.graphSidebarToggle(page)).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(sel.graphSidebar(page)).toHaveCount(0)

    // Re-expand — the sidebar comes back and must fit beside the canvas.
    await sel.graphSidebarToggle(page).click()
    await expect(sel.graphSidebar(page)).toBeVisible()
    await expect(sel.graphDisplayControls(page)).toBeVisible()

    // The page must not have grown a horizontal scrollbar...
    await expect.poll(() => pageOverflows(page)).toBe(false)
    // ...and the sidebar's right edge must be within the viewport.
    const box = await sel.graphSidebar(page).boundingBox()
    expect(box).not.toBeNull()
    if (box) {
      expect(box.x + box.width).toBeLessThanOrEqual(VIEWPORT.width + 1)
    }
  })
})
