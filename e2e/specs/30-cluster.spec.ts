import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'

// /cluster page — operator view of Raft cluster membership.
// The e2e backend (docker-compose) runs a single-node Geode, so this
// test exercises the standalone branch: nav link must be present, the
// page must render the standalone fallback panel, and the refresh
// button must remain interactive.
//
// If the local backend is swapped to a clustered build (3-node compose
// override), the assertion below relaxes — either the members table OR
// the standalone panel must render, and the refresh button must stay
// clickable in both states.
test.describe('cluster page', () => {
  test('nav link mounts the page; standalone-or-clustered branch renders', async ({
    authedPage: page,
  }) => {
    await page.goto('/dashboard')
    await expect(sel.navCluster(page)).toBeVisible()
    await sel.navCluster(page).click()
    await expect(page).toHaveURL(/\/cluster$/)
    // Either the standalone panel or the members table must be present.
    const standalone = sel.clusterStandalonePanel(page)
    const table = sel.clusterMembersTable(page)
    await expect(async () => {
      const sCount = await standalone.count()
      const tCount = await table.count()
      expect(sCount + tCount).toBeGreaterThanOrEqual(1)
    }).toPass({ timeout: 10_000 })
    // Refresh button must always be present and clickable.
    await expect(sel.clusterRefreshBtn(page)).toBeVisible()
    await sel.clusterRefreshBtn(page).click()
    // No error panel should appear after a manual refresh against a
    // healthy local backend.
    await expect(page.getByTestId('cluster-error-panel')).toHaveCount(0)
  })

  test('cluster role chip appears in the topbar when clustered and links to /cluster', async ({
    authedPage: page,
  }) => {
    await page.goto('/dashboard')
    const chip = sel.clusterRoleChip(page)
    const chipCount = await chip.count()
    if (chipCount === 0) {
      // Standalone backend — there is nothing to assert here. The
      // chip is intentionally hidden on standalone Geode.
      test.info().annotations.push({
        type: 'note',
        description: 'Standalone backend — cluster chip is hidden by design.',
      })
      return
    }
    await expect(chip).toBeVisible()
    await chip.click()
    await expect(page).toHaveURL(/\/cluster$/)
    await expect(sel.clusterMembersTable(page)).toBeVisible()
  })
})
