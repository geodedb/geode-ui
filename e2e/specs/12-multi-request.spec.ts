import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

// Reproduction guard for "commands are not consistently working on
// multiple requests". The page is loaded once; we then run a sequence
// of queries on the same QueryPage instance and assert each one
// settles to a result. Any row-count discrepancy or stuck busy state
// (no result banner after 10s) fails the test.
test.describe('query page survives many consecutive runs', () => {
  test('5 sequential RETURN queries each yield a result', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    await expect(sel.queryRunBtn(page)).toBeVisible()

    const queries: Array<{ stmt: string; expect: RegExp }> = [
      {
        stmt: `USE GRAPH ${seed.graph}; MATCH (n:Person) RETURN n.name LIMIT 1`,
        expect: /1 rows?/,
      },
      {
        stmt: `USE GRAPH ${seed.graph}; MATCH (m:Movie) RETURN m.title LIMIT 2`,
        expect: /2 rows?/,
      },
      { stmt: 'RETURN 42 AS answer', expect: /1 rows?/ },
      {
        stmt: `USE GRAPH ${seed.graph}; MATCH (n:Person) RETURN n LIMIT 3`,
        expect: /3 rows?/,
      },
      {
        stmt: `USE GRAPH ${seed.graph}; MATCH (n:Movie) RETURN count(n) AS movies`,
        expect: /1 rows?/,
      },
    ]

    /* eslint-disable no-await-in-loop, no-restricted-syntax */
    for (const q of queries) {
      await page.locator('.monaco-editor').first().click()
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.type(q.stmt)
      await sel.queryRunBtn(page).click()

      // Each run must surface its own row-count banner. waitFor with a
      // tight timeout catches "stuck busy" (the bug we're hunting).
      await expect(page.getByText(q.expect)).toBeVisible({ timeout: 10_000 })

      // Run button must be enabled again before we type the next one.
      await expect(sel.queryRunBtn(page)).toBeEnabled({ timeout: 5_000 })
    }
    /* eslint-enable no-await-in-loop, no-restricted-syntax */
  })

  test('toggling stream on/off across runs does not leak rows', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    // Sync run #1.
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH (n:Person) RETURN n.name LIMIT 1`
    )
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/1 rows?/)).toBeVisible({ timeout: 10_000 })

    // Stream run #2 with a different row count.
    await sel.queryStreamToggle(page).check()
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH (n:Person) RETURN n LIMIT 4`
    )
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/4 rows?/)).toBeVisible({ timeout: 15_000 })

    // Sync run #3 — the previous stream's rows must NOT leak.
    await sel.queryStreamToggle(page).uncheck()
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('RETURN 1 AS one')
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/1 rows?/)).toBeVisible({ timeout: 10_000 })
  })
})
