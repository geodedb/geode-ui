import React from 'react'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../../test-utils/theme'
import { GraphTooltip } from './GraphTooltip'

const t = (k: string) => k

describe('GraphTooltip', () => {
  it('renders nothing when targetData is null', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphTooltip targetData={null} t={t} />
      </ThemeProvider>
    )
    expect(screen.queryByTestId('graph-tooltip')).toBeNull()
  })

  it('shows label + props', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphTooltip
          targetData={{
            id: '7',
            label: 'Person',
            props: { name: 'Alice', age: 30 },
          }}
          t={t}
        />
      </ThemeProvider>
    )
    const tt = screen.getByTestId('graph-tooltip')
    expect(tt).toBeInTheDocument()
    expect(tt.textContent).toContain('Person')
    expect(tt.textContent).toContain('Alice')
    expect(tt.textContent).toContain('30')
  })

  it('shows the "no properties" label when props are empty', () => {
    render(
      <ThemeProvider theme={theme}>
        <GraphTooltip
          targetData={{ id: '7', label: 'Person', props: {} }}
          t={t}
        />
      </ThemeProvider>
    )
    expect(screen.getByTestId('graph-tooltip').textContent).toContain(
      'graph.tooltipNoProps'
    )
  })
})
