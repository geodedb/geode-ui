import React from 'react'
import { render, act, screen } from '@testing-library/react'
import {
  ConnectionsProvider,
  useConnections,
  useActiveConnection,
  getLatestToken,
  setLatestToken,
} from './connections'

jest.mock('./electron-bridge', () => ({
  ...jest.requireActual('./electron-bridge'),
  storeConnections: jest.fn().mockResolvedValue(undefined),
  getStoredConnections: jest.fn().mockResolvedValue([]),
  isElectron: jest.fn().mockReturnValue(false),
}))

// Bug 2 (2026-05-21 bug-fix bundle): mock the cookie-rehydration
// endpoint at the auth module so the connections lazy-hydrate path can
// exercise both "cookie present" and "cookie absent" branches without
// hitting fetch.
jest.mock('./auth', () => ({
  ...jest.requireActual('./auth'),
  fetchWhoAmI: jest.fn().mockResolvedValue(null),
}))
const mockWhoAmI = jest.requireMock('./auth').fetchWhoAmI as jest.Mock

const mockStore = jest.requireMock('./electron-bridge')
  .storeConnections as jest.Mock
const mockGetStored = jest.requireMock('./electron-bridge')
  .getStoredConnections as jest.Mock

beforeEach(() => {
  mockStore.mockClear()
  mockGetStored.mockReset()
  mockGetStored.mockResolvedValue([])
  mockWhoAmI.mockReset()
  mockWhoAmI.mockResolvedValue(null)
  setLatestToken(null)
})

const Inner: React.FC = () => {
  const { add, remove, setActive } = useConnections()
  const active = useActiveConnection()
  const handleAdd = () =>
    add({
      connectionId: 'c1',
      token: 'tok-c1',
      profileName: 'default',
      expiresAt: Date.now() + 3600_000,
    })
  const handleSetActive = () => setActive('c1')
  const handleRemove = () => remove('c1')
  return (
    <div>
      <span data-testid="active-token">{active?.token ?? 'none'}</span>
      <button aria-label="add" data-testid="add" onClick={handleAdd} />
      <button
        aria-label="setactive-c1"
        data-testid="setactive-c1"
        onClick={handleSetActive}
      />
      <button
        aria-label="remove-c1"
        data-testid="remove-c1"
        onClick={handleRemove}
      />
    </div>
  )
}

test('add → setActive exposes the connection via useActiveConnection', () => {
  render(
    <ConnectionsProvider>
      <Inner />
    </ConnectionsProvider>
  )
  expect(screen.getByTestId('active-token').textContent).toBe('none')
  act(() => screen.getByTestId('add').click())
  act(() => screen.getByTestId('setactive-c1').click())
  expect(screen.getByTestId('active-token').textContent).toBe('tok-c1')
})

test('remove clears the active connection if it was active', () => {
  render(
    <ConnectionsProvider>
      <Inner />
    </ConnectionsProvider>
  )
  act(() => screen.getByTestId('add').click())
  act(() => screen.getByTestId('setactive-c1').click())
  act(() => screen.getByTestId('remove-c1').click())
  expect(screen.getByTestId('active-token').textContent).toBe('none')
})

test('initialConnections seeds reducer with first entry active and primes latch', () => {
  const InnerActive: React.FC = () => {
    const active = useActiveConnection()
    return <span data-testid="active-token">{active?.token ?? 'none'}</span>
  }
  render(
    <ConnectionsProvider
      initialConnections={[
        {
          connectionId: 'r1',
          token: 'rtok',
          profileName: 'p',
          expiresAt: Date.now() + 60_000,
        },
        {
          connectionId: 'r2',
          token: 'rtok2',
          profileName: 'q',
          expiresAt: Date.now() + 60_000,
        },
      ]}
    >
      <InnerActive />
    </ConnectionsProvider>
  )
  expect(screen.getByTestId('active-token').textContent).toBe('rtok')
  expect(getLatestToken()).toBe('rtok')
})

test('initialConnections of empty array uses default empty state', () => {
  const InnerActive: React.FC = () => {
    const active = useActiveConnection()
    return <span data-testid="active-token">{active?.token ?? 'none'}</span>
  }
  render(
    <ConnectionsProvider initialConnections={[]}>
      <InnerActive />
    </ConnectionsProvider>
  )
  expect(screen.getByTestId('active-token').textContent).toBe('none')
})

test('add triggers storeConnections via the bridge', () => {
  render(
    <ConnectionsProvider>
      <Inner />
    </ConnectionsProvider>
  )
  act(() => screen.getByTestId('add').click())
  expect(mockStore).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({ connectionId: 'c1', token: 'tok-c1' }),
    ])
  )
})

// ---------------------------------------------------------------------------
// PSR-F9 (#106) — persist useEffect IPC chattiness.
//
// Pre-fix the persist effect's dep array was `[state.byId]`, but the
// reducer creates a new Map on every dispatch — including no-op
// transitions like a redundant `setActive` to the same id. That caused
// the effect to fire on every reducer tick, sending a fresh IPC down to
// the secure store (which then triple-passes the encrypt + atomic
// rename per fire). The fix is a `version: number` that only bumps when
// the persisted shape actually changes.
// ---------------------------------------------------------------------------

test('PSR-F9: a single add fires storeConnections exactly once', () => {
  render(
    <ConnectionsProvider>
      <Inner />
    </ConnectionsProvider>
  )
  // The provider mount runs the persist effect once with the empty
  // initial state. Clear so we can isolate the post-add fire count.
  mockStore.mockClear()
  act(() => screen.getByTestId('add').click())
  expect(mockStore).toHaveBeenCalledTimes(1)
})

test('PSR-F9: setActive that does not change the active id is a no-op (no extra IPC)', () => {
  render(
    <ConnectionsProvider>
      <Inner />
    </ConnectionsProvider>
  )
  act(() => screen.getByTestId('add').click())
  // First add auto-activates c1; clear after that so we measure only
  // the no-op setActive that follows.
  mockStore.mockClear()
  // Re-issue setActive('c1') — same id, no real state change. Pre-fix
  // this still produced a new Map identity on `byId`, firing the
  // persist effect a second time. Post-fix the version doesn't bump.
  act(() => screen.getByTestId('setactive-c1').click())
  expect(mockStore).not.toHaveBeenCalled()
})

test('PSR-F9: re-adding the same connection identity does not re-fire IPC', () => {
  // Pre-fix the reducer cloned `byId` on every dispatch and `set`
  // overwrote with the same value, producing a new Map identity that
  // re-tripped the `[state.byId]` dep array. Post-fix the reducer
  // detects the no-op and skips the version bump.
  const FixedAdder: React.FC = () => {
    const { add } = useConnections()
    const handle = () =>
      add({
        connectionId: 'fixed',
        token: 'tok-fixed',
        profileName: 'default',
        expiresAt: 1700000000000, // fixed so two clicks compare equal
      })
    return (
      <button data-testid="add-fixed" aria-label="add-fixed" onClick={handle} />
    )
  }
  render(
    <ConnectionsProvider>
      <FixedAdder />
    </ConnectionsProvider>
  )
  act(() => screen.getByTestId('add-fixed').click())
  mockStore.mockClear()
  // Same connectionId, same token, same expiresAt → no real change.
  act(() => screen.getByTestId('add-fixed').click())
  expect(mockStore).not.toHaveBeenCalled()
})

// GAP-046: re-running signIn against the same profile must NOT
// produce two switcher rows. Pre-fix the reducer keyed `byId` on the
// server-issued `connectionId` (a fresh opaque id on every login),
// so a second login for the same profile inserted a SECOND entry with
// the new id and the user saw two indistinguishable rows in the
// switcher menu — one holding a stale-soon JWT.
test('GAP-046: re-adding the same profileName replaces in place (single switcher row)', () => {
  const DualAdder: React.FC = () => {
    const { add, connections } = useConnections()
    const addFirst = (): void =>
      add({
        connectionId: 'first',
        token: 'tok-first',
        profileName: 'shared',
        expiresAt: 1700000000000,
      })
    const addSecond = (): void =>
      add({
        connectionId: 'second',
        token: 'tok-second',
        profileName: 'shared',
        expiresAt: 1700001000000,
      })
    return (
      <div>
        <span data-testid="size">{connections.size}</span>
        <span data-testid="profiles">
          {[...connections.values()].map((c) => c.profileName).join(',')}
        </span>
        <span data-testid="tokens">
          {[...connections.values()].map((c) => c.token).join(',')}
        </span>
        <button
          data-testid="add-first"
          aria-label="add-first"
          onClick={addFirst}
        />
        <button
          data-testid="add-second"
          aria-label="add-second"
          onClick={addSecond}
        />
      </div>
    )
  }
  render(
    <ConnectionsProvider>
      <DualAdder />
    </ConnectionsProvider>
  )
  act(() => screen.getByTestId('add-first').click())
  expect(screen.getByTestId('size').textContent).toBe('1')
  expect(screen.getByTestId('tokens').textContent).toBe('tok-first')

  // Second login for the same profile. Size must stay at 1, token must
  // reflect the fresh JWT, and the entry must be the new connectionId.
  act(() => screen.getByTestId('add-second').click())
  expect(screen.getByTestId('size').textContent).toBe('1')
  expect(screen.getByTestId('tokens').textContent).toBe('tok-second')
  expect(screen.getByTestId('profiles').textContent).toBe('shared')
})

test('GAP-046: dedupe is per-profile — distinct profiles still get distinct rows', () => {
  const PairAdder: React.FC = () => {
    const { add, connections } = useConnections()
    const handle = (): void => {
      add({
        connectionId: 'a',
        token: 't-a',
        profileName: 'one',
        expiresAt: 1700000000000,
      })
      add({
        connectionId: 'b',
        token: 't-b',
        profileName: 'two',
        expiresAt: 1700001000000,
      })
    }
    return (
      <div>
        <span data-testid="size">{connections.size}</span>
        <button data-testid="add-pair" aria-label="add-pair" onClick={handle} />
      </div>
    )
  }
  render(
    <ConnectionsProvider>
      <PairAdder />
    </ConnectionsProvider>
  )
  act(() => screen.getByTestId('add-pair').click())
  expect(screen.getByTestId('size').textContent).toBe('2')
})

test('PSR-F9: removing a connection that does not exist is a no-op (no IPC)', () => {
  render(
    <ConnectionsProvider>
      <Inner />
    </ConnectionsProvider>
  )
  // Provider mount fires once with the empty initial state; reset.
  mockStore.mockClear()
  // Remove a non-existent id — pre-fix this still cloned `byId` and
  // re-fired the persist effect. Post-fix: no version bump, no IPC.
  act(() => screen.getByTestId('remove-c1').click())
  expect(mockStore).not.toHaveBeenCalled()
})

test('PSR-F9: 5 sequential adds fire 5 IPCs, one per real change', () => {
  const Multi: React.FC = () => {
    const { add } = useConnections()
    const handle = (i: number) => () =>
      add({
        connectionId: `c${i}`,
        token: `t${i}`,
        profileName: 'p',
        expiresAt: Date.now() + 60_000,
      })
    return (
      <div>
        {[0, 1, 2, 3, 4].map((i) => (
          <button
            key={i}
            data-testid={`add-${i}`}
            aria-label={`add-${i}`}
            onClick={handle(i)}
          />
        ))}
      </div>
    )
  }
  render(
    <ConnectionsProvider>
      <Multi />
    </ConnectionsProvider>
  )
  mockStore.mockClear()
  act(() => screen.getByTestId('add-0').click())
  act(() => screen.getByTestId('add-1').click())
  act(() => screen.getByTestId('add-2').click())
  act(() => screen.getByTestId('add-3').click())
  act(() => screen.getByTestId('add-4').click())
  // Each add bumps the version; the secure-store layer (PSR-F6) is
  // responsible for coalescing the resulting writes.
  expect(mockStore).toHaveBeenCalledTimes(5)
})

test('PSR-F9: remove that actually deletes a connection bumps version (one IPC)', () => {
  render(
    <ConnectionsProvider>
      <Inner />
    </ConnectionsProvider>
  )
  act(() => screen.getByTestId('add').click())
  mockStore.mockClear()
  act(() => screen.getByTestId('remove-c1').click())
  expect(mockStore).toHaveBeenCalledTimes(1)
})

// ---------------------------------------------------------------------------
// PSR-F16 (#113) — lazy-hydrate connections after first paint.
//
// Pre-fix src/index.tsx awaited getStoredConnections() before calling
// createRoot, serialising safeStorage init + the secure-store decrypt
// IPC on the critical path of first paint. Post-fix the React shell
// mounts synchronously with `lazyHydrate=true`; the provider mounts
// with `loading=true`, fires the bridge call from a useEffect, and
// dispatches the populated state when it resolves. ProtectedRoute
// treats `loading=true` as "wait, don't redirect" so a hydrated
// session doesn't briefly bounce to /login before the byId map fills.
// ---------------------------------------------------------------------------

test('PSR-F16: lazyHydrate mounts with loading=true and empty map', async () => {
  const STORED = [
    {
      connectionId: 'lazy-c1',
      token: 'lazy-tok',
      profileName: 'default',
      expiresAt: Date.now() + 60_000,
    },
  ]
  // Hold the bridge open so the post-mount effect can't resolve before
  // we observe the loading state. mockResolvedValue with a never-
  // resolving promise would also work but is harder to inspect.
  let releaseHydrate: (v: typeof STORED) => void = () => undefined
  mockGetStored.mockReturnValue(
    new Promise((resolve) => {
      releaseHydrate = resolve
    })
  )

  const Probe: React.FC = () => {
    const { connections, loading } = useConnections()
    return (
      <div>
        <span data-testid="loading">{loading ? 'yes' : 'no'}</span>
        <span data-testid="size">{String(connections.size)}</span>
      </div>
    )
  }
  render(
    <ConnectionsProvider lazyHydrate>
      <Probe />
    </ConnectionsProvider>
  )

  // First paint: loading=true, empty map.
  expect(screen.getByTestId('loading').textContent).toBe('yes')
  expect(screen.getByTestId('size').textContent).toBe('0')

  // Cleanup: release so jest can tear down without dangling promises.
  // Wrap in act() so the resulting state flips don't trigger
  // "update outside act" warnings.
  await act(async () => {
    releaseHydrate(STORED)
    await Promise.resolve()
    await Promise.resolve()
  })
})

test('PSR-F16: lazyHydrate dispatches populated state after bridge resolves', async () => {
  const STORED = [
    {
      connectionId: 'lazy-c1',
      token: 'lazy-tok',
      profileName: 'default',
      expiresAt: Date.now() + 60_000,
    },
  ]
  mockGetStored.mockResolvedValue(STORED)

  const Probe: React.FC = () => {
    const { connections, loading } = useConnections()
    const active = useActiveConnection()
    return (
      <div>
        <span data-testid="loading">{loading ? 'yes' : 'no'}</span>
        <span data-testid="size">{String(connections.size)}</span>
        <span data-testid="active-token">{active?.token ?? 'none'}</span>
      </div>
    )
  }
  render(
    <ConnectionsProvider lazyHydrate>
      <Probe />
    </ConnectionsProvider>
  )

  // Drain the post-mount effect.
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })

  expect(screen.getByTestId('loading').textContent).toBe('no')
  expect(screen.getByTestId('size').textContent).toBe('1')
  expect(screen.getByTestId('active-token').textContent).toBe('lazy-tok')
  // Module-level latch is in sync (the fetch wrapper reads this).
  expect(getLatestToken()).toBe('lazy-tok')
})

test('PSR-F16: lazyHydrate=false (default) starts with loading=false and skips bridge', () => {
  // Eager mounts (every existing test, browser mode where the bridge
  // is a noop) must NOT touch getStoredConnections — the legacy
  // contract is "the caller already provided initialConnections, do
  // not double-load".
  mockGetStored.mockClear()

  const Probe: React.FC = () => {
    const { loading } = useConnections()
    return <span data-testid="loading">{loading ? 'yes' : 'no'}</span>
  }
  render(
    <ConnectionsProvider>
      <Probe />
    </ConnectionsProvider>
  )

  expect(screen.getByTestId('loading').textContent).toBe('no')
  expect(mockGetStored).not.toHaveBeenCalled()
})

test('PSR-F16: bridge failure flips loading off without crashing', async () => {
  mockGetStored.mockRejectedValue(new Error('bridge unavailable'))

  const Probe: React.FC = () => {
    const { connections, loading } = useConnections()
    return (
      <div>
        <span data-testid="loading">{loading ? 'yes' : 'no'}</span>
        <span data-testid="size">{String(connections.size)}</span>
      </div>
    )
  }
  render(
    <ConnectionsProvider lazyHydrate>
      <Probe />
    </ConnectionsProvider>
  )

  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })

  // Loading flips off and the map stays empty — caller will hit the
  // unauthenticated path, ProtectedRoute will redirect to /login.
  expect(screen.getByTestId('loading').textContent).toBe('no')
  expect(screen.getByTestId('size').textContent).toBe('0')
})

// ---------------------------------------------------------------------------
// Bug 2 (2026-05-21 bug-fix bundle): cookie-driven session rehydration.
// ---------------------------------------------------------------------------

test('Bug 2: lazyHydrate synthesises ConnectionState from whoami when bridge is empty', async () => {
  // Browser-mode bootstrap: getStoredConnections() returns [] (no
  // Electron secure-store), but the HttpOnly cookie carries a valid
  // session. The provider must ask /api/v1/auth/whoami and synthesise
  // a ConnectionState so ProtectedRoute does NOT bounce to /login.
  mockGetStored.mockResolvedValue([])
  mockWhoAmI.mockResolvedValue({
    sub: 'alice',
    profile: 'default',
    roles: ['reader'],
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    connection_id: 'cookie-conn-1',
  })

  const Probe: React.FC = () => {
    const { connections, activeId, loading } = useConnections()
    const active = useActiveConnection()
    return (
      <div>
        <span data-testid="loading">{loading ? 'yes' : 'no'}</span>
        <span data-testid="size">{String(connections.size)}</span>
        <span data-testid="activeId">{activeId ?? 'none'}</span>
        <span data-testid="active-profile">
          {active?.profileName ?? 'none'}
        </span>
        <span data-testid="active-token-empty">
          {active && active.token === '' ? 'yes' : 'no'}
        </span>
      </div>
    )
  }
  render(
    <ConnectionsProvider lazyHydrate>
      <Probe />
    </ConnectionsProvider>
  )

  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })

  expect(screen.getByTestId('loading').textContent).toBe('no')
  expect(screen.getByTestId('size').textContent).toBe('1')
  expect(screen.getByTestId('activeId').textContent).toBe('cookie-conn-1')
  expect(screen.getByTestId('active-profile').textContent).toBe('default')
  // The synthesised state intentionally carries an empty token so
  // client.ts strips the Authorization header and the server reads
  // the cookie. The JWT must NEVER end up in JS-readable storage.
  expect(screen.getByTestId('active-token-empty').textContent).toBe('yes')
  // Module-level latch is also empty for the same reason.
  expect(getLatestToken()).toBe('')
})

test('Bug 2: lazyHydrate falls through to /login when whoami returns null', async () => {
  // No Electron store, no cookie: typical first-visit / post-logout
  // path. The provider must NOT synthesise anything and the
  // ProtectedRoute gate must redirect normally.
  mockGetStored.mockResolvedValue([])
  mockWhoAmI.mockResolvedValue(null)

  const Probe: React.FC = () => {
    const { connections, loading } = useConnections()
    return (
      <div>
        <span data-testid="loading">{loading ? 'yes' : 'no'}</span>
        <span data-testid="size">{String(connections.size)}</span>
      </div>
    )
  }
  render(
    <ConnectionsProvider lazyHydrate>
      <Probe />
    </ConnectionsProvider>
  )

  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })

  expect(screen.getByTestId('loading').textContent).toBe('no')
  expect(screen.getByTestId('size').textContent).toBe('0')
  expect(mockWhoAmI).toHaveBeenCalledTimes(1)
})

test('Bug 2: lazyHydrate skips whoami when bridge already returned a connection', async () => {
  // Electron mode: the secure-store hydrates a connection. There is
  // no need to ping whoami; the in-memory state already has what
  // ProtectedRoute needs. Skipping the request avoids a wasted round
  // trip on every Electron app launch.
  mockGetStored.mockResolvedValue([
    {
      connectionId: 'electron-c1',
      token: 'real-jwt-from-store',
      profileName: 'default',
      expiresAt: Date.now() + 3600_000,
    },
  ])

  const Probe: React.FC = () => {
    const { connections, loading } = useConnections()
    return (
      <div>
        <span data-testid="loading">{loading ? 'yes' : 'no'}</span>
        <span data-testid="size">{String(connections.size)}</span>
      </div>
    )
  }
  render(
    <ConnectionsProvider lazyHydrate>
      <Probe />
    </ConnectionsProvider>
  )

  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })

  expect(screen.getByTestId('loading').textContent).toBe('no')
  expect(screen.getByTestId('size').textContent).toBe('1')
  expect(mockWhoAmI).not.toHaveBeenCalled()
})

test('Bug 2: whoami failure is non-fatal — bootstrap falls through to /login', async () => {
  mockGetStored.mockResolvedValue([])
  mockWhoAmI.mockRejectedValue(new Error('network down'))

  const Probe: React.FC = () => {
    const { connections, loading } = useConnections()
    return (
      <div>
        <span data-testid="loading">{loading ? 'yes' : 'no'}</span>
        <span data-testid="size">{String(connections.size)}</span>
      </div>
    )
  }
  render(
    <ConnectionsProvider lazyHydrate>
      <Probe />
    </ConnectionsProvider>
  )

  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })

  expect(screen.getByTestId('loading').textContent).toBe('no')
  expect(screen.getByTestId('size').textContent).toBe('0')
})

// APP-08 (2026-05-24 appsec): per-connection bearer binding. The
// module-level latch (`setLatestToken`) is fragile — a render-driven
// switch from connection A to B between two fetches against A would
// attach B's token. `getTokenForConnection(id)` exposes a stable
// lookup keyed by the connection id so callers that target a specific
// connection can plumb the id through their request `init` and let
// the fetch wrapper read the right token.
test('APP-08: getTokenForConnection returns the per-connection token', () => {
  // The connections map is process-internal; we exercise the
  // accessor by populating it through the public reducer surface.
  const Inner: React.FC = () => {
    const conns = useConnections()
    React.useEffect(() => {
      conns.add({
        connectionId: 'cid-A',
        token: 'tok-A',
        profileName: 'profile-A',
        expiresAt: Date.now() + 60_000,
      })
      conns.add({
        connectionId: 'cid-B',
        token: 'tok-B',
        profileName: 'profile-B',
        expiresAt: Date.now() + 60_000,
      })
    }, [])
    return <span data-testid="probe" />
  }

  render(
    <ConnectionsProvider lazyHydrate={false}>
      <Inner />
    </ConnectionsProvider>
  )
  // The accessor lives in ./connections — import via require to keep
  // the existing top-level imports stable.
  // eslint-disable-next-line global-require
  const { getTokenForConnection } = require('./connections')
  expect(getTokenForConnection('cid-A')).toBe('tok-A')
  expect(getTokenForConnection('cid-B')).toBe('tok-B')
  expect(getTokenForConnection('cid-missing')).toBeNull()
})
