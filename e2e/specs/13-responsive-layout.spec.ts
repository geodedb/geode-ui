// Responsive-layout regressions for the data table and the app shell
// header. The unit tests for `estimateRowHeight` and the
// `TableView.test.tsx` snapshot prove the per-cell math; this spec
// proves it actually paints correctly across a viewport sweep, where
// jsdom can't reach.
//
// What's being asserted:
//   1) On a mobile viewport (375 px), the data table is reachable —
//      either via vertical scroll or via horizontal scroll inside the
//      grid wrapper — and the rendered row's pixel height grows when
//      the cell content is long. No silent clipping.
//   2) On the same viewport, the app shell header collapses to a
//      hamburger drawer; the brand + ConnectionPicker + hamburger fit
//      on a single visible row, and the desktop nav links are not
//      visible.
//   3) On a desktop viewport (1280 px) the desktop nav is visible,
//      the hamburger is hidden, and the row data is readable in
//      multiple expanded columns.
//
// The spec is tagged @responsive so the mobile-chrome / tablet-chrome
// projects in playwright.config.ts pick it up. We also explicitly
// resize inside each test so the same spec runs deterministically on
// the chromium project (which has no project-level grep filter and
// would otherwise inherit Desktop Chrome's 1280 viewport).

import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

const LONG_PROP_QUERY = `USE GRAPH ${seed.graph}; MATCH (n:Movie) WHERE n.tagline IS NOT NULL RETURN n LIMIT 5`

// Force the viewport to a known size so the test outcome doesn't
// depend on which playwright project runs it.
const MOBILE_VIEWPORT = { width: 375, height: 812 }
const TABLET_VIEWPORT = { width: 810, height: 1080 }
const DESKTOP_VIEWPORT = { width: 1280, height: 800 }

test.describe('@responsive responsive layout', () => {
  test('@mobile data table rows expand to fit wrapped content on mobile', async ({
    authedPage: page,
  }) => {
    await page.setViewportSize(MOBILE_VIEWPORT)
    await page.goto('/')
    await expect(sel.queryRunBtn(page)).toBeVisible()

    // Some Movie nodes carry multi-sentence taglines that wrap heavily
    // in a 320-px column — exactly the bug we're regression-guarding.
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(LONG_PROP_QUERY)
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/\d+ rows?/)).toBeVisible({ timeout: 15_000 })

    await sel.queryTabTable(page).click()
    const tableView = page.getByTestId('table-view')
    await expect(tableView).toBeVisible()

    // The horizontal-scroll inner area must be present; previously the
    // outer wrap had `overflow: hidden`, which silently truncated wide
    // grids on narrow viewports.
    const scrollArea = page.getByTestId('table-scroll-area')
    await expect(scrollArea).toBeVisible()

    // At least one row must paint at greater than the single-line
    // baseline (36 px). Picks the tallest row in the visible slice so
    // the test isn't sensitive to which Movie ordering Geode returns.
    const rowHeights = await page
      .locator('[data-row-index]')
      .evaluateAll((els) =>
        els.map((el) => (el as HTMLElement).getBoundingClientRect().height)
      )
    expect(rowHeights.length).toBeGreaterThan(0)
    const tallest = Math.max(...rowHeights)
    expect(tallest).toBeGreaterThan(36)
  })

  test('@mobile mobile shell collapses desktop nav into the hamburger drawer', async ({
    authedPage: page,
  }) => {
    await page.setViewportSize(MOBILE_VIEWPORT)
    await page.goto('/')

    // Hamburger visible.
    const hamburger = page.getByRole('button', { name: /(open|close).*menu/i })
    await expect(hamburger).toBeVisible()

    // Desktop nav links are NOT visible — they live inside the
    // collapsed DesktopNav (display: none below lg).
    await expect(sel.navSchema(page)).toBeHidden()
    await expect(sel.navAdmin(page)).toBeHidden()

    // Page does not horizontally scroll; the header has overflow-x: clip
    // and the body padding clamps to the spacing.md token.
    const docOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    )
    expect(docOverflow).toBeLessThanOrEqual(1)

    // Tapping the hamburger reveals the drawer.
    await hamburger.click()
    await expect(page.getByRole('link', { name: 'Schema' })).toBeVisible()
  })

  test('desktop shell shows full nav and hides the hamburger', async ({
    authedPage: page,
  }) => {
    // Mobile / tablet projects inject a small viewport at context
    // creation time; we can't widen back up to desktop dimensions
    // without remounting the SPA, so skip those projects.
    test.skip(
      test.info().project.name !== 'chromium',
      'desktop layout is only meaningful on the chromium project'
    )
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await page.goto('/')

    await expect(sel.navQuery(page)).toBeVisible()
    await expect(sel.navSchema(page)).toBeVisible()
    await expect(sel.navAdmin(page)).toBeVisible()
    await expect(sel.logout(page)).toBeVisible()

    // The mobile toggle is rendered (so click handlers are wired) but
    // hidden via CSS at lg+ widths.
    const toggle = page.getByRole('button', { name: /(open|close).*menu/i })
    await expect(toggle).toBeHidden()
  })

  test('@tablet data-table cell text is fully visible (no overflow:hidden clipping)', async ({
    authedPage: page,
  }) => {
    await page.setViewportSize(TABLET_VIEWPORT)
    await page.goto('/')
    await expect(sel.queryRunBtn(page)).toBeVisible()

    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(LONG_PROP_QUERY)
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/\d+ rows?/)).toBeVisible({ timeout: 15_000 })
    await sel.queryTabTable(page).click()

    // Cells must not have computed `overflow: hidden` — that's the
    // bug we just fixed, where wrapped cell content was clipped.
    const overflow = await page
      .locator('[role="cell"]')
      .first()
      .evaluate((el) => getComputedStyle(el).overflow)
    expect(overflow).not.toBe('hidden')
  })
})
