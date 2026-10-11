import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

// selectGraphAndExpectButtons navigates to /schema, clicks the seeded
// graph button, and waits for every name in `names` to appear as a
// button. The schema introspection API hits the single upstream Geode
// driver, which occasionally takes >12 s under parallel test load — so
// on a timeout we re-navigate and try once more with a fresh window
// (re-navigation remounts SchemaExplorer, dropping its per-graph cache
// and re-issuing the fetch). Two full windows makes a deterministic
// slow-query absorb cleanly while a real regression still fails twice.
async function selectGraphAndExpectButtons(
  page: Page,
  names: readonly string[],
  timeout = 18_000
): Promise<void> {
  // Two 18 s attempts + per-step overhead can exceed Playwright's 30 s
  // default test timeout, so widen it for any test that goes through
  // this path. (Plus the config's retries:1 still backstops a genuinely
  // pathological upstream stall.)
  test.setTimeout(75_000)
  const tryOnce = async (): Promise<boolean> => {
    try {
      await page.goto('/schema')
      // The graph-list button comes from /api/v1/graphs, which can also
      // lag under load — wait for it with a bounded timeout, then click.
      const graphBtn = page.getByRole('button', {
        name: seed.graph,
        exact: true,
      })
      await graphBtn.waitFor({ state: 'visible', timeout })
      await graphBtn.click({ timeout })
      await Promise.all(
        names.map((n) =>
          page
            .getByRole('button', { name: n, exact: true })
            .waitFor({ state: 'visible', timeout })
        )
      )
      return true
    } catch {
      return false
    }
  }
  if (await tryOnce()) return
  // Second attempt with a fresh component mount + fresh timeout window.
  const ok = await tryOnce()
  expect(
    ok,
    `schema buttons [${names.join(', ')}] never appeared after 2 attempts`
  ).toBeTruthy()
}

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
    // exact:true (inside the helper) so 'Movie' label doesn't collide
    // with the 'movies' graph button. The helper retries with a fresh
    // component mount if the upstream introspection query is slow.
    await selectGraphAndExpectButtons(page, seed.labels)
  })

  test('clicking a label stages a MATCH query and navigates to /', async ({
    authedPage: page,
  }) => {
    await selectGraphAndExpectButtons(page, ['Person'])
    await page.getByRole('button', { name: 'Person', exact: true }).click()
    await expect(page).toHaveURL(/\/$/)
    // The editor should now contain MATCH (n:Person) RETURN n LIMIT 25
    // Monaco paints its view lines asynchronously after the lazy editor
    // mounts, so a one-shot textContent() read can race it and see "".
    // Use the auto-retrying assertion instead.
    const editor = page.locator('.monaco-editor').first()
    await expect(editor).toContainText('MATCH')
    await expect(editor).toContainText('Person')
    // The staged query MUST also be runnable end-to-end. Regression
    // test for two distinct bugs:
    //   1. Geode v0.5.11 rejects backtick-quoted identifiers, so the
    //      schema explorer must stage bare-name queries.
    //   2. The staged statement must include `USE GRAPH <graph>;` —
    //      without it Geode runs against no graph context and silently
    //      returns 0 rows. The staged template caps at LIMIT 25, and
    //      the movies seed has more Person nodes than that, so we
    //      assert exactly 25 rows (NOT /\d+ rows?/, which would let a
    //      0-row regression slip through).
    await sel.queryRunBtn(page).click()
    await expect(page.locator('span', { hasText: /query_error/i })).toHaveCount(
      0,
      { timeout: 8_000 }
    )
    await expect(page.getByText(/25 rows?/)).toBeVisible({ timeout: 8_000 })
  })

  test('edge types pane lists ACTED_IN and DIRECTED', async ({
    authedPage: page,
  }) => {
    await selectGraphAndExpectButtons(page, seed.edgeTypes)
  })

  test('clicking an edge type stages a runnable MATCH', async ({
    authedPage: page,
  }) => {
    await selectGraphAndExpectButtons(page, ['ACTED_IN'])
    await page.getByRole('button', { name: 'ACTED_IN', exact: true }).click()
    await expect(page).toHaveURL(/\/$/)
    // Monaco paints its view lines asynchronously after the lazy editor
    // mounts, so a one-shot textContent() read can race it and see "".
    // Use the auto-retrying assertion instead.
    const editor = page.locator('.monaco-editor').first()
    await expect(editor).toContainText('MATCH')
    await expect(editor).toContainText('ACTED_IN')

    // Run it. Same regression as the label test — without USE GRAPH the
    // query silently returns 0 rows. The staged template caps at
    // LIMIT 25 and the seed has more ACTED_IN edges than that, so we
    // assert exactly 25 rows.
    await sel.queryRunBtn(page).click()
    await expect(page.locator('span', { hasText: /query_error/i })).toHaveCount(
      0,
      { timeout: 8_000 }
    )
    await expect(page.getByText(/25 rows?/)).toBeVisible({ timeout: 8_000 })
  })
})
