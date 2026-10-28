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

async function connectSecond(
  page: import('@playwright/test').Page
): Promise<void> {
  await sel.connectionTrigger(page).click()
  await sel.addConnectionMenuItem(page).click()
  await page.getByLabel('Username').fill(USER)
  await page.getByLabel('Password').fill(PASS)
  await sel.addConnectionSubmit(page).click()
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 5000 })
}

test.describe('connection switcher', () => {
  test('disconnect removes the row from the menu', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    await connectSecond(page)

    await sel.connectionTrigger(page).click()
    // Should now have two rows. Pick the inactive one to disconnect
    // so we don't tear down the active session mid-test.
    const rows = page.getByRole('menuitemradio', { name: /default/i })
    await expect(rows).toHaveCount(2)

    const active = page.getByRole('menuitemradio', { checked: true })
    const activeId = await active.getAttribute('data-testid')
    expect(activeId).toBeTruthy()
    // Both profiles have the same label. Select by checked state so this
    // always disconnects the inactive session, regardless of insertion order.
    await page
      .getByRole('menuitemradio', { checked: false })
      .getByRole('button', { name: 'Disconnect: default' })
      .click()

    // The web-component dropdown closes on selection. Reopen it before
    // querying visible menu roles, and verify the original session survived.
    await expect(page.getByRole('menu').first()).not.toBeVisible()
    await sel.connectionTrigger(page).click()
    await expect(rows).toHaveCount(1)
    await expect(page.getByTestId(activeId!)).toHaveAttribute('aria-checked', 'true')

  })

  test('unseeded protected shell redirects to /login (lazy-hydrate empty)', async ({
    browser,
  }) => {
    // The fixture eagerly seeds __GEODE_E2E_INITIAL_CONNECTIONS__ so
    // ProtectedRoute admits the test page. Without that seed,
    // ConnectionsProvider hydrates with an empty map, the protected
    // shell sees useActiveConnection() === null, and the route
    // redirects to /login. This is the OBSERVABLE consequence of the
    // PSR-F16 lazy-hydrate path; the aria-busy placeholder branch
    // itself only renders in Electron mode and is covered by
    // src/components/layout/ConnectionSwitcher.test.tsx.
    const apiCtx = await browser.newContext()
    const loginRes = await apiCtx.request.post('/api/v1/auth/login', {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      form: { username: USER, password: PASS, profile: 'default' },
    })
    expect(loginRes.ok()).toBeTruthy()
    const storageState = await apiCtx.request.storageState()
    await apiCtx.close()

    const ctx = await browser.newContext({ storageState })
    // Seed only the session-hint so AuthProvider considers us authed.
    // Do NOT seed __GEODE_E2E_INITIAL_CONNECTIONS__ — that's the whole
    // point of the test.
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
