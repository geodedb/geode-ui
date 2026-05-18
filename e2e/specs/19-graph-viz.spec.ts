import { test, expect } from '../fixtures'
import { sel, selectGraphLayout } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

// Smoke test for the Phase-1 graph-viz feature ports: the fcose / dagre
// layouts in the layout picker, the group-by-label clustering toggle,
// and path mode. Each test runs a small graph query against the seeded
// movies dataset, switches to the Graph tab, and exercises one feature
// via its stable data-testid.
//
// NOTE: the running stack is rebuilt as part of this work (the e2e
// image is `compose up --build`-ed); against the OLD image these tests
// fail for the right reason — the new controls don't exist yet.
test.describe('graph viz: layouts, clustering, path mode', () => {
  const GRAPH_QUERY = `USE GRAPH ${seed.graph}; MATCH (p:Person)-[r:ACTED_IN]->(m:Movie) RETURN p, r, m LIMIT 25`

  test.beforeEach(async ({ authedPage: page }) => {
    await page.goto('/')
    // The query editor is Monaco — click into it, select-all, type.
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(GRAPH_QUERY)
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/(2[0-5]|1\d) rows/)).toBeVisible()
    await sel.queryTabGraph(page).click()
    await expect(page.getByTestId('graph-layout-picker')).toBeVisible()
  })

  test('fcose and dagre are selectable layouts', async ({
    authedPage: page,
  }) => {
    const picker = page.getByTestId('graph-layout-picker')
    // Bug-C fix: layout picker is a Bootstrap dropdown (role=listbox
    // sibling, role=option entries) instead of a native <select>.
    await picker.click()
    await expect(page.getByRole('option', { name: /Force \(fast\)/i }))
      .toHaveCount(1)
    await expect(page.getByRole('option', { name: /Layered \(DAG\)/i }))
      .toHaveCount(1)
    // Close + re-open to drive each selection through the public path.
    await page.keyboard.press('Escape')
    await selectGraphLayout(page, 'fcose')
    await expect(picker).toContainText(/Force \(fast\)/i)
    await selectGraphLayout(page, 'dagre')
    await expect(picker).toContainText(/Layered \(DAG\)/i)
  })

  test('group-by-label clustering toggle is pressable', async ({
    authedPage: page,
  }) => {
    const toggle = page.getByTestId('graph-cluster-toggle')
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await toggle.click()
    // Cytoscape rendering of the compound parents in headless Chromium is
    // hard to assert on directly; pin the toggle state instead.
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    // The canvas is still mounted after the rebuild.
    await expect(sel.graphCanvas(page).first()).toBeVisible()
  })

  test('path mode prompts for two nodes and exits cleanly', async ({
    authedPage: page,
  }) => {
    const pathToggle = page.getByTestId('graph-path-mode')
    await expect(pathToggle).toHaveAttribute('aria-pressed', 'false')
    await pathToggle.click()
    await expect(pathToggle).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(/click the start node/i)).toBeVisible()
    await page.getByTestId('graph-path-clear').click()
    await expect(pathToggle).toHaveAttribute('aria-pressed', 'false')
  })

  test('matrix tab renders an adjacency heatmap', async ({
    authedPage: page,
  }) => {
    // beforeEach already ran the Person—ACTED_IN→Movie query and is on
    // the Graph tab; switch to the Matrix tab and assert the heatmap.
    await sel.queryTabMatrix(page).click()
    await expect(
      page.getByRole('table', { name: /adjacency|matrix/i })
    ).toBeVisible()
    await expect(
      page.getByRole('columnheader', { name: /Movie/i })
    ).toBeVisible()
  })
})
