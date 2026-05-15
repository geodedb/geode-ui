import React from 'react'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

import { GraphsCard } from './GraphsCard'
import { testTheme } from '../../test-utils/theme'

function renderCard(ui: React.ReactElement): void {
  render(<ThemeProvider theme={testTheme}>{ui}</ThemeProvider>)
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
