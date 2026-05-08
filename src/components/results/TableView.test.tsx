/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { TableView, formatCell } from './TableView'

import { testTheme as theme } from '../../test-utils/theme'

test('renders columns and rows', () => {
  render(
    <ThemeProvider theme={theme}>
      <TableView
        expand={false}
        resp={{ columns: [{ name: 'n', type: 'node' }], rows: [['x'], ['y']] }}
      />
    </ThemeProvider>
  )
  expect(screen.getByText('n')).toBeInTheDocument()
  expect(screen.getByText('x')).toBeInTheDocument()
  expect(screen.getByText('y')).toBeInTheDocument()
})

// Regression for the "wall of text" complaint: a node row with many
// properties must render a label chip + a structured key/value list
// so each property is on its own row rather than concatenated into a
// single 600-char string.
test('renders node rows as label chip + structured property list', () => {
  const node = {
    id: 1,
    labels: ['Role'],
    properties: {
      name: 'admin',
      parent_role: 0,
      created_at: 1778128562483,
      is_system: true,
      priority: 100,
    },
  }
  render(
    <ThemeProvider theme={theme}>
      <TableView
        expand={false}
        resp={{ columns: [{ name: 'r', type: 'node' }], rows: [[node]] }}
      />
    </ThemeProvider>
  )
  expect(screen.getByText(':Role')).toBeInTheDocument()
  // Each property key should appear as its own <dt> element.
  expect(screen.getByText('name')).toBeInTheDocument()
  expect(screen.getByText('parent_role')).toBeInTheDocument()
  expect(screen.getByText('created_at')).toBeInTheDocument()
  expect(screen.getByText('is_system')).toBeInTheDocument()
  expect(screen.getByText('priority')).toBeInTheDocument()
  // Values render alongside.
  expect(screen.getByText("'admin'")).toBeInTheDocument()
  expect(screen.getByText('1778128562483')).toBeInTheDocument()
})

test('renders edge rows as type chip + structured property list', () => {
  const edge = {
    id: 100,
    start_node: 1,
    end_node: 2,
    type: 'ACTED_IN',
    properties: { role: 'Lead', year: 2008 },
  }
  render(
    <ThemeProvider theme={theme}>
      <TableView
        expand={false}
        resp={{ columns: [{ name: 'e', type: 'edge' }], rows: [[edge]] }}
      />
    </ThemeProvider>
  )
  expect(screen.getByText(':ACTED_IN')).toBeInTheDocument()
  expect(screen.getByText('role')).toBeInTheDocument()
  expect(screen.getByText("'Lead'")).toBeInTheDocument()
  expect(screen.getByText('year')).toBeInTheDocument()
  expect(screen.getByText('2008')).toBeInTheDocument()
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

test('TableView projects node columns into property columns by default', () => {
  const node = {
    id: 1,
    labels: ['Person'],
    properties: { name: 'Alice', born: 1980 },
  }
  render(
    <ThemeProvider theme={theme}>
      <TableView
        resp={{ columns: [{ name: 'n', type: 'NODE' }], rows: [[node]] }}
      />
    </ThemeProvider>
  )
  expect(screen.getByText('n._labels')).toBeInTheDocument()
  expect(screen.getByText('n.name')).toBeInTheDocument()
  expect(screen.getByText('n.born')).toBeInTheDocument()
  expect(screen.getByText('Person')).toBeInTheDocument()
  expect(screen.getByText('Alice')).toBeInTheDocument()
  expect(screen.getByText('1980')).toBeInTheDocument()
})

// PERF-F5 (issue #26): TableView used to map every row to a <tr>, so
// page_size=1000 produced ~1000 rows in the DOM at once. With windowing
// only the visible slice + overscan should be in the DOM. We render
// 1000 rows and assert the DOM has substantially fewer than 1000.
test('TableView virtualizes large row sets (DOM contains << total rows)', () => {
  const rows: unknown[][] = []
  for (let i = 0; i < 1000; i += 1) rows.push([`row-${i}`])
  const { container } = render(
    <ThemeProvider theme={theme}>
      <TableView
        expand={false}
        resp={{ columns: [{ name: 'n', type: 'STRING' }], rows }}
      />
    </ThemeProvider>
  )
  const rowEls = container.querySelectorAll('[data-row-index]')
  // Without virtualization there would be 1000 rows. With virtualization
  // (jsdom has no layout, so react-window falls back to defaultHeight)
  // we expect substantially fewer, certainly < 100.
  expect(rowEls.length).toBeGreaterThan(0)
  expect(rowEls.length).toBeLessThan(100)
})

test('TableView with expand=false renders node as a structured chip cell', () => {
  const node = {
    id: 1,
    labels: ['Person'],
    properties: { name: 'Alice' },
  }
  render(
    <ThemeProvider theme={theme}>
      <TableView
        expand={false}
        resp={{ columns: [{ name: 'n', type: 'NODE' }], rows: [[node]] }}
      />
    </ThemeProvider>
  )
  expect(screen.getByText(':Person')).toBeInTheDocument()
  expect(screen.queryByText('n._labels')).not.toBeInTheDocument()
})
