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
    </ThemeProvider>,
  )

  // Wait for client.labels() to settle and both labels to appear.
  await waitFor(() => {
    expect(screen.getByText('Person')).toBeInTheDocument()
    expect(screen.getByText('Movie')).toBeInTheDocument()
  })

  // Click the Person button -- LabelList should hand a backtick-wrapped
  // MATCH statement to the query store and trigger navigation.
  fireEvent.click(screen.getByText('Person'))
  expect(setStaged).toHaveBeenCalledWith('MATCH (n:`Person`) RETURN n LIMIT 25')
})
