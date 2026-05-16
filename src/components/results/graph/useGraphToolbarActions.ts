// useGraphToolbarActions — the small bag of toolbar action callbacks
// (zoom in/out, fit, reset view, selection-mode toggle, cluster toggle).
//
// Each one closes over the live cy core / sticky-prefs setters; the
// individual bodies are tiny, but pulling them out of the orchestrator
// keeps the GraphViewCytoscape render scope focused on the JSX wiring.
// QUALITY #164.

import { useCallback } from 'react'
import type { Core } from 'cytoscape'
import { layoutConfig } from './layouts'
import type { Selected } from './GraphInspector'

export type GraphLayoutSetter = (l: string) => void

export type GraphToolbarActions = {
  onToggleSelectionMode: () => void
  onToggleClusterByLabel: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  onResetView: () => void
}

export function useGraphToolbarActions(opts: {
  cyRef: React.RefObject<Core | null>
  selectionMode: 'pan' | 'box'
  setSelectionMode: (m: 'pan' | 'box') => void
  clusterByLabel: boolean
  setClusterByLabel: (v: boolean) => void
  layout: string
  setLayout: GraphLayoutSetter
  setSelected: (s: Selected | null) => void
  setHiddenLabels: (s: Set<string>) => void
}): GraphToolbarActions {
  const {
    cyRef,
    selectionMode,
    setSelectionMode,
    clusterByLabel,
    setClusterByLabel,
    layout,
    setLayout,
    setSelected,
    setHiddenLabels,
  } = opts

  const onToggleSelectionMode = useCallback((): void => {
    setSelectionMode(selectionMode === 'box' ? 'pan' : 'box')
  }, [selectionMode, setSelectionMode])

  const onToggleClusterByLabel = useCallback((): void => {
    const next = !clusterByLabel
    setClusterByLabel(next)
    // Clustering ON auto-picks fcose (best for compound graphs); off
    // doesn't force a layout change, so a manual pick is respected.
    if (next) setLayout('fcose')
  }, [clusterByLabel, setClusterByLabel, setLayout])

  const onZoomIn = useCallback((): void => {
    const cy = cyRef.current
    if (!cy) return
    cy.zoom({
      level: cy.zoom() * 1.25,
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    })
  }, [cyRef])

  const onZoomOut = useCallback((): void => {
    const cy = cyRef.current
    if (!cy) return
    cy.zoom({
      level: cy.zoom() / 1.25,
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    })
  }, [cyRef])

  const onFit = useCallback((): void => {
    cyRef.current?.fit(undefined, 24)
  }, [cyRef])

  const onResetView = useCallback((): void => {
    const cy = cyRef.current
    if (!cy) return
    setSelected(null)
    setHiddenLabels(new Set())
    cy.layout(layoutConfig(layout)).run()
    cy.fit(undefined, 24)
  }, [cyRef, layout, setHiddenLabels, setSelected])

  return {
    onToggleSelectionMode,
    onToggleClusterByLabel,
    onZoomIn,
    onZoomOut,
    onFit,
    onResetView,
  }
}
