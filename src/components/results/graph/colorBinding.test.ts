// Reproduction test for the "node color flips when display-property
// changes" bug.
//
// Symptom: in cytoscapeStyle.ts the node color resolver runs
// `labelToColor(e.data('label'), variant)`. `data('label')` is ALSO
// the visible label text — which `applyLabels` mutates whenever the
// user picks a different display property (e.g. show `title` instead
// of the bare `Movie` label). Because the color is hashed from the
// same field, changing the display property reseeds the palette: a
// row of Movie nodes that started purple-purple-purple ends up
// green-blue-red the moment the operator picks `title` from the
// "Display Field" select.
//
// The fix stamps an immutable `nodeType` (and `edgeType` for edges)
// onto each element's data bag at extract time and routes the color
// resolver through that field. The display label can keep mutating;
// the color stays bound to the graph TYPE.
//
// This file pins three contracts:
//   1) Every node element carries `data.nodeType` set to its first
//      label, regardless of how `data.label` is set.
//   2) Every edge element carries `data.edgeType` set to its
//      relationship type, regardless of how `data.type` / `data.label`
//      is set.
//   3) `applyLabels` rewrites `data.label` and `data.type` for
//      display, but leaves `data.nodeType` / `data.edgeType`
//      untouched — so the cytoscapeStyle color hash stays stable.

import { extractElements, type QueryRespLike } from '../../../lib/graphResult'

// applyLabels lives in cyHelpers.ts and operates on a live Cytoscape
// core. It calls `cy.nodes().forEach((n) => n.data('label', resolved))`
// and `cy.edges().forEach((e) => e.data('type', resolved))`. We don't
// need a real Cytoscape instance — a tiny stand-in that mutates the
// element data bags is enough to assert the immutability contract.
function simulateApplyLabels(
  els: ReturnType<typeof extractElements>,
  nodePref: Record<string, string>,
  edgePref: Record<string, string>
): void {
  els.forEach((el) => {
    const data = el.data as Record<string, unknown>
    const labels = Array.isArray(data.labels) ? (data.labels as string[]) : []
    const labelKey = labels[0] ?? ''
    const props = (data.props as Record<string, unknown>) ?? {}
    if (el.group === 'nodes') {
      const pref = nodePref[labelKey]
      if (pref && pref !== '__label__') {
        const v = props[pref]
        if (v != null && v !== '') {
          // This is what cyHelpers.applyLabels does on a real cy core.
          data.label = String(v)
        }
      }
    } else {
      const t = String(data.type ?? '')
      const pref = edgePref[t]
      if (pref && pref !== '__type__') {
        const v = props[pref]
        if (v != null && v !== '') {
          data.type = String(v)
        }
      }
    }
  })
}

const RESP: QueryRespLike = {
  graph_summary: {
    nodes: [
      {
        id: 1,
        labels: ['Movie'],
        properties: { title: 'A Few Good Men', released: 1992 },
      },
      {
        id: 2,
        labels: ['Person'],
        properties: { name: 'Tom Hanks', born: 1956 },
      },
    ],
    edges: [
      {
        id: 1,
        start_node: 2,
        end_node: 1,
        type: 'ACTED_IN',
        properties: { roles: 'Sam Weinberg' },
      },
    ],
  },
}

describe('graph node/edge color binding (stable across display-pref changes)', () => {
  it('stamps data.nodeType with the first label on every node element', () => {
    const els = extractElements(RESP)
    const movie = els.find(
      (el) =>
        el.group === 'nodes' && (el.data as Record<string, unknown>).id === '1'
    )
    const person = els.find(
      (el) =>
        el.group === 'nodes' && (el.data as Record<string, unknown>).id === '2'
    )
    expect((movie?.data as Record<string, unknown> | undefined)?.nodeType).toBe(
      'Movie'
    )
    expect(
      (person?.data as Record<string, unknown> | undefined)?.nodeType
    ).toBe('Person')
  })

  it('stamps data.edgeType with the relationship type on every edge element', () => {
    const els = extractElements(RESP)
    const edge = els.find((el) => el.group === 'edges')
    expect((edge?.data as Record<string, unknown> | undefined)?.edgeType).toBe(
      'ACTED_IN'
    )
  })

  it('keeps data.nodeType / data.edgeType stable when applyLabels mutates the display label/type', () => {
    const els = extractElements(RESP)
    // Snapshot the color-seed fields before mutation.
    const beforeNode = els
      .filter((el) => el.group === 'nodes')
      .map((el) => (el.data as Record<string, unknown>).nodeType)
    const beforeEdge = els
      .filter((el) => el.group === 'edges')
      .map((el) => (el.data as Record<string, unknown>).edgeType)

    // Apply the user-chosen display preferences — `title` for Movie
    // nodes, `name` for Person, `roles` for ACTED_IN edges. This is
    // the exact mutation cyHelpers.applyLabels performs on the live
    // cy core when the operator picks a property from the Display
    // Field selector.
    simulateApplyLabels(
      els,
      { Movie: 'title', Person: 'name' },
      { ACTED_IN: 'roles' }
    )

    // data.label / data.type changed (display rebound).
    const movie = els.find(
      (el) =>
        el.group === 'nodes' && (el.data as Record<string, unknown>).id === '1'
    )
    expect((movie?.data as Record<string, unknown> | undefined)?.label).toBe(
      'A Few Good Men'
    )
    const edge = els.find((el) => el.group === 'edges')
    expect((edge?.data as Record<string, unknown> | undefined)?.type).toBe(
      'Sam Weinberg'
    )

    // data.nodeType / data.edgeType did NOT change — the color seed
    // is untouched.
    const afterNode = els
      .filter((el) => el.group === 'nodes')
      .map((el) => (el.data as Record<string, unknown>).nodeType)
    const afterEdge = els
      .filter((el) => el.group === 'edges')
      .map((el) => (el.data as Record<string, unknown>).edgeType)
    expect(afterNode).toEqual(beforeNode)
    expect(afterEdge).toEqual(beforeEdge)
  })

  it('placeholder nodes carry nodeType from the MATCH-derived type when available', () => {
    // A query result where an edge points at a node id that's missing
    // from graph_summary.nodes. The placeholder pusher synthesises a
    // stub node and tags it with the MATCH-derived type.
    const placeholderResp: QueryRespLike = {
      graph_summary: {
        nodes: [{ id: 1, labels: ['Person'], properties: { name: 'a' } }],
        edges: [
          {
            id: 1,
            start_node: 1,
            end_node: 99,
            type: 'ACTED_IN',
            properties: {},
          },
        ],
      },
    }
    const els = extractElements(placeholderResp)
    const placeholder = els.find(
      (el) =>
        el.group === 'nodes' && (el.data as Record<string, unknown>).id === '99'
    )
    expect(placeholder).toBeDefined()
    expect(
      (placeholder?.data as Record<string, unknown> | undefined)?.nodeType
    ).toBeDefined()
  })
})
