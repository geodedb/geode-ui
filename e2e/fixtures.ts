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
    // Seed the SPA's per-mount auth state.
    //
    // - geode-ui.session-hint: AuthProvider reads this from sessionStorage
    //   on mount (it cannot see the HttpOnly auth cookie). Without it,
    //   isAuthed starts false and ProtectedRoute redirects to /login even
    //   though the cookie is valid.
    // - geode-ui.profile: non-secret default profile name, cached in
    //   localStorage so the picker doesn't reset on first render.
    // - __GEODE_E2E_INITIAL_CONNECTIONS__: post-multi-session-rebuild
    //   ProtectedRoute gates on useActiveConnection() != null. Production
    //   primes that latch via signIn / Electron's secure store; tests
    //   shortcut by seeding the global the SPA's bootstrap reads as a
    //   fallback (src/index.tsx). The token here is the JWT minted by
    //   the programmatic login above, so Bearer-mode requests authenticate
    //   correctly.
    await ctx.addInitScript((token: string) => {
      sessionStorage.setItem('geode-ui.session-hint', '1')
      localStorage.setItem('geode-ui.profile', 'default')
      // Bracket access avoids the no-underscore-dangle lint and signals
      // that this is a test-only sentinel global. src/index.tsx reads
      // the same key as a fallback when Electron-bridge has nothing.
      const e2eKey = '__GEODE_E2E_INITIAL_CONNECTIONS__'
      const seed = [
        {
          connectionId: 'e2e-seed',
          token,
          profileName: 'default',
          expiresAt: Date.now() + 8 * 3600 * 1000,
        },
      ]
      const w = window as unknown as Record<string, unknown>
      w[e2eKey] = seed
    }, authToken)
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
