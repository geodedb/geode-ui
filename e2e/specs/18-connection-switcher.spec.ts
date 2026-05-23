// e2e/specs/18-connection-switcher.spec.ts
//
// ConnectionSwitcher behaviors that landed with the multi-connection
// rebuild. The empty/loading-state and menu-anchor tests don't require
// a second connection; the disconnect test does, so it goes through the
// AddConnectionModal flow exercised in 17-add-connection.spec.ts.

import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'

const USER = process.env.ADMIN_USER ?? 'geode'
const PASS = process.env.ADMIN_PASSWORD ?? 'Geode E2E Bootstrap Password 2024'

// Connect a SECOND distinct profile ('social') so the switcher actually
// holds two rows. Pre-2026-05-22 this helper re-added 'default' to
// produce two rows, but the GAP-046 dedupe-by-profileName reducer
// REPLACES same-profile re-adds — exercising it that way only ever
// landed one row.
async function connectSecond(
  page: import('@playwright/test').Page
): Promise<void> {
  await sel.connectionTrigger(page).click()
  await sel.addConnectionMenuItem(page).click()
  await expect(page.locator('select#add-profile')).toBeVisible({
    timeout: 10_000,
  })
  await page.locator('select#add-profile').selectOption('social')
  await page.getByLabel('Username').fill(USER)
  await page.getByLabel('Password').fill(PASS)
  await sel.addConnectionSubmit(page).click()
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })
}

test.describe('connection switcher', () => {
  test('disconnect removes the row from the menu', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    await connectSecond(page)

    await page.getByTestId('connection-trigger').click()
    // Two rows now: one 'default' (from the fixture seed) and one
    // 'social' (just added). The disconnect handler stops
    // propagation, so the menu stays open and we can assert the new
    // count without re-clicking the trigger.
    await expect(
      page.getByRole('menuitemradio', { name: /default/i })
    ).toHaveCount(1)
    await expect(
      page.getByRole('menuitemradio', { name: /social/i })
    ).toHaveCount(1)

    // Disconnect 'social' (the inactive row) so we don't tear down
    // the active session mid-test.
    await page.getByRole('button', { name: 'Disconnect: social' }).click()

    await expect(
      page.getByRole('menuitemradio', { name: /social/i })
    ).toHaveCount(0, { timeout: 5000 })
    await expect(
      page.getByRole('menuitemradio', { name: /default/i })
    ).toHaveCount(1)
  })

  test('unseeded protected shell with no cookie redirects to /login (lazy-hydrate empty)', async ({
    browser,
  }) => {
    // The fixture eagerly seeds __GEODE_E2E_INITIAL_CONNECTIONS__ so
    // ProtectedRoute admits the test page. Without that seed AND
    // without a valid auth cookie, ConnectionsProvider hydrates with
    // an empty map, useActiveConnection() === null, and the route
    // redirects to /login.
    //
    // 2026-05-21 cookie-driven session rehydration (commit 170542d):
    // when the lazy-hydrate path finds no records on disk, it asks
    // the server who we are via /api/v1/auth/whoami. If the cookie is
    // valid the SPA synthesises a placeholder connection and ADMITS
    // — so the original "session-hint + valid cookie → redirect"
    // shape no longer holds. This test now exercises the genuine no-
    // session case (no cookie at all, no seed) which still must
    // redirect.
    const ctx = await browser.newContext()
    // Seed ONLY the session-hint so AuthProvider's optimistic flag
    // is set; we do NOT login, so there is no auth cookie and
    // /api/v1/auth/whoami will 401. Neither of these paths gives
    // ProtectedRoute a non-null active connection.
    await ctx.addInitScript(() => {
      sessionStorage.setItem('geode-ui.session-hint', '1')
    })
    const p = await ctx.newPage()
    await p.goto('/')

    await expect(p).toHaveURL(/\/login$/, { timeout: 5000 })
    await ctx.close()
  })

  test('menu opens within the viewport at narrow widths', async ({
    authedPage: page,
  }) => {
    // Narrow viewport that previously pushed the right-anchored menu
    // off-screen (~17px overflow on desktop, ~33px on mobile). This
    // locks down the fix from commit 0b73836.
    await page.setViewportSize({ width: 360, height: 720 })
    await page.goto('/')

    const triggerBox = await sel.connectionTrigger(page).boundingBox()
    expect(triggerBox).not.toBeNull()
    if (!triggerBox) return

    await sel.connectionTrigger(page).click()

    const menu = page.getByRole('menu').first()
    await expect(menu).toBeVisible()
    const menuBox = await menu.boundingBox()
    expect(menuBox).not.toBeNull()
    if (!menuBox) return

    // Menu's left edge aligns with the trigger's left edge (≤ 4px
    // tolerance for sub-pixel rounding) and the right edge stays on-
    // screen.
    expect(Math.abs(menuBox.x - triggerBox.x)).toBeLessThanOrEqual(4)
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(360 + 1)
  })
})
