// Regression coverage for the "login failed (400)" path the operator
// hit during manual testing. The cause was not the credentials — they
// were correct — but two latent UX/correctness bugs that compound:
//
//   1) api/auth.ts read `err.error_description` from a 400 body, but
//      the genapi-generated handler emits the field as `error`. The
//      fallback "login failed (400)" replaced whatever specific
//      validation message the server sent ("password: too short" /
//      "username: too short"), so the operator saw a 400 with no clue.
//
//   2) LoginPage submitted whatever lived in React state at click
//      time. <wa-input> bridges its inner shadow-DOM <input>'s `input`
//      event back to the host, but Chrome's password-autofill writes
//      to the shadow <input> directly and only fires `change` (not
//      `input`) on the inner element — the wa-input host's value
//      property updates but the React onInput handler never sees a
//      keystroke, so `password` state stays empty. The form submits
//      empty fields, the server rejects with 400 "password: too
//      short", and the operator gets the useless fallback message.
//
// This spec exercises both fixes:
//   - (1) by stubbing the /auth/login response to a 400 with the
//         server's actual body shape and asserting the rendered error
//         text matches.
//   - (2) by setting the wa-input's value PROPERTY programmatically
//         (without dispatching an input event) and submitting; the
//         submit handler must read from the DOM, not from stale state.

import { test, expect } from '@playwright/test'
import { sel } from '../helpers/selectors'

const USER = process.env.ADMIN_USER ?? 'geode'
const PASS = process.env.ADMIN_PASSWORD ?? 'Geode E2E Bootstrap Password 2024'

test.describe('login edge cases', () => {
  test('surfaces the server validation error verbatim (not "login failed")', async ({
    page,
  }) => {
    // Stub the login endpoint to return the exact 400 body shape the
    // genapi handler emits when validation fails.
    await page.route('**/api/v1/auth/login', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'bad request: password: too short' }),
      })
    )

    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')
    await sel.loginUsername(page).fill('any-user')
    await sel.loginPassword(page).fill('any-password')
    await sel.loginSubmit(page).click()

    // The error banner should surface the SERVER message, not the
    // useless "login failed (400)" fallback.
    await expect(
      page.getByRole('alert').filter({ hasText: /password: too short/i })
    ).toBeVisible({ timeout: 5000 })
  })

  test('captures values injected by autofill (no input event fired)', async ({
    page,
  }) => {
    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(300)

    // Simulate Chrome's saved-password autofill: write the values
    // directly into the host wa-input's `value` PROPERTY without
    // dispatching an input/change event from React's point of view.
    // The framework handler will not see a keystroke; the form must
    // read the live DOM value at submit time, not stale React state.
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

    await sel.loginSubmit(page).click()
    // Successful login lands at /.
    await expect(page).toHaveURL(/\/$/, { timeout: 8_000 })
  })
})
