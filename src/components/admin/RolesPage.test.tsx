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

const theme = {
  colors: {
    background: '#000',
    surface: '#111',
    text: '#fff',
    textSecondary: '#888',
    border: '#333',
    primary: '#48b',
  },
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '24px',
    xl: '32px',
  },
}

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
