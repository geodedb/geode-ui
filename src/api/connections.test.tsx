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
  isElectron: jest.fn().mockReturnValue(false),
}))

const mockStore = jest.requireMock('./electron-bridge')
  .storeConnections as jest.Mock

beforeEach(() => {
  mockStore.mockClear()
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
