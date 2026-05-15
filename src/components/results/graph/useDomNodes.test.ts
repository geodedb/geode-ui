import { renderHook } from '@testing-library/react'
import { useDomNodes } from './useDomNodes'

type DomNodeFake = {
  domNode: jest.Mock<unknown, [unknown?]>
  nodes: () => {
    forEach: (
      cb: (n: { data: (k?: string, v?: unknown) => unknown }) => void
    ) => void
  }
}

function makeCy(): DomNodeFake {
  const nodes = [
    {
      bag: { id: '1', label: 'Alice' } as Record<string, unknown>,
      data(k?: string, v?: unknown): unknown {
        if (k === undefined) return this.bag
        if (v === undefined) return this.bag[k]
        this.bag[k] = v
        return undefined
      },
    },
  ]
  return {
    domNode: jest.fn(),
    nodes: () => ({
      forEach: (cb: (n: (typeof nodes)[number]) => void) => nodes.forEach(cb),
    }),
  }
}

describe('useDomNodes', () => {
  it('initializes cytoscape-dom-node when enabled flips to true', () => {
    const cy = makeCy()
    const cyRef = { current: cy as never }
    const renderNode = jest.fn(() => document.createElement('div'))
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useDomNodes({
          cyRef: cyRef as never,
          enabled,
          renderNode,
          sig: 's1',
        }),
      { initialProps: { enabled: false } }
    )
    expect(cy.domNode).not.toHaveBeenCalled()
    rerender({ enabled: true })
    expect(cy.domNode).toHaveBeenCalled()
    expect(renderNode).toHaveBeenCalled()
  })

  it('no-ops when cyRef.current is null', () => {
    const cyRef = { current: null }
    const renderNode = jest.fn(() => document.createElement('div'))
    renderHook(() =>
      useDomNodes({
        cyRef: cyRef as never,
        enabled: true,
        renderNode,
        sig: 's1',
      })
    )
    expect(renderNode).not.toHaveBeenCalled()
  })
})
