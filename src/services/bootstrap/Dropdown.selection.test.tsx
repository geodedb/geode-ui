/// <reference types="@testing-library/jest-dom" />
//
// Reproduction tests for the bug:
//
//   "The dropdown for re-organizing the graph view is not consistently
//   showing the selected option. Sometimes it'll randomly select another
//   if I select Grid, or Force cose etc..."
//
// The user-facing contract:
//
//   1. Clicking an option must call `onChange` with THAT option's value
//      (never the previously-active option's value, never an adjacent
//      option's value).
//   2. After the parent flows the new value back as the controlled
//      `value` prop, the trigger MUST render the label of the new
//      option.
//   3. The contract holds across repeated open / close / reopen cycles.
//   4. A scroll while the menu is open MUST close the menu — it must
//      not shift the menu under the user's pointer (the scroll-shift
//      race was the most plausible root cause of "sometimes random"
//      mishits).
//   5. Every option carries its value on the DOM element so the click
//      handler can read it from `event.currentTarget` rather than rely
//      solely on the render-time closure.

import React, { useState } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { BootstrapDropdown } from './Dropdown'

const LAYOUTS = [
  { value: 'cose', label: 'Force (cose)' },
  { value: 'fcose', label: 'Force (fcose)' },
  { value: 'dagre', label: 'Layered (DAG)' },
  { value: 'breadthfirst', label: 'Breadth-first' },
  { value: 'circle', label: 'Circle' },
  { value: 'concentric', label: 'Concentric' },
  { value: 'grid', label: 'Grid' },
  { value: 'spread', label: 'Spread' },
] as const

const Harness: React.FC<{
  initial?: string
  onPick?: (v: string) => void
}> = ({ initial = 'cose', onPick }) => {
  const [value, setValue] = useState<string>(initial)
  return (
    <BootstrapDropdown
      items={LAYOUTS as never}
      value={value}
      onChange={(v) => {
        setValue(v)
        if (onPick) onPick(v)
      }}
      ariaLabel="Layout"
      triggerProps={{ 'data-testid': 'layout-picker' }}
    />
  )
}

function trigger(): HTMLElement {
  return screen.getByTestId('layout-picker')
}

function option(name: string): HTMLElement {
  return screen.getByRole('option', { name })
}

describe('BootstrapDropdown — selection consistency (regression)', () => {
  it('clicking Grid calls onChange with "grid" (not the previously-active item)', () => {
    const onPick = jest.fn()
    render(<Harness onPick={onPick} />)
    fireEvent.click(trigger())
    fireEvent.click(option('Grid'))
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith('grid')
  })

  it('clicking Force (cose) when grid is active picks cose, not the focused active item', () => {
    const onPick = jest.fn()
    render(<Harness initial="grid" onPick={onPick} />)
    fireEvent.click(trigger())
    fireEvent.click(option('Force (cose)'))
    expect(onPick).toHaveBeenCalledWith('cose')
  })

  it('after picking Grid, the trigger renders the Grid label', () => {
    render(<Harness />)
    expect(trigger()).toHaveTextContent('Force (cose)')
    fireEvent.click(trigger())
    fireEvent.click(option('Grid'))
    expect(trigger()).toHaveTextContent('Grid')
  })

  it('successive picks each land the user-chosen item', () => {
    const onPick = jest.fn()
    render(<Harness onPick={onPick} />)

    fireEvent.click(trigger())
    fireEvent.click(option('Grid'))
    expect(trigger()).toHaveTextContent('Grid')

    fireEvent.click(trigger())
    fireEvent.click(option('Force (fcose)'))
    expect(trigger()).toHaveTextContent('Force (fcose)')

    fireEvent.click(trigger())
    fireEvent.click(option('Circle'))
    expect(trigger()).toHaveTextContent('Circle')

    expect(onPick.mock.calls.map((c) => c[0])).toEqual([
      'grid',
      'fcose',
      'circle',
    ])
  })

  it('scroll while the menu is open CLOSES the menu (no shift-under-pointer mishit)', () => {
    const onPick = jest.fn()
    render(<Harness onPick={onPick} />)
    fireEvent.click(trigger())
    expect(screen.getByRole('listbox').className).toContain('show')
    // The previous implementation re-anchored the portaled menu on
    // scroll, which could shift an option under the user's pointer
    // between mousedown and mouseup and redirect the click. Closing
    // on scroll is the unambiguous fix.
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    const listbox = screen.queryByRole('listbox')
    expect(listbox?.className.includes('show')).toBeFalsy()
    expect(onPick).not.toHaveBeenCalled()
  })

  it('every option carries its value as data-value on the DOM element', () => {
    render(<Harness />)
    fireEvent.click(trigger())
    // Each rendered option must expose its value as data-value so the
    // click handler can read it from event.currentTarget rather than
    // rely solely on the render-time closure.
    LAYOUTS.forEach((item) => {
      const opt = option(item.label)
      expect(opt.getAttribute('data-value')).toBe(item.value)
    })
  })

  it('re-opening after a selection does not re-fire onChange', () => {
    const onPick = jest.fn()
    render(<Harness onPick={onPick} />)
    fireEvent.click(trigger())
    fireEvent.click(option('Grid'))
    expect(onPick).toHaveBeenCalledTimes(1)
    fireEvent.click(trigger())
    expect(onPick).toHaveBeenCalledTimes(1)
    fireEvent.click(option('Grid'))
    expect(onPick).toHaveBeenCalledTimes(2)
  })
})
