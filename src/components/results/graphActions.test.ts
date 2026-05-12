/* eslint-disable no-underscore-dangle, no-use-before-define */
import type { Core } from 'cytoscape'
import {
  collapseNode,
  expandCollapsed,
  hideNode,
  mergeSubgraph,
  restoreNode,
} from './graphActions'

// ----------------------------------------------------------------------
// A small purpose-built Cytoscape mock for graphActions. It models the
// few surface methods the helpers reach: getElementById(id) →
// addClass/removeClass on a single element, neighborhood()/degree() on a
// node so collapseNode can find degree-1 leaves, and add()/getElementById
// presence checks for mergeSubgraph. The class state is shared per-core so
// __classesOf(id) is observable.
// ----------------------------------------------------------------------

type ElData = { id: string; source?: string; target?: string }

type MockColl = {
  // The "node" filter is a no-op here — every member is a node-or-edge
  // singular and collapseNode only iterates neighbour singulars it then
  // re-fetches by id, so a faithful filter isn't needed.
  nodes: () => MockColl
  forEach: (fn: (el: MockEl) => void) => void
  length: number
}

type MockEl = {
  data: (key?: string) => ElData | unknown
  addClass: jest.Mock
  removeClass: jest.Mock
  hasClass: (cls: string) => boolean
  neighborhood: () => MockColl
  degree: (includeLoops?: boolean) => number
  empty: () => boolean
  length: number
}

type MockCy = Core & {
  __classesOf: (id: string) => string[]
  __ids: () => string[]
  __addCalls: ElData[][]
}

function makeMockCy(els: ElData[]): MockCy {
  const present = new Map<string, ElData>()
  els.forEach((e) => present.set(e.id, e))
  const classes = new Map<string, Set<string>>()
  const addCalls: ElData[][] = []

  // Adjacency (undirected) for nodes — derived from edge els.
  const adj = new Map<string, Set<string>>()
  const ensure = (id: string): Set<string> => {
    let s = adj.get(id)
    if (!s) {
      s = new Set<string>()
      adj.set(id, s)
    }
    return s
  }
  els.forEach((e) => {
    if (e.source !== undefined && e.target !== undefined) {
      ensure(e.source).add(e.target)
      ensure(e.target).add(e.source)
    }
  })

  const makeEl = (id: string): MockEl => {
    const el: MockEl = {
      data: (key?: string) => {
        const d = present.get(id) ?? { id }
        return key === undefined ? d : (d as Record<string, unknown>)[key]
      },
      addClass: jest.fn((cls: string) => {
        const set = classes.get(id) ?? new Set<string>()
        set.add(cls)
        classes.set(id, set)
        return el
      }),
      removeClass: jest.fn((cls: string) => {
        classes.get(id)?.delete(cls)
        return el
      }),
      hasClass: (cls: string) => classes.get(id)?.has(cls) ?? false,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      degree: (_includeLoops?: boolean) => adj.get(id)?.size ?? 0,
      empty: () => !present.has(id),
      length: present.has(id) ? 1 : 0,
      neighborhood: () => {
        const ids = Array.from(adj.get(id) ?? [])
        return makeColl(ids.map(makeEl))
      },
    }
    return el
  }

  const makeColl = (members: MockEl[]): MockColl => ({
    nodes: () => makeColl(members),
    forEach: (fn) => members.forEach(fn),
    length: members.length,
  })

  const cy = {
    getElementById: (id: string) => makeEl(id),
    add: jest.fn((toAdd: ElData | ElData[] | { data: ElData }[]) => {
      const arr = (Array.isArray(toAdd) ? toAdd : [toAdd]) as (
        | ElData
        | { data: ElData }
      )[]
      const datas: ElData[] = arr.map((x) => {
        return 'data' in x ? (x as { data: ElData }).data : (x as ElData)
      })
      datas.forEach((d) => present.set(d.id, d))
      addCalls.push(datas)
    }),
    __classesOf: (id: string): string[] => Array.from(classes.get(id) ?? []),
    __ids: (): string[] => Array.from(present.keys()),
    __addCalls: addCalls,
  } as unknown as MockCy
  return cy
}

describe('graphActions.hideNode', () => {
  it('adds the .hidden-node class to the node and returns [id]', () => {
    const cy = makeMockCy([{ id: 'a' }, { id: 'b' }])
    const out = hideNode(cy, 'a')
    expect(out).toEqual(['a'])
    expect(cy.__classesOf('a')).toContain('hidden-node')
    expect(cy.__classesOf('b')).not.toContain('hidden-node')
  })
})

describe('graphActions.restoreNode', () => {
  it('removes the .hidden-node class from the node', () => {
    const cy = makeMockCy([{ id: 'a' }])
    hideNode(cy, 'a')
    expect(cy.__classesOf('a')).toContain('hidden-node')
    restoreNode(cy, 'a')
    expect(cy.__classesOf('a')).not.toContain('hidden-node')
  })
})

describe('graphActions.collapseNode', () => {
  it('hides only the degree-1 leaf neighbours and returns their ids', () => {
    // hub --- leaf1
    //  |  \-- leaf2
    //  \----- other --- far   (other has degree 2, not a leaf)
    const cy = makeMockCy([
      { id: 'hub' },
      { id: 'leaf1' },
      { id: 'leaf2' },
      { id: 'other' },
      { id: 'far' },
      { id: 'e1', source: 'hub', target: 'leaf1' },
      { id: 'e2', source: 'hub', target: 'leaf2' },
      { id: 'e3', source: 'hub', target: 'other' },
      { id: 'e4', source: 'other', target: 'far' },
    ])
    const hidden = collapseNode(cy, 'hub')
    expect(new Set(hidden)).toEqual(new Set(['leaf1', 'leaf2']))
    expect(cy.__classesOf('leaf1')).toContain('hidden-node')
    expect(cy.__classesOf('leaf2')).toContain('hidden-node')
    // The hub itself is NOT hidden.
    expect(cy.__classesOf('hub')).not.toContain('hidden-node')
    // 'other' has degree 2 — not collapsed.
    expect(cy.__classesOf('other')).not.toContain('hidden-node')
    expect(cy.__classesOf('far')).not.toContain('hidden-node')
  })

  it('returns [] when the node has no leaf neighbours', () => {
    const cy = makeMockCy([
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
      { id: 'e3', source: 'c', target: 'a' },
    ])
    expect(collapseNode(cy, 'a')).toEqual([])
  })
})

describe('graphActions.expandCollapsed', () => {
  it('removes .hidden-node from every id passed', () => {
    const cy = makeMockCy([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    hideNode(cy, 'a')
    hideNode(cy, 'b')
    expandCollapsed(cy, ['a', 'b'])
    expect(cy.__classesOf('a')).not.toContain('hidden-node')
    expect(cy.__classesOf('b')).not.toContain('hidden-node')
  })
})

describe('graphActions.mergeSubgraph', () => {
  it('adds only elements whose data.id is not already present and returns the added ids', () => {
    const cy = makeMockCy([{ id: 'a' }, { id: 'b' }])
    const els = [
      { data: { id: 'a' } }, // already present — skip
      { data: { id: 'c' } }, // new
      { data: { id: 'd' } }, // new
      { data: { id: 'eAB', source: 'a', target: 'b' } }, // new edge
    ]
    const added = mergeSubgraph(
      cy,
      els as unknown as Parameters<typeof mergeSubgraph>[1]
    )
    expect(new Set(added)).toEqual(new Set(['c', 'd', 'eAB']))
    // cy.add was called only with the new ones.
    const addedDatas = cy.__addCalls.flat().map((d) => d.id)
    expect(new Set(addedDatas)).toEqual(new Set(['c', 'd', 'eAB']))
    expect(cy.__ids()).toEqual(
      expect.arrayContaining(['a', 'b', 'c', 'd', 'eAB'])
    )
  })

  it('is a no-op (returns []) when every element is already present', () => {
    const cy = makeMockCy([{ id: 'a' }, { id: 'b' }])
    const added = mergeSubgraph(cy, [
      { data: { id: 'a' } },
      { data: { id: 'b' } },
    ] as unknown as Parameters<typeof mergeSubgraph>[1])
    expect(added).toEqual([])
    expect(cy.__addCalls).toEqual([])
  })
})
