/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../../test-utils/theme'
import {
  GraphFilterChips,
  type GraphFilterChipsProps,
} from './GraphFilterChips'

const makeProps = (
  overrides: Partial<GraphFilterChipsProps> = {}
): GraphFilterChipsProps => ({
  t: (k: string, opts?: Record<string, unknown>) => {
    if (!opts) return k
    return `${k}|${JSON.stringify(opts)}`
  },
  hiddenLabels: new Set<string>(),
  onClearHidden: () => {},
  clusterByLabel: false,
  onClearCluster: () => {},
  focusActive: false,
  focusId: null,
  focusHops: 1,
  onClearFocus: () => {},
  pathActive: false,
  onClearPath: () => {},
  ...overrides,
})

describe('GraphFilterChips', () => {
  it('renders nothing when no filter is active', () => {
    const { container } = render(
      <ThemeProvider theme={theme}>
        <GraphFilterChips {...makeProps()} />
      </ThemeProvider>
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders one chip per active filter', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphFilterChips
          {...makeProps({
            hiddenLabels: new Set(['Movie', 'Person']),
            clusterByLabel: true,
            focusActive: true,
            focusId: '7',
            pathActive: true,
          })}
        />
      </ThemeProvider>
    )
    expect(screen.getByTestId('graph-chip-hidden-Movie')).toBeInTheDocument()
    expect(screen.getByTestId('graph-chip-hidden-Person')).toBeInTheDocument()
    expect(screen.getByTestId('graph-chip-cluster')).toBeInTheDocument()
    expect(screen.getByTestId('graph-chip-focused')).toBeInTheDocument()
    expect(screen.getByTestId('graph-chip-path')).toBeInTheDocument()
  })

  it('clicking a hidden chip clear-x fires onClearHidden with the label', () => {
    const onClearHidden = jest.fn()
    render(
      <ThemeProvider theme={theme}>
        <GraphFilterChips
          {...makeProps({
            hiddenLabels: new Set(['Movie']),
            onClearHidden,
          })}
        />
      </ThemeProvider>
    )
    const chip = screen.getByTestId('graph-chip-hidden-Movie')
    const btn = chip.querySelector('button')
    if (!btn) throw new Error('expected a button inside the chip')
    fireEvent.click(btn)
    expect(onClearHidden).toHaveBeenCalledWith('Movie')
  })

  it('clicking the cluster chip clear-x fires onClearCluster', () => {
    const onClearCluster = jest.fn()
    render(
      <ThemeProvider theme={theme}>
        <GraphFilterChips
          {...makeProps({ clusterByLabel: true, onClearCluster })}
        />
      </ThemeProvider>
    )
    const btn = screen.getByTestId('graph-chip-cluster').querySelector('button')
    if (!btn) throw new Error('expected a button')
    fireEvent.click(btn)
    expect(onClearCluster).toHaveBeenCalledTimes(1)
  })

  it('renders the chip strip wrapper with data-testid graph-filter-chips when any chip is active', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphFilterChips {...makeProps({ pathActive: true })} />
      </ThemeProvider>
    )
    expect(screen.getByTestId('graph-filter-chips')).toBeInTheDocument()
  })
})
