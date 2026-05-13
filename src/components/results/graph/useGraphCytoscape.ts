import { useEffect, useState } from 'react'
import cytoscape, { Core, ElementDefinition } from 'cytoscape'
import type { DefaultTheme } from 'styled-components'
import { createCytoscapeStyle } from '../cytoscapeStyle'
import {
  applyEmphasis,
  applyLabels,
  applySelectionMode,
  applyVisibility,
} from './cyHelpers'
import { layoutConfig } from './layouts'
import type { LayoutName } from '../useGraphPrefs'
import type { Selected } from './GraphInspector'

const REBUILD_DEBOUNCE_MS = 250

type TFn = (key: string, opts?: Record<string, unknown>) => string

export type UseGraphCytoscapeArgs = {
  // Sig string that triggers a debounced rebuild (row_count|query|cluster).
  sig: string
  // The DOM container ref the cy core mounts into. Owned by the orchestrator.
  containerRef: React.RefObject<HTMLDivElement | null>
  // The live cy core ref (orchestrator-owned so tap handlers can read it).
  cyRef: React.MutableRefObject<Core | null>
  // Refs the debounced build callback reads on fire — they always hold
  // the latest snapshot without re-creating the timer every render.
  elementsRef: React.MutableRefObject<ElementDefinition[]>
  layoutRef: React.MutableRefObject<LayoutName>
  nodePrefsRef: React.MutableRefObject<Record<string, string>>
  edgePrefsRef: React.MutableRefObject<Record<string, string>>
  selectionModeRef: React.MutableRefObject<'pan' | 'box'>
  // Tap handler ref (path mode picks up taps first; returns true to
  // swallow). The orchestrator owns this; the hook reads it.
  pathTapRef: React.MutableRefObject<(nodeId: string) => boolean>
  // Live theme — used for the rebuild and for the live-swap effect.
  theme: DefaultTheme
  // Live pref values — these drive the secondary effects.
  nodeLabelPrefs: Record<string, string>
  edgeLabelPrefs: Record<string, string>
  layout: LayoutName
  selectionMode: 'pan' | 'box'
  hiddenLabels: Set<string>
  hidden: Set<string>
  selected: Selected | null
  // The orchestrator owns the selection / error / counts state because
  // it renders them; the hook drives the setters from inside the build.
  setSelected: React.Dispatch<React.SetStateAction<Selected | null>>
  setError: (msg: string | null) => void
  setCounts: (counts: { nodes: number; edges: number }) => void
  // Optional hook into the pinned-node bookkeeping. Fires after a
  // rebuild (fresh core has no `locked` memory) and after a layout
  // rerun (defensive — Cytoscape preserves lock on the same core, but
  // re-applying is a cheap idempotent op).
  reapplyPins?: () => void
  t: TFn
}

// useGraphCytoscape owns every effect that talks to the live Cytoscape
// core: the debounced (re)build keyed on `sig`, the label / theme /
// layout / selection-mode / visibility / hidden-set / emphasis
// side-effects, and the ResizeObserver that re-fits the canvas when the
// container box changes. The orchestrator passes refs to its core,
// element snapshot, and prefs; the hook never reads any zustand store
// or i18n catalogue directly (per the refactor brief's closure-capture
// rule).
export function useGraphCytoscape(args: UseGraphCytoscapeArgs): void {
  const {
    sig,
    containerRef,
    cyRef,
    elementsRef,
    layoutRef,
    nodePrefsRef,
    edgePrefsRef,
    selectionModeRef,
    pathTapRef,
    theme,
    nodeLabelPrefs,
    edgeLabelPrefs,
    layout,
    selectionMode,
    hiddenLabels,
    hidden,
    selected,
    setSelected,
    setError,
    setCounts,
    reapplyPins,
    t,
  } = args

  // Stash the theme in a ref so the rebuild reads the latest value
  // without listing theme as a sig dep (which would force a rebuild on
  // every light↔dark flip — the live-swap effect handles that instead).
  const [themeRef] = useState({ current: theme })
  themeRef.current = theme

  // Debounced (re)build keyed on sig. Theme is intentionally NOT a dep —
  // theme flips swap the stylesheet via the dedicated effect below
  // without rebuilding the core.
  useEffect(() => {
    if (!containerRef.current) return undefined
    let canceled = false

    const build = (): void => {
      if (canceled || !containerRef.current) return
      // GAP-02 / GAP-06: drop the previous selection so the inspector
      // doesn't keep showing data from a graph that was just torn down.
      setSelected(null)
      setError(null)
      // Tear down a previous core if any. We accept this cost because
      // the rebuild is gated by row_count + debounce (PERF-F9), so a
      // streaming run produces exactly one teardown+rebuild instead of
      // one per row.
      if (cyRef.current) {
        cyRef.current.destroy()
        cyRef.current = null
      }
      try {
        // P-NEW-5: reuse the memoized snapshot from elements.
        const els = elementsRef.current
        // GAP-05: when the response has no graph elements, skip the
        // cytoscape mount entirely.
        if (els.length === 0) {
          setCounts({ nodes: 0, edges: 0 })
          return
        }
        const cy = cytoscape({
          container: containerRef.current,
          elements: els,
          style: createCytoscapeStyle(themeRef.current),
          layout: layoutConfig(layoutRef.current),
          wheelSensitivity: 0.2,
        })
        cy.on('tap', 'node', (ev) => {
          const id = ev.target.id() as string
          // In path mode the first/second tap pick the path endpoints;
          // the handler returns true to swallow the tap. Otherwise fall
          // through to the normal inspector-select behaviour.
          if (pathTapRef.current(id)) return
          const data = ev.target.data() as Record<string, unknown>
          setSelected({ kind: 'node', data })
        })
        cy.on('tap', 'edge', (ev) => {
          const data = ev.target.data() as Record<string, unknown>
          setSelected({ kind: 'edge', data })
        })
        cy.on('tap', (ev) => {
          if (ev.target === cy) setSelected(null)
        })
        cyRef.current = cy
        applyLabels(cy, nodePrefsRef.current, edgePrefsRef.current)
        applySelectionMode(cy, selectionModeRef.current)
        setCounts({ nodes: cy.nodes().length, edges: cy.edges().length })
        // Re-apply pinned-node bookkeeping against the fresh core —
        // Cytoscape doesn't carry `locked` state across teardown/rebuild.
        reapplyPins?.()
      } catch (e: unknown) {
        // GAP-04: surface the failure as a visible banner instead of an
        // uncaught console rejection.
        const buildErr = e instanceof Error ? e.message : String(e)
        setError(t('graph.errorBanner', { message: buildErr }))
      }
    }

    const timer = setTimeout(build, REBUILD_DEBOUNCE_MS)

    return () => {
      canceled = true
      clearTimeout(timer)
      if (cyRef.current) {
        cyRef.current.destroy()
        cyRef.current = null
      }
    }
    // The other deps are refs (stable) or setters (stable). sig is the
    // real trigger; everything else is read at fire time.
  }, [sig])

  // Re-apply labels when preferences change. This does NOT rebuild
  // the core or run the layout — it just rewrites data.label.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    applyLabels(cy, nodeLabelPrefs, edgeLabelPrefs)
  }, [cyRef, nodeLabelPrefs, edgeLabelPrefs])

  // Live theme swap: rebuild the stylesheet when light↔dark flips. No
  // layout rerun — Cytoscape recomputes node fills / labels / edges
  // from the new tokens against existing positions.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.style(createCytoscapeStyle(theme)).update()
  }, [cyRef, theme])

  // Re-run the layout when the user picks a different one. We do NOT
  // tear down the core; .layout().run() re-positions in place.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.layout(layoutConfig(layout)).run()
    cy.fit(undefined, 24)
    // Defensive: re-apply pins after a layout switch. Cytoscape keeps
    // `locked` across .layout().run() on the same core, so this is
    // typically a no-op — but it's a cheap idempotent guard and keeps
    // the .gv-pinned class glued to its node.
    reapplyPins?.()
  }, [cyRef, layout, reapplyPins])

  // Canvas interaction-mode changes — cheap; just flips two cy flags.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    applySelectionMode(cy, selectionMode)
  }, [cyRef, selectionMode])

  // Visibility filter changes — re-run the apply pass.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    applyVisibility(cy, hiddenLabels)
  }, [cyRef, hiddenLabels])

  // Phase-2 per-node hide set — idempotent backstop so the `hidden` set
  // remains the source of truth.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.batch(() => {
      hidden.forEach((nodeId) => {
        cy.getElementById(nodeId).addClass('hidden-node')
      })
    })
  }, [cyRef, hidden])

  // Selected element changes — drive the 1-hop emphasis styling.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    applyEmphasis(cy, selected)
  }, [cyRef, selected])

  // ResizeObserver: re-fit when the canvas box changes size. Guarded
  // for jsdom (no-op stub from polyfills.js, so the observer simply
  // never fires there — those tests assert on markup, not on cy.fit).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return undefined
    if (typeof ResizeObserver === 'undefined') return undefined
    let raf = 0
    const refit = (): void => {
      raf = 0
      const cy = cyRef.current
      if (!cy) return
      cy.resize()
      cy.fit(undefined, 24)
    }
    const schedule = (): void => {
      if (typeof requestAnimationFrame !== 'function') {
        refit()
        return
      }
      if (raf) return
      raf = requestAnimationFrame(refit)
    }
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    return () => {
      ro.disconnect()
      if (raf && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(raf)
      }
    }
  }, [containerRef, cyRef])
}
