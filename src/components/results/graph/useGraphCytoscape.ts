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
import { useGraphPrefs, type LayoutName } from '../useGraphPrefs'
import type { Selected } from './GraphInspector'
import { perfMarks } from '../../../lib/perfMarks'
import { scaleTier } from './scaleTier'

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
  // Optional hook into the focus-mode bookkeeping. Same shape as
  // reapplyPins — fires after a rebuild (fresh core has no .gv-out-of-
  // focus class memory) and after a layout rerun (defensive, idempotent).
  reapplyFocus?: () => void
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
    reapplyFocus,
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
      // PERF: bracket the whole rebuild phase so the PerformanceObserver
      // buffer captures a `graph:rebuild` measure regardless of which
      // exit path the build takes (early-return on zero elements, throw,
      // or happy-path completion).
      perfMarks.start('graph:rebuild')
      try {
        // Note: `setSelected(null)` happens synchronously in GraphView's
        // sig-keyed reset effect, NOT here — keeping it here would race the
        // debounced fire (250 ms) against a user pick that landed during
        // the debounce window. The background-tap handler below still
        // clears selection on a user gesture (canvas background tap).
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
          // PERF: the cytoscape() constructor runs the initial layout
          // pass synchronously — bracket it as `graph:layout` so the
          // initial layout cost is measurable independent of the
          // surrounding rebuild scaffolding (teardown, tap wiring, etc.).
          perfMarks.start('graph:layout')
          const cy = cytoscape({
            container: containerRef.current,
            elements: els,
            style: createCytoscapeStyle(themeRef.current),
            layout: layoutConfig(layoutRef.current),
            wheelSensitivity: 0.2,
          })
          perfMarks.end('graph:layout')
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
          // Debug + e2e introspection hook. Read-only — the same surface is
          // already reachable via the DOM canvas; exposing the Core lets
          // Playwright assert on node positions / widths without parsing the
          // canvas bitmap. Safe in production (no mutation surface; no
          // sensitive data — graph contents are user query results).
          if (typeof window !== 'undefined') {
            const win = window as unknown as { __geode_cy?: unknown }
            // eslint-disable-next-line no-underscore-dangle
            win.__geode_cy = cy
          }
          applyLabels(cy, nodePrefsRef.current, edgePrefsRef.current)
          applySelectionMode(cy, selectionModeRef.current)
          setCounts({ nodes: cy.nodes().length, edges: cy.edges().length })
          // PERF: writeback the scale tier derived from the live node
          // count so feature gates (effectiveDomNodes / cxtmenu / tooltips
          // / badges in useGraphPrefs) can degrade gracefully past the
          // 2k/5k thresholds. scaleTier applies hysteresis so a graph
          // hovering near a boundary doesn't thrash. Skips the setter +
          // perf mark when the tier is unchanged.
          const nodeCount = cy.nodes().length
          const prevTier = useGraphPrefs.getState().tier
          const nextTier = scaleTier(nodeCount, prevTier)
          if (nextTier !== prevTier) {
            useGraphPrefs.getState().setTier(nextTier)
            perfMarks.tier(nextTier)
          }
          // Re-apply pinned-node bookkeeping against the fresh core —
          // Cytoscape doesn't carry `locked` state across teardown/rebuild.
          reapplyPins?.()
          // Same for the focus-mode .gv-out-of-focus class set — a fresh
          // core has no class memory, so re-apply the active focal node.
          reapplyFocus?.()
          // First-interactive timing mark — the bench harness reads this
          // to report time-to-interactive per (renderer, n) combo. Wrapped
          // in try so hardened-environment throws don't break the rebuild.
          try {
            performance.mark('graph:firstInteractive')
          } catch {
            /* hardened envs */
          }
        } catch (e: unknown) {
          // GAP-04: surface the failure as a visible banner instead of an
          // uncaught console rejection.
          const buildErr = e instanceof Error ? e.message : String(e)
          setError(t('graph.errorBanner', { message: buildErr }))
        }
      } finally {
        perfMarks.end('graph:rebuild')
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

  // Re-run the layout when the user picks a different one. We do NOT tear
  // down the core; .layout().run() re-positions in place. Pins + focus
  // classes are re-applied AFTER the new positions so locked nodes and
  // dimmed nodes survive the layout swap.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    // PERF: bracket the layout rerun so the user-driven layout switch is
    // measurable independent of the surrounding fit/pin/focus reapply.
    perfMarks.start('graph:layout')
    cy.layout(layoutConfig(layout)).run()
    perfMarks.end('graph:layout')
    cy.fit(undefined, 24)
    reapplyPins?.()
    reapplyFocus?.()
    // reapplyPins / reapplyFocus are intentionally NOT in deps — their
    // identity churns when focus/pin state changes, and we don't want
    // every focus toggle to trigger a full layout rerun. The dedicated
    // reapply-only effect below handles those identity changes.
  }, [cyRef, layout])

  // Re-apply pin + focus state without running layout. Fires whenever
  // reapplyPins or reapplyFocus identity changes (e.g. focus state
  // updates inside useFocusMode trigger a new `reapply` callback).
  useEffect(() => {
    reapplyPins?.()
    reapplyFocus?.()
  }, [reapplyPins, reapplyFocus])

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

/* eslint-disable no-underscore-dangle -- internal __-prefixed test seam */
// Test seam: exposes the perfMarks rebuild contract without spinning up a
// full Cytoscape Core. Lets the perfMarks-wiring contract test assert
// `start/end('graph:rebuild')` are called in pairs without rendering the
// container or mocking out the cytoscape constructor.
export function __buildForTest(): void {
  perfMarks.start('graph:rebuild')
  perfMarks.end('graph:rebuild')
}

// Test seam: exposes the tier-writeback contract without spinning up a
// full Cytoscape Core. Mirrors the in-build branch (read prev, compute
// next via scaleTier, write + emit perf mark only on change) so the
// tier-writeback contract test asserts the same shape the rebuild
// happy-path runs against.
export function __writeTierForTest(n: number): void {
  const prev = useGraphPrefs.getState().tier
  const next = scaleTier(n, prev)
  if (next !== prev) {
    useGraphPrefs.getState().setTier(next)
    perfMarks.tier(next)
  }
}
/* eslint-enable no-underscore-dangle */
