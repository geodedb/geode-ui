/* eslint-disable no-underscore-dangle */
import { act, renderHook } from '@testing-library/react'
import { useEdgeTooltip } from './useEdgeTooltip'

type Handler = (ev: { target: unknown }) => void

function makeCy() {
  const handlers = new Map<string, Handler>()
  const selectors = new Map<string, string>()
  return {
    on: jest.fn((events: string, selector: string, h: Handler) => {
      events.split(' ').forEach((e) => {
        handlers.set(e, h)
        selectors.set(e, selector)
      })
    }),
    off: jest.fn(),
    __fire: (event: string, target: unknown): void =>
      handlers.get(event)?.({ target }),
    __selectorFor: (event: string): string | undefined => selectors.get(event),
  }
}

describe('useEdgeTooltip', () => {
  it('reveals the tooltip target on edge mouseover and clears on mouseout', () => {
    const cy = makeCy()
    const cyRef = { current: cy as never }
    const { result } = renderHook(() =>
      useEdgeTooltip({ cyRef: cyRef as never, sig: 's1' })
    )
    expect(result.current.targetData).toBeNull()

    const fakeEdge = {
      data: () => ({
        id: 'e1',
        type: 'ACTED_IN',
        props: { roles: ['Neo'] },
      }),
    }
    act(() => cy.__fire('mouseover', fakeEdge))
    // GAP-059: the tooltip label for an edge reads ":Type" — a visible
    // type chip the user can disambiguate from the node tooltip
    // ("Person") at a glance.
    expect(result.current.targetData).toEqual({
      id: 'e1',
      label: ':ACTED_IN',
      props: { roles: ['Neo'] },
    })
    act(() => cy.__fire('mouseout', fakeEdge))
    expect(result.current.targetData).toBeNull()
  })

  it('binds to the edge selector, not the node selector', () => {
    // Regression guard: pre-fix the codebase only had useNodeTooltip
    // (selector "node"); this hook MUST select "edge" or it duplicates
    // the node hook on the same cy core and competes for state.
    const cy = makeCy()
    const cyRef = { current: cy as never }
    renderHook(() => useEdgeTooltip({ cyRef: cyRef as never, sig: 's1' }))
    expect(cy.__selectorFor('mouseover')).toBe('edge')
    expect(cy.__selectorFor('mouseout')).toBe('edge')
  })

  it('falls back to data.label when an edge has no type stamp', () => {
    // Synthesised edges (pre-pushRealEdges audit) may carry only a
    // label; the hook surfaces that string unchanged so the tooltip
    // shows SOMETHING rather than an empty chip.
    const cy = makeCy()
    const cyRef = { current: cy as never }
    const { result } = renderHook(() =>
      useEdgeTooltip({ cyRef: cyRef as never, sig: 's1' })
    )
    const fakeEdge = {
      data: () => ({ id: 'e2', label: 'inferred', props: {} }),
    }
    act(() => cy.__fire('mouseover', fakeEdge))
    expect(result.current.targetData?.label).toBe('inferred')
  })

  it('defaults missing props to an empty object', () => {
    // The inspector / tooltip pipeline expects `props` to be an object.
    // A pre-GAP-046 synthesised edge that omits the field must still
    // produce a renderable target.
    const cy = makeCy()
    const cyRef = { current: cy as never }
    const { result } = renderHook(() =>
      useEdgeTooltip({ cyRef: cyRef as never, sig: 's1' })
    )
    const fakeEdge = { data: () => ({ id: 'e3', type: 'X' }) }
    act(() => cy.__fire('mouseover', fakeEdge))
    expect(result.current.targetData?.props).toEqual({})
  })
})
