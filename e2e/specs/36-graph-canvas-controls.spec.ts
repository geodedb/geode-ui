import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

// Poll until __geode_cy is initialised (set by useGraphCytoscape's
// useEffect once the Cytoscape core is constructed). Returns the
// current zoom level or -1 when the core isn't ready yet.
async function readZoom(
  page: import('@playwright/test').Page
): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as { __geode_cy?: { zoom(): number } }
    // eslint-disable-next-line no-underscore-dangle
    return w.__geode_cy?.zoom() ?? -1
  })
}

// Repeatedly check until __geode_cy is available (the React effect
// runs after the canvas div appears, so there's a brief gap).
async function waitForCy(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __geode_cy?: { zoom(): number } }
      // eslint-disable-next-line no-underscore-dangle
      return typeof w.__geode_cy?.zoom === 'function'
    },
    { timeout: 15_000 }
  )
}

test.describe('graph canvas controls + edge picking', () => {
  test.beforeEach(async ({ authedPage: page }) => {
    await page.goto('/')
    await expect(sel.queryRunBtn(page)).toBeVisible()
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    // Use explicit element variables (p, r, m) — same pattern as
    // 19-graph-viz.spec.ts. RETURN p (path) may not populate graph_summary
    // on this Geode version so Cytoscape would get zero elements and
    // skip initialisation entirely.
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH (a:Person)-[r:ACTED_IN]->(b:Movie) RETURN a, r, b LIMIT 5`
    )
    await sel.queryRunBtn(page).click()
    await sel.queryTabGraph(page).click()
    await page
      .locator('[data-testid="graph-canvas"]')
      .waitFor({ timeout: 10_000 })
  })

  test('the canvas pill renders the five controls', async ({
    authedPage: page,
  }) => {
    await expect(sel.graphCanvasZoomIn(page)).toBeVisible()
    await expect(sel.graphCanvasZoomOut(page)).toBeVisible()
    await expect(sel.graphCanvasZoomSlider(page)).toBeVisible()
    await expect(sel.graphCanvasFit(page)).toBeVisible()
    await expect(sel.graphCanvasReset(page)).toBeVisible()
  })

  test('clicking + increases cy.zoom() and − decreases it', async ({
    authedPage: page,
  }) => {
    // Wait for the Cytoscape core to finish initialising. The core is
    // built asynchronously in a React useEffect that fires after the
    // canvas div appears — without this poll readZoom() returns -1.
    await waitForCy(page)
    const before = await readZoom(page)
    await sel.graphCanvasZoomIn(page).click()
    const afterIn = await readZoom(page)
    expect(afterIn).toBeGreaterThan(before)
    await sel.graphCanvasZoomOut(page).click()
    const afterOut = await readZoom(page)
    expect(afterOut).toBeLessThan(afterIn)
  })

  test('slider drag updates cy.zoom() along the log curve', async ({
    authedPage: page,
  }) => {
    await waitForCy(page)
    const slider = sel.graphCanvasZoomSlider(page)
    // React's onChange on <input type="range"> is wired to the native
    // `input` event via React's internal event delegation. The most
    // reliable cross-browser way to fire it from Playwright is to use
    // the nativeInputValueSetter path that React-Testing-Library uses
    // internally — get React's own setter for the input value, then
    // dispatch `input` so React's delegation layer sees the new value.
    await slider.evaluate((el: HTMLInputElement) => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set as ((v: string) => void) | undefined
      if (nativeSetter) nativeSetter.call(el, '0.8')
      else {
        el.value = '0.8'
      }
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })
    // Wait for the cy zoom to reflect the new slider position.
    // zoomFromLevel(0.8) = 10 ** (0.8*2 - 1) = 10^0.6 ≈ 3.98
    await page.waitForFunction(
      () => {
        const w = window as unknown as { __geode_cy?: { zoom(): number } }
        // eslint-disable-next-line no-underscore-dangle
        const z = w.__geode_cy?.zoom() ?? -1
        return z > 2
      },
      { timeout: 5_000 }
    )
    const z = await readZoom(page)
    // 10 ** (0.8*2 - 1) = 10^0.6 ≈ 3.98
    expect(z).toBeGreaterThan(3)
    expect(z).toBeLessThan(5)
  })

  test('clicking an edge populates the inspector with its properties', async ({
    authedPage: page,
  }) => {
    await waitForCy(page)
    // Fire a synthetic tap on the first ACTED_IN edge via Cytoscape's
    // emit() API — avoids unreliable pointer-event coordinates over a canvas.
    await page.evaluate(() => {
      const w = window as unknown as {
        __geode_cy?: {
          edges(): { length: number; [i: number]: { emit(e: string): void } }
        }
      }
      // eslint-disable-next-line no-underscore-dangle
      const cy = w.__geode_cy
      const edges = cy?.edges()
      if (edges && edges.length > 0) {
        const list = edges as never as Array<{ emit: (e: string) => void }>
        list[0]!.emit('tap')
      }
    })
    // Inspector should switch to edge selection — props pane shows
    // an edge identity header + property list.
    await expect(page.getByTestId('graph-inspector')).toBeVisible()
    await expect(page.getByTestId('graph-inspector-props')).toBeVisible()
    // ACTED_IN edges in the movies seed carry { roles: [...] }; the
    // dt label should appear.
    await expect(page.locator('dt', { hasText: 'roles' })).toBeVisible()
  })
})
