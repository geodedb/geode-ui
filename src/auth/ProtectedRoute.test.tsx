// PSR-F16 (#113): ProtectedRoute must wait for ConnectionsProvider's
// lazy-hydrate effect to settle before deciding to redirect to /login.
// Pre-fix the route gated solely on `useActiveConnection() != null` —
// a hydrated session would briefly flash a redirect to /login during
// the secure-store decrypt round-trip, then bounce back once the byId
// map populated. Post-fix the route renders nothing while the
// connections context reports `loading=true`.

import React from 'react'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './AuthProvider'
import { ConnectionsProvider } from '../api/connections'
import { ProtectedRoute } from './ProtectedRoute'

jest.mock('../api/electron-bridge', () => ({
  ...jest.requireActual('../api/electron-bridge'),
  storeConnections: jest.fn().mockResolvedValue(undefined),
  getStoredConnections: jest.fn().mockResolvedValue([]),
  isElectron: jest.fn().mockReturnValue(false),
}))

const mockGetStored = jest.requireMock('../api/electron-bridge')
  .getStoredConnections as jest.Mock

beforeEach(() => {
  mockGetStored.mockReset()
  // Default: a hydrated stored connection so we can prove the
  // post-hydration path keeps the user authenticated.
  mockGetStored.mockResolvedValue([
    {
      connectionId: 'cid-hydrated',
      token: 'tok-hydrated',
      profileName: 'default',
      expiresAt: Date.now() + 60_000,
    },
  ])
  // session-storage hint must say "we were logged in" for the auth
  // gate to evaluate true; AuthProvider reads it on mount.
  try {
    sessionStorage.setItem('geode-ui.session-hint', '1')
  } catch {
    /* noop */
  }
})

afterEach(() => {
  try {
    sessionStorage.removeItem('geode-ui.session-hint')
  } catch {
    /* noop */
  }
})

const ProtectedShell: React.FC = () => (
  <ProtectedRoute>
    <span data-testid="protected">PROTECTED</span>
  </ProtectedRoute>
)

function renderWithRouter(): void {
  render(
    <MemoryRouter initialEntries={['/']}>
      <ConnectionsProvider lazyHydrate>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<ProtectedShell />} />
            <Route
              path="/login"
              element={<span data-testid="login">LOGIN</span>}
            />
          </Routes>
        </AuthProvider>
      </ConnectionsProvider>
    </MemoryRouter>
  )
}

test('PSR-F16: ProtectedRoute does not redirect to /login while loading', async () => {
  // Hold the bridge open: the post-mount effect can't resolve.
  let release: (v: unknown[]) => void = () => undefined
  mockGetStored.mockReturnValue(
    new Promise((resolve) => {
      release = resolve
    })
  )

  renderWithRouter()

  // We MUST NOT have flashed the LOGIN element — the loading window
  // renders nothing.
  expect(screen.queryByTestId('login')).toBeNull()
  // And we MUST NOT yet have shown the protected content (no active
  // connection yet).
  expect(screen.queryByTestId('protected')).toBeNull()

  // Cleanup: release inside act() so the state flips settle cleanly.
  await act(async () => {
    release([])
    await Promise.resolve()
    await Promise.resolve()
  })
})

test('PSR-F16: ProtectedRoute renders protected content after hydration with valid session', async () => {
  renderWithRouter()

  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })

  expect(screen.getByTestId('protected').textContent).toBe('PROTECTED')
  expect(screen.queryByTestId('login')).toBeNull()
})

test('PSR-F16: ProtectedRoute redirects to /login after hydration with no stored session', async () => {
  // Override default to empty stored list.
  mockGetStored.mockResolvedValue([])
  // Also clear the auth hint so isAuthed becomes false.
  try {
    sessionStorage.removeItem('geode-ui.session-hint')
  } catch {
    /* noop */
  }

  renderWithRouter()

  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })

  // The unauthenticated path lands on /login.
  expect(screen.getByTestId('login').textContent).toBe('LOGIN')
  expect(screen.queryByTestId('protected')).toBeNull()
})
