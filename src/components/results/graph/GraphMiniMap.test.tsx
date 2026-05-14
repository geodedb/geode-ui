/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../../test-utils/theme'
import { GraphMiniMap } from './GraphMiniMap'

jest.mock('cytoscape-navigator', () => ({
  __esModule: true,
  default: jest.fn(),
}))

describe('GraphMiniMap', () => {
  it('mounts a container with the test-id and calls .navigator on the core', () => {
    const navigator = jest.fn(() => ({ destroy: jest.fn() }))
    const cyRef = { current: { navigator } as never }
    const { container } = render(
      <ThemeProvider theme={theme}>
        <GraphMiniMap cyRef={cyRef as never} />
      </ThemeProvider>
    )
    expect(
      container.querySelector('[data-testid="graph-minimap"]')
    ).not.toBeNull()
    expect(navigator).toHaveBeenCalled()
  })

  it('renders the container even when cyRef.current is null', () => {
    const cyRef = { current: null }
    const { container } = render(
      <ThemeProvider theme={theme}>
        <GraphMiniMap cyRef={cyRef as never} />
      </ThemeProvider>
    )
    expect(
      container.querySelector('[data-testid="graph-minimap"]')
    ).not.toBeNull()
  })
})
