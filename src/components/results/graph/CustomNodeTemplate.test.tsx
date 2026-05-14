import React from 'react'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../../test-utils/theme'
import { CustomNodeTemplate } from './CustomNodeTemplate'

describe('CustomNodeTemplate', () => {
  it('renders the swatch + label', () => {
    render(
      <ThemeProvider theme={theme}>
        <CustomNodeTemplate
          label="Alice"
          swatchColor="#ff0099"
          pinned={false}
        />
      </ThemeProvider>
    )
    expect(screen.getByTestId('custom-node-label').textContent).toBe('Alice')
    const swatch = screen.getByTestId('custom-node-swatch')
    expect(swatch.style.backgroundColor).toMatch(/#ff0099|rgb\(255, 0, 153\)/)
  })

  it('shows a pin glyph when pinned=true', () => {
    render(
      <ThemeProvider theme={theme}>
        <CustomNodeTemplate label="Alice" swatchColor="#000" pinned />
      </ThemeProvider>
    )
    expect(screen.getByTestId('custom-node-pin')).toBeInTheDocument()
  })
})
