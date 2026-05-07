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
    await sel.loginProfile(page).fill('default')
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

  test('token persists across reloads', async ({ page }) => {
    await page.goto('/login')
    await sel.loginUsername(page).fill(USER)
    await sel.loginPassword(page).fill(PASS)
    await sel.loginSubmit(page).click()
    await expect(page).toHaveURL(/\/$/)
    await page.reload()
    await expect(page).toHaveURL(/\/$/)
    await expect(sel.queryRunBtn(page)).toBeVisible()
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
