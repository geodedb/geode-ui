/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

// GrantsPanel does not list anything (no SHOW GRANTS endpoint), so the
// test only verifies the form scaffolding renders. The mocked client
// methods exist to keep import-resolution clean.
jest.mock('../../api/client', () => ({
  client: {
    grants: jest.fn().mockResolvedValue({}),
    revoke: jest.fn().mockResolvedValue({}),
  },
}))

import { GrantsPanel } from './GrantsPanel'

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

test('renders the grants form with apply and revoke buttons', () => {
  render(
    <ThemeProvider theme={theme}>
      <GrantsPanel />
    </ThemeProvider>
  )

  expect(screen.getByText('Grants')).toBeInTheDocument()
  expect(screen.getByText('Apply')).toBeInTheDocument()
  expect(screen.getByText('Revoke')).toBeInTheDocument()
  // Permission, Resource, Grantee, Grantee kind labels are present.
  expect(screen.getByText('Permission')).toBeInTheDocument()
  expect(screen.getByText('Resource')).toBeInTheDocument()
  expect(screen.getByText('Grantee')).toBeInTheDocument()
  expect(screen.getByText('Grantee kind')).toBeInTheDocument()
})
