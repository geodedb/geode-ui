import React from 'react'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { MemoryRouter } from 'react-router-dom'

import { GraphsCard } from './GraphsCard'
import { testTheme } from '../../test-utils/theme'

function renderCard(ui: React.ReactElement): void {
  render(
    <MemoryRouter>
      <ThemeProvider theme={testTheme}>{ui}</ThemeProvider>
    </MemoryRouter>
  )
}

test('lists graphs and shows the count in the heading', () => {
  renderCard(
    <GraphsCard graphs={['default', 'movies']} loading={false} error={null} />
  )
  expect(
    screen.getByRole('heading', { name: /Graphs \(2\)/ })
  ).toBeInTheDocument()
  expect(screen.getByText('default')).toBeInTheDocument()
  expect(screen.getByText('movies')).toBeInTheDocument()
})

test('shows a loading status while loading', () => {
  renderCard(<GraphsCard graphs={null} loading error={null} />)
  expect(screen.getByRole('status')).toBeInTheDocument()
})

test('shows an alert with the error message on error', () => {
  renderCard(<GraphsCard graphs={null} loading={false} error="nope" />)
  expect(screen.getByRole('alert')).toHaveTextContent('nope')
})

test('shows an empty state when there are no graphs', () => {
  renderCard(<GraphsCard graphs={[]} loading={false} error={null} />)
  expect(screen.getByRole('note')).toBeInTheDocument()
})

// GAP-055: every listed graph deep-links into /schema?graph=…. The card
// is the user's headline "graphs this server hosts" surface and pretending
// to be a navigation card while rendering inert <li>s was a UX dead-end.
test('GAP-055: each graph row deep-links into the schema explorer', () => {
  renderCard(
    <GraphsCard graphs={['default', 'movies']} loading={false} error={null} />
  )
  const links = screen.getAllByTestId('dashboard-graphs-link')
  expect(links).toHaveLength(2)
  expect(links[0]).toHaveAttribute('href', '/schema?graph=default')
  expect(links[1]).toHaveAttribute('href', '/schema?graph=movies')
})

test('GAP-055: encodes graph names that contain reserved URL characters', () => {
  renderCard(
    <GraphsCard graphs={['my graph & co']} loading={false} error={null} />
  )
  const link = screen.getByTestId('dashboard-graphs-link')
  expect(link).toHaveAttribute('href', '/schema?graph=my%20graph%20%26%20co')
})
