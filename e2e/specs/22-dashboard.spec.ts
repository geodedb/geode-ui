import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

// Overview dashboard (/dashboard): an <h1> "Overview" plus a grid of four
// cards (Graphs / Recent queries / Connection / <graph> stats). The Recent
// queries card is fed by useQueryHistory, which records every completed
// query on the Query page (/) and persists to localStorage — Playwright
// gives each test a fresh browser context, so the log starts empty here.
// Each recent row deep-links to /?statement=<urlencoded statement>; the
// Query page reads that param on mount and prefills the editor. The graph
// stats card loads node/edge counts on demand (the "Load stats" button).
test.describe('overview dashboard', () => {
  test('renders the cards and surfaces a recently-run query', async ({
    authedPage: page,
  }) => {
    await page.goto('/dashboard')
    await expect(sel.dashboardGraphsCard(page)).toBeVisible()
    await expect(
      sel.dashboardGraphsCard(page).getByText(seed.graph)
    ).toBeVisible()
    await expect(
      sel.dashboardConnectionCard(page).getByText(/geode/i)
    ).toBeVisible()
    // No queries run yet in this fresh context → the Recent card is empty.
    await expect(sel.dashboardRecentRow(page)).toHaveCount(0)

    // Run a query on the Query page so it lands in the history store.
    await page.goto('/')
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH (m:Movie) RETURN m LIMIT 2`
    )
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/2 rows/)).toBeVisible({ timeout: 10_000 })

    // Back on the dashboard the statement shows up in Recent queries.
    await page.goto('/dashboard')
    await expect(sel.dashboardRecentRow(page).first()).toContainText(
      'MATCH (m:Movie)'
    )

    // Clicking the row re-loads the Query page with that statement.
    await sel.dashboardRecentRow(page).first().getByRole('link').click()
    await expect(page).toHaveURL(/[?&]statement=/)
    await expect(page.locator('.monaco-editor').first()).toContainText(
      'MATCH (m:Movie)'
    )

    // The graph-stats card can pull node/edge counts for the default graph.
    await page.goto('/dashboard')
    if (await sel.dashboardStatsLoad(page).isVisible()) {
      await sel.dashboardStatsLoad(page).click()
      await expect(
        page
          .getByTestId('dashboard-stats-card')
          .getByText(/^\d+$/)
          .first()
      ).toBeVisible({ timeout: 10_000 })
    }
  })
})
