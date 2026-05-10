import React from 'react'
import { act, render, screen } from '@testing-library/react'
import { AuthProvider, useAuth } from './AuthProvider'
import {
  ConnectionsProvider,
  useConnections,
  useActiveConnection,
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

  // PSR-F10 (#108): pre-fix signIn awaited refreshCsrfToken BEFORE
  // touching the connections state, so the active-connection latch
  // was unnecessarily blocked behind the CSRF round-trip. Post-fix
  // the synchronous reducer dispatches and latch writes happen
  // concurrently with the CSRF promise. We assert this directly: hold
  // the CSRF response open and verify conns.add already landed (the
  // active-token latch is populated) BEFORE refreshCsrfToken
  // resolves.
  test('PSR-F10: signIn parallelizes CSRF refresh with conns.add', async () => {
    let releaseCsrf: () => void = () => undefined
    const csrfHeld = new Promise<void>((resolve) => {
      releaseCsrf = resolve
    })

    const orig = global.fetch
    const csrfStartedAt: number[] = []
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/api/v1/auth/login')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'tok-parallel',
            token_type: 'Bearer',
            expires_in: 3600,
            connection_id: 'cid-parallel',
          }),
        } as unknown as Response
      }
      if (url.endsWith('/api/v1/csrf')) {
        csrfStartedAt.push(Date.now())
        // Block the CSRF round-trip until the test releases it.
        await csrfHeld
        return {
          ok: true,
          status: 200,
          json: async () => ({ token: 'csrf-parallel' }),
        } as unknown as Response
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
      } as unknown as Response
    }) as unknown as typeof fetch

    let captured: ReturnType<typeof useAuth> | null = null
    let signInPromise: Promise<void> | null = null
    const InnerP: React.FC = () => {
      captured = useAuth()
      return (
        <button
          data-testid="signin"
          onClick={() => {
            signInPromise = captured!.signIn('alice', 'pw', 'default')
            // Catch is added by the test via signInPromise to avoid
            // unhandled-rejection warnings during the held window.
            signInPromise.catch(() => undefined)
          }}
          aria-label="sign in"
        />
      )
    }
    render(
      <ConnectionsProvider>
        <AuthProvider>
          <InnerP />
        </AuthProvider>
      </ConnectionsProvider>
    )

    // Click signIn but DO NOT release CSRF yet.
    await act(async () => {
      screen.getByTestId('signin').click()
      // Drain microtasks so apiLogin's response resolves and signIn
      // has reached the `const csrfPromise = refreshCsrfToken()` line.
      // Subsequent ticks let the synchronous conns.add + setActive +
      // setLatestToken run.
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    // CSRF was started but is still held. The latch MUST already be
    // populated — that's the parallelism we're proving.
    expect(csrfStartedAt.length).toBeGreaterThanOrEqual(1)
    expect(getLatestToken()).toBe('tok-parallel')

    // Release CSRF; signIn promise should now resolve.
    await act(async () => {
      releaseCsrf()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    await expect(signInPromise!).resolves.toBeUndefined()

    global.fetch = orig
  })

  // PSR-F10 partner test: signIn invokes storeSavedPassword via the
  // electron bridge when savePassword=true, but does NOT await it on
  // the critical path. We mock the bridge with a never-resolving
  // promise and assert signIn still resolves.
  test('PSR-F10: signIn fires storeSavedPassword without awaiting', async () => {
    const stored: Array<{ profile: string; user: string; pw: string }> = []
    let releaseStore: () => void = () => undefined
    const storeHeld = new Promise<void>((resolve) => {
      releaseStore = resolve
    })
    // Inject a fake electron bridge before render. The real
    // storeSavedPassword reads window.geode at call time, so
    // installing the stub before signIn fires is enough.
    const fakeBridge = {
      isElectron: true,
      storeSavedPassword: jest.fn(
        async (profile: string, user: string, pw: string) => {
          stored.push({ profile, user, pw })
          // Single held promise — signIn must NOT block on it.
          await storeHeld
        }
      ),
    }
    const win = window as unknown as { geode: typeof fakeBridge }
    win.geode = fakeBridge

    let captured: ReturnType<typeof useAuth> | null = null
    const InnerSP: React.FC = () => {
      captured = useAuth()
      return <span />
    }
    render(
      <ConnectionsProvider>
        <AuthProvider>
          <InnerSP />
        </AuthProvider>
      </ConnectionsProvider>
    )

    let signInDone = false
    await act(async () => {
      const p = captured!.signIn('alice', 'pw', 'default', true)
      p.then(() => {
        signInDone = true
      })
      // Drain microtasks for apiLogin + CSRF mock + storeSavedPassword
      // initial dispatch.
      for (let i = 0; i < 12; i += 1) {
        // eslint-disable-next-line no-await-in-loop -- intentional microtask drain
        await Promise.resolve()
      }
    })
    // signIn already resolved even though storeSavedPassword is still
    // held — that's the parallelism we're proving.
    expect(signInDone).toBe(true)
    // The bridge call landed exactly once.
    expect(stored.length).toBe(1)
    expect(stored[0]).toEqual({ profile: 'default', user: 'alice', pw: 'pw' })

    // Cleanup: release the held promise so the bridge call settles
    // and Jest can tear down cleanly.
    releaseStore()
    await Promise.resolve()
    delete (win as unknown as { geode?: unknown }).geode
  })

  test('PSR-G03: connectMore refreshes the CSRF token after apiLogin', async () => {
    // Pre-fix `connectMore` swapped the access cookie via apiLogin
    // but never called `/api/v1/csrf`, so the in-memory CSRF latch
    // pointed at the old session. Subsequent state-changing requests
    // would 403 with a stale double-submit pair.
    //
    // This test counts the GETs against `/api/v1/csrf`. signIn fires
    // exactly one (we drain it first); connectMore must fire exactly
    // one more, total two.
    let csrfCalls = 0
    const orig = global.fetch
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/api/v1/auth/login')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'tok-csrf-test',
            token_type: 'Bearer',
            expires_in: 3600,
            connection_id: 'cid-csrf-test',
          }),
        } as unknown as Response
      }
      if (url.endsWith('/api/v1/csrf')) {
        csrfCalls += 1
        return {
          ok: true,
          status: 200,
          json: async () => ({ token: `csrf-token-${csrfCalls}` }),
        } as unknown as Response
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
      } as unknown as Response
    }) as unknown as typeof fetch

    let captured: ReturnType<typeof useAuth> | null = null
    const InnerCsrf: React.FC = () => {
      captured = useAuth()
      return (
        <button
          data-testid="signin"
          onClick={() => {
            captured!.signIn('alice', 'pw', 'default').catch(() => undefined)
          }}
          aria-label="sign in"
        />
      )
    }
    render(
      <ConnectionsProvider>
        <AuthProvider>
          <InnerCsrf />
        </AuthProvider>
      </ConnectionsProvider>
    )

    await act(async () => {
      screen.getByTestId('signin').click()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    // signIn already calls refreshCsrfToken, plus the AuthProvider
    // useEffect that fires once isAuthed flips true. Snapshot the
    // count BEFORE connectMore so we measure the delta the call
    // itself contributes.
    const csrfCallsAfterSignIn = csrfCalls
    expect(csrfCallsAfterSignIn).toBeGreaterThanOrEqual(1)

    await act(async () => {
      captured!.connectMore('bob', 'pw', 'prod').catch(() => undefined)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    // The release-blocker assertion: connectMore MUST trigger at
    // least one additional /api/v1/csrf round-trip. Pre-fix the
    // delta was zero (PSR-G03 / GitLab #80).
    expect(csrfCalls).toBeGreaterThan(csrfCallsAfterSignIn)

    global.fetch = orig
  })

  test('connectMore adds a connection without displacing the active one', async () => {
    const responses = [
      {
        access_token: 'tok-A',
        token_type: 'Bearer',
        expires_in: 3600,
        connection_id: 'cid-A',
      },
      {
        access_token: 'tok-B',
        token_type: 'Bearer',
        expires_in: 3600,
        connection_id: 'cid-B',
      },
    ]
    let callCount = 0
    const orig = global.fetch
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/api/v1/auth/login')) {
        const body = responses[callCount]
        callCount += 1
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
    }) as unknown as typeof fetch

    // Render with both providers; expose signIn + connectMore + active token via a child.
    let observed: { activeToken: string | null; activeId: string | null } = {
      activeToken: null,
      activeId: null,
    }
    const InnerA: React.FC = () => {
      const auth = useAuth()
      const conns = useConnections()
      const active = useActiveConnection()
      observed = {
        activeToken: active?.token ?? null,
        activeId: conns.activeId,
      }
      return (
        <>
          <button
            data-testid="signin"
            onClick={() => {
              auth.signIn('alice', 'pw', 'default').catch(() => undefined)
            }}
            aria-label="sign in"
          />
          <button
            data-testid="connectmore"
            onClick={() => {
              auth.connectMore('bob', 'pw', 'prod').catch(() => undefined)
            }}
            aria-label="connect more"
          />
        </>
      )
    }
    render(
      <ConnectionsProvider>
        <AuthProvider>
          <InnerA />
        </AuthProvider>
      </ConnectionsProvider>
    )

    await act(async () => {
      screen.getByTestId('signin').click()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(observed.activeId).toBe('cid-A')
    expect(observed.activeToken).toBe('tok-A')

    await act(async () => {
      screen.getByTestId('connectmore').click()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    // Active should STILL be A; B was added but did not steal focus.
    expect(observed.activeId).toBe('cid-A')
    expect(observed.activeToken).toBe('tok-A')

    global.fetch = orig
  })

  test('switchActive updates active id AND token latch', async () => {
    // Sign in twice (signIn then connectMore). The latch starts holding A's
    // token. Call switchActive(B). The latch must now hold B's token.
    const responses = [
      {
        access_token: 'tok-A',
        token_type: 'Bearer',
        expires_in: 3600,
        connection_id: 'cid-A',
      },
      {
        access_token: 'tok-B',
        token_type: 'Bearer',
        expires_in: 3600,
        connection_id: 'cid-B',
      },
    ]
    let callCount = 0
    const orig = global.fetch
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/api/v1/auth/login')) {
        const body = responses[callCount]
        callCount += 1
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
    }) as unknown as typeof fetch

    let captured: ReturnType<typeof useAuth> | null = null
    const Inner: React.FC = () => {
      captured = useAuth()
      return (
        <>
          <button
            data-testid="signin"
            onClick={() => {
              captured!.signIn('alice', 'pw', 'default').catch(() => undefined)
            }}
            aria-label="sign in"
          />
          <button
            data-testid="connectmore"
            onClick={() => {
              captured!.connectMore('bob', 'pw', 'prod').catch(() => undefined)
            }}
            aria-label="connect more"
          />
        </>
      )
    }
    render(
      <ConnectionsProvider>
        <AuthProvider>
          <Inner />
        </AuthProvider>
      </ConnectionsProvider>
    )

    await act(async () => {
      screen.getByTestId('signin').click()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      screen.getByTestId('connectmore').click()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(getLatestToken()).toBe('tok-A')

    await act(async () => {
      captured!.switchActive('cid-B')
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(getLatestToken()).toBe('tok-B')

    global.fetch = orig
  })

  test('disconnect removes the named connection and promotes the next when active', async () => {
    // Sign in twice (A then connectMore B). Disconnect A. Expect:
    //   - Connection A is gone from the map
    //   - Active id is now B (auto-promotion)
    //   - getLatestToken() returns B's token
    // Then disconnect B: active is null and getLatestToken() returns null.
    const responses = [
      {
        access_token: 'tok-A',
        token_type: 'Bearer',
        expires_in: 3600,
        connection_id: 'cid-A',
      },
      {
        access_token: 'tok-B',
        token_type: 'Bearer',
        expires_in: 3600,
        connection_id: 'cid-B',
      },
    ]
    let callCount = 0
    const orig = global.fetch
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/api/v1/auth/login')) {
        const body = responses[callCount]
        callCount += 1
        return {
          ok: true,
          status: 200,
          json: async () => body,
        } as unknown as Response
      }
      if (url.endsWith('/api/v1/auth/logout')) {
        return {
          ok: true,
          status: 204,
          json: async () => ({}),
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
    }) as unknown as typeof fetch

    let observed: {
      activeId: string | null
      size: number
      latestToken: string | null
    } = { activeId: null, size: 0, latestToken: null }
    let captured: ReturnType<typeof useAuth> | null = null
    const InnerB: React.FC = () => {
      const auth = useAuth()
      const conns = useConnections()
      captured = auth
      observed = {
        activeId: conns.activeId,
        size: conns.connections.size,
        latestToken: getLatestToken(),
      }
      return (
        <>
          <button
            data-testid="signin"
            onClick={() => {
              auth.signIn('alice', 'pw', 'default').catch(() => undefined)
            }}
            aria-label="sign in"
          />
          <button
            data-testid="connectmore"
            onClick={() => {
              auth.connectMore('bob', 'pw', 'prod').catch(() => undefined)
            }}
            aria-label="connect more"
          />
        </>
      )
    }
    render(
      <ConnectionsProvider>
        <AuthProvider>
          <InnerB />
        </AuthProvider>
      </ConnectionsProvider>
    )

    await act(async () => {
      screen.getByTestId('signin').click()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      screen.getByTestId('connectmore').click()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(observed.size).toBe(2)
    expect(observed.activeId).toBe('cid-A')

    await act(async () => {
      captured!.disconnect('cid-A')
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(observed.size).toBe(1)
    expect(observed.activeId).toBe('cid-B')
    expect(observed.latestToken).toBe('tok-B')

    await act(async () => {
      captured!.disconnect('cid-B')
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(observed.size).toBe(0)
    expect(observed.activeId).toBeNull()
    expect(observed.latestToken).toBeNull()

    global.fetch = orig
  })
})
