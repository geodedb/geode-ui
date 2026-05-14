import React from 'react'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../../test-utils/theme'
import { GraphBadges } from './GraphBadges'

describe('GraphBadges', () => {
  it('renders one badge per item with positions applied', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphBadges
          badges={[
            { kind: 'pin', nodeId: 'a', x: 10, y: 20 },
            { kind: 'collapsed', nodeId: 'b', count: 3, x: 50, y: 60 },
          ]}
        />
      </ThemeProvider>
    )
    const pin = screen.getByTestId('graph-badge-pin-a')
    const col = screen.getByTestId('graph-badge-collapsed-b')
    expect(pin).toBeInTheDocument()
    expect(col).toBeInTheDocument()
    expect(col.textContent).toBe('3')
  })

  it('renders nothing when given an empty list', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphBadges badges={[]} />
      </ThemeProvider>
    )
    expect(screen.queryByTestId(/^graph-badge-/)).toBeNull()
  })
})
