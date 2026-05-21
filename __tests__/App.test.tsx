import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import App from '../src/App'

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    // Reset the URL so each test starts at `/` regardless of which
    // route the previous test navigated through.
    window.history.replaceState(null, '', '/')
  })

  test('redirects unauthenticated users to login', async () => {
    render(<App />)
    expect(
      screen.getByRole('heading', { level: 1, name: /Sign in/i })
    ).toBeInTheDocument()
    // QUALITY #227: LoginPage kicks off `fetchPublicProfiles()` on mount;
    // the rejected promise (no backend mocked in this smoke test) flips
    // `loadErr` to true. Without awaiting the failure the setState
    // fires after the test exits, producing an act() warning. Wait for
    // the username input — always rendered on the login branch (the
    // post-Task-7 LoginPage drops the ProfileFilter entirely when
    // `loadErr` is true, so `#login-profile` is no longer a reliable
    // sentinel) — to confirm the rejection finished.
    await waitFor(() => {
      expect(document.querySelector('#login-username')).not.toBeNull()
    })
  })

  // SEC issue 264 (S-NEW-10): a logged-in non-admin user who navigates
  // to /admin must be redirected away. The route MUST NOT render the
  // AdminPage scaffold (which would leak the route's existence) and
  // MUST NOT render any visible "403" body. This is the App-level
  // integration counterpart to the unit-level RoleGate.test.tsx pin —
  // it exercises the wiring in src/App.tsx::AdminPageGated, not the
  // RoleGate component in isolation.
  //
  // Note on defense-in-depth: ProtectedRoute also redirects to /login
  // when there is no active connection. With no real backend mocked in
  // this smoke test the active connection is null, so the redirect
  // would fire even if RoleGate were removed. The load-bearing unit
  // pin for RoleGate's specific contribution is in
  // src/auth/RoleGate.test.tsx (4 cases including
  // "redirects to fallback when the caller lacks the required role").
  // This App-level test asserts the end-to-end observable: a non-admin
  // who lands on /admin/users does NOT see the AdminPage scaffold and
  // is not parked at /admin/users.
  test('redirects authenticated non-admin away from /admin (issue 264)', async () => {
    // Spoof an authenticated non-admin session. AuthProvider's initial
    // mount reads:
    //   sessionStorage['geode-ui.session-hint']  -> isAuthed
    //   sessionStorage['geode-ui.session-roles'] -> roles[]
    // (see src/auth/AuthProvider.tsx::AUTH_HINT_KEY / AUTH_ROLES_KEY).
    // The cookie is HttpOnly so production reads the same hint to
    // bridge a reload; we use the documented seam here.
    sessionStorage.setItem('geode-ui.session-hint', '1')
    sessionStorage.setItem(
      'geode-ui.session-roles',
      JSON.stringify(['user']) // intentionally NOT 'admin'
    )
    window.history.replaceState(null, '', '/admin/users')

    render(<App />)

    // RoleGate's contract: redirect to '/' with the original location
    // in router state. After a tick the AdminPage scaffold must NOT
    // appear, and a forbidden/403 body must NOT appear (the redirect
    // IS the response).
    //
    // We probe two independent signals:
    //   1. window.location.pathname has changed off /admin/users.
    //   2. The AdminPage tab strip — which renders "Users" / "Roles"
    //      / "Policies" / etc. from i18n key `nav.adminTab*` — is NOT
    //      in the DOM. Asserting on the literal "Policies" string is
    //      defensible because the SPA does not render that token
    //      anywhere outside the AdminPage tab strip (no other route
    //      surfaces "Policies" as plain text).
    await waitFor(() => {
      // Redirect fires synchronously on mount; pathname must have
      // moved away from /admin/users.
      expect(window.location.pathname).not.toBe('/admin/users')
    })
    expect(screen.queryByText(/^Policies$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/403/)).not.toBeInTheDocument()
    expect(screen.queryByText(/forbidden/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/unauthorized/i)).not.toBeInTheDocument()
  })
})
