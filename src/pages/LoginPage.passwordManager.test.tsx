/**
 * Regression coverage for the "1Password autofill triggers add-profile
 * instead of login" bug. Repro stages:
 *
 *   1. The LoginPage rendered the "+ Add a new profile" `<button
 *      type="button">` INSIDE the `<form>`. The submit CTA is a
 *      `<wa-button type="submit">` — a custom element. Password
 *      managers (1Password, LastPass, Bitwarden) scan the form's DOM
 *      for a NATIVE `button[type="submit"]` / `input[type="submit"]`
 *      to click after autofill; the custom element is invisible to
 *      that selector. The add-profile button — the only native
 *      `<button>` left in the form — became the de-facto submit
 *      target, so autofill flipped the page into OnboardProfileForm.
 *
 *   2. Browsers fall through similar heuristics when Enter is pressed
 *      in a password input: they want to click the implicit native
 *      submit button. With no native submit inside the form, Enter
 *      could submit the form (good) OR — in some browser/extension
 *      combos — fall through to clicking the next native button (bad).
 *
 * Fix invariants this file pins:
 *
 *   A. The add-profile toggle MUST NOT live inside the login form.
 *      Anything inside the form is a candidate password-manager
 *      submit target, no matter what `type` it carries.
 *   B. The form MUST contain at least one NATIVE `<button
 *      type="submit">` element (visible or hidden) so password
 *      managers + Enter-key submission find a real submit anchor.
 *   C. Form submission MUST call signIn — never setShowOnboard —
 *      regardless of which native button inside the form is clicked.
 */

import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from 'styled-components'

import { testTheme as theme } from '../test-utils/theme'
import { LoginPage } from './LoginPage'
import { ConnectionsProvider } from '../api/connections'
import { AuthProvider } from '../auth/AuthProvider'

jest.mock('../api/auth', () => ({
  ...jest.requireActual('../api/auth'),
  fetchPublicProfiles: jest.fn(async () => [
    { name: 'default', description: 'Default cluster' },
  ]),
  login: jest.fn(async () => ({ access_token: 'fake.jwt.token' })),
}))

const renderLogin = () =>
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <ConnectionsProvider>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </ConnectionsProvider>
      </MemoryRouter>
    </ThemeProvider>
  )

describe('LoginPage — password-manager autofill safety', () => {
  beforeEach(() => {
    const mod = jest.requireMock('../api/auth') as {
      login: jest.Mock
      fetchPublicProfiles: jest.Mock
    }
    mod.login.mockClear()
    mod.fetchPublicProfiles.mockResolvedValue([
      { name: 'default', description: 'Default cluster' },
    ])
  })

  test('the add-profile toggle is NOT a descendant of the login form', async () => {
    renderLogin()
    await waitFor(() => {
      expect(screen.getByTestId('login-submit-btn')).toBeInTheDocument()
    })
    const addProfile = screen.getByTestId('login-add-profile')
    // Walk up the ancestor chain — if any ancestor is the login <form>
    // a password manager can plausibly fire its "click the first
    // button in the form" heuristic against this control. Pin that
    // structural invariant here.
    const ancestors: HTMLElement[] = []
    let cursor: HTMLElement | null = addProfile.parentElement
    while (cursor) {
      ancestors.push(cursor)
      cursor = cursor.parentElement
    }
    const enclosingForm = ancestors.find((a) => a.tagName === 'FORM')
    expect(enclosingForm).toBeUndefined()
  })

  test('the login form exposes at least one NATIVE submit button', async () => {
    renderLogin()
    await waitFor(() => {
      expect(screen.getByTestId('login-submit-btn')).toBeInTheDocument()
    })
    // Pick the form by the submit button's first <form> ancestor — the
    // wa-button host (also a custom element) is the visible submit CTA,
    // but it lives inside the same form regardless.
    const submit = screen.getByTestId('login-submit-btn')
    let formEl: HTMLElement | null = submit.parentElement
    while (formEl && formEl.tagName !== 'FORM') formEl = formEl.parentElement
    expect(formEl).not.toBeNull()
    const nativeSubmits = formEl!.querySelectorAll(
      'button[type="submit"], input[type="submit"]'
    )
    // At least one native submit-typed element must exist so password
    // managers and Enter-key submission have a real anchor.
    expect(nativeSubmits.length).toBeGreaterThanOrEqual(1)
  })

  test('submitting the form via dispatchEvent("submit") calls signIn (not setShowOnboard)', async () => {
    const mod = jest.requireMock('../api/auth') as { login: jest.Mock }
    renderLogin()
    await waitFor(() => {
      expect(screen.getByTestId('login-submit-btn')).toBeInTheDocument()
    })

    // Simulate the password-manager autofill path: write values into
    // the wa-input host's `value` property (no synthetic input event),
    // then dispatch a native submit on the form. The submit handler
    // must read live DOM values and call login() — NOT flip into the
    // onboarding view.
    const usernameHost = screen.getByTestId('login-username') as HTMLElement & {
      value?: string
    }
    const passwordHost = screen.getByTestId('login-password') as HTMLElement & {
      value?: string
    }
    usernameHost.value = 'autofilled-user'
    passwordHost.value = 'autofilled-password'

    // Find the enclosing form and dispatch a real submit event.
    let formEl: HTMLElement | null = usernameHost.parentElement
    while (formEl && formEl.tagName !== 'FORM') formEl = formEl.parentElement
    expect(formEl).not.toBeNull()
    fireEvent.submit(formEl!)

    await waitFor(() => {
      expect(mod.login).toHaveBeenCalledTimes(1)
    })
    // The onboard form must NOT have replaced the login form.
    expect(screen.queryByTestId('onboard-name')).toBeNull()
  })

  test('a password-manager clicking the first native button in the form does not flip into onboarding', async () => {
    const mod = jest.requireMock('../api/auth') as { login: jest.Mock }
    renderLogin()
    await waitFor(() => {
      expect(screen.getByTestId('login-submit-btn')).toBeInTheDocument()
    })

    // Provide credentials via the autofill path (DOM property, no event).
    const usernameHost = screen.getByTestId('login-username') as HTMLElement & {
      value?: string
    }
    const passwordHost = screen.getByTestId('login-password') as HTMLElement & {
      value?: string
    }
    usernameHost.value = 'autofilled-user'
    passwordHost.value = 'autofilled-password'

    // Find the form, then locate the FIRST native button inside it —
    // this is the element 1Password's "click the submit-looking button"
    // heuristic typically lands on.
    let formEl: HTMLElement | null = usernameHost.parentElement
    while (formEl && formEl.tagName !== 'FORM') formEl = formEl.parentElement
    expect(formEl).not.toBeNull()
    const firstNativeButton = formEl!.querySelector(
      'button'
    ) as HTMLButtonElement | null
    expect(firstNativeButton).not.toBeNull()
    // It must be a submit-type button — pre-fix this was the
    // type="button" add-profile toggle, which silently swapped the
    // login form for the onboarding form.
    expect(firstNativeButton!.type).toBe('submit')

    fireEvent.click(firstNativeButton!)

    await waitFor(() => {
      expect(mod.login).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByTestId('onboard-name')).toBeNull()
  })

  test('username/password inputs declare the correct autocomplete contract', async () => {
    renderLogin()
    await waitFor(() => {
      expect(screen.getByTestId('login-submit-btn')).toBeInTheDocument()
    })
    const username = screen.getByTestId('login-username')
    const password = screen.getByTestId('login-password')
    // The wa-input host forwards `autocomplete` to its inner shadow
    // input. The host attribute is what matters for password-manager
    // detection — assert it directly.
    expect(username.getAttribute('autocomplete')).toBe('username')
    expect(password.getAttribute('autocomplete')).toBe('current-password')
  })
})
