/// <reference types="@testing-library/jest-dom" />
//
// Reproduction tests for the bug:
//
//   "In mobile the overlay options on the graph visualizer don't work
//   properly — they are off-canvas and overlapping other areas."
//
// The GraphCanvasControls pill stacks vertically (zoom-in button +
// vertical 110 px slider + zoom-out button + fit button + reset
// button + 4×4 px gaps + 8 px vertical padding) totalling ~210-250 px
// of intrinsic height. It anchors with `position: absolute; bottom:
// 12 px` of the canvas wrapper. On a short mobile canvas (e.g. 240 px
// when the editor + toolbar above eat most of the viewport) the pill
// extends ~60-110 px ABOVE the canvas top edge, overlapping the
// filter chips / path-status row / toolbar.
//
// Contract: at mobile widths the pill MUST NOT render. Pinch-to-zoom
// and two-finger pan are the canonical mobile gestures on a touch
// canvas; the pill is desktop chrome that has no place at <md.
//
// At desktop widths the pill MUST still render — this is purely a
// mobile-hide, not a removal.

import React from 'react'
import { render } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../../test-utils/theme'
import { GraphCanvasControls } from './GraphCanvasControls'

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

const props = {
  zoomLevel: 0.5,
  onZoomLevelChange: jest.fn(),
  onZoomIn: jest.fn(),
  onZoomOut: jest.fn(),
  onFit: jest.fn(),
  onResetView: jest.fn(),
  t: (k: string) => k,
}

describe('GraphCanvasControls — mobile hides the on-canvas pill', () => {
  it('does not render at a mobile viewport (≤ md breakpoint)', () => {
    installMatchMediaMock(375)
    const { queryByTestId } = render(
      <ThemeProvider theme={theme}>
        <GraphCanvasControls {...props} />
      </ThemeProvider>
    )
    // The five canonical controls must all be absent — the pill is
    // suppressed entirely so its 200+ px height cannot extend above
    // the canvas top edge on a short mobile viewport.
    expect(queryByTestId('graph-canvas-zoom-in')).toBeNull()
    expect(queryByTestId('graph-canvas-zoom-out')).toBeNull()
    expect(queryByTestId('graph-canvas-zoom-slider')).toBeNull()
    expect(queryByTestId('graph-canvas-fit')).toBeNull()
    expect(queryByTestId('graph-canvas-reset')).toBeNull()
  })

  it('renders at a desktop viewport (> md breakpoint)', () => {
    installMatchMediaMock(1200)
    const { getByTestId } = render(
      <ThemeProvider theme={theme}>
        <GraphCanvasControls {...props} />
      </ThemeProvider>
    )
    // Desktop is unchanged — the pill remains visible and functional.
    expect(getByTestId('graph-canvas-zoom-in')).toBeInTheDocument()
    expect(getByTestId('graph-canvas-zoom-out')).toBeInTheDocument()
    expect(getByTestId('graph-canvas-zoom-slider')).toBeInTheDocument()
    expect(getByTestId('graph-canvas-fit')).toBeInTheDocument()
    expect(getByTestId('graph-canvas-reset')).toBeInTheDocument()
  })
})
