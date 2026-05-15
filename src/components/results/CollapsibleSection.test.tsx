/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../test-utils/theme'
import { CollapsibleSection } from './CollapsibleSection'

describe('CollapsibleSection', () => {
  it('renders the heading and the body when open=true', () => {
    render(
      <ThemeProvider theme={theme}>
        <CollapsibleSection title="Hello" open onToggle={() => {}}>
          <p>body</p>
        </CollapsibleSection>
      </ThemeProvider>
    )
    expect(screen.getByText('Hello')).toBeInTheDocument()
    expect(screen.getByText('body')).toBeInTheDocument()
  })

  it('hides the body when open=false', () => {
    render(
      <ThemeProvider theme={theme}>
        <CollapsibleSection title="Hello" open={false} onToggle={() => {}}>
          <p>secret</p>
        </CollapsibleSection>
      </ThemeProvider>
    )
    expect(screen.queryByText('secret')).not.toBeInTheDocument()
  })

  it('fires onToggle when the summary is clicked', () => {
    const onToggle = jest.fn()
    render(
      <ThemeProvider theme={theme}>
        <CollapsibleSection title="Hello" open={false} onToggle={onToggle}>
          <p>body</p>
        </CollapsibleSection>
      </ThemeProvider>
    )
    fireEvent.click(screen.getByText('Hello'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('exposes aria-expanded reflecting the open state', () => {
    const { rerender } = render(
      <ThemeProvider theme={theme}>
        <CollapsibleSection title="Hello" open onToggle={() => {}}>
          <p>body</p>
        </CollapsibleSection>
      </ThemeProvider>
    )
    const btn = screen.getByRole('button', { name: /hello/i })
    expect(btn).toHaveAttribute('aria-expanded', 'true')

    rerender(
      <ThemeProvider theme={theme}>
        <CollapsibleSection title="Hello" open={false} onToggle={() => {}}>
          <p>body</p>
        </CollapsibleSection>
      </ThemeProvider>
    )
    expect(btn).toHaveAttribute('aria-expanded', 'false')
  })

  it('forwards data-testid to the section wrapper when provided', () => {
    render(
      <ThemeProvider theme={theme}>
        <CollapsibleSection
          title="Hello"
          open
          onToggle={() => {}}
          testId="my-section"
        >
          <p>body</p>
        </CollapsibleSection>
      </ThemeProvider>
    )
    expect(screen.getByTestId('my-section')).toBeInTheDocument()
  })
})
