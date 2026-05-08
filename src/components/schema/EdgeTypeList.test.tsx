/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { MemoryRouter } from 'react-router-dom'

const setStaged = jest.fn()

jest.mock('../../api/client', () => ({
  client: {
    edgeTypes: jest.fn().mockResolvedValue({ types: ['ACTED_IN', 'DIRECTED'] }),
  },
}))

jest.mock('../../lib/queryStore', () => ({
  useQueryStore: (selector: (s: unknown) => unknown) =>
    selector({ stagedStatement: null, setStaged }),
}))

import { EdgeTypeList } from './EdgeTypeList'

import { testTheme as theme } from '../../test-utils/theme'

beforeEach(() => {
  setStaged.mockClear()
})

test('clicking an edge type stages a MATCH with USE GRAPH prefix', async () => {
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <EdgeTypeList graph="movies" />
      </MemoryRouter>
    </ThemeProvider>
  )

  await waitFor(() => {
    expect(screen.getByText('ACTED_IN')).toBeInTheDocument()
    expect(screen.getByText('DIRECTED')).toBeInTheDocument()
  })

  fireEvent.click(screen.getByText('ACTED_IN'))
  // Regression: must include `USE GRAPH <graph>;` prefix so Geode runs
  // the MATCH against the active graph. Without the prefix the query
  // executes against no graph and silently returns 0 rows.
  expect(setStaged).toHaveBeenCalledWith(
    'USE GRAPH movies; MATCH ()-[r:ACTED_IN]->() RETURN r LIMIT 25'
  )
})
