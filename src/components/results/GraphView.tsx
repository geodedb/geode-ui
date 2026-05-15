import React from 'react'
import {
  GraphViewCytoscape,
  type GraphViewCytoscapeProps,
} from './GraphViewCytoscape'

export type GraphViewProps = GraphViewCytoscapeProps

// Thin dispatcher that historically picked between the cytoscape canvas
// renderer (production) and the reagraph WebGL spike (Phase 0).
//
// The reagraph branch is currently DISABLED at the dispatcher level
// because reagraph@4.30.8 transitively requires @react-three/fiber@9.6.1
// which peer-depends on React >=19. The project pins react@18.2 and
// react-three-fiber's module body reads ReactSharedInternals.S (a React
// 19 internal). Lazy-loading the reagraph chunk therefore throws
// synchronously during module evaluation — outside any Suspense or
// ErrorBoundary scope — and the protected shell whitescreens.
//
// Caught by e2e/specs/28-no-whitescreen.spec.ts. The spike sources
// (GraphViewReagraph.tsx + reagraphElements.ts) are intentionally left
// on disk so the spike branch is recoverable when either reagraph
// publishes a React-18-compatible release or the project upgrades to
// React 19; flipping this dispatcher back to a lazy-loaded reagraph
// branch is then a one-line change. Until then there is exactly one
// renderer: cytoscape.
export const GraphView: React.FC<GraphViewProps> = (props) => (
  <GraphViewCytoscape {...props} />
)
