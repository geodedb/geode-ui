import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../../test-utils/theme'
import { ExpandQueryPopover } from './ExpandQueryPopover'

const t = (k: string, o?: Record<string, unknown>) => {
  return o ? `${k}:${JSON.stringify(o)}` : k
}

const renderPop = (
  overrides: Partial<React.ComponentProps<typeof ExpandQueryPopover>> = {}
) =>
  render(
    <ThemeProvider theme={theme}>
      <ExpandQueryPopover
        open
        nodeId="42"
        labelOptions={['Person', 'Movie']}
        onRun={() => {}}
        onCancel={() => {}}
        t={t}
        {...overrides}
      />
    </ThemeProvider>
  )

describe('ExpandQueryPopover', () => {
  it('renders nothing when open=false', () => {
    renderPop({ open: false })
    expect(screen.queryByTestId('graph-expand-popover')).toBeNull()
  })

  it('shows the generated statement live as inputs change', () => {
    renderPop()
    const preview = screen.getByTestId('graph-expand-preview')
    expect(preview.textContent).toContain('MATCH (n)-[r]-(m) WHERE id(n) = 42')
    fireEvent.click(screen.getByTestId('graph-expand-direction-out'))
    expect(preview.textContent).toContain('MATCH (n)-[r]->(m)')
    fireEvent.change(screen.getByTestId('graph-expand-label-filter'), {
      target: { value: 'Movie' },
    })
    expect(preview.textContent).toContain('(m:Movie)')
    fireEvent.change(screen.getByTestId('graph-expand-limit'), {
      target: { value: '25' },
    })
    expect(preview.textContent).toContain('LIMIT 25;')
  })

  it('Run calls onRun with the current options', () => {
    const onRun = jest.fn()
    renderPop({ onRun })
    fireEvent.click(screen.getByTestId('graph-expand-run'))
    expect(onRun).toHaveBeenCalledWith({
      direction: 'both',
      labelFilter: undefined,
      limit: 100,
    })
  })

  it('Cancel calls onCancel', () => {
    const onCancel = jest.fn()
    renderPop({ onCancel })
    fireEvent.click(screen.getByTestId('graph-expand-cancel'))
    expect(onCancel).toHaveBeenCalled()
  })
})
