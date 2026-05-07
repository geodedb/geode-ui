/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { TableView, formatCell } from './TableView'

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
      <TableView
        resp={{ columns: [{ name: 'n', type: 'node' }], rows: [['x'], ['y']] }}
      />
    </ThemeProvider>
  )
  expect(screen.getByText('n')).toBeInTheDocument()
  expect(screen.getByText('x')).toBeInTheDocument()
  expect(screen.getByText('y')).toBeInTheDocument()
})

describe('formatCell', () => {
  test('renders nulls as empty string', () => {
    expect(formatCell(null)).toBe('')
    expect(formatCell(undefined)).toBe('')
  })
  test('renders primitives as String()', () => {
    expect(formatCell('alice')).toBe('alice')
    expect(formatCell(42)).toBe('42')
    expect(formatCell(true)).toBe('true')
  })
  test('renders nodes in cypher-like notation', () => {
    const node = {
      id: 1,
      labels: ['Person'],
      properties: { name: 'Alice', born: 1980 },
    }
    expect(formatCell(node)).toBe("(:Person {name: 'Alice', born: 1980})")
  })
  test('renders ALL node properties without truncation', () => {
    // Reproduction for the user-reported "…" truncation: a real
    // (:User {…}) row with many properties was rendered as
    // "(:User {lockout_until: 0, is_default_user: true, …})" which
    // hid the actually interesting fields (username, email, roles).
    // Truncation belongs to the UI's responsibility for layout, not
    // the formatter's responsibility for data.
    const node = {
      id: 7,
      labels: ['User'],
      properties: {
        lockout_until: 0,
        is_default_user: true,
        username: 'alice',
        email: 'alice@example.com',
        created_at: '2025-01-01',
        roles: ['admin'],
      },
    }
    const out = formatCell(node)
    expect(out).not.toContain('…')
    expect(out).toContain("username: 'alice'")
    expect(out).toContain("email: 'alice@example.com'")
    expect(out).toContain('roles: ["admin"]')
  })
  test('renders ALL edge properties without truncation', () => {
    const edge = {
      id: 100,
      start_node: 1,
      end_node: 2,
      type: 'ACTED_IN',
      properties: {
        role: 'Lead',
        year: 2008,
        billing_position: 1,
        screen_time_min: 95,
      },
    }
    const out = formatCell(edge)
    expect(out).not.toContain('…')
    expect(out).toContain("role: 'Lead'")
    expect(out).toContain('billing_position: 1')
    expect(out).toContain('screen_time_min: 95')
  })
  test('renders nodes with multiple labels', () => {
    const node = { id: 1, labels: ['Person', 'Actor'], properties: {} }
    expect(formatCell(node)).toBe('(:Person:Actor)')
  })
  test('renders edges in cypher-like notation', () => {
    const edge = {
      id: 100,
      start_node: 1,
      end_node: 2,
      type: 'ACTED_IN',
      properties: { role: 'Lead' },
    }
    expect(formatCell(edge)).toBe("[:ACTED_IN {role: 'Lead'}]")
  })
  test('renders paths as a node/edge count summary', () => {
    const path = { nodes: [{}, {}, {}], edges: [{}, {}] }
    expect(formatCell(path)).toBe('<path: 3 nodes, 2 edges>')
  })
  test('falls back to JSON for unknown objects', () => {
    expect(formatCell({ foo: 'bar' })).toBe('{"foo":"bar"}')
  })
  test('arrays are JSON-stringified', () => {
    expect(formatCell([1, 2, 3])).toBe('[1,2,3]')
  })
})
