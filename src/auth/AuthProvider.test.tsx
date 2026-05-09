import React from 'react'
import { act, render, screen } from '@testing-library/react'
import { AuthProvider, useAuth } from './AuthProvider'
import {
  ConnectionsProvider,
  getLatestToken,
  setLatestToken,
} from '../api/connections'
import { resetCsrfTokenForTests } from '../api/csrf'

// We assert that signIn writes the token through to the in-memory
// latch so the fetch wrapper in client.ts can attach a Bearer header
// on subsequent requests. This is the integration seam Plan B's unit
// tests don't cover.

const STUB_LOGIN_RESPONSE = {
  access_token: 'tok-integration-abc',
  token_type: 'Bearer',
  expires_in: 3600,
  connection_id: 'cid-integration-xyz',
}

function fetchMock(): jest.Mock {
  return jest.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.endsWith('/api/v1/auth/login')) {
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(STUB_LOGIN_RESPONSE),
      } as unknown as Response
    }
    if (url.endsWith('/api/v1/csrf')) {
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ token: 'csrf-mock' }),
      } as unknown as Response
    }
    return {
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
    } as unknown as Response
  })
}

const Inner: React.FC = () => {
  const { signIn } = useAuth()
  return (
    <button
      aria-label="sign in"
      data-testid="signin"
      onClick={() => {
        signIn('alice', 'pw', 'default').catch(() => {
          // test — errors surfaced via getLatestToken assertion
        })
      }}
    />
  )
}

describe('AuthProvider → ConnectionsContext integration', () => {
  let originalFetch: typeof fetch
  let mock: jest.Mock

  beforeEach(() => {
    originalFetch = global.fetch
    mock = fetchMock()
    global.fetch = mock as unknown as typeof fetch
    // Reset module-level latches between tests for isolation.
    setLatestToken(null)
    resetCsrfTokenForTests()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  test('signIn writes the access_token into the in-memory latch', async () => {
    render(
      <ConnectionsProvider>
        <AuthProvider>
          <Inner />
        </AuthProvider>
      </ConnectionsProvider>
    )

    expect(getLatestToken()).toBeNull()

    await act(async () => {
      screen.getByTestId('signin').click()
      // Drain microtasks: apiLogin + refreshCsrfToken are both async.
      // Each awaited fetch + json() adds microtask ticks; drain enough
      // for the full signIn promise chain to settle.
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getLatestToken()).toBe('tok-integration-abc')
  })
})
