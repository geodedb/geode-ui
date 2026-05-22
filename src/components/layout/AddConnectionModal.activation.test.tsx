import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../services/i18n/config'
import { lightTheme } from '@geodedb/ui-core/theme'
import { AddConnectionModal } from './AddConnectionModal'
import { AuthProvider, useAuth } from '../../auth/AuthProvider'
import {
  ConnectionsProvider,
  useConnections,
  setLatestToken,
} from '../../api/connections'
import { resetCsrfTokenForTests } from '../../api/csrf'

// 2026-05-22 bug report — operator clicks an inactive profile in the
// top-left ConnectionSwitcher dropdown, authenticates against it, and
// expects the active connection to switch. Pre-fix the chrome called
// `connectMore(...).then(id => switchActive(id))` from inside the
// modal's submit handler — but `switchActive` did a guard read against
// `conns.connections.get(id)` using a React reducer snapshot that
// predated the `add` dispatch performAuth had just dispatched. The
// running submit's closure captured the OLD `switchActive`, whose
// closed-over `conns.connections` map did not yet contain the new id,
// so the guard returned early and `setActive` was never dispatched.
//
// The previous unit tests in AddConnectionModal.test.tsx mocked
// useAuth() and only asserted that `mockSwitchActive` was called —
// they could not see that the call was a no-op against the real
// reducer. This file mounts the real ConnectionsProvider +
// AuthProvider and asserts the OBSERVABLE state: `activeId` actually
// moves to the new connection after submit.

jest.mock('../../api/auth', () => ({
  ...jest.requireActual('../../api/auth'),
  fetchPublicProfiles: jest.fn(async () => [
    { name: 'default', description: 'Default cluster' },
    { name: 'prod', description: 'Production' },
  ]),
  fetchWhoAmI: jest.fn().mockResolvedValue(null),
}))

jest.mock('../../api/profiles', () => ({
  ...jest.requireActual('../../api/profiles'),
  listProfiles: jest.fn().mockResolvedValue([]),
}))

jest.mock('../../api/electron-bridge', () => ({
  ...jest.requireActual('../../api/electron-bridge'),
  isElectron: jest.fn().mockReturnValue(false),
  getStoredConnections: jest.fn().mockResolvedValue([]),
  storeConnections: jest.fn().mockResolvedValue(undefined),
}))

const RESPONSES: Record<
  string,
  {
    access_token: string
    token_type: string
    expires_in: number
    connection_id: string
  }
> = {
  default: {
    access_token: 'tok-initial',
    token_type: 'Bearer',
    expires_in: 3600,
    connection_id: 'cid-initial',
  },
  prod: {
    access_token: 'tok-new-prod',
    token_type: 'Bearer',
    expires_in: 3600,
    connection_id: 'cid-new-prod',
  },
}

let observedActiveId: string | null = null
let observedSize = 0
const ActiveObserver: React.FC = () => {
  const conns = useConnections()
  observedActiveId = conns.activeId
  observedSize = conns.connections.size
  return null
}

describe('AddConnectionModal post-submit profile activation (real providers)', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = global.fetch
    observedActiveId = null
    observedSize = 0
    setLatestToken(null)
    resetCsrfTokenForTests()
    global.fetch = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.endsWith('/api/v1/auth/login')) {
          const params =
            init && typeof init.body === 'string'
              ? new URLSearchParams(init.body)
              : new URLSearchParams()
          const profile = params.get('profile') ?? 'default'
          const body = RESPONSES[profile] ?? RESPONSES.default
          return {
            ok: true,
            status: 200,
            json: async () => body,
          } as unknown as Response
        }
        if (url.endsWith('/api/v1/csrf')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ token: 'csrf-mock' }),
          } as unknown as Response
        }
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
        } as unknown as Response
      }
    ) as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  test('submitting with initialProfile set makes the new connection ACTIVE in the store', async () => {
    let captured: ReturnType<typeof useAuth> | null = null
    const AuthCapturer: React.FC = () => {
      captured = useAuth()
      return null
    }

    const onClose = jest.fn()
    render(
      <I18nextProvider i18n={i18n}>
        <ThemeProvider theme={lightTheme}>
          <ConnectionsProvider>
            <AuthProvider>
              <AuthCapturer />
              <ActiveObserver />
              <AddConnectionModal
                open
                onClose={onClose}
                initialProfile="prod"
              />
            </AuthProvider>
          </ConnectionsProvider>
        </ThemeProvider>
      </I18nextProvider>
    )

    // Establish baseline: sign in to 'default' first so there is an
    // existing active connection — this mirrors the real scenario
    // where the operator already has a session and switches via the
    // chrome dropdown to a DIFFERENT profile.
    await act(async () => {
      captured!.signIn('alice', 'pw', 'default').catch(() => undefined)
      for (let i = 0; i < 12; i += 1) {
        // eslint-disable-next-line no-await-in-loop -- intentional microtask drain
        await Promise.resolve()
      }
    })
    expect(observedActiveId).toBe('cid-initial')

    // Wait for the modal's profile select to render (fetchPublicProfiles
    // is async).
    await waitFor(() => {
      expect(
        screen.getByRole('combobox', { name: /connection/i })
      ).toBeInTheDocument()
    })

    // Fill the form against the prod profile and submit, exactly like
    // a chrome-driven dropdown→login flow.
    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: 'bob' },
    })
    fireEvent.change(
      screen.getByLabelText(/password/i, {
        selector: 'input[type="password"]',
      }),
      { target: { value: 'pw' } }
    )
    await act(async () => {
      fireEvent.submit(screen.getByLabelText(/username/i).closest('form')!)
      for (let i = 0; i < 16; i += 1) {
        // eslint-disable-next-line no-await-in-loop -- drain through both apiLogin + csrf
        await Promise.resolve()
      }
    })

    // Both connections are now in the store.
    expect(observedSize).toBe(2)
    // RELEASE-BLOCKER: the new connection must be active. Pre-fix the
    // chrome's stale switchActive closure made this a silent no-op and
    // activeId stayed at 'cid-initial'.
    expect(observedActiveId).toBe('cid-new-prod')
  })
})
