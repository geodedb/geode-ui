import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

// Multi-pane workspace (/workspace): each WorkspacePane owns its own
// streaming query state, so two panes can run different queries and each
// keeps its own result. The seed has seed.counts.movies (38) Movies and
// seed.counts.persons (133) Persons, so plain `MATCH (n:Label) RETURN n
// LIMIT N` returns exactly N rows — we pick distinct, deterministic LIMITs
// (3 / 6) so each pane's row-count line is unambiguous.
test.describe('multi-pane workspace', () => {
  test('two panes run independent queries side by side', async ({
    authedPage: page,
  }) => {
    await page.goto('/workspace')
    await expect(sel.workspacePane(page)).toHaveCount(1)

    await sel.workspaceAddPane(page).click()
    await expect(sel.workspacePane(page)).toHaveCount(2)

    const pane0 = sel.workspacePane(page).nth(0)
    const pane1 = sel.workspacePane(page).nth(1)

    // Pane 0 — 3 movies.
    await pane0.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH (m:Movie) RETURN m LIMIT 3`
    )
    await pane0.getByTestId('pane-run-btn').click()
    await expect(pane0.getByText(/3 rows/)).toBeVisible({ timeout: 10_000 })

    // Pane 1 — a different query / different count.
    await pane1.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH (p:Person) RETURN p LIMIT 6`
    )
    await pane1.getByTestId('pane-run-btn').click()
    await expect(pane1.getByText(/6 rows/)).toBeVisible({ timeout: 10_000 })

    // Pane 0 still shows its own result — the panes are independent.
    await expect(pane0.getByText(/3 rows/)).toBeVisible()

    // Closing pane 1 leaves pane 0 (and its result) intact.
    await pane1.getByTestId('pane-close-btn').click()
    await expect(sel.workspacePane(page)).toHaveCount(1)
    await expect(
      sel
        .workspacePane(page)
        .first()
        .getByText(/3 rows/)
    ).toBeVisible()
  })

  test('the close button is disabled with a single pane', async ({
    authedPage: page,
  }) => {
    await page.goto('/workspace')
    await expect(sel.workspacePane(page)).toHaveCount(1)
    await expect(sel.paneCloseBtn(page)).toBeDisabled()

    // Adding a second pane enables both close buttons.
    await sel.workspaceAddPane(page).click()
    await expect(sel.workspacePane(page)).toHaveCount(2)
    await expect(sel.paneCloseBtn(page).nth(0)).toBeEnabled()
    await expect(sel.paneCloseBtn(page).nth(1)).toBeEnabled()
  })
})
