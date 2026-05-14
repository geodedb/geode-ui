import { zoomToNode } from './zoomToNode'

function makeFakeCy(adj: Record<string, { x: number; y: number }>) {
  const calls: { method: string; args: unknown[] }[] = []
  const wrap = (id: string) => ({
    empty: () => !(id in adj),
    position: () => adj[id] ?? { x: 0, y: 0 },
  })
  return {
    getElementById: (id: string) => wrap(id),
    animate: (opts: unknown) => {
      calls.push({ method: 'animate', args: [opts] })
      return { promise: () => Promise.resolve() }
    },
    center: (n: { position: () => { x: number; y: number } }) => {
      calls.push({ method: 'center', args: [n.position()] })
    },
    zoom: (level: number) => {
      calls.push({ method: 'zoom', args: [level] })
    },
    calls,
  }
}

describe('zoomToNode', () => {
  it('animates the viewport onto the node at the requested zoom level', () => {
    const cy = makeFakeCy({ a: { x: 50, y: 75 } })
    zoomToNode(cy as never, 'a', { zoom: 2, duration: 300 })
    expect(cy.calls).toEqual([
      {
        method: 'animate',
        args: [
          {
            center: { eles: expect.anything() },
            zoom: 2,
            duration: 300,
            easing: 'ease-in-out',
          },
        ],
      },
    ])
  })

  it('uses defaults when no opts provided (zoom=1.5, duration=400)', () => {
    const cy = makeFakeCy({ a: { x: 0, y: 0 } })
    zoomToNode(cy as never, 'a')
    expect(cy.calls).toEqual([
      {
        method: 'animate',
        args: [
          {
            center: { eles: expect.anything() },
            zoom: 1.5,
            duration: 400,
            easing: 'ease-in-out',
          },
        ],
      },
    ])
  })

  it('is a no-op when the node does not exist', () => {
    const cy = makeFakeCy({})
    zoomToNode(cy as never, 'ghost')
    expect(cy.calls).toEqual([])
  })
})
