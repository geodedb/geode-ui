import React from 'react'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme } from '../../test-utils/theme'
import type { QueryRespLike } from '../../lib/graphResult'

// Mock reagraph so jsdom doesn't try to instantiate WebGL. We assert
// against the props we pass into <GraphCanvas/> — that's the
// integration boundary that matters at the renderer level. The mock is
// declared BEFORE importing GraphViewReagraph so the module graph picks
// up the stub instead of pulling three.js into the worker.
type ReagraphProps = {
  nodes: { id: string }[]
  edges: { id: string }[]
  layoutType: string
}
const mockGraphCanvas = jest.fn(
  (props: ReagraphProps): React.JSX.Element => (
    // Touch `props` (rendering a data attribute with the layout type
    // we received) so eslint's no-unused-vars rule is satisfied without
    // an underscore-prefixed arg name or rule-disable comment. The
    // assertions read from `mockGraphCanvas.mock.calls`, not the DOM.
    <div data-testid="reagraph-canvas" data-layout={props.layoutType} />
  )
)
jest.mock('reagraph', () => ({
  __esModule: true,
  GraphCanvas: (props: ReagraphProps) => mockGraphCanvas(props),
}))

import { GraphViewReagraph } from './GraphViewReagraph'

const resp: QueryRespLike = {
  rows: [],
  columns: [],
  graph_summary: {
    nodes: [
      { id: 1, labels: ['Person'], properties: { name: 'Alice' } },
      { id: 2, labels: ['Person'], properties: { name: 'Bob' } },
    ],
    edges: [
      {
        id: 10,
        start_node: 1,
        end_node: 2,
        type: 'KNOWS',
        properties: {},
      },
    ],
  },
}

const renderWithTheme = (): ReturnType<typeof render> =>
  render(
    <ThemeProvider theme={testTheme}>
      <GraphViewReagraph resp={resp} />
    </ThemeProvider>
  )

describe('GraphViewReagraph', () => {
  beforeEach(() => mockGraphCanvas.mockClear())

  it('mounts the reagraph canvas', () => {
    renderWithTheme()
    expect(screen.getByTestId('reagraph-canvas')).toBeInTheDocument()
  })

  it('forwards projected nodes and edges to GraphCanvas', () => {
    renderWithTheme()
    expect(mockGraphCanvas).toHaveBeenCalled()
    const props = mockGraphCanvas.mock.calls[0]![0] as {
      nodes: { id: string }[]
      edges: { id: string }[]
    }
    // extractElements stamps numeric node ids verbatim and prefixes
    // numeric edge ids with `e` (see `extractElements` in graphResult.ts —
    // disambiguates against potentially-colliding node ids).
    expect(props.nodes.map((n) => n.id).sort()).toEqual(['1', '2'])
    expect(props.edges.map((e) => e.id)).toEqual(['e10'])
  })

  it('uses forceDirected2d layout by default', () => {
    renderWithTheme()
    const props = mockGraphCanvas.mock.calls[0]![0] as {
      layoutType: string
    }
    expect(props.layoutType).toBe('forceDirected2d')
  })

  it('shows the empty-state overlay when there are no elements', () => {
    const empty: QueryRespLike = {
      rows: [],
      columns: [],
      graph_summary: { nodes: [], edges: [] },
    }
    render(
      <ThemeProvider theme={testTheme}>
        <GraphViewReagraph resp={empty} />
      </ThemeProvider>
    )
    expect(screen.getByTestId('graph-empty-state')).toBeInTheDocument()
  })
})
