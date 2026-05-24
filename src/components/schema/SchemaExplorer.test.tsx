/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { MemoryRouter } from 'react-router-dom'

// PERF-F8 (#52) regression. The SchemaExplorer must:
//   1. abort an in-flight indexes/constraints fetch when the active
//      graph changes mid-flight (otherwise late-resolving responses
//      for the previous graph stomp the panel state)
//   2. avoid re-fetching when the user re-selects a graph already
//      hydrated this session (per-graph cache).
//
// We mock the generated client at the module-graph level so the
// useEffect-driven fetch lands on a Promise we can resolve at a
// chosen time. AbortController behaviour is observed via the
// `abortedCalls` array — every time the component aborts a prior
// fetch we should see it grow.

const labelsCall = jest.fn()
const edgeTypesCall = jest.fn()

// indexResolvers / constraintResolvers track the in-flight Promise's
// resolver so each test can decide WHEN to resolve. This is the
// classic "race the new graph against the old fetch" setup.
type Resolver<T> = (v: T) => void
const indexResolvers: Array<
  Resolver<{ indexes: Array<Record<string, unknown>> }>
> = []
const constraintResolvers: Array<
  Resolver<{ constraints: Array<Record<string, unknown>> }>
> = []

const indexesCallArgs: Array<{ graph: string }> = []
const constraintsCallArgs: Array<{ graph: string }> = []

jest.mock('../../api/client', () => ({
  client: {
    graphs: jest.fn().mockResolvedValue({ graphs: ['alpha', 'beta'] }),
    labels: (...args: unknown[]): Promise<{ labels: string[] }> => {
      labelsCall(...args)
      return Promise.resolve({ labels: [] })
    },
    edgeTypes: (...args: unknown[]): Promise<{ edge_types: unknown[] }> => {
      edgeTypesCall(...args)
      return Promise.resolve({ edge_types: [] })
    },
    indexes: jest.fn((req: { graph: string }) => {
      indexesCallArgs.push(req)
      return new Promise<{ indexes: Array<Record<string, unknown>> }>(
        (resolve) => {
          indexResolvers.push(resolve)
        }
      )
    }),
    constraints: jest.fn((req: { graph: string }) => {
      constraintsCallArgs.push(req)
      return new Promise<{ constraints: Array<Record<string, unknown>> }>(
        (resolve) => {
          constraintResolvers.push(resolve)
        }
      )
    }),
  },
}))

import { SchemaExplorer, createSchemaExplorerCache } from './SchemaExplorer'

import { testTheme as theme } from '../../test-utils/theme'

beforeEach(() => {
  labelsCall.mockClear()
  edgeTypesCall.mockClear()
  indexResolvers.length = 0
  constraintResolvers.length = 0
  indexesCallArgs.length = 0
  constraintsCallArgs.length = 0
  // The mocks in jest.mock() are call counters; reset between tests.
  // eslint-disable-next-line global-require
  const c = require('../../api/client').client
  c.indexes.mockClear()
  c.constraints.mockClear()
  c.graphs.mockClear()
  c.graphs.mockResolvedValue({ graphs: ['alpha', 'beta'] })
})

function renderExplorer(cache = createSchemaExplorerCache()): {
  cache: ReturnType<typeof createSchemaExplorerCache>
} {
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <SchemaExplorer cache={cache} />
      </MemoryRouter>
    </ThemeProvider>
  )
  return { cache }
}

test('F8: aborts the prior graph fetch when active graph changes mid-flight', async () => {
  renderExplorer()

  // Wait for the initial graphs list to populate; the component
  // auto-selects the first graph ("alpha").
  await waitFor(() => {
    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('beta')).toBeInTheDocument()
  })

  // After auto-selection there should be one in-flight pair for "alpha".
  expect(indexesCallArgs[0]?.graph).toBe('alpha')
  expect(constraintsCallArgs[0]?.graph).toBe('alpha')
  expect(indexResolvers.length).toBe(1)
  expect(constraintResolvers.length).toBe(1)

  // Switch to "beta" BEFORE the alpha fetch resolves.
  fireEvent.click(screen.getByText('beta'))

  await waitFor(() => {
    // A new pair should be in-flight for beta.
    expect(indexesCallArgs[1]?.graph).toBe('beta')
    expect(constraintsCallArgs[1]?.graph).toBe('beta')
  })

  // Late-resolve the prior "alpha" fetch with data that would have
  // overwritten the beta panel if cancellation were broken.
  await act(async () => {
    indexResolvers[0]?.({ indexes: [{ name: 'ALPHA_LATE' }] })
    constraintResolvers[0]?.({ constraints: [{ name: 'ALPHA_LATE_C' }] })
    // Yield to microtasks.
    await Promise.resolve()
  })

  // The DOM must NOT show the alpha-late payload.
  expect(document.body.textContent).not.toContain('ALPHA_LATE')

  // Now resolve beta to confirm the panel still updates correctly.
  await act(async () => {
    indexResolvers[1]?.({ indexes: [{ name: 'BETA_OK' }] })
    constraintResolvers[1]?.({ constraints: [{ name: 'BETA_OK_C' }] })
    await Promise.resolve()
  })
  await waitFor(() => {
    // <pre> renders the JSON with whitespace; use a textContent match.
    expect(document.body.textContent).toContain('BETA_OK')
  })
})

test('F8: cached graphs do not refetch on re-select', async () => {
  const cache = createSchemaExplorerCache()
  // Pre-warm the cache for "beta" so a click on beta does NOT
  // trigger any network call.
  cache.put('beta', {
    indexes: [{ name: 'CACHED_BETA_I' }],
    constraints: [{ name: 'CACHED_BETA_C' }],
  })

  renderExplorer(cache)
  await waitFor(() => {
    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('beta')).toBeInTheDocument()
  })

  // One pair for alpha (auto-select on mount).
  const alphaCallCount = indexesCallArgs.length

  // Switch to beta — should be served from cache. No new client call.
  fireEvent.click(screen.getByText('beta'))
  await waitFor(() => {
    expect(document.body.textContent).toContain('CACHED_BETA_I')
  })
  // The number of client.indexes / client.constraints calls must be
  // unchanged after the cached selection.
  expect(indexesCallArgs.length).toBe(alphaCallCount)
  expect(constraintsCallArgs.length).toBe(alphaCallCount)
})

// GAP-055: dashboard cards now deep-link via /schema?graph=<name>. The
// explorer must honour the URL preselect on mount instead of forcing
// the first server-returned graph; otherwise the dashboard click looks
// inert (lands on /schema but stuck on graph[0]).
test('GAP-055: ?graph= preselects the matching graph on mount', async () => {
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={['/schema?graph=beta']}>
        <SchemaExplorer cache={createSchemaExplorerCache()} />
      </MemoryRouter>
    </ThemeProvider>
  )
  await waitFor(() => {
    // The picker fires labels() once per active-graph change; we lean
    // on indexes() calls instead because they are predictable wire
    // calls captured by the mock. The first call must be for beta,
    // not the first-server-returned alpha.
    expect(indexesCallArgs[0]?.graph).toBe('beta')
  })
})

// Defensive: a stale URL pointing at a graph the server no longer
// serves must fall through to the first-graph auto-select rather than
// leaving the panes empty.
test('GAP-055: ?graph= falls through when the named graph is missing', async () => {
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={['/schema?graph=ghost']}>
        <SchemaExplorer cache={createSchemaExplorerCache()} />
      </MemoryRouter>
    </ThemeProvider>
  )
  await waitFor(() => {
    expect(indexesCallArgs[0]?.graph).toBe('alpha')
  })
})

test('F8: cache LRU eviction respects maxEntries', () => {
  const cache = createSchemaExplorerCache(3)
  cache.put('a', { indexes: [], constraints: [] })
  cache.put('b', { indexes: [], constraints: [] })
  cache.put('c', { indexes: [], constraints: [] })
  expect(cache.size()).toBe(3)
  cache.put('d', { indexes: [], constraints: [] })
  expect(cache.size()).toBe(3)
  // 'a' was inserted first; it should have been evicted.
  expect(cache.get('a')).toBeUndefined()
  expect(cache.get('d')).toBeDefined()

  // Re-hitting 'b' promotes it; inserting 'e' should evict 'c'.
  cache.put('b', { indexes: [{ name: 'B2' }], constraints: [] })
  cache.put('e', { indexes: [], constraints: [] })
  expect(cache.size()).toBe(3)
  expect(cache.get('c')).toBeUndefined()
  expect(cache.get('b')?.indexes[0]).toEqual({ name: 'B2' })
})

test('renders FULLTEXT index type alongside BTREE in the indexes table', async () => {
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={['/schema?graph=alpha']}>
        <SchemaExplorer cache={createSchemaExplorerCache()} />
      </MemoryRouter>
    </ThemeProvider>
  )
  await waitFor(() => expect(indexesCallArgs.length).toBeGreaterThan(0))
  // Resolve indexes with one BTREE and one FULLTEXT row; constraints
  // can stay empty for this assertion.
  await act(async () => {
    indexResolvers[0]?.({
      indexes: [
        {
          name: 'idx_person_name',
          label: 'Person',
          property: 'name',
          index_type: 'BTREE',
        },
        {
          name: 'ft_doc_body',
          label: 'Doc',
          property: 'body',
          index_type: 'FULLTEXT',
        },
      ],
    })
    constraintResolvers[0]?.({ constraints: [] })
  })
  expect(await screen.findByTestId('schema-indexes-table')).toBeInTheDocument()
  expect(screen.getByText('idx_person_name')).toBeInTheDocument()
  expect(screen.getByText('ft_doc_body')).toBeInTheDocument()
  expect(screen.getByText('BTREE')).toBeInTheDocument()
  expect(screen.getByText('FULLTEXT')).toBeInTheDocument()
})
