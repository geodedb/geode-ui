import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import App from '../src/App'

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
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
    // the fallback input to confirm the rejection finished.
    await waitFor(() => {
      expect(document.querySelector('#login-profile')).not.toBeNull()
    })
  })
})
