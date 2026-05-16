// Mobile-viewport coverage for the data-view UX overhaul (Phase 1-5).
//
// The overhaul reworked the QueryPage → ResultPanel → {Table/JSON/Graph/Matrix}
// flex chain so the result panel fills the viewport without clicking
// the maximize toggle, split the graph toolbar into three labelled
// groups + a More dropdown, collapsed the sidebar blocks behind sticky
// CollapsibleSection wrappers, added a GraphFilterChips strip, and
// moved the QueryPage stream/expand toggles into an Options dropdown.
//
// At desktop widths the new layout is well-covered by 30-vertical-space
// (1280×900) and 31-graph-toolbar-grouped (1280×900). This spec walks
// the same surface at MOBILE (Pixel 7, ~412×915 — overridden to 375×812
// for the iPhone-class viewport) and asserts:
//
//   1) The QueryPage result region fills the visible viewport between
//      the editor row and the bottom edge.
//   2) The graph toolbar wraps cleanly: each group is visible (after
//      horizontal scroll if needed); the More dropdown is reachable
//      and opens without overflowing the viewport.
//   3) The CollapsibleSection wrappers respond to taps: clicking the
//      summary toggles aria-expanded; the closed body is unmounted.
//   4) The filter chip strip appears under the toolbar when a label
//      is hidden; the × clears it.
//   5) The QueryPage Options dropdown opens on tap and the stream
//      checkbox flips state.
//   6) The page never grows a horizontal scrollbar on the document
//      element (the responsive 1-column sidebar stack should keep all
//      content within viewport width).
//
// Tagged @mobile so the mobile-chrome project picks it up. The
// explicit setViewportSize lets the same spec run on the chromium
// project for a determinism check.

import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

const MOBILE_VIEWPORT = { width: 375, height: 812 }
const SEED_QUERY = `USE GRAPH ${seed.graph}; MATCH (a:Person)-[r:ACTED_IN]->(m:Movie) RETURN a, r, m LIMIT 10`

async function runSeedQuery(
  page: import('@playwright/test').Page
): Promise<void> {
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type(SEED_QUERY)
  await sel.queryRunBtn(page).click()
  await expect(page.getByText(/10 rows?/)).toBeVisible({ timeout: 15_000 })
}

async function pageOverflows(
  page: import('@playwright/test').Page
): Promise<number> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  )
}

test.describe('@mobile @responsive data-view UX on mobile viewports', () => {
  test.beforeEach(async ({ authedPage: page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT)
    await page.goto('/')
    await expect(sel.queryRunBtn(page)).toBeVisible()
  })

  test('result panel fills the viewport on mobile without fullscreen', async ({
    authedPage: page,
  }) => {
    await runSeedQuery(page)
    const grid = page.getByTestId('table-view')
    await expect(grid).toBeVisible()
    const box = await grid.boundingBox()
    expect(box).not.toBeNull()
    if (box) {
      // The grid must claim a meaningful slice of the visible viewport
      // height. At 812 px tall the editor + Bar consume ~300 px of
      // chrome above the result region; we conservatively assert > 30%.
      expect(box.height).toBeGreaterThan(MOBILE_VIEWPORT.height * 0.3)
    }
    // The page must not have grown a horizontal scrollbar.
    expect(await pageOverflows(page)).toBeLessThanOrEqual(1)
  })

  test('graph toolbar groups render and the More dropdown is tappable', async ({
    authedPage: page,
  }) => {
    await runSeedQuery(page)
    await sel.queryTabGraph(page).click()
    await expect(page.getByTestId('graph-toolbar')).toBeVisible()
    // The three groups exist (may scroll horizontally inside the toolbar).
    await expect(page.getByTestId('graph-toolbar-group-view')).toBeAttached()
    await expect(page.getByTestId('graph-toolbar-group-filters')).toBeAttached()
    await expect(
      page.getByTestId('graph-toolbar-group-analysis')
    ).toBeAttached()
    // The More dropdown trigger is reachable. The wa-dropdown host
    // itself has no visible bounding box (it's display:inline with no
    // intrinsic size); the visible click target is the slot=trigger
    // wa-button child carrying graph-toolbar-more-trigger.
    const moreTrigger = page.getByTestId('graph-toolbar-more-trigger')
    await expect(moreTrigger).toBeAttached()
    await moreTrigger.scrollIntoViewIfNeeded()
    await moreTrigger.click()
    // The minimap item is now visible inside the open dropdown.
    await expect(page.getByTestId('graph-more-minimap')).toBeVisible()
    // Document scrollbar still hasn't appeared.
    expect(await pageOverflows(page)).toBeLessThanOrEqual(1)
  })

  test('sidebar CollapsibleSection toggles open/close on tap', async ({
    authedPage: page,
  }) => {
    await runSeedQuery(page)
    await sel.queryTabGraph(page).click()
    // Below the md breakpoint the sidebar stacks BELOW the canvas with
    // max-height: 320px. We expect it to be reachable via vertical
    // scroll on the page or inside its own scroll container.
    const section = page.getByTestId('graph-section-display')
    await expect(section).toBeAttached()
    await section.scrollIntoViewIfNeeded()
    const summary = section.locator('button').first()
    await expect(summary).toBeVisible()
    // Default state is open.
    await expect(summary).toHaveAttribute('aria-expanded', 'true')
    await summary.click()
    await expect(summary).toHaveAttribute('aria-expanded', 'false')
    await summary.click()
    await expect(summary).toHaveAttribute('aria-expanded', 'true')
  })

  test('hiding a label surfaces a removable filter chip on mobile', async ({
    authedPage: page,
  }) => {
    await runSeedQuery(page)
    await sel.queryTabGraph(page).click()
    // No chip strip when no filter is active.
    await expect(page.getByTestId('graph-filter-chips')).toHaveCount(0)
    // Make the Visibility section reachable and toggle Movie off.
    const visibility = page.getByTestId('graph-section-visibility')
    await visibility.scrollIntoViewIfNeeded()
    await visibility.getByLabel(/Movie/).click()
    // Chip strip appears with the hidden-Movie pill.
    const chip = page.getByTestId('graph-chip-hidden-Movie')
    await expect(chip).toBeVisible()
    // Click the × — chip + strip disappear.
    await chip.locator('button').click()
    await expect(page.getByTestId('graph-filter-chips')).toHaveCount(0)
  })

  test('QueryPage Options dropdown toggles stream mode on mobile', async ({
    authedPage: page,
  }) => {
    const trigger = page.getByTestId('query-options-dropdown')
    await expect(trigger).toBeVisible()
    await trigger.click()
    const streamItem = page.getByTestId('query-options-stream')
    await expect(streamItem).toBeVisible()
    await expect(streamItem).toHaveAttribute('aria-checked', 'false')
    await streamItem.click()
    await expect(streamItem).toHaveAttribute('aria-checked', 'true')
    // The page should still fit horizontally.
    expect(await pageOverflows(page)).toBeLessThanOrEqual(1)
  })

  test('all four result tabs are tappable and do not overflow horizontally', async ({
    authedPage: page,
  }) => {
    await runSeedQuery(page)
    const tabs = [
      sel.queryTabTable(page),
      sel.queryTabJson(page),
      sel.queryTabGraph(page),
      sel.queryTabMatrix(page),
    ]
    // Click each tab sequentially and assert no horizontal overflow.
    // Uses reduce so awaits are sequential without a for…of loop.
    await tabs.reduce(async (chain, tab) => {
      await chain
      await tab.click()
      expect(await pageOverflows(page)).toBeLessThanOrEqual(1)
    }, Promise.resolve())
  })

  test('graph sidebar stacks below the canvas at mobile widths', async ({
    authedPage: page,
  }) => {
    await runSeedQuery(page)
    await sel.queryTabGraph(page).click()
    const canvas = sel.graphCanvas(page).first()
    const sidebar = sel.graphSidebar(page)
    await expect(canvas).toBeVisible()
    // Sidebar might be absent if collapsed by user via the More menu —
    // for this default-open path it should be attached and stack
    // BELOW the canvas (y-coord of sidebar > y-coord of canvas + height).
    await expect(sidebar).toBeAttached()
    const canvasBox = await canvas.boundingBox()
    const sidebarBox = await sidebar.boundingBox()
    expect(canvasBox).not.toBeNull()
    expect(sidebarBox).not.toBeNull()
    if (canvasBox && sidebarBox) {
      expect(sidebarBox.y).toBeGreaterThanOrEqual(
        canvasBox.y + canvasBox.height - 4
      )
    }
  })

  test('graph canvas has a usable minimum height on mobile (not collapsed to zero)', async ({
    authedPage: page,
  }) => {
    await runSeedQuery(page)
    await sel.queryTabGraph(page).click()
    // Let cytoscape's layout pass settle.
    await page.waitForTimeout(500)
    // Cytoscape mounts a stack of <canvas> elements that may render
    // off-screen during initial sizing; the relevant container is the
    // styled Canvas <div> carrying data-testid="graph-canvas" which
    // owns the cytoscape mount. Assert THAT element's bounding box,
    // not the first <canvas> in DOM order.
    const canvas = page.getByTestId('graph-canvas')
    await expect(canvas).toBeVisible()
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    if (box) expect(box.height).toBeGreaterThan(200)
  })

  test('Monaco editor fits inside the viewport (does not overflow)', async ({
    authedPage: page,
  }) => {
    // The Monaco container expands to its parent's width by default;
    // any positive padding/margin on an ancestor should keep it within
    // the viewport so the user can read their query without horizontal
    // scrolling.
    const editor = page.locator('.monaco-editor').first()
    await expect(editor).toBeVisible()
    const box = await editor.boundingBox()
    expect(box).not.toBeNull()
    if (box) {
      expect(box.x + box.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1)
    }
    expect(await pageOverflows(page)).toBeLessThanOrEqual(1)
  })

  test('graph toolbar More dropdown is reachable within the visible toolbar', async ({
    authedPage: page,
  }) => {
    await runSeedQuery(page)
    await sel.queryTabGraph(page).click()
    const toolbar = page.getByTestId('graph-toolbar')
    const trigger = page.getByTestId('graph-toolbar-more-trigger')
    await expect(toolbar).toBeVisible()
    await expect(trigger).toBeAttached()
    // The trigger should be reachable by scrolling the toolbar itself
    // (overflow-x: auto). If the trigger lies entirely off-screen of
    // the document AND the user has no obvious affordance to scroll
    // the toolbar (no visible scrollbar on touch viewports), that is
    // a UX failure. We test reachability via scrollIntoViewIfNeeded.
    await trigger.scrollIntoViewIfNeeded()
    const triggerBox = await trigger.boundingBox()
    expect(triggerBox).not.toBeNull()
    if (triggerBox) {
      // After scrolling into view, the trigger must paint a non-zero
      // bounding rect inside the document.
      expect(triggerBox.width).toBeGreaterThan(0)
      expect(triggerBox.height).toBeGreaterThan(0)
    }
  })

  test('graph toolbar lets the user reach EVERY group without horizontal scroll on mobile', async ({
    authedPage: page,
  }) => {
    // The plan accepted overflow-x: auto on desktop to avoid the strip
    // jumping rows mid-md, but at touch widths a single-row strip with
    // 13+ controls hides the Filters / Analysis / More clusters
    // off-screen behind a scrollbar most users won't discover. At ≤ md
    // the toolbar should wrap so every group is visible without
    // horizontal scroll.
    await runSeedQuery(page)
    await sel.queryTabGraph(page).click()
    const toolbar = page.getByTestId('graph-toolbar')
    await expect(toolbar).toBeVisible()
    const tbBox = await toolbar.boundingBox()
    expect(tbBox).not.toBeNull()
    if (!tbBox) return
    const groupIds = [
      'graph-toolbar-group-view',
      'graph-toolbar-group-filters',
      'graph-toolbar-group-analysis',
      'graph-toolbar-more-trigger',
    ]
    // Assert each group is visible and its right edge lies within the toolbar.
    // Sequential awaits via reduce — no for…of or no-await-in-loop violations.
    await groupIds.reduce(async (chain, id) => {
      await chain
      const el = page.getByTestId(id)
      await expect(el).toBeVisible()
      const box = await el.boundingBox()
      expect(box).not.toBeNull()
      if (box) {
        // The element's RIGHT edge must lie within the toolbar's
        // visible width (8 px tolerance for sub-pixel rounding + the
        // Group's 1 px border-right + the toolbar's inner padding).
        // Otherwise it sits behind the overflow scrollbar.
        expect(box.x + box.width).toBeLessThanOrEqual(tbBox.x + tbBox.width + 8)
      }
    }, Promise.resolve())
    // And the document itself must NOT have a horizontal scrollbar.
    expect(await pageOverflows(page)).toBeLessThanOrEqual(1)
  })

  test('maximize toggle does not occupy a dedicated mobile row above the tab strip', async ({
    authedPage: page,
  }) => {
    // On the 375 px viewport the existing layout pushes the maximize
    // ⤡ button into its own right-aligned row above the tab strip,
    // wasting ~48 px of vertical space for a control that is rarely
    // needed on touch viewports (the flex chain already fills the
    // viewport without it). At mobile the toggle should either be
    // absent or live inline with another row, not occupy its own row.
    await runSeedQuery(page)
    const toggle = sel.resultFullscreenToggle(page)
    // Either the toggle is hidden entirely OR its bounding box must
    // overlap the Bar row (same y as the Run button) instead of
    // sitting between the Bar and the tab strip on a row of its own.
    const isVisible = await toggle.isVisible().catch(() => false)
    if (!isVisible) return // hidden on mobile is acceptable
    const runBtn = sel.queryRunBtn(page)
    const runBox = await runBtn.boundingBox()
    const toggleBox = await toggle.boundingBox()
    expect(runBox).not.toBeNull()
    expect(toggleBox).not.toBeNull()
    if (runBox && toggleBox) {
      const overlap =
        toggleBox.y < runBox.y + runBox.height &&
        toggleBox.y + toggleBox.height > runBox.y
      expect(overlap).toBe(true)
    }
  })
})
