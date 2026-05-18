// Mobile-responsive reproduction tests for QueryPage / ResultPanel /
// GraphView / GqlEditor.
//
// These tests document the bugs that the responsive sweep (Phase 4 of
// the mobile UX audit) is about to fix:
//
//  1) GqlEditor uses a fixed `height={240}` default which is too tall on
//     a 375 x 812 viewport (eats ~30% of vertical chrome). After the fix
//     the editor must shrink to <= 200px on mobile.
//
//  2) The graph <Canvas> styled.ts:49-59 applies `min-height: 60vh` only
//     for the mobile breakpoint, which forces the canvas taller than its
//     grid parent and pushes the graph off-screen / off-center. After the
//     fix the canvas must not overflow its parent grid cell.
//
//  3) cytoscape's rendered nodes must stay inside the visible canvas
//     viewport after a resize 375x812 -> 1280x800 -> 375x812 (the bug:
//     no resize-driven re-fit, so on rotate-back the graph is shifted).
//
//  4) Sidebar collapse toggle is buried in the GraphToolbarMore
//     wa-dropdown (graph-more-sidebar). On mobile the toggle should be a
//     first-class button visible in the toolbar without opening a
//     dropdown. The test asserts a `button[aria-label*="sidebar" i]`
//     locator resolves to a visible element at 375px width.
//
//  5) ResultPanel tab strip must not horizontally overflow at 375 px
//     viewport width (`scrollWidth <= clientWidth + 1`).
//
//  6) QueryPage Bar styled.ts uses `gap: spacing.md` and `flex-wrap:
//     wrap` — at 320 px width the wrap should keep total Bar height
//     <= 160 px (today it can grow to 3+ rows of full-size buttons).
//
// Tagged @mobile so the mobile-chrome project picks them up. The
// explicit setViewportSize call lets the same spec run on the chromium
// project for a determinism check.
//
// NOTE: A few tests use selectors that intentionally do not exist yet
// in production code:
//   - `[data-testid="query-sidebar-toggle"]` for the first-class sidebar
//     collapse button that must be wired in during the fix.
// The production code MUST add that data-testid as part of the fix.

import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

const MOBILE_VIEWPORT = { width: 375, height: 812 }
const NARROW_VIEWPORT = { width: 320, height: 568 }
const DESKTOP_VIEWPORT = { width: 1280, height: 800 }
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

test.describe('@mobile @responsive QueryPage mobile responsive bugs', () => {
  test.beforeEach(async ({ authedPage: page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT)
    await page.goto('/')
    await expect(sel.queryRunBtn(page)).toBeVisible()
  })

  test('Bug 1: Monaco editor height fits within 200px on 375x812 mobile viewport', async ({
    authedPage: page,
  }) => {
    // GqlEditor default `height={240}` is too tall for mobile chrome.
    // After the fix the editor's actual rendered height must be <= 200 px.
    await runSeedQuery(page)
    await sel.queryTabGraph(page).click()
    const editor = page.locator('.monaco-editor').first()
    await expect(editor).toBeVisible()
    const box = await editor.boundingBox()
    expect(box).not.toBeNull()
    if (box) {
      // BEFORE the fix this is 240. AFTER the fix it should be <= 200.
      expect(box.height).toBeLessThanOrEqual(200)
    }
  })

  test('Bug 2: graph canvas does not overflow the visible viewport on 375x812', async ({
    authedPage: page,
  }) => {
    // The `min-height: 60vh` mobile rule on Canvas (styled.ts:49-59)
    // forces it taller than the parent flex slot, which in turn pushes
    // the page's vertical scroll past the viewport and shifts the graph
    // off-center. We assert TWO conditions:
    //  (a) the canvas bottom does not extend beyond the visible
    //      viewport bottom; and
    //  (b) the document does not need to grow a vertical scrollbar to
    //      contain the QueryPage's chrome + result region.
    await runSeedQuery(page)
    await sel.queryTabGraph(page).click()
    const canvas = page.getByTestId('graph-canvas')
    await expect(canvas).toBeVisible()
    const measurement = await canvas.evaluate((el) => {
      const cb = el.getBoundingClientRect()
      return {
        canvasTop: cb.top,
        canvasBottom: cb.bottom,
        canvasHeight: cb.height,
        viewportHeight: window.innerHeight,
        docScrollOverflow:
          document.documentElement.scrollHeight -
          document.documentElement.clientHeight,
      }
    })
    // (a) canvas must not visually overflow the bottom of the viewport.
    expect(measurement.canvasBottom).toBeLessThanOrEqual(
      measurement.viewportHeight + 1
    )
    // (b) the page must not need vertical scroll to contain the canvas
    //     (the 60vh floor today pushes total page height past viewport).
    expect(measurement.docScrollOverflow).toBeLessThanOrEqual(1)
  })

  test('Bug 3: graph stays fit after resize mobile -> desktop -> mobile', async ({
    authedPage: page,
  }) => {
    // Cytoscape's ResizeObserver must re-fit the graph on container
    // resize. The bug: after a viewport flip the rendered nodes lie
    // outside the canvas's clip rect. We assert that after each resize
    // every rendered node is inside the canvas's viewport rect.
    await runSeedQuery(page)
    await sel.queryTabGraph(page).click()
    const canvas = page.getByTestId('graph-canvas')
    await expect(canvas).toBeVisible()
    // Wait for cytoscape to settle the initial layout.
    await page.waitForTimeout(800)

    type Bounds = {
      canvas: { x: number; y: number; w: number; h: number }
      anyNodeOutside: boolean
    }
    const probe = async (): Promise<Bounds> => {
      return canvas.evaluate((el) => {
        const cb = el.getBoundingClientRect()
        // Cytoscape mounts <canvas> children inside `el`; rendered nodes
        // become absolutely-positioned <div> overlays only when DOM-nodes
        // mode is on. Use the cytoscape instance attached to the host —
        // when the styled Canvas div hosts the cy mount, the cy
        // instance is exposed via the GraphView's window-debug hook
        // (`window.__GEODE_E2E_CY__`). Fall back to scanning .layer-node
        // children if the hook isn't installed.
        // Bracket-access via Reflect avoids the dot-notation lint while
        // keeping the test-only sentinel global name untouched.
        const cy = Reflect.get(window, '__GEODE_E2E_CY__') as
          | {
              nodes: () => {
                forEach: (
                  fn: (n: {
                    renderedPosition: () => { x: number; y: number }
                  }) => void
                ) => void
                length: number
              }
            }
          | undefined
        let anyOutside = false
        if (cy && cy.nodes) {
          const nodes = cy.nodes()
          nodes.forEach((n) => {
            const p = n.renderedPosition()
            // Rendered position is in canvas-local coords.
            if (p.x < 0 || p.y < 0 || p.x > cb.width || p.y > cb.height) {
              anyOutside = true
            }
          })
        } else {
          // Fallback: the styled Canvas owns a <canvas> child; if its
          // intrinsic size differs from the host box by > 4 px we count
          // that as "the graph is not fitting".
          const inner = el.querySelector('canvas') as HTMLCanvasElement | null
          if (inner) {
            const ib = inner.getBoundingClientRect()
            if (
              Math.abs(ib.width - cb.width) > 4 ||
              Math.abs(ib.height - cb.height) > 4
            ) {
              anyOutside = true
            }
          } else {
            // No cytoscape instance and no <canvas> — the graph is not
            // mounted; treat this as a failure for this test's purpose
            // (the page is supposed to be on the graph tab).
            anyOutside = true
          }
        }
        return {
          canvas: { x: cb.x, y: cb.y, w: cb.width, h: cb.height },
          anyNodeOutside: anyOutside,
        }
      })
    }

    // Step 1: initial mobile probe.
    const start = await probe()
    expect(start.anyNodeOutside).toBe(false)
    // Step 2: resize to desktop, wait for layout.
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await page.waitForTimeout(800)
    const desktop = await probe()
    expect(desktop.anyNodeOutside).toBe(false)
    // Step 3: back to mobile.
    await page.setViewportSize(MOBILE_VIEWPORT)
    await page.waitForTimeout(800)
    const back = await probe()
    expect(back.anyNodeOutside).toBe(false)
  })

  test('Bug 4: first-class sidebar-collapse button is visible without opening a dropdown', async ({
    authedPage: page,
  }) => {
    // Today the only way to toggle the graph sidebar on mobile is to
    // open the More dropdown (wa-dropdown host carries `graph-more-sidebar`).
    // That dropdown is hidden by default. We require a first-class
    // button rendered directly in the toolbar (no menu open required)
    // whose accessible name mentions "sidebar" or "panel".
    await runSeedQuery(page)
    await sel.queryTabGraph(page).click()
    // Look for a directly-visible toggle button. The fix should add
    // a data-testid="query-sidebar-toggle" (or wire it into an existing
    // toolbar group) with an aria-label containing "sidebar" or "panel".
    const directToggle = page.locator(
      'button[aria-label*="sidebar" i], button[aria-label*="panel" i], [data-testid="query-sidebar-toggle"]'
    )
    // The button must be attached AND visible without any dropdown open.
    await expect(directToggle.first()).toBeVisible({ timeout: 4_000 })
  })

  test('Bug 5: ResultPanel tab strip does not require horizontal scroll at 320px', async ({
    authedPage: page,
  }) => {
    // The tab strip hosts four tabs (table/json/graph/matrix). On a
    // fold-closed / SE-1st-gen 320 px viewport the Web Awesome
    // <wa-tab-group> nav element ends up wider than the result panel
    // and exposes its leading/trailing chevron scroller. The fix
    // should either compact the tabs or wrap them so the inner nav
    // scrollWidth fits within its clientWidth.
    await page.setViewportSize({ width: 320, height: 740 })
    await page.reload()
    await runSeedQuery(page)
    // Locate the role=tablist for the result panel (the FIRST tablist
    // in document order is the result-panel tab group; the global
    // navigation does not use role=tablist).
    const tablist = page.getByRole('tablist').first()
    await expect(tablist).toBeVisible()
    const overflow = await tablist.evaluate((el) => {
      // The wa-tab-group renders the actual scroller inside its shadow
      // root. Try the shadow nav first; fall back to the light-DOM
      // host's own scrollWidth/clientWidth.
      const host = el as HTMLElement & { shadowRoot?: ShadowRoot | null }
      let inner: Element | null = null
      if (host.shadowRoot) {
        inner =
          host.shadowRoot.querySelector('[part="nav"]') ??
          host.shadowRoot.querySelector('.tab-group__nav') ??
          host.shadowRoot.querySelector('[class*="nav"]')
      }
      const target = inner ?? el
      return {
        scrollWidth: target.scrollWidth,
        clientWidth: target.clientWidth,
        delta: target.scrollWidth - target.clientWidth,
        // The shadow-root nav also exposes hasScrollControls when the
        // strip overflows; surface it for the test message.
        hasScrollControls:
          (el.getAttribute('data-scroll-controls') ??
            host.shadowRoot
              ?.querySelector('[part="scroll-button"]')
              ?.getAttribute('part')) != null,
      }
    })
    // BEFORE the fix the inner nav scrolls horizontally (delta > 0).
    expect(overflow.delta).toBeLessThanOrEqual(1)
  })

  test('Bug 6: QueryPage Bar wraps compactly at 320px viewport width', async ({
    authedPage: page,
  }) => {
    // At 320 px (smallest supported viewport, SE 1st gen / fold-closed)
    // the QueryPage Bar uses spacing.md gaps (16 px) which is too wide
    // for narrow viewports -- it forces the Options/Run/cancel cluster
    // onto separate rows and inflates the bar's vertical chrome. The
    // fix should switch to a narrow-width gap and keep total Bar height
    // <= 80 px (~1 row of standard wa-button + minimal padding).
    await page.setViewportSize(NARROW_VIEWPORT)
    // Re-navigate so the layout recomputes against the narrower width.
    await page.goto('/')
    const runBtn = sel.queryRunBtn(page)
    await expect(runBtn).toBeVisible()
    // The Bar is the parent flex container that holds the Run button.
    // We measure its bounding box height AND the computed gap to assert
    // the fix applied the mobile gap reduction.
    const measurement = await runBtn.evaluate((el) => {
      let cur: HTMLElement | null = el.closest('div') as HTMLElement | null
      while (cur) {
        const style = window.getComputedStyle(cur)
        if (style.display === 'flex' && style.flexWrap !== 'nowrap') {
          return {
            height: cur.getBoundingClientRect().height,
            // Parse the column-gap (gap shorthand on flex containers
            // resolves to row-gap + column-gap; we read column-gap).
            columnGapPx: parseFloat(style.columnGap || '0'),
          }
        }
        cur = cur.parentElement
      }
      return { height: -1, columnGapPx: -1 }
    })
    expect(measurement.height).toBeGreaterThan(0)
    // BEFORE the fix the Bar uses spacing.md (16 px) and stacks into a
    // 2-3 row layout > 100 px tall. AFTER the fix it should be a tight
    // single row <= 80 px tall.
    expect(measurement.height).toBeLessThanOrEqual(80)
    // The desktop gap is spacing.md = 16 px. The fix should drop to
    // spacing.xs / spacing.sm (<= 8 px) on narrow viewports.
    expect(measurement.columnGapPx).toBeLessThanOrEqual(8)
  })
})
