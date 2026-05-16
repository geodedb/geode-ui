// Shared cytoscape / api-client / cxtmenu mocks for the split GraphView
// test suites. The factory functions captured here are referenced by
// jest.mock() factories in each test file (lifecycle / layout / interaction)
// so the mock surface is identical across the three suites. Without this
// extraction every split file would carry a near-identical ~350-line
// prologue. QUALITY #164.

/* eslint-disable no-underscore-dangle */

import type { jest as jestType } from '@jest/globals'

// `jest` is a global injected by jest.config — referencing it directly is
// safe inside test-utility modules, the type import above is only for
// editor autocomplete.
declare const jest: typeof jestType

export type GraphCtx = {
  adj: Map<string, Set<string>>
  dataById: Map<string, Record<string, unknown>>
}

export type ElLike = {
  data?: { id?: unknown; source?: unknown; target?: unknown } & Record<
    string,
    unknown
  >
}

export type CyCore = Record<string, unknown> & {
  __lastElements?: unknown
  __classesOf?: (id: string) => string[]
  __addCalls?: unknown[]
  __emitTap?: (kind: string, id: string) => void
}

export type GraphViewMockHarness = {
  cyConstructorCalls: unknown[]
  destroyMock: jest.Mock
  onMock: jest.Mock
  useMock: jest.Mock
  layoutCalls: unknown[]
  cyFactory: jest.Mock
  queryMock: jest.Mock
  lastCy: () => CyCore
  classesOf: (id: string) => string[]
  lastLayoutArg: () => unknown
  resetCalls: () => void
}

export function createGraphViewMockHarness(): GraphViewMockHarness {
  const cyConstructorCalls: unknown[] = []
  const destroyMock = jest.fn()
  const onMock = jest.fn()
  const useMock = jest.fn()
  const layoutCalls: unknown[] = []
  let lastCyInstance: CyCore | null = null

  const makeColl = (
    members: string[] = [],
    classed: Map<string, Set<string>> | null = null,
    ctx: GraphCtx | null = null
  ): Record<string, unknown> => {
    const classes = classed ?? new Map<string, Set<string>>()
    const coll: Record<string, unknown> = {
      forEach: jest.fn((fn: (el: unknown) => void) => {
        members.forEach((m) => fn(makeColl([m], classes, ctx)))
      }),
      remove: jest.fn(),
      length: members.length,
      empty: () => members.length === 0,
      id: () => members[0] ?? '',
      edges: () => makeColl([], classes, ctx),
      nodes: () => makeColl(members.slice(), classes, ctx),
      data: (key?: string) => {
        const d = ctx?.dataById.get(members[0] ?? '') ?? { id: members[0] }
        return key === undefined ? d : (d as Record<string, unknown>)[key]
      },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      degree: (_includeLoops?: boolean) =>
        ctx?.adj.get(members[0] ?? '')?.size ?? 0,
      hasClass: (cls: string) =>
        classes.get(members[0] ?? '')?.has(cls) ?? false,
      neighborhood: () =>
        makeColl(
          Array.from(ctx?.adj.get(members[0] ?? '') ?? []),
          classes,
          ctx
        ),
      renderedPosition: () => ({ x: 0, y: 0 }),
      renderedHeight: () => 0,
    }
    const chain = (): Record<string, unknown> => coll
    coll.addClass = jest.fn((cls: string) => {
      members.forEach((m) => {
        const set = classes.get(m) ?? new Set<string>()
        set.add(cls)
        classes.set(m, set)
      })
      return coll
    })
    coll.removeClass = jest.fn((cls: string) => {
      members.forEach((m) => {
        const set = classes.get(m)
        if (set) set.delete(cls)
      })
      return coll
    })
    coll.filter = jest.fn(
      (predicate: (el: { id: () => string }) => boolean) => {
        const kept = members.filter((m) =>
          predicate(makeColl([m], classes, ctx) as { id: () => string })
        )
        return makeColl(kept, classes, ctx)
      }
    )
    coll.difference = jest.fn((other: { __members?: string[] }) => {
      const omit = new Set(other?.__members ?? [])
      return makeColl(
        members.filter((m) => !omit.has(m)),
        classes,
        ctx
      )
    })
    coll.union = chain
    coll.connectedNodes = chain
    coll.closedNeighborhood = chain
    coll.connectedEdges = () => makeColl([], classes, ctx)
    coll.select = chain
    coll.lock = jest.fn(() => coll)
    coll.unlock = jest.fn(() => coll)
    coll.dijkstra = jest.fn(() => ({
      pathTo: jest.fn(() => makeColl(members.slice(), classes, ctx)),
    }))
    coll.__members = members
    coll.__classes = classes
    return coll
  }

  function idsFromElements(opts: unknown): string[] {
    const els = (opts as { elements?: ElLike[] })?.elements
    if (!Array.isArray(els)) return []
    const ids: string[] = []
    els.forEach((e) => {
      const id = e.data?.id
      if (id != null && String(id) !== '') ids.push(String(id))
    })
    return ids
  }

  function addElsToCtx(ctx: GraphCtx, els: ElLike[] | unknown): void {
    if (!Array.isArray(els)) return
    const ensure = (id: string): Set<string> => {
      let s = ctx.adj.get(id)
      if (!s) {
        s = new Set<string>()
        ctx.adj.set(id, s)
      }
      return s
    }
    els.forEach((e) => {
      const data = (e as ElLike).data
      if (!data) return
      const id = data.id != null ? String(data.id) : ''
      if (!id) return
      const src = data.source != null ? String(data.source) : ''
      const tgt = data.target != null ? String(data.target) : ''
      if (src && tgt) {
        ensure(src).add(tgt)
        ensure(tgt).add(src)
      } else {
        ctx.dataById.set(id, data as Record<string, unknown>)
        ensure(id)
      }
    })
  }

  const cyFactory = jest.fn((opts: unknown) => {
    cyConstructorCalls.push(opts)
    const style = { update: jest.fn() }
    const classes = new Map<string, Set<string>>()
    const elementIds: string[] = idsFromElements(opts)
    const ctx: GraphCtx = { adj: new Map(), dataById: new Map() }
    addElsToCtx(ctx, (opts as { elements?: unknown })?.elements)
    const addCalls: unknown[] = []
    const tapHandlers: Record<string, ((ev: unknown) => void)[]> = {}
    const pushHandler = (key: string, fn: (e: unknown) => void): void => {
      const list = tapHandlers[key] ?? []
      list.push(fn)
      tapHandlers[key] = list
    }
    const recordOn = (...args: unknown[]): void => {
      onMock(...args)
      const ev = args[0]
      if (ev !== 'tap') return
      if (typeof args[1] === 'function') {
        pushHandler('__bg', args[1] as (e: unknown) => void)
      } else if (typeof args[1] === 'string' && typeof args[2] === 'function') {
        pushHandler(args[1] as string, args[2] as (e: unknown) => void)
      }
    }
    const addImpl = jest.fn((els: unknown) => {
      addCalls.push(els)
      addElsToCtx(ctx, els)
      const arr = Array.isArray(els) ? els : [els]
      arr.forEach((e) => {
        const id = (e as ElLike)?.data?.id
        if (id != null && String(id) !== '') elementIds.push(String(id))
      })
      return makeColl([], classes, ctx)
    })
    const core: CyCore = {
      on: recordOn,
      off: jest.fn(),
      destroy: destroyMock,
      add: addImpl,
      remove: jest.fn(),
      batch: (fn: () => void) => fn(),
      elements: () => makeColl(elementIds.slice(), classes, ctx),
      getElementById: (id: string) =>
        makeColl(elementIds.includes(id) ? [id] : [], classes, ctx),
      layout: jest.fn((arg: unknown) => {
        layoutCalls.push(arg)
        return { run: jest.fn() }
      }),
      nodes: () => makeColl([], classes, ctx),
      edges: () => makeColl([], classes, ctx),
      $id: (id: string) =>
        makeColl(elementIds.includes(id) ? [id] : [], classes, ctx),
      fit: jest.fn(),
      center: jest.fn(),
      animate: jest.fn(),
      pan: jest.fn(() => ({ x: 0, y: 0 })),
      zoom: jest.fn(() => 1),
      width: jest.fn(() => 400),
      height: jest.fn(() => 300),
      style: jest.fn(() => style),
      userPanningEnabled: jest.fn(),
      boxSelectionEnabled: jest.fn(),
      __lastElements: (opts as { elements?: unknown })?.elements,
      __classesOf: (id: string): string[] => Array.from(classes.get(id) ?? []),
      __addCalls: addCalls,
      __emitTap: (kind: string, id: string): void => {
        const handlers = tapHandlers[kind] ?? []
        const target = makeColl([id], classes, ctx)
        target.id = () => id
        handlers.forEach((h) => h({ target }))
      },
    }
    lastCyInstance = core
    return core
  })

  const queryMock = jest.fn()

  const lastCy = (): CyCore => {
    if (!lastCyInstance) throw new Error('no cytoscape core constructed yet')
    return lastCyInstance
  }

  const classesOf = (id: string): string[] =>
    (lastCy().__classesOf as (i: string) => string[])(id)

  const lastLayoutArg = (): unknown => layoutCalls[layoutCalls.length - 1]

  const resetCalls = (): void => {
    cyConstructorCalls.length = 0
    layoutCalls.length = 0
    lastCyInstance = null
    destroyMock.mockClear()
    onMock.mockClear()
    queryMock.mockReset()
    // useMock intentionally not cleared — cytoscape.use(fcose/dagre) runs
    // once at module load, before any beforeEach.
  }

  return {
    cyConstructorCalls,
    destroyMock,
    onMock,
    useMock,
    layoutCalls,
    cyFactory,
    queryMock,
    lastCy,
    classesOf,
    lastLayoutArg,
    resetCalls,
  }
}

// Module-scope shared instance — tests import this so the mock factories
// installed via jest.mock(...) see the same harness the test body uses
// for assertions. Calling `createGraphViewMockHarness()` again in a test
// file would create a fresh harness that the already-installed
// jest.mock(...) factory would NOT see.
export const graphViewHarness = createGraphViewMockHarness()
