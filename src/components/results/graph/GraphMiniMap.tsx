// cytoscape-navigator ships a CommonJS bundle with no TypeScript types
// (see node_modules/cytoscape-navigator/package.json — no "types" /
// "typings" entry). The ambient declaration lives in
// src/types/cytoscape-navigator.d.ts so the default import resolves
// cleanly here; the cast-through-unknown at `cytoscape.use(...)` does
// the rest of the typing work.

import React, { useEffect, useRef } from 'react'
import styled from 'styled-components'
import cytoscape, { Core } from 'cytoscape'
import navigator from 'cytoscape-navigator'

// Side-effect import — the package ships its panner / viewport-rect
// styles in this file. Without it the navigator div renders empty
// (no visible rectangle, no draggable handle), which looks exactly
// like a broken mini-map. The Jest CSS stub (jest.config.cjs's
// moduleNameMapper for "\\.css$") returns an empty module so this
// import is a no-op in tests.
import 'cytoscape-navigator/cytoscape.js-navigator.css'

// Idempotent registration — cytoscape.use is a no-op on second call, so
// re-importing this module (e.g. across tests) doesn't double-register.
// `cytoscape-navigator` predates the modern Ext typing, so we cast through
// unknown — matches the project's existing pattern.
cytoscape.use(navigator as unknown as cytoscape.Ext)

const Box = styled.div`
  width: 160px;
  height: 120px;
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.sm};
  background: ${({ theme }) => theme.bg.canvas};
  overflow: hidden;
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 5;
`

// cytoscape-navigator augments the Core with a .navigator(opts) method at
// registration time. The typed Core interface doesn't know about it, so we
// widen locally for the call-site only.
type CoreWithNavigator = Core & {
  navigator: (opts: { container: HTMLElement; viewLiveFramerate?: number }) => {
    destroy: () => void
  }
}

export type GraphMiniMapProps = {
  cyRef: React.MutableRefObject<Core | null>
  // Reapply key — the caller passes the orchestrator's `sig` so the
  // navigator instance recycles when the underlying cy core is rebuilt
  // (the old navigator's bound canvas would point at a destroyed core
  // otherwise).
  sig?: string
}

// GraphMiniMap renders a small overview panel anchored to the bottom-right
// of the graph canvas. The user opts in via the toolbar toggle (default
// off) — when mounted, it attaches `cytoscape-navigator` to the live cy
// core and tears the instance down on unmount or sig change.
export const GraphMiniMap: React.FC<GraphMiniMapProps> = ({ cyRef, sig }) => {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const cy = cyRef.current as CoreWithNavigator | null
    const el = ref.current
    if (!cy || !el || typeof cy.navigator !== 'function') return undefined
    const inst = cy.navigator({ container: el, viewLiveFramerate: 30 })
    return () => {
      try {
        inst.destroy()
      } catch {
        // Swallow — the underlying cy core may already be destroyed by
        // the orchestrator's rebuild teardown, in which case the
        // navigator's destroy() throws while trying to unbind listeners
        // from a dead core. The next mount will reattach to the new core.
      }
    }
  }, [cyRef, sig])

  return <Box ref={ref} data-testid="graph-minimap" />
}
