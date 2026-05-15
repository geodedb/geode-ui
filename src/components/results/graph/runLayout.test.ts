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

function makeFakeCoreWithLocks(idList: string[]): {
  _ran: number
  _fit: number
  _positionWrites: number
  _locked: string[]
  _unlocked: string[]
  batch: (fn: () => void) => void
  nodes: () => {
    forEach: (
      cb: (n: {
        id(): string
        position: (p?: { x: number; y: number }) => { x: number; y: number }
        lock(): void
        unlock(): void
      }) => void
    ) => void
    length: number
  }
  edges: () => { forEach: (cb: unknown) => void }
  layout: () => { run: () => unknown }
  fit: (...args: unknown[]) => void
} {
  const state: {
    _ran: number
    _fit: number
    _positionWrites: number
    _locked: string[]
    _unlocked: string[]
    batch: (fn: () => void) => void
    nodes: () => {
      forEach: (
        cb: (n: {
          id(): string
          position: (p?: { x: number; y: number }) => { x: number; y: number }
          lock(): void
          unlock(): void
        }) => void
      ) => void
      length: number
    }
    edges: () => { forEach: (cb: unknown) => void }
    layout: () => { run: () => unknown }
    fit: (...args: unknown[]) => void
  } = {
    _ran: 0,
    _fit: 0,
    _positionWrites: 0,
    _locked: [],
    _unlocked: [],
    batch: (fn) => fn(),
    nodes: () => {
      const items = idList.map((id) => ({
        id: () => id,
        position: (p?: { x: number; y: number }) => {
          if (p) state._positionWrites += 1
          return p ?? { x: 0, y: 0 }
        },
        lock: () => {
          state._locked.push(id)
        },
        unlock: () => {
          state._unlocked.push(id)
        },
      }))
      return { forEach: (cb) => items.forEach(cb), length: items.length }
    },
    edges: () => ({ forEach: () => {} }),
    layout: () => ({
      run: () => {
        state._ran += 1
      },
    }),
    fit: () => {
      state._fit += 1
    },
  }
  return state
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

  it('partial cache hit (>=60% matched) applies cached + runs layout on unlocked subset', () => {
    // Build a fakeCore that tracks position writes (for the matched apply)
    // and lock/unlock calls.
    const cy = makeFakeCoreWithLocks(['a', 'b', 'c'])
    layoutCache.set(
      'fcose|OLD',
      new Map([
        ['a', { x: 10, y: 20 }],
        ['b', { x: 30, y: 40 }],
      ])
    )
    runLayout({
      cy: cy as unknown as import('cytoscape').Core,
      layoutName: 'fcose',
      sig: 'OLD',
      currentIds: ['a', 'b', 'c'],
      n: 3,
      useWorker: false,
    })
    // Positions for a + b applied before layout
    expect(cy._positionWrites).toBeGreaterThanOrEqual(2)
    // lock() called for matched ids (a, b)
    expect(cy._locked).toEqual(expect.arrayContaining(['a', 'b']))
    // Layout ran for the unlocked subset (c)
    expect(cy._ran).toBe(1)
    // unlock() called after
    expect(cy._unlocked.length).toBeGreaterThan(0)
  })

  it('partial cache hit < 60% matched falls through to full layout', () => {
    const cy = makeFakeCoreWithLocks(['a', 'b', 'c', 'd', 'e'])
    layoutCache.set('fcose|SMALL', new Map([['a', { x: 0, y: 0 }]]))
    runLayout({
      cy: cy as unknown as import('cytoscape').Core,
      layoutName: 'fcose',
      sig: 'SMALL',
      currentIds: ['a', 'b', 'c', 'd', 'e'],
      n: 5,
      useWorker: false,
    })
    // 1/5 = 20% — below 60% threshold, full layout instead of partial
    expect(cy._ran).toBe(1)
    // Should NOT have called lock(); 20% match means partial path is skipped
    expect(cy._locked).toEqual([])
  })
})
