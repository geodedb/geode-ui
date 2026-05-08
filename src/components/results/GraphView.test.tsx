/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { act, render } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

// Capture the constructor calls from cytoscape so we can assert that
// repeated streaming `resp` updates do NOT tear down + rebuild the
// Cytoscape Core on every render. The mock returns a thin stub that
// honors the methods GraphView touches.
const cyConstructorCalls: unknown[] = []
const destroyMock = jest.fn()
const onMock = jest.fn()

jest.mock('cytoscape', () => {
  const factory = (opts: unknown) => {
    cyConstructorCalls.push(opts)
    return {
      on: onMock,
      destroy: destroyMock,
      add: jest.fn(),
      remove: jest.fn(),
      batch: (fn: () => void) => fn(),
      elements: () => ({ remove: jest.fn() }),
      layout: () => ({ run: jest.fn() }),
      nodes: () => ({ forEach: jest.fn() }),
      edges: () => ({ forEach: jest.fn() }),
    }
  }
  return { __esModule: true, default: factory }
})

// Import after the mock is in place.
import { GraphView } from './GraphView'

import { testTheme as theme } from '../../test-utils/theme'

function makeResp(rowCount: number): {
  rows: unknown[][]
  graph_summary: {
    nodes: {
      id: number
      labels: string[]
      properties: Record<string, never>
    }[]
  }
  row_count: number
} {
  const nodes: {
    id: number
    labels: string[]
    properties: Record<string, never>
  }[] = []
  for (let i = 0; i < rowCount; i += 1) {
    nodes.push({ id: i, labels: ['N'], properties: {} })
  }
  return {
    rows: nodes.map((n) => [n]),
    graph_summary: { nodes },
    row_count: rowCount,
  }
}

beforeEach(() => {
  cyConstructorCalls.length = 0
  destroyMock.mockClear()
  onMock.mockClear()
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
})

test('GraphView debounces rebuilds during streaming row_count growth', () => {
  // First render: no rebuild yet (debounce gate has not fired).
  const first = makeResp(1)
  const { rerender } = render(
    <ThemeProvider theme={theme}>
      <GraphView resp={first} />
    </ThemeProvider>
  )

  // Five rapid streaming updates (row_count grows each time).
  for (let i = 2; i <= 6; i += 1) {
    rerender(
      <ThemeProvider theme={theme}>
        <GraphView resp={makeResp(i)} />
      </ThemeProvider>
    )
  }

  // Before the debounce fires there should be at most one rebuild
  // (the leading initial mount). The previous behavior would have
  // produced 6 cytoscape() calls, one per update.
  expect(cyConstructorCalls.length).toBeLessThanOrEqual(1)

  // After the debounce window elapses we should converge to a single
  // rebuild for the final settled state.
  act(() => {
    jest.advanceTimersByTime(300)
  })
  expect(cyConstructorCalls.length).toBe(1)
})

test('GraphView rebuilds once on the final settled resp (single-shot)', () => {
  render(
    <ThemeProvider theme={theme}>
      <GraphView resp={makeResp(3)} />
    </ThemeProvider>
  )
  act(() => {
    jest.advanceTimersByTime(300)
  })
  expect(cyConstructorCalls.length).toBe(1)
})

test('GraphView rebuilds when row_count changes meaningfully (after debounce)', () => {
  const { rerender } = render(
    <ThemeProvider theme={theme}>
      <GraphView resp={makeResp(2)} />
    </ThemeProvider>
  )
  act(() => {
    jest.advanceTimersByTime(300)
  })
  expect(cyConstructorCalls.length).toBe(1)

  // Simulate a second, settled query result with a different row_count.
  rerender(
    <ThemeProvider theme={theme}>
      <GraphView resp={makeResp(5)} />
    </ThemeProvider>
  )
  act(() => {
    jest.advanceTimersByTime(300)
  })
  expect(cyConstructorCalls.length).toBe(2)
})
