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

  test('does not surface the __geode_security system graph', async ({
    authedPage: page,
  }) => {
    // Regression: SHOW GRAPHS upstream returns __geode_security alongside
    // user graphs. The server must filter __-prefixed names so the
    // SchemaExplorer's "first graph" auto-selection lands on a real
    // user-data graph instead of the system graph.
    await page.goto('/schema')
    await expect(page.getByRole('button', { name: seed.graph })).toBeVisible()
    // Wait a beat for /api/v1/graphs to settle, then assert the system
    // graph button is absent. We use exact match because partial matches
    // could collide with similar user graph names.
    await expect(
      page.getByRole('button', { name: '__geode_security', exact: true })
    ).toHaveCount(0)
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
    // The staged query MUST also be runnable end-to-end. Regression
    // test for two distinct bugs:
    //   1. Geode v0.5.11 rejects backtick-quoted identifiers, so the
    //      schema explorer must stage bare-name queries.
    //   2. The staged statement must include `USE GRAPH <graph>;` —
    //      without it Geode runs against no graph context and silently
    //      returns 0 rows. The staged template caps at LIMIT 25, and
    //      the movies seed has more Person nodes than that, so we
    //      assert exactly 25 rows (NOT /\d+ rows/, which would let a
    //      0-row regression slip through).
    await page.getByRole('button', { name: /run/i }).click()
    await expect(page.locator('span', { hasText: /query_error/i })).toHaveCount(
      0,
      { timeout: 8_000 }
    )
    await expect(page.getByText(/25 rows/)).toBeVisible({ timeout: 8_000 })
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

  test('clicking an edge type stages a runnable MATCH', async ({
    authedPage: page,
  }) => {
    await page.goto('/schema')
    await page.getByRole('button', { name: seed.graph, exact: true }).click()
    await page.getByRole('button', { name: 'ACTED_IN', exact: true }).click()
    await expect(page).toHaveURL(/\/$/)
    const editorText = await page
      .locator('.monaco-editor')
      .first()
      .textContent()
    expect(editorText).toContain('MATCH')
    expect(editorText).toContain('ACTED_IN')

    // Run it. Same regression as the label test — without USE GRAPH the
    // query silently returns 0 rows. The staged template caps at
    // LIMIT 25 and the seed has more ACTED_IN edges than that, so we
    // assert exactly 25 rows.
    await page.getByRole('button', { name: /run/i }).click()
    await expect(page.locator('span', { hasText: /query_error/i })).toHaveCount(
      0,
      { timeout: 8_000 }
    )
    await expect(page.getByText(/25 rows/)).toBeVisible({ timeout: 8_000 })
  })
})
