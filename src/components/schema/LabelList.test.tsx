/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { MemoryRouter } from 'react-router-dom'

// Mock the generated client and queryStore BEFORE importing LabelList
// so the useEffect-driven fetch resolves against the canned labels and
// the click handler can be observed by inspecting the setStaged mock.
//
// `labelsCall` records every invocation; `labelResolvers` exposes each
// in-flight Promise's resolver so the cache/abort tests can choose WHEN
// to resolve (the classic "race the new graph against the old fetch"
// setup).
const setStaged = jest.fn()

type Resolver<T> = (v: T) => void
const labelsCall = jest.fn<unknown, [unknown]>()
const labelResolvers: Array<Resolver<{ labels: string[] }>> = []
let labelsAutoResolve: string[] | null = ['Person', 'Movie']

jest.mock('../../api/client', () => ({
  client: {
    labels: (req: unknown): Promise<{ labels: string[] }> => {
      labelsCall(req)
      if (labelsAutoResolve !== null) {
        return Promise.resolve({ labels: labelsAutoResolve })
      }
      return new Promise<{ labels: string[] }>((resolve) => {
        labelResolvers.push(resolve)
      })
    },
  },
}))

jest.mock('../../lib/queryStore', () => ({
  useQueryStore: (selector: (s: unknown) => unknown) =>
    selector({ stagedStatement: null, setStaged }),
}))

// Capture nav target so the regression test for the post-Bug-1
// routing change (QueryPage moved off `/` to `/query`) can pin the
// click behaviour to the new path instead of the old index route
// (which now redirects to /dashboard).
const navigate = jest.fn()
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => navigate,
}))

import { LabelList } from './LabelList'
import { createSchemaCache } from './schemaCache'

import { testTheme as theme } from '../../test-utils/theme'

beforeEach(() => {
  setStaged.mockClear()
  labelsCall.mockClear()
  labelResolvers.length = 0
  labelsAutoResolve = ['Person', 'Movie']
  navigate.mockClear()
})

function renderList(props: {
  graph: string
  cache?: ReturnType<typeof createSchemaCache>
}): void {
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <LabelList graph={props.graph} cache={props.cache} />
      </MemoryRouter>
    </ThemeProvider>
  )
}

test('renders fetched labels and stages a MATCH query on click', async () => {
  renderList({ graph: 'default', cache: createSchemaCache() })

  // Wait for client.labels() to settle and both labels to appear.
  await waitFor(() => {
    expect(screen.getByText('Person')).toBeInTheDocument()
    expect(screen.getByText('Movie')).toBeInTheDocument()
  })

  // Click the Person button -- LabelList should hand a bare-identifier
  // MATCH statement to the query store and trigger navigation. Bare
  // identifiers are required because Geode v0.5.11 rejects backtick-
  // quoted form (42000: expected identifier or keyword, got 'invalid').
  fireEvent.click(screen.getByText('Person'))
  // Regression: must include `USE GRAPH <graph>;` prefix so Geode runs
  // the MATCH against the active graph. Without the prefix the query
  // executes against no graph and silently returns 0 rows.
  expect(setStaged).toHaveBeenCalledWith(
    'USE GRAPH default; MATCH (n:Person) RETURN n LIMIT 25'
  )
  // 2026-05-21 follow-up to Bug 1: QueryPage moved off `/` to
  // `/query`. The click must land on /query, NOT the index route
  // (which now redirects to /dashboard and would dump the staged
  // statement on the metrics overview).
  expect(navigate).toHaveBeenCalledWith('/query')
})

test('passes the active graph through to the staged statement', async () => {
  renderList({ graph: 'movies', cache: createSchemaCache() })
  await waitFor(() => {
    expect(screen.getByText('Person')).toBeInTheDocument()
  })
  fireEvent.click(screen.getByText('Person'))
  expect(setStaged).toHaveBeenCalledWith(
    'USE GRAPH movies; MATCH (n:Person) RETURN n LIMIT 25'
  )
})

test('PERF-#154: re-selecting the same graph serves labels from cache (zero extra wire calls)', async () => {
  const cache = createSchemaCache()
  const { rerender } = render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <LabelList graph="alpha" cache={cache} />
      </MemoryRouter>
    </ThemeProvider>
  )
  await waitFor(() => {
    expect(screen.getByText('Person')).toBeInTheDocument()
  })
  expect(labelsCall).toHaveBeenCalledTimes(1)

  // Switch to a different graph -> one more wire call.
  rerender(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <LabelList graph="beta" cache={cache} />
      </MemoryRouter>
    </ThemeProvider>
  )
  await waitFor(() => {
    expect(labelsCall).toHaveBeenCalledTimes(2)
  })
  // Yield so the beta fetch settles into the cache.
  await act(async () => {
    await Promise.resolve()
  })

  // Re-select "alpha" -> served from cache, NO additional wire call.
  rerender(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <LabelList graph="alpha" cache={cache} />
      </MemoryRouter>
    </ThemeProvider>
  )
  await waitFor(() => {
    expect(screen.getByText('Person')).toBeInTheDocument()
  })
  expect(labelsCall).toHaveBeenCalledTimes(2)

  // ...and re-select "beta" too -> still cached, still 2 calls total.
  rerender(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <LabelList graph="beta" cache={cache} />
      </MemoryRouter>
    </ThemeProvider>
  )
  await waitFor(() => {
    expect(screen.getByText('Person')).toBeInTheDocument()
  })
  expect(labelsCall).toHaveBeenCalledTimes(2)
})

test('PERF-#154: switching graph mid-flight aborts the prior fetch; a late resolve does not stomp state', async () => {
  labelsAutoResolve = null // deferred resolution
  const cache = createSchemaCache()
  const { rerender } = render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <LabelList graph="alpha" cache={cache} />
      </MemoryRouter>
    </ThemeProvider>
  )
  await waitFor(() => {
    expect(labelsCall).toHaveBeenCalledTimes(1)
  })
  expect(labelResolvers.length).toBe(1)

  // Switch to beta BEFORE alpha resolves.
  rerender(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <LabelList graph="beta" cache={cache} />
      </MemoryRouter>
    </ThemeProvider>
  )
  await waitFor(() => {
    expect(labelsCall).toHaveBeenCalledTimes(2)
  })
  expect(labelResolvers.length).toBe(2)

  // Late-resolve the prior "alpha" fetch with data that would have
  // stomped the panel if cancellation were broken.
  await act(async () => {
    labelResolvers[0]?.({ labels: ['ALPHA_LATE'] })
    await Promise.resolve()
  })
  expect(document.body.textContent).not.toContain('ALPHA_LATE')
  // The aborted request must not have populated the cache either.
  expect(cache.getLabels('alpha')).toBeUndefined()

  // Resolve beta -> panel updates normally.
  await act(async () => {
    labelResolvers[1]?.({ labels: ['BETA_OK'] })
    await Promise.resolve()
  })
  await waitFor(() => {
    expect(screen.getByText('BETA_OK')).toBeInTheDocument()
  })
})

test('PERF-#154: cache LRU eviction respects maxEntries', () => {
  const cache = createSchemaCache(2)
  cache.putLabels('a', ['A'])
  cache.putLabels('b', ['B'])
  expect(cache.size()).toBe(2)
  cache.putLabels('c', ['C'])
  expect(cache.size()).toBe(2)
  // 'a' was inserted first; it should have been evicted.
  expect(cache.getLabels('a')).toBeUndefined()
  expect(cache.getLabels('c')).toEqual(['C'])
  // Re-hitting 'b' promotes it; inserting 'd' should evict 'c'.
  cache.putLabels('b', ['B2'])
  cache.putLabels('d', ['D'])
  expect(cache.getLabels('c')).toBeUndefined()
  expect(cache.getLabels('b')).toEqual(['B2'])
})
