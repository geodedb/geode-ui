import { test as base, Page, BrowserContext } from '@playwright/test'
import { login } from './helpers/auth'

type Fixtures = {
  authedContext: BrowserContext
  authedPage: Page
}

// `authedContext` boots a fresh browser context with the JWT pre-seeded
// in localStorage so tests skip the login flow. Use this for every test
// that doesn't specifically test login itself.
export const test = base.extend<Fixtures>({
  authedContext: async ({ browser, request }, use) => {
    const token = await login(request)
    const ctx = await browser.newContext()
    // The SPA reads localStorage via the AuthProvider on mount, so
    // initialize the token before the first navigation.
    await ctx.addInitScript((t: string) => {
      localStorage.setItem('geode-ui.access_token', t)
      localStorage.setItem('geode-ui.profile', 'default')
    }, token)
    await use(ctx)
    await ctx.close()
  },

  authedPage: async ({ authedContext }, use) => {
    const page = await authedContext.newPage()
    await use(page)
    await page.close()
  },
})

export { expect } from '@playwright/test'
