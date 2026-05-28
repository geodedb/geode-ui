import React from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { useClusterStatus } from './useClusterStatus'
import * as clusterApi from '../api/cluster'
import { useActiveConnection } from '../api/connections'

jest.mock('../api/connections', () => ({
  useActiveConnection: jest.fn(),
}))
const mockedActive = useActiveConnection as jest.MockedFunction<
  typeof useActiveConnection
>

const Probe = (): React.ReactElement => {
  const s = useClusterStatus({ intervalMs: 1000 })
  return (
    <div>
      <span data-testid="loading">{String(s.loading)}</span>
      <span data-testid="err">{s.error ?? ''}</span>
      <span data-testid="count">{s.snapshot?.members.length ?? -1}</span>
    </div>
  )
}

beforeEach(() => {
  jest.useFakeTimers()
  mockedActive.mockReturnValue({
    connectionId: 'c1',
    token: 't',
    profileName: 'default',
    expiresAt: Date.now() + 60_000,
  })
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

test('fetches on mount and exposes the snapshot', async () => {
  const spy = jest.spyOn(clusterApi, 'fetchClusterStatus').mockResolvedValue({
    members: [
      {
        nodeId: 1,
        role: 'leader',
        term: 1,
        leaderId: 1,
        endpoint: 'h:1',
        lastContactMs: 0,
      },
    ],
    selfNodeId: 1,
    fetchedAt: 1,
  })
  const { getByTestId } = render(<Probe />)
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(getByTestId('count').textContent).toBe('1'))
  expect(getByTestId('loading').textContent).toBe('false')
})

test('repolls at the configured interval', async () => {
  const spy = jest.spyOn(clusterApi, 'fetchClusterStatus').mockResolvedValue({
    members: [],
    selfNodeId: null,
    fetchedAt: 1,
  })
  render(<Probe />)
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
  await act(async () => {
    jest.advanceTimersByTime(1000)
  })
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
  await act(async () => {
    jest.advanceTimersByTime(1000)
  })
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(3))
})

test('surfaces fetch errors', async () => {
  jest
    .spyOn(clusterApi, 'fetchClusterStatus')
    .mockRejectedValue(new Error('boom'))
  const { getByTestId } = render(<Probe />)
  await waitFor(() => expect(getByTestId('err').textContent).toBe('boom'))
})

test('skips polling when no active connection', async () => {
  mockedActive.mockReturnValue(null)
  const spy = jest
    .spyOn(clusterApi, 'fetchClusterStatus')
    .mockResolvedValue({ members: [], selfNodeId: null, fetchedAt: 1 })
  render(<Probe />)
  await act(async () => {
    jest.advanceTimersByTime(5000)
  })
  expect(spy).not.toHaveBeenCalled()
})
