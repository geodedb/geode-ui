/// <reference types="@testing-library/jest-dom" />
//
// Bug 1 / Bug 4 reproduction:
// the BootstrapDropdown menu was rendered inline inside its `.dropdown`
// root. The graph toolbar wraps its row in `overflow-x: auto` (which
// every modern browser computes as both axes clipped — see
// https://drafts.csswg.org/css-overflow-3/#overflow-properties), so a
// positioned-absolute menu inside that scroller is clipped vertically.
// The user reported "only Force (cose) is visible" (Bug 1) and "the
// toolbar shows a vertical scroll when the dropdown opens" (Bug 4).
// The fix portals the menu to document.body when open, escaping every
// ancestor overflow / clip / transform / stacking context.

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { BootstrapDropdown } from './Dropdown'

const ITEMS = [
  { value: 'cose', label: 'Force (cose)' },
  { value: 'grid', label: 'Grid' },
  { value: 'dagre', label: 'Layered (DAG)' },
] as const

describe('BootstrapDropdown — open menu escapes ancestor overflow (Bug 1, 4)', () => {
  it('renders the open menu in document.body, NOT inside the .dropdown root', () => {
    render(
      <div style={{ overflow: 'auto', width: 100, height: 32 }}>
        <BootstrapDropdown
          items={ITEMS as never}
          value="cose"
          onChange={() => {}}
          ariaLabel="Layout"
          triggerProps={{ 'data-testid': 'pkr' }}
        />
      </div>
    )
    // Click the trigger to open the menu.
    fireEvent.click(screen.getByTestId('pkr'))
    // The menu is now visible.
    const menu = screen.getByRole('listbox', { name: 'Layout' })
    // After the fix the menu MUST live directly under document.body
    // (createPortal). Before the fix it was a child of the
    // .dropdown root, which a clipped ancestor would cut.
    expect(menu.parentElement).toBe(document.body)
  })

  it('shows every option once the menu opens (regression for "only Force (cose) is visible")', () => {
    render(
      <BootstrapDropdown
        items={ITEMS as never}
        value="cose"
        onChange={() => {}}
        ariaLabel="Layout"
        triggerProps={{ 'data-testid': 'pkr' }}
      />
    )
    fireEvent.click(screen.getByTestId('pkr'))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Force (cose)',
      'Grid',
      'Layered (DAG)',
    ])
  })
})
