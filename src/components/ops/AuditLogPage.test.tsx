/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

// Mock the generated client BEFORE importing AuditLogPage so the
// useEffect-driven poll resolves against a canned entry list. We use a
// jest fake timer to keep the 5-second setInterval from clobbering the
// snapshot on slower test runners.
jest.useFakeTimers()

jest.mock('../../api/client', () => ({
  client: {
    audit: jest.fn().mockResolvedValue({
      entries: [
        { timestamp: '2025-01-01T00:00:00Z', user: 'alice', event: 'login' },
        {
          timestamp: '2025-01-01T00:00:01Z',
          user: 'bob',
          event: 'query',
          graph: 'default',
        },
      ],
    }),
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
