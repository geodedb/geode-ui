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

// Stable id used both as the wrapper's DOM id and as the CSS selector
// passed to cy.navigator(). The library's _initPanel only honors
// options.container when it's a STRING selector (see
// node_modules/cytoscape-navigator/cytoscape-navigator.js:376-389) —
// passing an HTMLElement silently falls through and the library mounts
// its own panel pinned to document.body via `position: fixed`.
const PANEL_ID = 'graph-minimap-panel'

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

  /* Defense: cytoscape-navigator's stylesheet positions
     .cytoscape-navigator as fixed bottom-right with hard-coded
     width/height. Override here so the nested panel stays inside
     our wrapper. */
  & .cytoscape-navigator {
    position: absolute !important;
    inset: 0 !important;
    width: 100% !important;
    height: 100% !important;
    bottom: auto !important;
    right: auto !important;
  }
`

// cytoscape-navigator augments the Core with a .navigator(opts) method at
// registration time. The typed Core interface doesn't know about it, so we
// widen locally for the call-site only. `container` is typed as a string
// CSS selector — see PANEL_ID note above for why.
type CoreWithNavigator = Core & {
  navigator: (opts: { container: string; viewLiveFramerate?: number }) => {
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
    // `el` is still required so we don't init before React has mounted
    // our wrapper into the DOM — cy.navigator() will querySelector the
    // selector immediately and fail if the node isn't there yet.
    if (!cy || !el || typeof cy.navigator !== 'function') return undefined
    const inst = cy.navigator({
      container: `#${PANEL_ID}`,
      viewLiveFramerate: 30,
    })
    // Bug 5: cytoscape-navigator captures its preview image at init
    // time from the cy core's current render snapshot. When the user
    // toggles the mini-map on FOR THE FIRST TIME the core may have
    // just finished a layout and the navigator misses the next paint
    // tick, producing a blank / broken-image preview that only fixes
    // itself when the user pans or zooms (each of which triggers the
    // navigator's resize listener). Force-resize the core on the next
    // animation frame so the navigator immediately gets a fresh
    // snapshot of the painted scene without waiting for user input.
    let raf: number | null = null
    if (typeof window !== 'undefined') {
      raf = window.requestAnimationFrame(() => {
        raf = null
        try {
          cy.resize()
        } catch {
          /* core may already be destroyed; ignore */
        }
      })
    }
    return () => {
      if (raf != null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(raf)
      }
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

  return <Box ref={ref} id={PANEL_ID} data-testid="graph-minimap" />
}
