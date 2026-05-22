// Regression coverage for the "1Password autofill triggers Add-profile
// instead of Sign-in" bug.
//
// 1Password (and similar password managers — Bitwarden, LastPass,
// Chrome built-in) work in two phases:
//
//   1) Fill the credential fields by writing to the input element's
//      `value` property. The wrapper wa-input host *property* updates;
//      no React onInput event fires because the password manager
//      writes via the DOM, not via synthetic keystrokes. The existing
//      26-login-edge-cases spec covers the "read live DOM at submit"
//      half of that contract.
//
//   2) Auto-submit by clicking a "submit-looking" button. Password
//      managers' selectors specifically look for native
//      `button[type="submit"]`, `input[type="submit"]`, or buttons
//      with submit-y text. `<wa-button>` is a custom element — even
//      though Web Awesome implements form-associated semantics via
//      ElementInternals, password managers' DOM scanners typically
//      miss it. With no native submit anchor inside the form, the
//      manager falls through to clicking the next visible native
//      `<button>` in the form — pre-fix that was the "+ Add a new
//      profile" toggle, which silently swapped the page into the
//      OnboardProfileForm.
//
// This spec exercises both halves at once: it fills the credentials by
// setting the host wa-input's `value` PROPERTY (no input event), then
// asks the browser to submit the form the way 1Password's auto-submit
// would. We verify that the page lands authenticated, NOT in the
// onboarding view.

import { test, expect } from '@playwright/test'
import { sel } from '../helpers/selectors'

const USER = process.env.ADMIN_USER ?? 'geode'
const PASS = process.env.ADMIN_PASSWORD ?? 'Geode E2E Bootstrap Password 2024'

test.describe('login: password-manager autofill safety', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies()
    await context.clearPermissions()
  })

  test('the add-profile toggle is not a child of the login form', async ({
    page,
  }) => {
    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')
    await expect(sel.loginSubmit(page)).toBeVisible()

    // The add-profile toggle MUST live outside the <form> element so
    // password managers' "click the first button in the form" submit
    // heuristic can never pick it up.
    const addProfile = page.getByTestId('login-add-profile')
    await expect(addProfile).toBeVisible()
    const insideForm = await addProfile.evaluate((el) => {
      let cursor: HTMLElement | null = el.parentElement
      while (cursor) {
        if (cursor.tagName === 'FORM') return true
        cursor = cursor.parentElement
      }
      return false
    })
    expect(insideForm).toBe(false)
  })

  test('login form exposes a native submit anchor for password managers', async ({
    page,
  }) => {
    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')
    await expect(sel.loginSubmit(page)).toBeVisible()

    // The form must contain at least one native button[type="submit"]
    // (visible or visually hidden) so password-manager DOM scanners
    // and Enter-key submission have a real anchor to drive.
    const nativeSubmitCount = await page.evaluate(() => {
      const form = document.querySelector('form')
      if (!form) return 0
      return form.querySelectorAll(
        'button[type="submit"], input[type="submit"]'
      ).length
    })
    expect(nativeSubmitCount).toBeGreaterThanOrEqual(1)
  })

  test('autofill via wa-input value-property + form.requestSubmit() logs in (not onboard)', async ({
    page,
  }) => {
    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')
    // Same profile-pinning rationale as 01-auth.spec.ts: other specs
    // persist new profiles in the same compose stack so the seed row
    // may not be auto-selected by the time this test runs.
    await page.getByTestId('profile-filter-row-default').click()

    // Stage 1 — fill via host `value` property, no input event.
    // Equivalent to how 1Password injects credentials.
    await page.evaluate(
      ({ user, pass }) => {
        const u = document.querySelector(
          'wa-input[data-testid="login-username"]'
        ) as HTMLElement & { value?: string }
        const p = document.querySelector(
          'wa-input[data-testid="login-password"]'
        ) as HTMLElement & { value?: string }
        if (u) u.value = user
        if (p) p.value = pass
      },
      { user: USER, pass: PASS }
    )

    // Stage 2 — auto-submit the form via the API the password manager
    // (or a browser pressing Enter) would use. requestSubmit() runs
    // form validation and fires a real `submit` event, which the React
    // handler converts into a signIn() call. Pre-fix the form had no
    // native submit anchor — requestSubmit() with no target button
    // failed-soft on some browsers and 1Password resorted to clicking
    // the add-profile button instead.
    await page.evaluate(() => {
      const form = document.querySelector('form') as HTMLFormElement | null
      if (!form) throw new Error('no form found on /login')
      form.requestSubmit()
    })

    // We end up authenticated — NOT in the onboard view.
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 8_000 })
    await expect(page.getByTestId('onboard-name')).toHaveCount(0)
  })

  test('autofill + clicking the first native button in the form logs in (not onboard)', async ({
    page,
  }) => {
    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')
    await page.getByTestId('profile-filter-row-default').click()

    // Fill via DOM property (no input event).
    await page.evaluate(
      ({ user, pass }) => {
        const u = document.querySelector(
          'wa-input[data-testid="login-username"]'
        ) as HTMLElement & { value?: string }
        const p = document.querySelector(
          'wa-input[data-testid="login-password"]'
        ) as HTMLElement & { value?: string }
        if (u) u.value = user
        if (p) p.value = pass
      },
      { user: USER, pass: PASS }
    )

    // Click the FIRST native <button> inside the form — this is the
    // element 1Password's auto-submit heuristic typically lands on.
    // It MUST be a submit button (pre-fix it was the type="button"
    // add-profile toggle, which flipped into onboarding).
    const firstButton = await page.evaluate(() => {
      const form = document.querySelector('form') as HTMLFormElement | null
      if (!form) return null
      const btn = form.querySelector('button') as HTMLButtonElement | null
      return btn ? { type: btn.type, testId: btn.dataset.testid ?? null } : null
    })
    expect(firstButton).not.toBeNull()
    expect(firstButton!.type).toBe('submit')

    // Click it the way the password manager would.
    await page.evaluate(() => {
      const form = document.querySelector('form') as HTMLFormElement | null
      const btn = form?.querySelector('button') as HTMLButtonElement | null
      btn?.click()
    })

    await expect(page).not.toHaveURL(/\/login$/, { timeout: 8_000 })
    await expect(page.getByTestId('onboard-name')).toHaveCount(0)
  })

  test('pressing Enter in the password field submits to login, not onboarding', async ({
    page,
  }) => {
    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')
    await page.getByTestId('profile-filter-row-default').click()

    await sel.loginUsername(page).fill(USER)
    await sel.loginPassword(page).fill(PASS)
    // Enter inside a focused input is the classic "submit the form"
    // gesture. Pre-fix, with no native submit anchor in the form, this
    // could fall through to clicking the next native button (the
    // add-profile toggle). Post-fix the form has a real submit anchor.
    await sel.loginPassword(page).press('Enter')

    await expect(page).not.toHaveURL(/\/login$/, { timeout: 8_000 })
    await expect(page.getByTestId('onboard-name')).toHaveCount(0)
  })
})
