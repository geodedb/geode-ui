/* eslint-disable no-underscore-dangle */
import { act, renderHook } from '@testing-library/react'
import { useNodeTooltip } from './useNodeTooltip'

type Handler = (ev: { target: unknown }) => void

function makeCy() {
  const handlers = new Map<string, Handler>()
  return {
    on: jest.fn((events: string, _selector: string, h: Handler) => {
      events.split(' ').forEach((e) => handlers.set(e, h))
    }),
    off: jest.fn(),
    __fire: (event: string, target: unknown) =>
      handlers.get(event)?.({ target }),
  }
}

describe('useNodeTooltip', () => {
  it('reveals the tooltip target on mouseover and clears on mouseout', () => {
    const cy = makeCy()
    const cyRef = { current: cy as never }
    const { result } = renderHook(() =>
      useNodeTooltip({ cyRef: cyRef as never, sig: 's1' })
    )
    expect(result.current.targetData).toBeNull()
    const fakeNode = {
      data: () => ({ id: '7', label: 'Person', props: { name: 'Alice' } }),
    }
    act(() => cy.__fire('mouseover', fakeNode))
    expect(result.current.targetData).toEqual({
      id: '7',
      label: 'Person',
      props: { name: 'Alice' },
    })
    act(() => cy.__fire('mouseout', fakeNode))
    expect(result.current.targetData).toBeNull()
  })
})
