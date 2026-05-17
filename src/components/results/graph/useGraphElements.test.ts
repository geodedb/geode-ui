import { renderHook } from '@testing-library/react'
import { useGraphElements } from './useGraphElements'
import type { QueryRespLike } from '../../../lib/graphResult'

describe('useGraphElements — degree stamp', () => {
  const resp = {
    columns: [{ name: 'n' }, { name: 'r' }, { name: 'm' }],
    rows: [],
    graph_summary: {
      nodes: [
        { id: 1, labels: ['Person'], properties: { name: 'A' } },
        { id: 2, labels: ['Person'], properties: { name: 'B' } },
        { id: 3, labels: ['Movie'], properties: { title: 'X' } },
      ],
      edges: [
        { id: 10, start_node: 1, end_node: 2, type: 'KNOWS', properties: {} },
        {
          id: 11,
          start_node: 1,
          end_node: 3,
          type: 'ACTED_IN',
          properties: {},
        },
      ],
    },
  }

  it('stamps data.degree and data.size on each node', () => {
    const { result } = renderHook(() =>
      useGraphElements({ resp, clusterByLabel: false, degreeSizing: true })
    )
    const nodes = result.current.baseEls.filter(
      (e) => (e.data as { source?: unknown }).source === undefined
    )
    const byId = new Map(
      nodes.map((n) => [
        String((n.data as { id: unknown }).id),
        n.data as Record<string, unknown>,
      ])
    )
    expect(byId.get('1')?.degree).toBe(2)
    expect(byId.get('2')?.degree).toBe(1)
    expect(byId.get('3')?.degree).toBe(1)
    expect(typeof byId.get('1')?.size).toBe('number')
    expect(byId.get('1')?.size as number).toBeGreaterThan(
      byId.get('3')?.size as number
    )
  })
})

// PERF-N1 (#275): regression pin for the #249 cascade win.
//
// `useGraphElements` keys its three `useMemo` factories (baseEls,
// elements, the id-index map) on `(resp, query, clusterByLabel,
// degreeSizing)`. The upstream cascade (#249) keeps `resp` reference-
// stable across throttled tick batches by memoising
// `streamStateToResp` on `throttledVersion` (the rAF-throttled mirror
// of `rowsVersion`). When `rowsVersion` doesn't bump, the cascade
// hands `useGraphElements` the same `resp` object identity, so the
// useMemo factories MUST short-circuit and return the same derived
// arrays / Maps by identity.
//
// Without this guard, a future refactor could re-derive resp on every
// render (e.g. building a fresh object literal in the parent) and
// silently re-introduce ~1.56M Map.set ops across a 10k-row graph
// stream. The test asserts the exact contract: stable `resp`
// reference => derived array / Map identities stay `===`; new `resp`
// reference => derived array / Map identities rotate.
describe('useGraphElements — rowsVersion rebuild guardrail (PERF-N1 / #275)', () => {
  const baseResp: QueryRespLike & { row_count?: number } = {
    columns: [{ name: 'n' }, { name: 'r' }, { name: 'm' }],
    rows: [],
    graph_summary: {
      nodes: [
        { id: 1, labels: ['Person'], properties: { name: 'A' } },
        { id: 2, labels: ['Person'], properties: { name: 'B' } },
      ],
      edges: [
        { id: 10, start_node: 1, end_node: 2, type: 'KNOWS', properties: {} },
      ],
    },
  }

  // The "throttled" upstream contract: when rowsVersion does not bump,
  // streamStateToResp returns the SAME object identity. We model that
  // here by holding the resp reference stable across rerenders.
  it('stable resp reference: baseEls / elements / nodeDataById stay === across 5 rerenders', () => {
    const { result, rerender } = renderHook(
      ({ resp, clusterByLabel, degreeSizing }) =>
        useGraphElements({ resp, clusterByLabel, degreeSizing }),
      {
        initialProps: {
          resp: baseResp,
          clusterByLabel: false,
          degreeSizing: false,
        },
      }
    )

    const initial = {
      baseEls: result.current.baseEls,
      elements: result.current.elements,
      nodeDataById: result.current.nodeDataById,
      edgeDataById: result.current.edgeDataById,
      nodeLabelBuckets: result.current.nodeLabelBuckets,
      nodeIds: result.current.nodeIds,
      edgeIds: result.current.edgeIds,
    }

    for (let i = 0; i < 5; i += 1) {
      // Same resp reference, same props — useMemo should NOT rebuild.
      rerender({
        resp: baseResp,
        clusterByLabel: false,
        degreeSizing: false,
      })
      expect(result.current.baseEls).toBe(initial.baseEls)
      expect(result.current.elements).toBe(initial.elements)
      expect(result.current.nodeDataById).toBe(initial.nodeDataById)
      expect(result.current.edgeDataById).toBe(initial.edgeDataById)
      expect(result.current.nodeLabelBuckets).toBe(initial.nodeLabelBuckets)
      expect(result.current.nodeIds).toBe(initial.nodeIds)
      expect(result.current.edgeIds).toBe(initial.edgeIds)
    }
  })

  // The "rowsVersion bumped" contract: a fresh resp object identity
  // means a real change upstream. The 3-Map rebuild fires exactly
  // once: result identities change after the bump and then stay
  // stable on subsequent rerenders with that new resp.
  it('new resp reference: derived identities rotate ONCE per bump, then stay stable', () => {
    const { result, rerender } = renderHook(
      ({ resp, clusterByLabel, degreeSizing }) =>
        useGraphElements({ resp, clusterByLabel, degreeSizing }),
      {
        initialProps: {
          resp: baseResp,
          clusterByLabel: false,
          degreeSizing: false,
        },
      }
    )

    const before = {
      baseEls: result.current.baseEls,
      nodeDataById: result.current.nodeDataById,
      edgeDataById: result.current.edgeDataById,
    }

    // Bump 1: spread-construct a fresh resp object with a NEW edge.
    // This mirrors what streamStateToResp emits when rowsVersion bumps.
    const bumpedResp: QueryRespLike & { row_count?: number } = {
      ...baseResp,
      graph_summary: {
        nodes: [...(baseResp.graph_summary?.nodes ?? [])],
        edges: [
          ...(baseResp.graph_summary?.edges ?? []),
          {
            id: 11,
            start_node: 2,
            end_node: 1,
            type: 'FRIENDS',
            properties: {},
          },
        ],
      },
    }
    rerender({
      resp: bumpedResp,
      clusterByLabel: false,
      degreeSizing: false,
    })

    // Identities rotated (different resp => useMemo recomputed).
    expect(result.current.baseEls).not.toBe(before.baseEls)
    expect(result.current.nodeDataById).not.toBe(before.nodeDataById)
    expect(result.current.edgeDataById).not.toBe(before.edgeDataById)

    // And the actual derived data reflects the bumped graph (the new
    // edge appears in edgeDataById). Edge ids are prefixed with 'e'
    // by `pushRealEdges` (`src/lib/graphResult/pushRealElements.ts:66`).
    expect(result.current.edgeDataById.has('e11')).toBe(true)

    // After the bump, holding the new resp reference stable should
    // again short-circuit useMemo on subsequent rerenders.
    const afterBump = result.current.baseEls
    for (let i = 0; i < 3; i += 1) {
      rerender({
        resp: bumpedResp,
        clusterByLabel: false,
        degreeSizing: false,
      })
      expect(result.current.baseEls).toBe(afterBump)
    }
  })
})
