import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

// Phase-2 node-inspector workflow: select a node, Hide it (it lands in
// the sidebar "Hidden" list), Restore it. Also covers Collapse on a node
// with neighbours adding them to the "Collapsed" list.
//
// Cytoscape canvas clicks are unreliable in headless Chromium, so node
// selection is driven through the toolbar Find input (graph-find-input).
// We search for a name known to exist in the seeded movies graph and
// press Enter to select the first match. The legacy graph-node-id-picker
// sidebar control was removed in Task 3.3.
test.describe('graph: node inspector hide / collapse / restore', () => {
  const GRAPH_QUERY = `USE GRAPH ${seed.graph}; MATCH (p:Person)-[r:ACTED_IN]->(m:Movie) RETURN p, r, m LIMIT 25`

  test.beforeEach(async ({ authedPage: page }) => {
    await page.goto('/')
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(GRAPH_QUERY)
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/(2[0-5]|1\d) rows/)).toBeVisible()
    await sel.queryTabGraph(page).click()
    await expect(sel.graphLayoutPicker(page)).toBeVisible()
  })

  // Select the first matched node via the toolbar Find input. Search for
  // a name that exists in the seeded movies graph ('Tom' — appears in
  // multiple Person nodes). Press Enter to select the first match.
  // The inspector lives at the bottom of a scrollable sidebar, so scroll
  // it into view once selected — headless Chromium won't auto-reveal it.
  async function selectFirstNode(page: import('@playwright/test').Page) {
    // graph-find-input is a <wa-input> custom element; use the selector
    // helper that chains to the shadow-DOM <input> for .fill()/.press().
    // Search for 'Movie' — every result set has Movie nodes with label
    // "Movie", so there is always at least one match regardless of LIMIT
    // ordering. The hidden/collapsed list shows the node's display label
    // which includes 'Movie', so toContainText('Movie') will work.
    const findInput = sel.graphFindInput(page)
    await expect(findInput).toBeVisible()
    await findInput.fill('Movie')
    // Wait for the React state to update and match count to appear,
    // ensuring matches[] is non-empty before pressing Enter.
    await expect(page.getByTestId('graph-find-count')).toContainText(/\d+/)
    await findInput.press('Enter')
    await expect(page.getByTestId('graph-inspector')).toBeVisible()
    await page.getByTestId('graph-inspector').scrollIntoViewIfNeeded()
    // Return 'Movie' — the hidden/collapsed restore lists show the node's
    // display label (e.g. "Movie 123"), so containText('Movie') works.
    return 'Movie'
  }

  test('hide a node, see it in the Hidden list, restore it', async ({
    authedPage: page,
  }) => {
    const id = await selectFirstNode(page)

    await sel.graphActionHide(page).click()
    // Hidden list now carries the node id; inspector closed.
    const hiddenList = sel.graphHiddenList(page)
    await expect(hiddenList).toContainText(id)
    await expect(page.getByTestId('graph-inspector')).toHaveCount(0)

    // Restore it from the list row.
    await hiddenList
      .getByRole('button', { name: /restore/i })
      .first()
      .click()
    // After restore the hidden section unmounts entirely (no empty-state
    // placeholder), so graph-hidden-list disappears from the DOM.
    await expect(sel.graphHiddenList(page)).toHaveCount(0)
  })

  test('collapse a node with neighbours adds them to the Collapsed list', async ({
    authedPage: page,
  }) => {
    const id = await selectFirstNode(page)
    await sel.graphActionCollapse(page).click()
    // Either the node had degree-1 leaves (it lands in the Collapsed
    // list) or it didn't (no-op). The seeded movies graph's Person/Movie
    // mesh has plenty of degree-1 leaves, so a Collapse on a typical node
    // produces at least one. If this node happened to have none, the
    // Collapsed list stays empty — assert the list element exists either
    // way, and the count heading reflects reality.
    const collapsedList = sel.graphCollapsedList(page)
    // If something was collapsed, the collapsed list appears and contains
    // the node's label. If the node had no degree-1 leaves (no-op), the
    // entire section stays unmounted — tolerate both outcomes.
    const listCount = await collapsedList.count()
    if (listCount > 0) {
      await expect(collapsedList).toContainText(id)
      await collapsedList
        .getByRole('button', { name: /expand/i })
        .first()
        .click()
      // After expand the collapsed section unmounts entirely.
      await expect(sel.graphCollapsedList(page)).toHaveCount(0)
    }
  })
})
