/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

// Mock the generated client BEFORE importing PoliciesPage so the
// useEffect-driven fetch resolves against the canned policy list.
jest.mock('../../api/client', () => ({
  client: {
    getPolicies: jest.fn().mockResolvedValue({
      policies: [
        {
          name: 'tenant_isolation',
          resource: 'graph:default',
          expression: 'tenant_id = $tenant',
        },
        {
          name: 'rls_owner',
          resource: 'graph:billing',
          expression: 'owner = $user',
        },
      ],
    }),
    postPolicies: jest.fn().mockResolvedValue({}),
    deleteName: jest.fn().mockResolvedValue({}),
  },
}))

import { PoliciesPage } from './PoliciesPage'

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

test('renders policy rows from the mocked client', async () => {
  render(
    <ThemeProvider theme={theme}>
      <PoliciesPage />
    </ThemeProvider>
  )

  await waitFor(() => {
    expect(screen.getByText('tenant_isolation')).toBeInTheDocument()
    expect(screen.getByText('rls_owner')).toBeInTheDocument()
  })

  expect(screen.getByText('graph:default')).toBeInTheDocument()
  expect(screen.getByText('tenant_id = $tenant')).toBeInTheDocument()
  expect(screen.getByText('Policies (2)')).toBeInTheDocument()
})
