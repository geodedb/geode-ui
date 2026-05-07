import { test, expect } from '../fixtures'
import { seed } from '../helpers/gqlData'

test.describe('schema explorer', () => {
  test('lists graphs from the seeded database', async ({
    authedPage: page,
  }) => {
    await page.goto('/schema')
    // The page auto-fetches /api/v1/graphs and renders a button per graph.
    await expect(page.getByRole('button', { name: seed.graph })).toBeVisible()
  })

  test('clicking a graph populates the labels pane', async ({
    authedPage: page,
  }) => {
    await page.goto('/schema')
    await page.getByRole('button', { name: seed.graph, exact: true }).click()
    // exact:true so 'Movie' label doesn't collide with 'movies' graph button.
    await Promise.all(
      seed.labels.map((label) =>
        expect(
          page.getByRole('button', { name: label, exact: true })
        ).toBeVisible()
      )
    )
  })

  test('clicking a label stages a MATCH query and navigates to /', async ({
    authedPage: page,
  }) => {
    await page.goto('/schema')
    await page.getByRole('button', { name: seed.graph, exact: true }).click()
    await page.getByRole('button', { name: 'Person', exact: true }).click()
    await expect(page).toHaveURL(/\/$/)
    // The editor should now contain MATCH (n:Person) RETURN n LIMIT 25
    const editorText = await page
      .locator('.monaco-editor')
      .first()
      .textContent()
    expect(editorText).toContain('MATCH')
    expect(editorText).toContain('Person')
    // The staged query MUST also be runnable end-to-end. Regression test
    // for: Geode v0.5.11 rejects backtick-quoted identifiers, so the
    // schema explorer must stage bare-name queries.
    await page.getByRole('button', { name: /run/i }).click()
    // Either we get rows (in this graph it's >= 1 since Person nodes
    // exist) or a 0-row response — but NOT a 422 query_error banner.
    await expect(page.locator('span', { hasText: /query_error/i })).toHaveCount(
      0,
      { timeout: 8_000 }
    )
    await expect(page.getByText(/\d+ rows/)).toBeVisible({ timeout: 8_000 })
  })

  test('edge types pane lists ACTED_IN and DIRECTED', async ({
    authedPage: page,
  }) => {
    await page.goto('/schema')
    await page.getByRole('button', { name: seed.graph, exact: true }).click()
    await Promise.all(
      seed.edgeTypes.map((t) =>
        expect(page.getByRole('button', { name: t, exact: true })).toBeVisible()
      )
    )
  })
})
