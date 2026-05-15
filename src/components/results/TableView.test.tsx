/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { TableView, estimateRowHeight, formatCell } from './TableView'

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

// Regression for the "long content wraps but row stays at 36 px so the
// data is unreadable" complaint. TableView used to pass a fixed
// VIRTUAL_ROW_HEIGHT to react-window's <List rowHeight={36}>; cells had
// `white-space: pre-wrap` plus `overflow: hidden`, so any wrapped lines
// were clipped. estimateRowHeight is the per-row computation that
// drives the new dynamic-height path.
describe('estimateRowHeight (regression for clipped wrapped content)', () => {
  test('short single-line cell stays at the minimum height', () => {
    expect(estimateRowHeight(['hi'])).toBe(36)
    expect(estimateRowHeight(['x', 'y', 'z'])).toBe(36)
  })

  test('long string content grows the row past 36 px', () => {
    const long = 'a'.repeat(120) // ~7 wrapped lines at ~18 chars/col
    const h = estimateRowHeight([long])
    expect(h).toBeGreaterThan(36)
  })

  test('row height grows with the row that has the most wrap', () => {
    const short = estimateRowHeight(['hello', 'world', 'baz'])
    const longInOneCell = estimateRowHeight(['hello', 'world', 'a'.repeat(120)])
    expect(longInOneCell).toBeGreaterThan(short)
  })

  test('explicit \\n line breaks count as wrapped lines', () => {
    const single = estimateRowHeight(['one'])
    const multi = estimateRowHeight(['one\ntwo\nthree\nfour\nfive'])
    expect(multi).toBeGreaterThan(single)
  })

  test('node cells grow proportional to property count', () => {
    const small = {
      id: 1,
      labels: ['Person'],
      properties: { name: 'Alice' },
    }
    const big = {
      id: 2,
      labels: ['User'],
      properties: {
        username: 'alice',
        email: 'alice@example.com',
        created_at: '2025-01-01',
        last_login: '2026-05-08',
        roles: ['admin', 'editor'],
        is_default_user: true,
      },
    }
    expect(estimateRowHeight([big])).toBeGreaterThan(estimateRowHeight([small]))
  })

  test('caps row height so virtualization stays bounded', () => {
    // Cap raised from 240 → 360 so wrapped content is actually
    // readable (Cell no longer hides overflow). Still bounded so a
    // 10 KB JSON cell can't blow the virtualizer up.
    const huge = 'a'.repeat(10000)
    expect(estimateRowHeight([huge])).toBeLessThanOrEqual(360)
  })

  test('handles null / undefined cells without throwing', () => {
    expect(() => estimateRowHeight([null, undefined, ''])).not.toThrow()
    expect(estimateRowHeight([null, undefined, ''])).toBe(36)
  })

  // Width-aware regression: the same cell content should produce a
  // taller row on a narrow column than on a wide one, because narrow
  // columns wrap into more visual lines. The `charsPerColumn` arg lets
  // the component feed the live container measurement in.
  test('narrower columns produce taller rows for the same content', () => {
    const text = 'a'.repeat(100)
    const wide = estimateRowHeight([text], 50) // ~2 wrapped lines
    const narrow = estimateRowHeight([text], 10) // ~10 wrapped lines
    expect(narrow).toBeGreaterThan(wide)
  })

  test('width-aware mode still respects ROW_HEIGHT_MIN floor', () => {
    expect(estimateRowHeight(['hi'], 12)).toBe(36)
    expect(estimateRowHeight(['hi'], 200)).toBe(36)
  })
})

test('TableView grows row height for long wrapped content (regression)', () => {
  // Renders a row with content that wraps many lines and asserts the
  // react-window-applied inline `style.height` exceeds the 36 px
  // single-line baseline. This catches a regression where the List was
  // configured with a fixed rowHeight again.
  const long = 'lorem ipsum '.repeat(40) // ~480 chars → many wrapped lines
  const { container } = render(
    <ThemeProvider theme={theme}>
      <TableView
        expand={false}
        resp={{
          columns: [{ name: 'msg', type: 'STRING' }],
          rows: [[long]],
        }}
      />
    </ThemeProvider>
  )
  const row = container.querySelector('[data-row-index="0"]') as HTMLElement
  expect(row).not.toBeNull()
  const h = parseInt(row.style.height || '0', 10)
  expect(h).toBeGreaterThan(36)
})

// Regression for the responsive-wrapping bug. Three asserts:
//   • The outer wrap exposes a horizontal-scroll inner area
//     (`data-testid="table-scroll-area"`) instead of swallowing
//     overflow with overflow:hidden — silent data loss when columns
//     exceed viewport.
//   • Cells DO NOT have `overflow: hidden` anymore; rows grow to fit.
//   • The body-virtualizer height is no longer the legacy fixed 480 px
//     constant — it derives from the viewport.
// Regression: when columns total wider than the viewport, the header
// must scroll horizontally with the body. Previously the List's outer
// container had its own `overflow: auto`, so horizontal scroll fired
// INSIDE the body while the header (a sibling of List inside the
// ScrollArea) stayed put — header columns ended up misaligned with
// body columns. The fix is to give the List's outer style
// `overflowX: 'visible'` so horizontal overflow propagates to the
// shared ScrollArea, which scrolls header + body together.
test('TableView body does not own horizontal scroll (header + body share ScrollArea)', () => {
  const { container, getByTestId } = render(
    <ThemeProvider theme={theme}>
      <TableView
        expand={false}
        resp={{
          columns: Array.from({ length: 10 }, (_, i) => ({
            name: `col_${i}`,
            type: 'STRING',
          })),
          rows: [Array.from({ length: 10 }, (_, i) => `v${i}`)],
        }}
      />
    </ThemeProvider>
  )

  // Header AND body are inside the same ScrollArea.
  const scrollArea = getByTestId('table-scroll-area')
  const header = container.querySelector('table')
  const body = container.querySelector('[data-row-index="0"]')
  expect(header).not.toBeNull()
  expect(body).not.toBeNull()
  expect(scrollArea.contains(header as Node)).toBe(true)
  expect(scrollArea.contains(body as Node)).toBe(true)

  // The List's immediate child of ScrollArea (i.e. react-window's
  // outer scroll container) must explicitly opt out of horizontal
  // overflow. react-window v2 defaults to `overflow: auto` on its
  // outer; without `overflowX: visible` the body owns its own
  // horizontal scrollbar and the header above stays put while the
  // user pans the columns. Traverse up from the row until we find
  // the child of ScrollArea — that's the List's outer.
  let listOuter: HTMLElement = body!.parentElement as HTMLElement
  while (listOuter.parentElement && listOuter.parentElement !== scrollArea) {
    listOuter = listOuter.parentElement as HTMLElement
  }
  expect(listOuter.style.overflowX).toBe('visible')
})

test('TableView exposes a scrollable area instead of clipping wide rows', () => {
  const { container, getByTestId } = render(
    <ThemeProvider theme={theme}>
      <TableView
        expand={false}
        resp={{
          columns: [
            { name: 'a', type: 'STRING' },
            { name: 'b', type: 'STRING' },
            { name: 'c', type: 'STRING' },
            { name: 'd', type: 'STRING' },
            { name: 'e', type: 'STRING' },
            { name: 'f', type: 'STRING' },
          ],
          rows: [['1', '2', '3', '4', '5', '6']],
        }}
      />
    </ThemeProvider>
  )
  // Scroll area exists.
  const scrollArea = getByTestId('table-scroll-area')
  expect(scrollArea).toBeInTheDocument()
  // Cell does not have overflow: hidden — content can grow vertically.
  const cell = container.querySelector('[role="cell"]') as HTMLElement
  expect(cell).not.toBeNull()
  expect(getComputedStyle(cell).overflow).not.toBe('hidden')
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

it('body height tracks the container height instead of capping at 720', () => {
  const resp = {
    columns: [{ name: 'a', type: 'string' }],
    rows: Array.from({ length: 100 }, (_, i) => [`row-${i}`]),
  }
  const { container } = render(
    <ThemeProvider theme={theme}>
      <div style={{ height: 1200 }}>
        <TableView resp={resp} />
      </div>
    </ThemeProvider>
  )
  // react-window writes `height` inline on the list root via the style
  // prop; assert it tracks the parent container height (1200), NOT the
  // legacy 720 cap. In jsdom ResizeObserver doesn't fire, so we read
  // the inline style applied at first paint — should be the floor
  // (VIRTUAL_BODY_MIN=240) since the container size isn't observed.
  // The KEY signal is that the value is NOT 720 (the old cap) and is
  // a finite number derived from the floor + observed (or floor).
  const list = container.querySelector(
    '[role="grid"] [style*="overflow"]'
  ) as HTMLElement
  expect(list).not.toBeNull()
  const inlineHeight = parseInt(list.style.height, 10)
  expect(Number.isFinite(inlineHeight)).toBe(true)
  // The 720 cap is removed — the inline height should NOT be capped at 720.
  // In jsdom the ResizeObserver doesn't fire so we get the floor (240).
  expect(inlineHeight).not.toBe(720)
  expect(inlineHeight).toBeGreaterThanOrEqual(240)
})
