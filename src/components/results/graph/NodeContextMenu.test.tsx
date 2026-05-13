/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../../test-utils/theme'
import { NodeContextMenu, NodeContextMenuAction } from './NodeContextMenu'

const t = (k: string): string => k

const renderMenu = (
  overrides: Partial<React.ComponentProps<typeof NodeContextMenu>> = {}
): ReturnType<typeof render> =>
  render(
    <ThemeProvider theme={theme}>
      <NodeContextMenu
        open
        x={20}
        y={30}
        items={['expand', 'hide', 'collapse', 'focus', 'pin', 'copyId']}
        onSelect={() => {}}
        onClose={() => {}}
        t={t}
        {...overrides}
      />
    </ThemeProvider>
  )

describe('NodeContextMenu', () => {
  it('renders nothing when open=false', () => {
    renderMenu({ open: false })
    expect(screen.queryByTestId('graph-node-menu')).toBeNull()
  })

  it('renders all items when open and positions them at (x, y)', () => {
    renderMenu()
    const root = screen.getByTestId('graph-node-menu')
    expect(root.style.left).toBe('20px')
    expect(root.style.top).toBe('30px')
    expect(screen.getByTestId('graph-node-menu-expand')).toBeInTheDocument()
    expect(screen.getByTestId('graph-node-menu-pin')).toBeInTheDocument()
  })

  it('fires onSelect with the action when an item is clicked', () => {
    const onSelect = jest.fn()
    renderMenu({ onSelect })
    fireEvent.click(screen.getByTestId('graph-node-menu-expand'))
    expect(onSelect).toHaveBeenCalledWith<[NodeContextMenuAction]>('expand')
  })

  it('fires onClose when Escape is pressed', () => {
    const onClose = jest.fn()
    renderMenu({ onClose })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
