import { test, expect } from '@playwright/test'
import { launchElectron } from './helpers'

// The Electron build serves the same React SPA the Go server does. The
// SPA's first paint should be the Login page (ProtectedRoute redirects
// unauthenticated traffic to /login). We deliberately do NOT exercise
// the auth flow against a running geode-ui server here — that is the
// browser-based suite's job. The Electron suite proves only that the
// renderer hosts the SPA correctly: HTML + JS + CSS load, React mounts,
// the login form appears.
test.describe('Electron app — SPA renders Login page', () => {
  test('login form renders without runtime errors', async () => {
    const app = await launchElectron()
    try {
      const window = await app.firstWindow()

      // Capture renderer-side console errors so a missing chunk, a
      // CSP violation, or an unhandled promise rejection in the
      // bootstrap surfaces here rather than as a silent blank page.
      const consoleErrors: string[] = []
      window.on('pageerror', (err) => consoleErrors.push(err.message))
      window.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text())
      })

      await window.waitForLoadState('domcontentloaded')

      // Username + password inputs are the stable identity surface
      // for the login flow — both the browser suite (e2e/specs/01-
      // auth.spec.ts) and the Electron build serve the same SPA, so
      // these test ids are the single contract that anchors both.
      // We assert toBeAttached rather than toBeVisible because the
      // inputs are <wa-input> custom elements whose Shadow DOM-driven
      // bounding box is 0×0 until Web Awesome's hydration scheduler
      // fires; visibility-checks against the host element race that.
      // Attachment is the strongest contract React is responsible for —
      // visibility is Web Awesome's contract, exercised separately by
      // the browser-served suite.
      await expect(window.getByTestId('login-username')).toBeAttached({
        timeout: 15_000,
      })
      await expect(window.getByTestId('login-password')).toBeAttached()
      await expect(window.getByTestId('login-submit-btn')).toBeAttached()

      // Filter out the network errors that surface because there's no
      // backend at geode://app/api/v1/* — those are expected during
      // standalone Electron boot and are surfaced to the user via the
      // LoginPage error banner, not as a silent failure.
      const fatalErrors = consoleErrors.filter(
        (e) =>
          !/Failed to load resource/.test(e) &&
          !/net::ERR_/.test(e) &&
          !/fetch/i.test(e) &&
          !/api\/v1/.test(e)
      )
      expect(
        fatalErrors,
        `Unexpected renderer errors:\n${fatalErrors.join('\n')}`
      ).toEqual([])
    } finally {
      await app.close()
    }
  })
})
