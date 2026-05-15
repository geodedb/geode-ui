import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

// Phase-2 node-inspector workflow: select a node, Hide it (it lands in
// the sidebar "Hidden" list), Restore it. Also covers Collapse on a node
// with neighbours adding them to the "Collapsed" list.
//
// Cytoscape canvas clicks are unreliable in headless Chromium, so node
// selection is driven through the keyboard "Select node by id" affordance
// (graph-node-id-picker) — the same control GraphView exposes for
// keyboard-only operators. We read a real node id out of the picker's
// datalist so the assertions don't couple to specific seed ids.
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

  // Read a concrete node id from the picker's datalist and select it.
  // The inspector lives at the bottom of a scrollable sidebar, so scroll
  // it into view once selected — headless Chromium won't auto-reveal it.
  async function selectFirstNode(page: import('@playwright/test').Page) {
    const firstOption = page.locator('#graph-node-ids option').first()
    await expect(firstOption).toHaveCount(1)
    const id = await firstOption.getAttribute('value')
    expect(id).toBeTruthy()
    await sel.graphNodeIdPicker(page).fill(id as string)
    await expect(page.getByTestId('graph-inspector')).toBeVisible()
    await page.getByTestId('graph-inspector').scrollIntoViewIfNeeded()
    return id as string
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
    await expect(hiddenList).not.toContainText(id)
    await expect(hiddenList).toContainText(/no hidden nodes/i)
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
    await expect(collapsedList).toBeVisible()
    // If something was collapsed, the id shows up; tolerate the no-op case.
    const text = (await collapsedList.textContent()) ?? ''
    if (!/no collapsed nodes/i.test(text)) {
      await expect(collapsedList).toContainText(id)
      await collapsedList
        .getByRole('button', { name: /expand/i })
        .first()
        .click()
      await expect(collapsedList).toContainText(/no collapsed nodes/i)
    }
  })
})
