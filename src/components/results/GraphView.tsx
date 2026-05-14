import React, { lazy, Suspense } from 'react'
import { useGraphPrefs } from './useGraphPrefs'
import {
  GraphViewCytoscape,
  type GraphViewCytoscapeProps,
} from './GraphViewCytoscape'

// Reagraph pulls in three.js (~600 KB minified) — lazy-load it so the
// cytoscape default path doesn't pay the bundle cost. The chunk is
// fetched the first time the user flips the renderer toggle. Suspense
// fallback is a single-frame placeholder; in practice the chunk is in
// cache after the first toggle.
const GraphViewReagraph = lazy(() =>
  import('./GraphViewReagraph').then((m) => ({ default: m.GraphViewReagraph }))
)

export type GraphViewProps = GraphViewCytoscapeProps

// Thin dispatcher that picks the active graph renderer from the sticky
// pref in useGraphPrefs. Both branches receive identical props — the
// renderer choice is intentionally invisible to the caller (QueryPage,
// the maximised overlay, etc.) so a future feature-flag flip or rollback
// is a one-line change here.
export const GraphView: React.FC<GraphViewProps> = (props) => {
  const renderer = useGraphPrefs((s) => s.renderer)
  if (renderer === 'reagraph') {
    return (
      <Suspense fallback={<div data-testid="graph-renderer-loading" />}>
        <GraphViewReagraph {...props} />
      </Suspense>
    )
  }
  return <GraphViewCytoscape {...props} />
}
