/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { MemoryRouter } from 'react-router-dom'

// Mock the generated client and queryStore BEFORE importing LabelList
// so the useEffect-driven fetch resolves against the canned labels and
// the click handler can be observed by inspecting the setStaged mock.
const setStaged = jest.fn()

jest.mock('../../api/client', () => ({
  client: {
    labels: jest.fn().mockResolvedValue({ labels: ['Person', 'Movie'] }),
  },
}))

jest.mock('../../lib/queryStore', () => ({
  useQueryStore: (selector: (s: unknown) => unknown) =>
    selector({ stagedStatement: null, setStaged }),
}))

import { LabelList } from './LabelList'

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

beforeEach(() => {
  setStaged.mockClear()
})

test('renders fetched labels and stages a MATCH query on click', async () => {
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <LabelList graph="default" />
      </MemoryRouter>
    </ThemeProvider>
  )

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
})

test('passes the active graph through to the staged statement', async () => {
  setStaged.mockClear()
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <LabelList graph="movies" />
      </MemoryRouter>
    </ThemeProvider>
  )
  await waitFor(() => {
    expect(screen.getByText('Person')).toBeInTheDocument()
  })
  fireEvent.click(screen.getByText('Person'))
  expect(setStaged).toHaveBeenCalledWith(
    'USE GRAPH movies; MATCH (n:Person) RETURN n LIMIT 25'
  )
})
