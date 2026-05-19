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
    // cytoscape-navigator captures its preview image via cy.png() —
    // a snapshot of whatever the cy canvas currently paints. Two
    // failure modes if we don't actively refresh that snapshot:
    //
    //   A) User toggles mini-map on FROM SETTLED STATE. The current
    //      paint is correct; the navigator captures it on next
    //      onRender tick. No problem.
    //   B) User opens the page with sticky `miniMap: true`. The
    //      navigator inits at the same time as cy's first layout —
    //      the snapshot at that moment is empty / pre-layout, and
    //      the navigator's throttled onRender (rerenderDelay: 500 ms)
    //      misses the layoutstop event entirely. The user sees a
    //      blank box until they toggle the mini-map off and back on
    //      (which re-runs the init flow against the now-painted cy).
    //
    // Fix: (1) force `cy.resize()` on rAF for the settled-state
    // case (mirrors the navigator's resize listener and forces a
    // fresh thumbnail capture) AND (2) listen for `layoutstop` on
    // the cy core — the moment the initial / any later layout
    // completes, force another `cy.resize()` so the navigator
    // captures the freshly-painted scene. The handler stays
    // registered for the lifetime of the GraphMiniMap mount so
    // subsequent layouts (e.g. user picks `dagre` from the View
    // dropdown) also refresh the thumbnail.
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
    const onLayoutStop = (): void => {
      try {
        cy.resize()
      } catch {
        /* core may already be destroyed during teardown; ignore */
      }
    }
    try {
      cy.on('layoutstop', onLayoutStop)
    } catch {
      /* test stubs that lack `on` (no-op) — listener is best-effort */
    }
    return () => {
      if (raf != null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(raf)
      }
      try {
        cy.off('layoutstop', onLayoutStop)
      } catch {
        /* ignore */
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
