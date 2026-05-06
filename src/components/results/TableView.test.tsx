/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { TableView } from './TableView'

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

test('renders columns and rows', () => {
  render(
    <ThemeProvider theme={theme}>
      <TableView resp={{ columns: [{ name: 'n', type: 'node' }], rows: [['x'], ['y']] }} />
    </ThemeProvider>,
  )
  expect(screen.getByText('n')).toBeInTheDocument()
  expect(screen.getByText('x')).toBeInTheDocument()
  expect(screen.getByText('y')).toBeInTheDocument()
})
