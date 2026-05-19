// cytoscape-navigator ships a CommonJS bundle with no TypeScript types
// (see node_modules/cytoscape-navigator/package.json — no "types" /
// "typings" entry). The ambient declaration lives in
// src/types/cytoscape-navigator.d.ts so the default import resolves
// cleanly here; the cast-through-unknown at `cytoscape.use(...)` does
// the rest of the typing work.

import React, { useEffect, useRef } from 'react'
import styled from 'styled-components'
import cytoscape, { Core } from 'cytoscape'

// PERF #316: lazy-load the cytoscape-navigator plugin AND its bundled
// CSS so users who never toggle the mini-map pay zero bytes for it.
// The CSS sibling import is co-located here because Webpack needs it
// inside the dynamic-import factory to roll the CSS into the same
// chunk; the Jest CSS stub returns an empty module so it's a no-op
// in tests. Same caching pattern as useLasso / useCxtMenu — first
// mini-map mount pays the import cost; subsequent mounts (after a
// toggle off/on) resolve immediately from the cached promise.
let navigatorPluginPromise: Promise<void> | null = null
function ensureNavigatorPlugin(): Promise<void> {
  if (!navigatorPluginPromise) {
    navigatorPluginPromise = Promise.all([
      import(/* webpackChunkName: "cyto-navigator" */ 'cytoscape-navigator'),
      import(
        /* webpackChunkName: "cyto-navigator" */ 'cytoscape-navigator/cytoscape.js-navigator.css'
      ),
    ]).then(([mod]) => {
      cytoscape.use(
        (mod as { default: unknown }).default as unknown as cytoscape.Ext
      )
    })
  }
  return navigatorPluginPromise
}

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
    // useGraphCytoscape's rebuild is debounced (setTimeout, 250 ms), so
    // when this component mounts with sticky `miniMap: true` the effect
    // runs BEFORE the cy core is constructed and cyRef.current is null.
    // Pre-fix the early-return at `if (!cy)` exited without rescheduling
    // and the useEffect deps `[cyRef, sig]` are stable refs — the effect
    // never re-fired, so the navigator was never initialised and the
    // user saw a blank panel.
    //
    // Fix: poll cyRef.current with a 50 ms retry until the core appears
    // (same pattern as useNodeTooltip.tryBind). Once bound, the
    // navigator + layoutstop wiring runs exactly as before.
    let cancelled = false
    let pollTimer: ReturnType<typeof setTimeout> | null = null
    let raf: number | null = null
    let bound: {
      cy: CoreWithNavigator
      inst: { destroy: () => void }
      onLayoutStop: () => void
    } | null = null

    const tryInit = (): void => {
      if (cancelled || bound) return
      const cy = cyRef.current as CoreWithNavigator | null
      const el = ref.current
      // `el` is required so we don't init before React has mounted our
      // wrapper into the DOM — cy.navigator() will querySelector the
      // selector immediately and fail if the node isn't there yet.
      //
      // PERF #316: `cy.navigator` may legitimately be undefined for a
      // few ms even after cy exists — the plugin chunk is lazy and
      // registers async via ensureNavigatorPlugin() below. The poll
      // gate handles both "cy not built yet" AND "plugin not loaded
      // yet" with the same setTimeout retry; no separate plugin-await
      // is needed inside the poll because the gate registers cytoscape
      // .use() globally, which makes cy.navigator visible to every
      // future cy instance on the same Core constructor.
      if (!cy || !el || typeof cy.navigator !== 'function') {
        pollTimer = setTimeout(tryInit, 50)
        return
      }
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
      //      misses the layoutstop event entirely.
      //
      // Force `cy.resize()` on rAF for the settled-state case AND
      // listen for `layoutstop` on the cy core so subsequent layouts
      // (and the very first one when the polling path landed mid-
      // layout) refresh the thumbnail.
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
      bound = { cy, inst, onLayoutStop }
    }

    // PERF #316: warm the plugin chunk in parallel with the cy-build
    // poll. The promise resolves once cytoscape.use(navigator) has run
    // globally — every cy instance constructed thereafter exposes
    // `cy.navigator()`. `tryInit` is fired here AND from the
    // ensureNavigatorPlugin then-callback so whichever lands first
    // (plugin-ready or cy-built) triggers the poll; the cancelled +
    // bound short-circuits guard against double-init.
    ensureNavigatorPlugin().then(
      () => {
        tryInit()
      },
      () => {
        // Plugin chunk failed to load — short-circuit the poll loop
        // so we don't spin forever waiting for cy.navigator. The user
        // sees an empty minimap div; toggling off and on retries via
        // the next mount + cached rejected promise.
        cancelled = true
      }
    )
    tryInit()

    return () => {
      cancelled = true
      if (pollTimer != null) {
        clearTimeout(pollTimer)
        pollTimer = null
      }
      if (raf != null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(raf)
        raf = null
      }
      if (bound) {
        try {
          bound.cy.off('layoutstop', bound.onLayoutStop)
        } catch {
          /* ignore */
        }
        try {
          bound.inst.destroy()
        } catch {
          // Swallow — the underlying cy core may already be destroyed by
          // the orchestrator's rebuild teardown, in which case the
          // navigator's destroy() throws while trying to unbind listeners
          // from a dead core. The next mount will reattach to the new core.
        }
        bound = null
      }
    }
  }, [cyRef, sig])

  return <Box ref={ref} id={PANEL_ID} data-testid="graph-minimap" />
}
