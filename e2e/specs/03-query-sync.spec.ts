import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

test.describe('query (sync)', () => {
  test('runs MATCH and shows the expected number of rows', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    await expect(sel.queryRunBtn(page)).toBeVisible()

    // Replace the editor's default statement with a deterministic query.
    // Monaco doesn't expose a stable input role; we use Ctrl+A + type.
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH (n:Person) RETURN n.name AS name ORDER BY name`
    )

    await sel.queryRunBtn(page).click()

    // Wait for the row-count summary to appear.
    await expect(
      page.getByText(new RegExp(`${seed.counts.persons} rows`))
    ).toBeVisible()

    // Switch to table tab, verify the seeded names appear.
    await sel.queryTabTable(page).click()
    await Promise.all(
      seed.people.map((name) => expect(page.getByText(name)).toBeVisible())
    )
  })

  test('a syntactically broken query surfaces an error banner', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('NOT A REAL QUERY ;;;')
    await sel.queryRunBtn(page).click()
    await expect(
      page
        .locator('span', { hasText: /query_error|syntax|unexpected|parse/i })
        .first()
    ).toBeVisible()
  })

  test('switches to JSON tab and shows valid JSON', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH (n:Person) RETURN n.name LIMIT 1`
    )
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/1 rows/)).toBeVisible()
    await sel.queryTabJson(page).click()
    const txt = await page.locator('pre').textContent()
    expect(txt && txt.length).toBeGreaterThan(0)
    expect(() => JSON.parse(txt!)).not.toThrow()
  })
})
