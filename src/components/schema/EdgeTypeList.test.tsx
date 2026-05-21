/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { MemoryRouter } from 'react-router-dom'

const setStaged = jest.fn()

type Resolver<T> = (v: T) => void
const edgeTypesCall = jest.fn<unknown, [unknown]>()
const edgeTypeResolvers: Array<Resolver<{ types: string[] }>> = []
let edgeTypesAutoResolve: string[] | null = ['ACTED_IN', 'DIRECTED']

jest.mock('../../api/client', () => ({
  client: {
    edgeTypes: (req: unknown): Promise<{ types: string[] }> => {
      edgeTypesCall(req)
      if (edgeTypesAutoResolve !== null) {
        return Promise.resolve({ types: edgeTypesAutoResolve })
      }
      return new Promise<{ types: string[] }>((resolve) => {
        edgeTypeResolvers.push(resolve)
      })
    },
  },
}))

jest.mock('../../lib/queryStore', () => ({
  useQueryStore: (selector: (s: unknown) => unknown) =>
    selector({ stagedStatement: null, setStaged }),
}))

// Pin the post-Bug-1 navigation target (QueryPage moved from `/` to
// `/query`). The actual react-router-dom MemoryRouter still handles
// route resolution; we only override useNavigate so the assertions
// can introspect the called path.
const navigate = jest.fn()
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => navigate,
}))

import { EdgeTypeList } from './EdgeTypeList'
import { createSchemaCache } from './schemaCache'

import { testTheme as theme } from '../../test-utils/theme'

beforeEach(() => {
  setStaged.mockClear()
  edgeTypesCall.mockClear()
  edgeTypeResolvers.length = 0
  edgeTypesAutoResolve = ['ACTED_IN', 'DIRECTED']
  navigate.mockClear()
})

function renderEdge(props: {
  graph: string
  cache?: ReturnType<typeof createSchemaCache>
}): { rerender: (graph: string) => void } {
  const cache = props.cache
  const { rerender } = render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <EdgeTypeList graph={props.graph} cache={cache} />
      </MemoryRouter>
    </ThemeProvider>
  )
  return {
    rerender: (graph: string) =>
      rerender(
        <ThemeProvider theme={theme}>
          <MemoryRouter>
            <EdgeTypeList graph={graph} cache={cache} />
          </MemoryRouter>
        </ThemeProvider>
      ),
  }
}

test('clicking an edge type stages a MATCH with USE GRAPH prefix', async () => {
  renderEdge({ graph: 'movies', cache: createSchemaCache() })

  await waitFor(() => {
    expect(screen.getByText('ACTED_IN')).toBeInTheDocument()
    expect(screen.getByText('DIRECTED')).toBeInTheDocument()
  })

  fireEvent.click(screen.getByText('ACTED_IN'))
  // Regression: must include `USE GRAPH <graph>;` prefix so Geode runs
  // the MATCH against the active graph. Without the prefix the query
  // executes against no graph and silently returns 0 rows.
  //
  // GAP-057: the projection MUST include the endpoint nodes (n, m) so
  // the graph view renders their type labels instead of "#<id>"
  // placeholders. The pre-GAP-057 shape was `()-[r:T]->() RETURN r`
  // which returned edges with start/end node IDs but no labels.
  expect(setStaged).toHaveBeenCalledWith(
    'USE GRAPH movies; MATCH (n)-[r:ACTED_IN]->(m) RETURN n, r, m LIMIT 25'
  )
  // 2026-05-21 follow-up to Bug 1: post-routing-flip the navigate
  // target must be /query (the dedicated QueryPage route) rather
  // than `/` (which redirects to /dashboard).
  expect(navigate).toHaveBeenCalledWith('/query')
})

test('GAP-057: every staged edge query projects both endpoints', async () => {
  renderEdge({ graph: 'movies', cache: createSchemaCache() })
  await waitFor(() => {
    expect(screen.getByText('DIRECTED')).toBeInTheDocument()
  })
  fireEvent.click(screen.getByText('DIRECTED'))
  const staged = setStaged.mock.calls[0]?.[0] as string
  // Both (n) and (m) must appear in the MATCH pattern, and the RETURN
  // projection must surface them so the cytoscape pipeline can paint
  // their type labels.
  expect(staged).toMatch(/MATCH \(n\)-\[r:DIRECTED\]->\(m\)/)
  expect(staged).toMatch(/RETURN n, r, m/)
})

test('PERF-#154: re-selecting the same graph serves edge types from cache (zero extra wire calls)', async () => {
  const cache = createSchemaCache()
  const h = renderEdge({ graph: 'alpha', cache })
  await waitFor(() => {
    expect(screen.getByText('ACTED_IN')).toBeInTheDocument()
  })
  expect(edgeTypesCall).toHaveBeenCalledTimes(1)

  h.rerender('beta')
  await waitFor(() => {
    expect(edgeTypesCall).toHaveBeenCalledTimes(2)
  })
  await act(async () => {
    await Promise.resolve()
  })

  // Re-select alpha -> from cache, no new call.
  h.rerender('alpha')
  await waitFor(() => {
    expect(screen.getByText('ACTED_IN')).toBeInTheDocument()
  })
  expect(edgeTypesCall).toHaveBeenCalledTimes(2)

  h.rerender('beta')
  await waitFor(() => {
    expect(screen.getByText('ACTED_IN')).toBeInTheDocument()
  })
  expect(edgeTypesCall).toHaveBeenCalledTimes(2)
})

test('PERF-#154: switching graph mid-flight aborts the prior fetch; a late resolve does not stomp state', async () => {
  edgeTypesAutoResolve = null
  const cache = createSchemaCache()
  const h = renderEdge({ graph: 'alpha', cache })
  await waitFor(() => {
    expect(edgeTypesCall).toHaveBeenCalledTimes(1)
  })
  expect(edgeTypeResolvers.length).toBe(1)

  h.rerender('beta')
  await waitFor(() => {
    expect(edgeTypesCall).toHaveBeenCalledTimes(2)
  })
  expect(edgeTypeResolvers.length).toBe(2)

  await act(async () => {
    edgeTypeResolvers[0]?.({ types: ['ALPHA_LATE'] })
    await Promise.resolve()
  })
  expect(document.body.textContent).not.toContain('ALPHA_LATE')
  expect(cache.getEdgeTypes('alpha')).toBeUndefined()

  await act(async () => {
    edgeTypeResolvers[1]?.({ types: ['BETA_OK'] })
    await Promise.resolve()
  })
  await waitFor(() => {
    expect(screen.getByText('BETA_OK')).toBeInTheDocument()
  })
})

// GAP-056: during the cold-miss window the user needs an in-product
// signal that the panel is fetching, not empty. The data-state seam
// flips loading -> loaded once the wire call resolves; the skeleton
// rows render while loading; the existing aria-busy contract surfaces
// the state to assistive tech.
test('GAP-056: renders loading skeleton during cold-miss fetch', async () => {
  edgeTypesAutoResolve = null
  renderEdge({ graph: 'movies', cache: createSchemaCache() })

  // The fetch is in-flight (resolver pending) — the list is in
  // loading state and three skeleton rows render.
  const list = screen.getByTestId('edge-type-list')
  expect(list).toHaveAttribute('data-state', 'loading')
  expect(list).toHaveAttribute('aria-busy', 'true')
  expect(screen.getAllByTestId('edge-type-skeleton')).toHaveLength(3)

  // Resolve the fetch — state flips to loaded.
  await act(async () => {
    edgeTypeResolvers[0]?.({ types: ['ACTED_IN'] })
    await Promise.resolve()
  })
  await waitFor(() => {
    expect(screen.getByTestId('edge-type-list')).toHaveAttribute(
      'data-state',
      'loaded'
    )
  })
})

test('PERF-#154: cache LRU eviction respects maxEntries (shared across kinds)', () => {
  const cache = createSchemaCache(2)
  cache.putEdgeTypes('a', ['A'])
  cache.putLabels('a', ['LA']) // distinct (kind, graph) -> distinct entry
  expect(cache.size()).toBe(2)
  // Inserting a third entry evicts the oldest (edgeTypes:a).
  cache.putEdgeTypes('b', ['B'])
  expect(cache.size()).toBe(2)
  expect(cache.getEdgeTypes('a')).toBeUndefined()
  expect(cache.getLabels('a')).toEqual(['LA'])
  expect(cache.getEdgeTypes('b')).toEqual(['B'])
})
