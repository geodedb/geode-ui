/* eslint-disable no-underscore-dangle, @typescript-eslint/no-unused-vars -- test stub mimics cytoscape's chainable API + uses underscore-prefixed counters that mirror the dispatcher's contract */
import type { Core } from 'cytoscape'
import { runLayout } from './runLayout'
import { layoutCache } from './layoutCache'

type FakeCore = Core & { _ran: number; _fit: number }

function fakeCore(): FakeCore {
  const positions = new Map<string, { x: number; y: number }>()
  const nodes = [
    {
      id: () => 'a',
      position: (p?: { x: number; y: number }) => {
        if (p) positions.set('a', p)
        return positions.get('a') ?? { x: 0, y: 0 }
      },
    },
    {
      id: () => 'b',
      position: (p?: { x: number; y: number }) => {
        if (p) positions.set('b', p)
        return positions.get('b') ?? { x: 0, y: 0 }
      },
    },
  ]
  const core = {
    _ran: 0,
    _fit: 0,
    batch: (fn: () => void) => fn(),
    nodes: () => ({
      forEach: (cb: (n: (typeof nodes)[0]) => void) => nodes.forEach(cb),
      length: nodes.length,
    }),
    edges: () => ({ forEach: (_cb: unknown) => {} }),
    layout: () => {
      const handle = {
        run: () => {
          core._ran += 1
          return handle
        },
      }
      return handle
    },
    fit: (_: unknown, __: number) => {
      core._fit += 1
    },
  }
  return core as unknown as FakeCore
}

describe('runLayout', () => {
  it('full cache hit applies positions and skips cy.layout', () => {
    const cy = fakeCore()
    layoutCache.set(
      'fcose|SIG',
      new Map([
        ['a', { x: 10, y: 20 }],
        ['b', { x: 30, y: 40 }],
      ])
    )
    runLayout({
      cy,
      layoutName: 'fcose',
      sig: 'SIG',
      currentIds: ['a', 'b'],
      n: 2,
      useWorker: true,
    })
    expect(cy._ran).toBe(0)
    expect(cy._fit).toBe(1)
  })

  it('cache miss + non-fcose layout runs on main thread', () => {
    const cy = fakeCore()
    runLayout({
      cy,
      layoutName: 'dagre',
      sig: 'NEW',
      currentIds: ['a', 'b'],
      n: 2,
      useWorker: true,
    })
    expect(cy._ran).toBe(1)
  })

  it('cache miss + n < worker threshold runs on main thread', () => {
    const cy = fakeCore()
    runLayout({
      cy,
      layoutName: 'fcose',
      sig: 'NEW2',
      currentIds: ['a'],
      n: 100,
      useWorker: true,
    })
    expect(cy._ran).toBe(1)
  })

  it('useWorker=false forces main-thread layout', () => {
    const cy = fakeCore()
    runLayout({
      cy,
      layoutName: 'fcose',
      sig: 'NEW3',
      currentIds: ['a', 'b'],
      n: 5000,
      useWorker: false,
    })
    expect(cy._ran).toBe(1)
  })
})
