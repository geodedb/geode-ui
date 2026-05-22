// e2e/specs/41-login-react-185-repro.spec.ts
//
// Regression for React Minified error #185 ("Maximum update depth
// exceeded") on /dashboard immediately after login.
//
// Root cause was NOT in LoginPage — it was the `entriesFor()`
// selector in src/lib/useQueryHistory.ts returning a fresh empty
// array literal each call (`s.byProfile[name] ?? []`). Zustand's
// `useStore(selector)` is built on `useSyncExternalStore` which
// compares the selector result with `Object.is`. Two different `[]`
// references are not Object.is-equal, so React thought the snapshot
// had changed every render and scheduled another render to recheck —
// the classic "selector returns a new reference each call" infinite
// loop.
//
// The bug surfaced first via 1Password autofill because the
// 2026-05-22 password-manager safety fix correctly routes the auto-
// submit gesture into the live signIn() path, which navigates the
// SPA to /dashboard, which mounts DashboardPage, which calls
// `useQueryHistory((s) => entriesFor(s, profileName))`. Before that
// the autofill click was landing on the Add-profile button and
// silently swapping the page into the onboarding flow, so the
// dashboard never mounted and the loop never had a chance to fire.
//
// The fix lives in src/lib/useQueryHistory.ts — entriesFor() now
// returns a shared frozen `EMPTY_ENTRIES` singleton when the
// profile has no entries. This spec drives the full 1Password-style
// fill+submit path against the live compose stack and asserts no
// pageerror / console.error matching #185 fires within a short
// settle window after navigation lands on /dashboard.

import { test, expect } from '@playwright/test'
import { sel } from '../helpers/selectors'

const USER = process.env.ADMIN_USER ?? 'geode'
const PASS = process.env.ADMIN_PASSWORD ?? 'Geode E2E Bootstrap Password 2024'

test('login + dashboard render does not trip React #185 (max-update-depth)', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await page.goto('/login')
  await page.waitForLoadState('domcontentloaded')
  await page.getByTestId('profile-filter-row-default').click()

  // Drive the same fill+click path the operator uses (which is also
  // what triggered the user-reported #185 once the 2026-05-22
  // password-manager fix correctly routed autofill into the live
  // login flow). The exact event sequence isn't load-bearing here —
  // the goal is just to land on /dashboard so the useQueryHistory
  // selector runs against the lazy-hydrated state. The selector
  // stability bug was triggered by /dashboard mounting, not by the
  // particular fill flavour.
  await sel.loginUsername(page).fill(USER)
  await sel.loginPassword(page).fill(PASS)
  await sel.loginSubmit(page).click()

  // Let the SPA settle — sign-in resolves, navigation lands on
  // /dashboard, useQueryHistory's selector runs against the fresh
  // (empty) state, and the dashboard's data hooks fire their
  // initial fetches.
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 8_000 })
  await page.waitForTimeout(1500)

  const react185 = errors.filter((e) =>
    /Minified React error #185|invariant=185|Maximum update depth/i.test(e)
  )
  if (react185.length > 0) {
    // Dump the full captured-errors log so the CI log shows what
    // fired around the #185 hit. e2e specs are allowed to log
    // diagnostics — these surfaces in Playwright's per-test stdout
    // attachment, not the production app.
    // eslint-disable-next-line no-console
    console.log(`captured errors:\n${errors.join('\n')}`)
  }
  expect(react185).toEqual([])

  // Belt-and-braces: the protected shell rendered enough that we can
  // click into /query. Pre-fix the ErrorBoundary swallowed the
  // dashboard render and replaced it with the "Something went wrong"
  // panel, so this link never appeared.
  await expect(page.getByRole('link', { name: 'Query' })).toBeVisible({
    timeout: 8_000,
  })
})
