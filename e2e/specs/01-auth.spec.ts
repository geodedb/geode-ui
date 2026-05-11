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
    // LoginPage renders a profile-list picker fed by /api/v1/profiles/public
    // (Plan C). The first profile auto-selects on mount and the seed has
    // 'default' as the only system profile, so we just confirm the
    // picker is showing and proceed.
    await expect(page.getByRole('button', { name: /^default$/i })).toBeVisible()
    await sel.loginUsername(page).fill(USER)
    await sel.loginPassword(page).fill(PASS)
    await sel.loginSubmit(page).click()
    await expect(page).toHaveURL(/\/$/)
    // The query editor is the index of the protected shell.
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

  test('reload after login: browser mode redirects to /login (post-rebuild)', async ({
    page,
  }) => {
    // Plan B+C deliberately moved JWT storage from localStorage (DOM-XSS
    // surface) to an in-memory ConnectionsContext latch. After a hard
    // reload, the latch is empty; ProtectedRoute then gates on
    // useActiveConnection() != null and redirects to /login. The auth
    // cookie remains valid server-side — re-login with the same
    // credentials is a one-click round-trip — but the UI design no
    // longer "remembers" the session across reload in browser mode.
    // (Electron mode auto-restores from safeStorage; tested separately.)
    await page.goto('/login')
    await sel.loginUsername(page).fill(USER)
    await sel.loginPassword(page).fill(PASS)
    await sel.loginSubmit(page).click()
    await expect(page).toHaveURL(/\/$/)
    await page.reload()
    await expect(page).toHaveURL(/\/login$/)
  })

  test('logout clears auth cookie and redirects', async ({ page, context }) => {
    await page.goto('/login')
    await sel.loginUsername(page).fill(USER)
    await sel.loginPassword(page).fill(PASS)
    await sel.loginSubmit(page).click()
    await expect(page).toHaveURL(/\/$/)
    await sel.logout(page).click()
    await expect(page).toHaveURL(/\/login$/)
    // Auth cookie cleared (Set-Cookie with Max-Age=0 from /auth/logout).
    const authCookie = (await context.cookies()).find(
      (c) => c.name === 'geode-ui-auth'
    )
    expect(authCookie).toBeUndefined()
  })
})
