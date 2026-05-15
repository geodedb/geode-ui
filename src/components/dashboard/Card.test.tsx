import React from 'react'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

import { Card } from './Card'
import { testTheme } from '../../test-utils/theme'

function renderCard(ui: React.ReactElement): void {
  render(<ThemeProvider theme={testTheme}>{ui}</ThemeProvider>)
}

test('renders the title heading and children', () => {
  renderCard(
    <Card title="My Card">
      <span>body text</span>
    </Card>
  )
  expect(screen.getByRole('heading', { name: 'My Card' })).toBeInTheDocument()
  expect(screen.getByText('body text')).toBeInTheDocument()
})

test('renders the action node when given', () => {
  renderCard(
    <Card title="With Action" action={<button>act</button>}>
      <span>body</span>
    </Card>
  )
  expect(screen.getByRole('button', { name: 'act' })).toBeInTheDocument()
})

test('renders no extra button when no action is given', () => {
  renderCard(
    <Card title="No Action">
      <span>body</span>
    </Card>
  )
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

test('forwards data-testid to the section element', () => {
  renderCard(
    <Card title="Tagged" data-testid="my-card">
      <span>body</span>
    </Card>
  )
  expect(screen.getByTestId('my-card')).toBeInTheDocument()
  expect(screen.getByTestId('my-card').tagName).toBe('SECTION')
})
