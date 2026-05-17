/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

// PERF #243 regression gate: filter inputs debounce by 300 ms before
// triggering a refetch. A 5-character typing burst MUST collapse into
// a single fetch (plus the initial mount fetch) rather than firing one
// per keystroke as the pre-#243 code did.
test('filter typing debounces refetches (PERF #243)', async () => {
  auditMock.mockClear()
  render(
    <ThemeProvider theme={theme}>
      <AuditLogPage />
    </ThemeProvider>
  )
  // The mount fetch is fetch #1.
  await waitFor(() => expect(auditMock).toHaveBeenCalledTimes(1))

  // Drive five rapid keystrokes into the user filter input. Without
  // the debounce, each setFilters bump would re-deps the useApiResource
  // and trigger a fetch. Resolve the input by its id (al-user is the
  // stable, locale-independent handle the component sets).
  const userInput = document.getElementById('al-user') as HTMLInputElement
  // forEach + an async helper instead of for-of so the eslint rule
  // banning iterators doesn't trip.
  const tickKeystroke = async (c: string): Promise<void> => {
    await act(async () => {
      fireEvent.change(userInput, { target: { value: c } })
      // Stop short of the 300 ms threshold so the debounce hasn't fired.
      jest.advanceTimersByTime(50)
      await Promise.resolve()
    })
  }
  await tickKeystroke('a')
  await tickKeystroke('b')
  await tickKeystroke('c')
  await tickKeystroke('d')
  await tickKeystroke('e')
  // Mid-burst the audit() count is still 1 — every setFilters reset
  // the debounce timer, and 50 ms x 5 < 300 ms.
  expect(auditMock).toHaveBeenCalledTimes(1)

  // Cross the debounce threshold; useApiResource picks up the new deps
  // and fires exactly one fetch.
  await act(async () => {
    jest.advanceTimersByTime(AUDIT_FILTER_DEBOUNCE_MS_FOR_TEST)
    await Promise.resolve()
  })
  await waitFor(() => expect(auditMock).toHaveBeenCalledTimes(2))
})

// AUDIT_FILTER_DEBOUNCE_MS_FOR_TEST mirrors the production debounce
// window. Keeping a test-local copy avoids exporting the constant from
// AuditLogPage just for one assertion.
const AUDIT_FILTER_DEBOUNCE_MS_FOR_TEST = 350
