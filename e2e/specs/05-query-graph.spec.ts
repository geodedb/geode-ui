import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

test.describe('query (graph view)', () => {
  test('switches to graph tab and the cytoscape canvas mounts', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH (a:Person)-[r:ACTED_IN]->(m:Movie) RETURN a, r, m LIMIT 10`
    )
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/(10|9) rows/)).toBeVisible()

    await sel.queryTabGraph(page).click()
    // Cytoscape mounts at least one <canvas> for the layer renderer.
    await expect(sel.graphCanvas(page).first()).toBeVisible()

    // The side panel renders the placeholder until a node is clicked.
    await expect(
      page.getByText('Click a node or edge to inspect properties.')
    ).toBeVisible()
  })

  test('graph sidebar collapse toggle hides and restores the controls', async ({
    authedPage: page,
  }) => {
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

    // Sidebar is expanded by default — the display-controls block shows.
    await expect(page.getByTestId('graph-display-controls')).toBeVisible()
    const toggle = page.getByTestId('graph-more-sidebar')
    await expect(toggle).toHaveAttribute('aria-checked', 'false')

    // Collapse — the sidebar and its control blocks are removed.
    await toggle.click()
    await expect(page.getByTestId('graph-more-sidebar')).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await expect(page.getByTestId('graph-display-controls')).toHaveCount(0)
    // The canvas is still mounted.
    await expect(sel.graphCanvas(page).first()).toBeVisible()

    // Expand again — the controls come back.
    await page.getByTestId('graph-more-sidebar').click()
    await expect(page.getByTestId('graph-display-controls')).toBeVisible()
  })

  test('graph tab does not render when no rows', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH (n:Person {name: 'Nobody Real'}) RETURN n`
    )
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/0 rows?/)).toBeVisible()
    await sel.queryTabGraph(page).click()
    // Canvas renders empty; no inspector content beyond placeholder.
    await expect(
      page.getByText('Click a node or edge to inspect properties.')
    ).toBeVisible()
  })

  // Reproduction test for the "graph display options reset on re-run" bug.
  //
  // The layout-algorithm picker on the graph tab lives in GraphView's
  // component-local useState. Clicking "Run" calls QueryPage.resetRunState()
  // which sets activeResp to null → the {activeResp && <GraphView/>} subtree
  // collapses → GraphView unmounts. When the new (identical) response
  // arrives GraphView remounts and `layout` re-initialises to its 'cose'
  // default — the operator's chosen layout is silently lost on every
  // re-run. The fix lifts that state out of GraphView (into a
  // localStorage-backed store) so it survives the remount.
  //
  // NOTE: the running stack currently serves the OLD build (it gets
  // rebuilt as part of the fix), so this test FAILS today for the right
  // reason — the layout picker reads 'cose' again after the re-run.
  test('graph layout choice survives a query re-run', async ({
    authedPage: page,
  }) => {
    const q = `USE GRAPH ${seed.graph}; MATCH (a:Person)-[r:ACTED_IN]->(m:Movie) RETURN a, r, m LIMIT 10`

    await page.goto('/')
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(q)
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/(10|9) rows/)).toBeVisible()

    await sel.queryTabGraph(page).click()
    const layoutPicker = page.getByTestId('graph-layout-picker')
    await expect(layoutPicker).toBeVisible()
    await expect(layoutPicker).toHaveValue('cose')

    // Pick a non-default layout.
    await layoutPicker.selectOption('grid')
    await expect(layoutPicker).toHaveValue('grid')

    // Re-run the same query. resetRunState() unmounts GraphView; the
    // identical response remounts it.
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/(10|9) rows/)).toBeVisible()
    await sel.queryTabGraph(page).click()

    // The previously-selected layout must still be in effect.
    await expect(page.getByTestId('graph-layout-picker')).toHaveValue('grid')
  })

  // Reproduction test for the "graph inspector renders raw JSON only" UX gap.
  //
  // Selecting a node on the graph tab populates the right-hand inspector.
  // Today it renders the element's data bag as a raw <pre>JSON</pre> block.
  // The fix makes the inspector default to a structured property view
  // (data-testid="graph-inspector-props") with a toggle to a "Raw JSON"
  // view (button data-testid="graph-inspector-view-json", pane
  // data-testid="graph-inspector-json"). Node selection is driven through
  // the keyboard id-picker (the canvas itself isn't clickable from
  // Playwright) — its <datalist> exposes the available node ids.
  //
  // NOTE: the running stack currently serves the OLD build (rebuilt as
  // part of the fix), so this test FAILS today for the right reason — the
  // graph-inspector-* testids don't exist yet. It does get past
  // login → query → graph-tab → node-select, failing on the inspector
  // assertion, not setup.
  test('graph inspector defaults to the structured property view', async ({
    authedPage: page,
  }) => {
    const q = `USE GRAPH ${seed.graph}; MATCH (a:Person)-[r:ACTED_IN]->(m:Movie) RETURN a, r, m LIMIT 10`

    await page.goto('/')
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(q)
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/(10|9) rows/)).toBeVisible()

    await sel.queryTabGraph(page).click()
    await expect(sel.graphCanvas(page).first()).toBeVisible()

    // The keyboard node id-picker is the deterministic way to select a
    // node from Playwright. Pick the first id its <datalist> offers.
    const picker = page.getByTestId('graph-node-id-picker')
    await expect(picker).toBeVisible()
    const firstNodeId = await page
      .locator('#graph-node-ids option')
      .first()
      .getAttribute('value')
    expect(firstNodeId).toBeTruthy()
    await picker.fill(firstNodeId as string)

    // Structured property view is the default; the raw-JSON pane is not.
    await expect(page.getByTestId('graph-inspector-props')).toBeVisible()
    await expect(page.getByTestId('graph-inspector-json')).toHaveCount(0)

    // Toggle to the raw-JSON view — the <pre> shows the data-bag JSON.
    await page.getByTestId('graph-inspector-view-json').click()
    const jsonPane = page.getByTestId('graph-inspector-json')
    await expect(jsonPane).toBeVisible()
    await expect(jsonPane).toContainText('"id"')
  })
})
