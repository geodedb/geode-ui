/* eslint-disable no-underscore-dangle */
import { act, renderHook } from '@testing-library/react'
import type cytoscape from 'cytoscape'
import { useNodeContextMenu } from './useNodeContextMenu'

type FakeNode = { id: () => string; data: () => Record<string, unknown> }
type Handler = (ev: {
  target: FakeNode
  renderedPosition: { x: number; y: number }
  originalEvent?: {
    clientX: number
    clientY: number
    preventDefault: () => void
  }
}) => void

type FakeCore = {
  on: jest.Mock
  off: jest.Mock
  __handlers: Map<string, Handler>
}

function makeCore(): FakeCore {
  const handlers = new Map<string, Handler>()
  const on = jest.fn(
    (event: string, _selectorOrHandler: unknown, maybeHandler?: Handler) => {
      // cytoscape supports both `on(event, handler)` and
      // `on(event, selector, handler)`. The hook uses the 3-arg form for
      // 'cxttap'/'taphold' (selector === 'node') and the 2-arg form for
      // 'tap' (background tap → close). Normalize both into handlers map.
      if (typeof _selectorOrHandler === 'function') {
        handlers.set(event, _selectorOrHandler as Handler)
      } else if (typeof maybeHandler === 'function') {
        handlers.set(event, maybeHandler)
      }
    }
  )
  return {
    on: on as unknown as jest.Mock,
    off: jest.fn(),
    __handlers: handlers,
  }
}

describe('useNodeContextMenu', () => {
  it('opens at the cxttap position with the tapped node id', () => {
    const core = makeCore()
    const cyRef = { current: core as unknown as cytoscape.Core }
    const { result } = renderHook(() =>
      useNodeContextMenu({ cyRef, enabled: true, sig: 's1' })
    )
    expect(result.current.state.open).toBe(false)
    const node: FakeNode = { id: () => 'n42', data: () => ({ id: 'n42' }) }
    act(() => {
      core.__handlers.get('cxttap')!({
        target: node,
        renderedPosition: { x: 12, y: 34 },
      })
    })
    expect(result.current.state).toEqual({
      open: true,
      x: expect.any(Number),
      y: expect.any(Number),
      nodeId: 'n42',
    })
  })

  it('opens on taphold (long press) as well', () => {
    const core = makeCore()
    const cyRef = { current: core as unknown as cytoscape.Core }
    const { result } = renderHook(() =>
      useNodeContextMenu({ cyRef, enabled: true, sig: 's1' })
    )
    const node: FakeNode = { id: () => 'n7', data: () => ({ id: 'n7' }) }
    act(() => {
      core.__handlers.get('taphold')!({
        target: node,
        renderedPosition: { x: 0, y: 0 },
      })
    })
    expect(result.current.state.open).toBe(true)
    expect(result.current.state.nodeId).toBe('n7')
  })

  it('close() resets the open flag', () => {
    const core = makeCore()
    const cyRef = { current: core as unknown as cytoscape.Core }
    const { result } = renderHook(() =>
      useNodeContextMenu({ cyRef, enabled: true, sig: 's1' })
    )
    act(() => {
      core.__handlers.get('cxttap')!({
        target: { id: () => 'n1', data: () => ({ id: 'n1' }) },
        renderedPosition: { x: 0, y: 0 },
      })
    })
    act(() => result.current.close())
    expect(result.current.state.open).toBe(false)
  })

  it('re-subscribes when sig changes (e.g. cy core rebuilt)', () => {
    const coreA = makeCore()
    const cyRef = { current: coreA as unknown as cytoscape.Core }
    const { rerender } = renderHook(
      ({ sig }: { sig: string }) =>
        useNodeContextMenu({ cyRef, enabled: true, sig }),
      { initialProps: { sig: 's1' } }
    )
    expect(coreA.on).toHaveBeenCalledTimes(3)
    // Simulate a rebuild: cyRef.current swaps to a fresh core, sig flips.
    const coreB = makeCore()
    cyRef.current = coreB as unknown as cytoscape.Core
    rerender({ sig: 's2' })
    // Old core received .off (cleanup) for all three subscriptions.
    expect(coreA.off).toHaveBeenCalledTimes(3)
    // New core received .on for all three.
    expect(coreB.on).toHaveBeenCalledTimes(3)
  })
})
