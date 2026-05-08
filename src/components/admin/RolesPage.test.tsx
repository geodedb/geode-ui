/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

// Mock the generated client BEFORE importing RolesPage so the
// useEffect-driven fetch resolves against the canned role list.
jest.mock('../../api/client', () => ({
  client: {
    getRoles: jest.fn().mockResolvedValue({
      roles: [
        {
          name: 'admin',
          description: 'Full access',
          permissions: ['read', 'write'],
        },
        { name: 'reader', description: 'Read-only', permissions: ['read'] },
      ],
    }),
    postApiRoles: jest.fn().mockResolvedValue({}),
    deleteRole: jest.fn().mockResolvedValue({}),
  },
}))

import { RolesPage } from './RolesPage'

import { testTheme as theme } from '../../test-utils/theme'

test('renders role rows from the mocked client', async () => {
  render(
    <ThemeProvider theme={theme}>
      <RolesPage />
    </ThemeProvider>
  )

  await waitFor(() => {
    expect(screen.getByText('admin')).toBeInTheDocument()
    expect(screen.getByText('reader')).toBeInTheDocument()
  })

  expect(screen.getByText('Full access')).toBeInTheDocument()
  expect(screen.getByText('read, write')).toBeInTheDocument()
  expect(screen.getByText('Roles (2)')).toBeInTheDocument()
})
