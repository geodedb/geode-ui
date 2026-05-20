/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

import { QueryBuilderPanel } from './QueryBuilderPanel'
import { LocalizationProvider } from '../../services/i18n'
import { testTheme as theme } from '../../test-utils/theme'

function renderPanel(onApply: (gql: string) => void): void {
  render(
    <LocalizationProvider>
      <ThemeProvider theme={theme}>
        <QueryBuilderPanel graph="movies" onApply={onApply} />
      </ThemeProvider>
    </LocalizationProvider>
  )
}

test('GAP-060: builder applies the synthesised GQL on click', () => {
  const onApply = jest.fn()
  renderPanel(onApply)

  // Default state already valid (Person, no edge, LIMIT 25).
  fireEvent.click(screen.getByTestId('qb-apply'))
  expect(onApply).toHaveBeenCalledWith(
    'USE GRAPH movies; MATCH (n:Person) RETURN n LIMIT 25'
  )
})

test('GAP-060: edge type + end label produce the path MATCH', () => {
  const onApply = jest.fn()
  renderPanel(onApply)

  fireEvent.change(screen.getByTestId('qb-edge-type'), {
    target: { value: 'ACTED_IN' },
  })
  fireEvent.change(screen.getByTestId('qb-end-label'), {
    target: { value: 'Movie' },
  })
  fireEvent.click(screen.getByTestId('qb-apply'))
  expect(onApply).toHaveBeenCalledWith(
    'USE GRAPH movies; MATCH (n:Person)-[r:ACTED_IN]->(m:Movie) RETURN n, r, m LIMIT 25'
  )
})

test('GAP-060: empty start label aborts apply (no-op)', () => {
  const onApply = jest.fn()
  renderPanel(onApply)
  fireEvent.change(screen.getByTestId('qb-start-label'), {
    target: { value: '   ' },
  })
  fireEvent.click(screen.getByTestId('qb-apply'))
  expect(onApply).not.toHaveBeenCalled()
})

test('GAP-autocomplete: start label input has a datalist of known labels', () => {
  const onApply = jest.fn()
  render(
    <LocalizationProvider>
      <ThemeProvider theme={theme}>
        <QueryBuilderPanel
          graph="movies"
          knownLabels={['Person', 'Movie', 'Director']}
          knownEdgeTypes={['ACTED_IN', 'DIRECTED']}
          onApply={onApply}
        />
      </ThemeProvider>
    </LocalizationProvider>
  )
  const startInput = screen.getByTestId('qb-start-label') as HTMLInputElement
  const listId = startInput.getAttribute('list')
  expect(listId).toBeTruthy()
  const options = Array.from(
    document.getElementById(listId!)?.querySelectorAll('option') ?? []
  ).map((o) => (o as HTMLOptionElement).value)
  expect(options).toEqual(['Director', 'Movie', 'Person'])
})

test('GAP-autocomplete: edge type input has a datalist of known edge types', () => {
  const onApply = jest.fn()
  render(
    <LocalizationProvider>
      <ThemeProvider theme={theme}>
        <QueryBuilderPanel
          graph="movies"
          knownLabels={[]}
          knownEdgeTypes={['ACTED_IN', 'DIRECTED', 'ACTED_IN']}
          onApply={onApply}
        />
      </ThemeProvider>
    </LocalizationProvider>
  )
  const edgeInput = screen.getByTestId('qb-edge-type') as HTMLInputElement
  const listId = edgeInput.getAttribute('list')
  const options = Array.from(
    document.getElementById(listId!)?.querySelectorAll('option') ?? []
  ).map((o) => (o as HTMLOptionElement).value)
  expect(options).toEqual(['ACTED_IN', 'DIRECTED'])
})
