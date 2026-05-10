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

const mockStore = jest.requireMock('./electron-bridge')
  .storeConnections as jest.Mock
const mockGetStored = jest.requireMock('./electron-bridge')
  .getStoredConnections as jest.Mock

beforeEach(() => {
  mockStore.mockClear()
  mockGetStored.mockReset()
  mockGetStored.mockResolvedValue([])
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
