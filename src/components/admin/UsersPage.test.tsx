/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

// Mock the generated client BEFORE importing UsersPage so the
// useEffect-driven fetch resolves against the canned user list.
jest.mock('../../api/client', () => ({
  client: {
    getUsers: jest.fn().mockResolvedValue({
      users: [
        {
          username: 'alice',
          email: 'alice@example.com',
          roles: ['admin'],
          disabled: false,
        },
        {
          username: 'bob',
          email: 'bob@example.com',
          roles: [],
          disabled: true,
        },
      ],
    }),
    postUsers: jest.fn().mockResolvedValue({}),
    deleteUsername: jest.fn().mockResolvedValue({}),
    disable: jest.fn().mockResolvedValue({}),
    enable: jest.fn().mockResolvedValue({}),
  },
}))

import { UsersPage } from './UsersPage'

import { testTheme as theme } from '../../test-utils/theme'

test('renders user rows with username, email, and status from the mocked client', async () => {
  render(
    <ThemeProvider theme={theme}>
      <UsersPage />
    </ThemeProvider>
  )

  // Wait for the async getUsers() call to settle and the table to
  // render the canned rows. The two known usernames should both be in
  // the document, and bob's row should be marked 'disabled'.
  await waitFor(() => {
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
  })

  expect(screen.getByText('alice@example.com')).toBeInTheDocument()
  expect(screen.getByText('disabled')).toBeInTheDocument()
  expect(screen.getByText('active')).toBeInTheDocument()
  // Header reflects total count once data has loaded.
  expect(screen.getByText('Users (2)')).toBeInTheDocument()
})
