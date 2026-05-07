import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

test.describe('table column projection', () => {
  test('MATCH (n:Person) RETURN n shows separate columns for each property', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    await expect(sel.queryRunBtn(page)).toBeVisible()

    // Type a node-returning query.
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH (n:Person) RETURN n LIMIT 3`
    )
    await sel.queryRunBtn(page).click()

    // Wait for the row-count summary so we know the run finished.
    await expect(page.getByText(/\d+ rows/)).toBeVisible({ timeout: 10_000 })

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
    await expect(page.getByText('Alice Wonder', { exact: true })).toBeVisible()
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
    await expect(page.getByText(/\d+ rows/)).toBeVisible({ timeout: 10_000 })

    // Toggle Expand off.
    await page.getByRole('checkbox', { name: /Expand graph cells/i }).uncheck()

    // Compact mode: a single column "n" with the chip cell inside.
    await expect(page.getByRole('columnheader', { name: /^n\b/ })).toBeVisible()
    await expect(page.getByText(':Person', { exact: true })).toBeVisible()

    // Re-enable for the next assertion: projected headers come back.
    await page.getByRole('checkbox', { name: /Expand graph cells/i }).check()
    await expect(
      page.getByRole('columnheader', { name: /n\.name/ })
    ).toBeVisible()
  })
})
