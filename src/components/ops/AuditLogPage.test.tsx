/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

// Mock the generated client BEFORE importing AuditLogPage so the
// useEffect-driven poll resolves against a canned entry list. We use a
// jest fake timer to keep the 5-second setInterval from clobbering the
// snapshot on slower test runners.
jest.useFakeTimers()

const auditMock = jest.fn().mockResolvedValue({
  entries: [
    { timestamp: '2025-01-01T00:00:00Z', user: 'alice', event: 'login' },
    {
      timestamp: '2025-01-01T00:00:01Z',
      user: 'bob',
      event: 'query',
      graph: 'default',
    },
  ],
})

jest.mock('../../api/client', () => ({
  client: {
    audit: (...args: unknown[]) => auditMock(...args),
  },
}))

import { AuditLogPage } from './AuditLogPage'

import { testTheme as theme } from '../../test-utils/theme'

test('renders audit entries from the mocked client', async () => {
  render(
    <ThemeProvider theme={theme}>
      <AuditLogPage />
    </ThemeProvider>
  )

  await waitFor(() => {
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
  })

  expect(screen.getByText('login')).toBeInTheDocument()
  expect(screen.getByText('query')).toBeInTheDocument()
  // Header reflects the count once the first poll resolves.
  expect(screen.getByText('Audit log (2)')).toBeInTheDocument()
  // The non-column "graph: default" field is dumped as a JSON snippet.
  expect(screen.getByText(/"graph":"default"/)).toBeInTheDocument()
})

// PERF #224 regression gate: the 5-second polling interval MUST be
// gated on document.visibilityState so a hidden/backgrounded tab does
// not keep hammering the server. A regression here re-introduces the
// background-polling waste that prompted the original gating; the test
// drives the visibility state forward + back and asserts only the
// initial mount fetch fires while hidden.
test('polling pauses when document is hidden (PERF #224)', async () => {
  auditMock.mockClear()
  render(
    <ThemeProvider theme={theme}>
      <AuditLogPage />
    </ThemeProvider>
  )

  // The first fetch fires on mount via useApiResource — wait for it.
  await waitFor(() => expect(auditMock).toHaveBeenCalledTimes(1))

  // Hide the tab. Mock document.visibilityState by replacing the getter;
  // dispatch the visibilitychange event so the handler fires (but it
  // only triggers a fetch on 'visible' so this should be a no-op here).
  const visibilitySpy = jest
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('hidden')
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })

  // Advance the 5s interval ~6 times. With the visibility gate in place
  // the setInterval tick observes 'hidden' and skips refetch(); without
  // the gate every tick would call audit() exactly once.
  await act(async () => {
    jest.advanceTimersByTime(5_000 * 6)
    // flush any microtasks the refetch path may have enqueued.
    await Promise.resolve()
  })

  // Still only the original mount fetch — zero polled fetches while
  // hidden. If this fails (count > 1), the gate has regressed and the
  // server is being polled in background tabs again.
  expect(auditMock).toHaveBeenCalledTimes(1)

  // Restore visibility and advance — the visibilitychange handler
  // proactively re-fetches on 'visible' so the count should bump by
  // exactly one without waiting for the next interval tick.
  visibilitySpy.mockReturnValue('visible')
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()
  })
  await waitFor(() => expect(auditMock).toHaveBeenCalledTimes(2))

  visibilitySpy.mockRestore()
})
