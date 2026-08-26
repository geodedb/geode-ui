import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { ErrorBoundary } from './ErrorBoundary'
import { testTheme as theme } from '../../test-utils/theme'

afterEach(cleanup)

function Boom({ message }: { message: string }): React.JSX.Element {
  throw new Error(message)
}

describe('ErrorBoundary', () => {
  // jsdom logs every render-time throw via console.error; the boundary
  // also logs the caught object. Silence both during the throw cases so
  // the test output stays focused on the assertions.
  let consoleSpy: jest.SpyInstance
  beforeEach(() => {
    consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
  })
  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('renders children when no error is thrown', () => {
    render(
      <ThemeProvider theme={theme}>
        <ErrorBoundary>
          <p>healthy child</p>
        </ErrorBoundary>
      </ThemeProvider>
    )
    expect(screen.getByText('healthy child')).toBeInTheDocument()
  })

  it('renders the fallback UI with the error message when a child throws', () => {
    render(
      <ThemeProvider theme={theme}>
        <ErrorBoundary>
          <Boom message="kaboom: dispatcher missing" />
        </ErrorBoundary>
      </ThemeProvider>
    )
    const card = screen.getByTestId('app-error-boundary')
    expect(card).toBeInTheDocument()
    expect(card).toHaveAttribute('role', 'alert')
    expect(card.textContent ?? '').toMatch(/Something went wrong/)
    expect(card.textContent ?? '').toMatch(/kaboom: dispatcher missing/)
    expect(
      screen.getByRole('button', { name: /reload page/i })
    ).toBeInTheDocument()
  })
})
