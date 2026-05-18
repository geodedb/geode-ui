/// <reference types="@testing-library/jest-dom" />
//
// Bug 2 / Bug 3 reproduction:
// The graph sidebar (Visibility / Display Fields / Inspector) had no
// in-sidebar collapse affordance on desktop. The only way to hide it
// was through the GraphToolbarMore dropdown's "Hide sidebar" item,
// which is buried inside a wa-dropdown. The fix renders an in-sidebar
// ✕ button when an `onCollapse` callback is wired, and switches the
// sidebar overflow to `overflow-y: auto; overflow-x: hidden` so a
// long property value never produces a horizontal scrollbar (Bug 3).

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../../test-utils/theme'
import { GraphSidebar } from './GraphSidebar'

describe('GraphSidebar in-sidebar collapse button (Bug 2)', () => {
  it('renders the collapse button when onCollapse is provided', () => {
    const onCollapse = jest.fn()
    render(
      <ThemeProvider theme={theme}>
        <GraphSidebar onCollapse={onCollapse} collapseLabel="Hide sidebar">
          <p>body</p>
        </GraphSidebar>
      </ThemeProvider>
    )
    const btn = screen.getByTestId('graph-sidebar-collapse-btn')
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveAttribute('aria-label', 'Hide sidebar')
  })

  it('invokes onCollapse when the button is clicked', () => {
    const onCollapse = jest.fn()
    render(
      <ThemeProvider theme={theme}>
        <GraphSidebar onCollapse={onCollapse} collapseLabel="Hide">
          <p>body</p>
        </GraphSidebar>
      </ThemeProvider>
    )
    fireEvent.click(screen.getByTestId('graph-sidebar-collapse-btn'))
    expect(onCollapse).toHaveBeenCalledTimes(1)
  })

  it('omits the collapse button when onCollapse is not provided', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphSidebar>
          <p>body</p>
        </GraphSidebar>
      </ThemeProvider>
    )
    expect(
      screen.queryByTestId('graph-sidebar-collapse-btn')
    ).not.toBeInTheDocument()
  })
})

describe('GraphSidebar overflow-x is hidden (Bug 3)', () => {
  it('emits overflow-x: hidden so a long inspector value cannot scroll horizontally', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphSidebar>
          <p>body</p>
        </GraphSidebar>
      </ThemeProvider>
    )
    const css = Array.from(document.head.querySelectorAll('style'))
      .map((s) => s.textContent ?? '')
      .join('\n')
    // The Side styled-component must split overflow into two axes;
    // the shorthand `overflow: auto` lets X scroll.
    expect(css).toMatch(/overflow-x:\s*hidden/)
    expect(css).toMatch(/overflow-y:\s*auto/)
    // It MUST NOT use the shorthand that was the bug.
    expect(css).not.toMatch(/(?<![-\w])overflow:\s*auto/)
  })
})
