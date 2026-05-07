import { test as base, Page, BrowserContext } from '@playwright/test'
import { login } from './helpers/auth'

type Fixtures = {
  authedContext: BrowserContext
  authedPage: Page
  authToken: string
}

// `authToken` is the JWT string returned by /api/v1/auth/login. Tests
// that hit the API directly via Authorization: Bearer should depend on
// this fixture instead of pulling the token out of localStorage (which
// is no longer used post-S3c — auth is cookie-based now).
//
// `authedContext` boots a fresh browser context with the auth cookie
// pre-installed. It uses Playwright's storageState bridge to copy the
// cookie jar from the APIRequestContext (which login() populated via
// the response's Set-Cookie header) into the browser. The CSRF cookie
// is issued lazily by the SPA on its first state-changing request, so
// we don't need to seed it here.
export const test = base.extend<Fixtures>({
  authToken: async ({ request }, use) => {
    const token = await login(request)
    await use(token)
  },

  authedContext: async ({ browser, request, authToken }, use) => {
    // The authToken fixture is what runs login(); referencing it here
    // forces Playwright to evaluate it before we read storageState.
    if (!authToken) throw new Error('login did not return a token')
    const ctx = await browser.newContext({
      storageState: await request.storageState(),
    })
    // Seed the SPA's per-mount auth hint and profile cache.
    //
    // - geode-ui.session-hint: AuthProvider reads this from sessionStorage
    //   on mount (it cannot see the HttpOnly auth cookie). Without it,
    //   isAuthed starts false and ProtectedRoute redirects to /login even
    //   though the cookie is valid.
    // - geode-ui.profile: non-secret default profile name, cached in
    //   localStorage so the picker doesn't reset on first render.
    await ctx.addInitScript(() => {
      sessionStorage.setItem('geode-ui.session-hint', '1')
      localStorage.setItem('geode-ui.profile', 'default')
    })
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
