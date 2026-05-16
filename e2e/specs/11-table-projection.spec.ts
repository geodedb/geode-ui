import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

test.describe('table column projection', () => {
  test('MATCH (n:Person) RETURN n shows separate columns for each property', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    await expect(sel.queryRunBtn(page)).toBeVisible()

    // Pick a deterministic Person via name so the test isn't coupled
    // to Geode's MATCH iteration order across the 133-person seed.
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH (n:Person) WHERE n.name = 'Keanu Reeves' RETURN n`
    )
    await sel.queryRunBtn(page).click()

    // Wait for the row-count summary so we know the run finished.
    await expect(page.getByText(/1 rows?/)).toBeVisible({ timeout: 10_000 })

    // Default tab is table; assert the projected headers exist.
    await sel.queryTabTable(page).click()
    await expect(
      page.getByRole('columnheader', { name: /n\._labels/ })
    ).toBeVisible()
    await expect(
      page.getByRole('columnheader', { name: /n\.name/ })
    ).toBeVisible()

    // And the row data is NOT a wall-of-text "(:Person {…})" string —
    // each property cell stands on its own.
    await expect(page.getByText('Keanu Reeves', { exact: true })).toBeVisible()
  })

  test('Expand toggle off falls back to chip+prop-list rendering', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH (n:Person) RETURN n LIMIT 1`
    )
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/\d+ rows?/)).toBeVisible({ timeout: 10_000 })

    // Toggle Expand off — the control moved to the Options dropdown
    // (wa-dropdown-item data-testid="query-options-expand"). The
    // queryOptionsTrigger selector targets the wa-dropdown HOST which
    // may have no bounding box; use the inner wa-button[slot="trigger"]
    // via role=button to open the panel.
    await sel
      .queryOptionsTrigger(page)
      .locator('wa-button[slot="trigger"]')
      .click()
    await sel.queryOptionsExpand(page).click()

    // Compact mode: a single column "n" with the chip cell inside.
    await expect(page.getByRole('columnheader', { name: /^n\b/ })).toBeVisible()
    await expect(page.getByText(':Person', { exact: true })).toBeVisible()

    // Re-enable — open trigger again, click the item, projected headers come back.
    await sel
      .queryOptionsTrigger(page)
      .locator('wa-button[slot="trigger"]')
      .click()
    await sel.queryOptionsExpand(page).click()
    await expect(
      page.getByRole('columnheader', { name: /n\.name/ })
    ).toBeVisible()
  })
})
