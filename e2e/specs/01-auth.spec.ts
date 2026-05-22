import { test, expect } from '@playwright/test'
import { sel } from '../helpers/selectors'

const USER = process.env.ADMIN_USER ?? 'geode'
const PASS = process.env.ADMIN_PASSWORD ?? 'Geode E2E Bootstrap Password 2024'

test.describe('auth', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies()
    await context.clearPermissions()
  })

  test('redirects unauthenticated user from / to /login', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await expect(sel.loginSubmit(page)).toBeVisible()
  })

  test('login flow: fill, submit, land on /', async ({ page }) => {
    await page.goto('/login')
    // LoginPage renders a filterable profile picker fed by
    // /api/v1/profiles/public (2026-05-21 login profile UX, Task 5/7).
    // Each row in the picker carries a stable
    // `profile-filter-row-{name}` testid. The first row in the list
    // auto-selects on mount, but other specs (notably
    // 39-profile-onboarding.spec.ts) persist new profiles in the same
    // compose stack — by the time this test runs the `default` row may
    // no longer be first. Click it explicitly so the submit always
    // targets the seed profile rather than relying on list ordering.
    const defaultRow = page.getByTestId('profile-filter-row-default')
    await expect(defaultRow).toBeVisible()
    await defaultRow.click()
    await sel.loginUsername(page).fill(USER)
    await sel.loginPassword(page).fill(PASS)
    await sel.loginSubmit(page).click()
    // Post-login the SPA's IndexRoute redirects through `/` to
    // `/dashboard` (Bug 1 fix in 6808b04). Assert "no longer on /login"
    // rather than matching a specific landing path so future routing
    // tweaks don't churn this test. Then navigate to /query to confirm
    // the protected shell is reachable (preserves the original test's
    // queryRunBtn visibility check).
    await expect(page).not.toHaveURL(/\/login$/)
    await sel.navQuery(page).click()
    await expect(sel.queryRunBtn(page)).toBeVisible()
  })

  test('bad credentials surface a visible error', async ({ page }) => {
    await page.goto('/login')
    await sel.loginUsername(page).fill('not-a-real-user')
    await sel.loginPassword(page).fill('wrong')
    await sel.loginSubmit(page).click()
    await expect(
      page.getByText(
        /invalid|unauthorized|incorrect|authentication failed|failed/i
      )
    ).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test('reload after login: browser mode rehydrates the session from the cookie', async ({
    page,
  }) => {
    // Bug 2 (commit 170542d, 2026-05-21): cookie-driven session
    // rehydration. The HttpOnly geode-ui-auth cookie persists across a
    // hard reload; ConnectionsProvider's lazy-hydrate path now follows
    // up the empty Electron secure-store with a /api/v1/auth/whoami
    // round-trip, synthesises a placeholder ConnectionState on 200,
    // and ProtectedRoute admits the protected shell instead of
    // bouncing to /login. Pre-fix the SPA dumped the operator back on
    // /login on every refresh even though the cookie was still valid.
    await page.goto('/login')
    // Pin the profile to `default` — see the comment in "login flow"
    // for why we don't rely on the auto-selected first row.
    await page.getByTestId('profile-filter-row-default').click()
    await sel.loginUsername(page).fill(USER)
    await sel.loginPassword(page).fill(PASS)
    await sel.loginSubmit(page).click()
    // Post-login the SPA's IndexRoute redirects through `/` to
    // `/dashboard` (Bug 1 fix in 6808b04). Assert "no longer on /login"
    // rather than matching a specific landing path so future routing
    // tweaks don't churn this test.
    await expect(page).not.toHaveURL(/\/login$/)
    await page.reload()
    await expect(page).not.toHaveURL(/\/login$/)
  })

  test('logout clears auth cookie and redirects', async ({ page, context }) => {
    await page.goto('/login')
    // Pin the profile to `default` — see the comment in "login flow"
    // for why we don't rely on the auto-selected first row.
    await page.getByTestId('profile-filter-row-default').click()
    await sel.loginUsername(page).fill(USER)
    await sel.loginPassword(page).fill(PASS)
    await sel.loginSubmit(page).click()
    // Post-login the SPA's IndexRoute redirects through `/` to
    // `/dashboard` (Bug 1 fix in 6808b04). Assert "no longer on /login"
    // rather than matching a specific landing path so future routing
    // tweaks don't churn this test.
    await expect(page).not.toHaveURL(/\/login$/)
    await sel.logout(page).click()
    await expect(page).toHaveURL(/\/login$/)
    // Auth cookie cleared (Set-Cookie with Max-Age=0 from /auth/logout).
    const authCookie = (await context.cookies()).find(
      (c) => c.name === 'geode-ui-auth'
    )
    expect(authCookie).toBeUndefined()
  })
})
