// src/components/results/graph/GraphCanvasControls.test.tsx
/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { fireEvent, render } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../../test-utils/theme'
import { GraphCanvasControls } from './GraphCanvasControls'

const baseProps = {
  zoomLevel: 0.5,
  onZoomLevelChange: jest.fn(),
  onZoomIn: jest.fn(),
  onZoomOut: jest.fn(),
  onFit: jest.fn(),
  onResetView: jest.fn(),
  t: (k: string) => k,
}

describe('GraphCanvasControls', () => {
  beforeEach(() => jest.clearAllMocks())

  it('renders the five canonical controls', () => {
    const { getByTestId } = render(
      <ThemeProvider theme={theme}>
        <GraphCanvasControls {...baseProps} />
      </ThemeProvider>
    )
    expect(getByTestId('graph-canvas-zoom-in')).toBeInTheDocument()
    expect(getByTestId('graph-canvas-zoom-out')).toBeInTheDocument()
    expect(getByTestId('graph-canvas-zoom-slider')).toBeInTheDocument()
    expect(getByTestId('graph-canvas-fit')).toBeInTheDocument()
    expect(getByTestId('graph-canvas-reset')).toBeInTheDocument()
  })

  it('clicking + fires onZoomIn', () => {
    const { getByTestId } = render(
      <ThemeProvider theme={theme}>
        <GraphCanvasControls {...baseProps} />
      </ThemeProvider>
    )
    fireEvent.click(getByTestId('graph-canvas-zoom-in'))
    expect(baseProps.onZoomIn).toHaveBeenCalledTimes(1)
  })

  it('clicking − fires onZoomOut', () => {
    const { getByTestId } = render(
      <ThemeProvider theme={theme}>
        <GraphCanvasControls {...baseProps} />
      </ThemeProvider>
    )
    fireEvent.click(getByTestId('graph-canvas-zoom-out'))
    expect(baseProps.onZoomOut).toHaveBeenCalledTimes(1)
  })

  it('moving the slider fires onZoomLevelChange with the new 0..1 value', () => {
    const { getByTestId } = render(
      <ThemeProvider theme={theme}>
        <GraphCanvasControls {...baseProps} />
      </ThemeProvider>
    )
    fireEvent.change(getByTestId('graph-canvas-zoom-slider'), {
      target: { value: '0.75' },
    })
    expect(baseProps.onZoomLevelChange).toHaveBeenCalledWith(0.75)
  })

  it('fit + reset buttons fire their respective callbacks', () => {
    const { getByTestId } = render(
      <ThemeProvider theme={theme}>
        <GraphCanvasControls {...baseProps} />
      </ThemeProvider>
    )
    fireEvent.click(getByTestId('graph-canvas-fit'))
    expect(baseProps.onFit).toHaveBeenCalledTimes(1)
    fireEvent.click(getByTestId('graph-canvas-reset'))
    expect(baseProps.onResetView).toHaveBeenCalledTimes(1)
  })
})
