import React, { useEffect, useMemo } from 'react'
import { GraphView } from '../../components/results/GraphView'
import { seededGraph } from '../../lib/seededGraph'
import { useGraphPrefs } from '../../components/results/useGraphPrefs'
import type { QueryRespLike } from '../../lib/graphResult'

// Dev-only benchmark host for the cytoscape→reagraph spike. Reads
// `n` and `renderer` from the URL query string; the renderer choice
// is pushed into useGraphPrefs so the GraphView dispatcher picks it
// up on next render. Logs `[graph-bench]` records to the console
// every 200 ms — the Playwright harness in e2e/specs/19 listens for
// these and aggregates them into the benchmark JSON.
//
// IMPORTANT: This page is ONLY mounted in non-production builds. The
// App router gates the route accordingly.

function readQuery(): { n: number; renderer: 'cytoscape' | 'reagraph' } {
  const params = new URLSearchParams(window.location.search)
  const nRaw = parseInt(params.get('n') ?? '1000', 10)
  const n = Number.isFinite(nRaw) && nRaw > 0 ? Math.min(nRaw, 50_000) : 1000
  const r = params.get('renderer')
  const renderer = r === 'reagraph' ? 'reagraph' : 'cytoscape'
  return { n, renderer }
}

// Strip the `seededGraph` `'n'` id prefix and parse to a number.
// `extractElements` in graphResult.ts requires GqlNode.id and
// GqlEdge.start_node / end_node to be NUMERIC (`typeof === 'number'`,
// per `isEdgeShape`); a string id silently falls through `isEdgeShape`
// and the edge is dropped, leaving the cytoscape branch rendering
// nodes-only and skewing the benchmark.
function nodeIdNum(id: string): number {
  const n = parseInt(id.slice(1), 10)
  return Number.isFinite(n) ? n : 0
}

function toQueryRespLike(
  graph: ReturnType<typeof seededGraph>
): QueryRespLike & { row_count: number } {
  return {
    rows: [],
    columns: [],
    row_count: graph.nodes.length + graph.edges.length,
    graph_summary: {
      nodes: graph.nodes.map((node) => ({
        id: nodeIdNum(node.id),
        labels: [node.label],
        properties: node.properties,
      })),
      // GqlEdge shape: numeric id + start_node + end_node + type + properties.
      // `type` is a top-level field on GqlEdge (graphResult.ts:19), separate
      // from `properties.type`. `extractElements` uses the top-level `type`
      // as the edge's label fallback, so populating it is what gives the
      // benchmark edges visible labels on both renderers.
      edges: graph.edges.map((edge, idx) => ({
        id: idx,
        start_node: nodeIdNum(edge.source),
        end_node: nodeIdNum(edge.target),
        type: edge.type,
        properties: {},
      })),
    },
  }
}

export const GraphBenchPage: React.FC = () => {
  const { n, renderer } = useMemo(readQuery, [])
  const setRenderer = useGraphPrefs((s) => s.setRenderer)
  const resp = useMemo(() => toQueryRespLike(seededGraph(n)), [n])
  // Push the URL choice into the pref store so the dispatcher branches
  // correctly. Synchronous in useMemo would race with first render —
  // setState in useEffect is the right shape.
  useEffect(() => {
    setRenderer(renderer)
  }, [renderer, setRenderer])

  // Frame-time sampler. requestAnimationFrame fires once per displayed
  // frame; we average frame-times into FPS over a 200ms window and
  // console.log the result for the Playwright harness.
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let frames = 0
    const start = performance.now()
    // eslint-disable-next-line no-console
    console.log(
      `[graph-bench] init renderer=${renderer} n=${n} ts=${start.toFixed(0)}`
    )
    const tick = (now: number) => {
      frames += 1
      if (now - last >= 200) {
        const fps = (frames * 1000) / (now - last)
        const perfMem = (
          performance as unknown as { memory?: { usedJSHeapSize?: number } }
        ).memory
        const mem = perfMem?.usedJSHeapSize ?? -1
        // eslint-disable-next-line no-console
        console.log(
          `[graph-bench] sample fps=${fps.toFixed(1)} mem=${mem} elapsed=${(now - start).toFixed(0)}`
        )
        last = now
        frames = 0
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [renderer, n])

  return (
    <div style={{ height: '100vh' }} data-testid="graph-bench-page">
      <GraphView resp={resp} fillHeight />
    </div>
  )
}
