// e2e/specs/17-add-connection.spec.ts
//
// AddConnectionModal coverage. The modal opens from two places in the
// ConnectionSwitcher: the empty-state Connect button (no connections)
// and the "+ Add another connection" footer row (one or more
// connections present). The fixture seeds an active connection, so we
// exercise the second path.
//
// The modal:
//   - Fetches the public-profile list and the authenticated profile
//     list on open. Either failure surfaces a distinct warning
//     ([data-testid=add-connection-public-profile-warning] /
//     [data-testid=add-connection-authed-profile-warning]).
//   - Submitting calls AuthProvider.connectMore() which logs in against
//     /auth/login and refreshes the CSRF token (GAP-PSR-G03).

import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'

const USER = process.env.ADMIN_USER ?? 'geode'
const PASS = process.env.ADMIN_PASSWORD ?? 'Geode E2E Bootstrap Password 2024'

test.describe('add connection modal', () => {
  test('opens from the switcher add-row affordance', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    await sel.connectionTrigger(page).click()
    await sel.addConnectionMenuItem(page).click()

    // Modal heading + submit button visible.
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(sel.addConnectionSubmit(page)).toBeVisible()
  })

  test('surfaces a warning when /profiles/public fails on open (PSR-G04)', async ({
    authedPage: page,
  }) => {
    await page.route('**/api/v1/profiles/public', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'unavailable' }),
      })
    )

    await page.goto('/')
    await sel.connectionTrigger(page).click()
    await sel.addConnectionMenuItem(page).click()

    await expect(sel.addConnectionPublicProfileWarning(page)).toBeVisible({
      timeout: 5000,
    })

    // Form still usable (username + password + submit still rendered).
    await expect(page.getByLabel('Username')).toBeVisible()
    await expect(sel.addConnectionSubmit(page)).toBeVisible()
  })

  test('surfaces a warning when /profiles fails on open (PSR-G10)', async ({
    authedPage: page,
  }) => {
    // Allow /profiles/public through (so the public picker hydrates) and
    // intercept the authenticated /profiles list to fail. The two
    // warnings render independently, so the public-profile dropdown
    // populates while the saved-username dropdown does not.
    await page.route('**/api/v1/profiles', (route, req) => {
      if (req.method() === 'GET') {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'internal' }),
        })
      }
      return route.continue()
    })

    await page.goto('/')
    await sel.connectionTrigger(page).click()
    await sel.addConnectionMenuItem(page).click()

    await expect(sel.addConnectionAuthedProfileWarning(page)).toBeVisible({
      timeout: 5000,
    })
    // The public picker hydrated, so the public-profile warning must NOT show.
    await expect(sel.addConnectionPublicProfileWarning(page)).toHaveCount(0)
  })

  test('successful connect adds a second row to the switcher', async ({
    authedPage: page,
  }) => {
    // 2026-05-22: GAP-046 dedupe-by-profileName replaces a same-
    // profile re-add rather than creating a duplicate row. To prove
    // "a successful connectMore reaches the chrome", target a
    // DIFFERENT profile (social) — the resulting menu must hold one
    // default row AND one social row.
    await page.goto('/')
    await page.getByTestId('connection-trigger').click()
    await sel.addConnectionMenuItem(page).click()

    // Flip the public-profile picker to the second profile so the
    // connection lands under a fresh profileName. Wait for the
    // <select> to materialise — the picker is an <input> fallback
    // while the public-profiles fetch is still in flight.
    await expect(page.locator('select#add-profile')).toBeVisible({
      timeout: 10_000,
    })
    await page.locator('select#add-profile').selectOption('social')
    await page.getByLabel('Username').fill(USER)
    await page.getByLabel('Password').fill(PASS)
    await sel.addConnectionSubmit(page).click()

    // Modal closes on success; reopen the switcher and confirm the
    // chrome now holds rows for BOTH profiles.
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })
    await page.getByTestId('connection-trigger').click()
    await expect(
      page.getByRole('menuitemradio', { name: /default/i })
    ).toHaveCount(1, { timeout: 5000 })
    await expect(
      page.getByRole('menuitemradio', { name: /social/i })
    ).toHaveCount(1, { timeout: 5000 })
  })
})
