/// <reference types="@testing-library/jest-dom" />
//
// Reproduction tests for the bug:
//
//   "In mobile the overlay options on the graph visualizer don't work
//   properly — they are off-canvas and overlapping other areas."
//
// GraphMiniMap is a 160×120 px panel anchored bottom-right of the
// canvas wrapper. On a 320-360 px mobile viewport that's ~50% of the
// horizontal canvas width and a sizable vertical slice — the user
// loses the bottom-right quadrant of the actual graph to the
// navigator thumbnail. Add a short canvas (< 132 px = panel height +
// inset) and the panel extends ABOVE the canvas top edge, overlapping
// the toolbar/filter chips.
//
// Contract: at mobile widths the mini-map MUST NOT render even when
// the sticky pref is on. The toolbar's mini-map toggle still flips
// the preference (a desktop visit picks the pref up); we just suppress
// the on-canvas panel at sizes where it's an attractive nuisance.
//
// At desktop widths the panel MUST still render when the pref is on.

import React from 'react'
import { render } from '@testing-library/react'
import { GraphMiniMap } from './GraphMiniMap'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../../test-utils/theme'

function installMatchMediaMock(viewportPx: number): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => {
      const m = query.match(/max-width:\s*([0-9.]+)px/)
      const limit = m && m[1] ? parseFloat(m[1]) : Infinity
      return {
        matches: viewportPx <= limit,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }
    },
  })
}

describe('GraphMiniMap — mobile hides the navigator panel', () => {
  it('does not render at a mobile viewport', () => {
    installMatchMediaMock(375)
    const cyRef = { current: null }
    const { queryByTestId } = render(
      <ThemeProvider theme={theme}>
        <GraphMiniMap cyRef={cyRef} sig="x" />
      </ThemeProvider>
    )
    expect(queryByTestId('graph-minimap')).toBeNull()
  })

  it('renders at a desktop viewport', () => {
    installMatchMediaMock(1200)
    const cyRef = { current: null }
    const { getByTestId } = render(
      <ThemeProvider theme={theme}>
        <GraphMiniMap cyRef={cyRef} sig="x" />
      </ThemeProvider>
    )
    expect(getByTestId('graph-minimap')).toBeInTheDocument()
  })
})
