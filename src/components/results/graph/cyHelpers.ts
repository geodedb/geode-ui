import type { Core } from 'cytoscape'
import { resolveEdgeLabel, resolveNodeLabel } from '../../../lib/graphResult'
import type { Selected } from './GraphInspector'
import { nodeLabelOf } from './useGraphElements'

// Apply the canvas interaction mode to a Cytoscape core. 'box' enables
// the built-in box selection (drag-rectangle to multi-select) and turns
// off viewport panning so the drag doesn't fight it; 'pan' restores the
// default (drag-pans, no box select).
export function applySelectionMode(cy: Core, mode: 'pan' | 'box'): void {
  if (mode === 'box') {
    cy.userPanningEnabled(false)
    cy.boxSelectionEnabled(true)
  } else {
    cy.userPanningEnabled(true)
    cy.boxSelectionEnabled(false)
  }
}

// Re-apply the current node-label / edge-type field preferences to a
// live Cytoscape core. Runs inside a single cy.batch so the style
// invalidation only fires once.
export function applyLabels(
  cy: Core,
  nodePrefs: Record<string, string>,
  edgePrefs: Record<string, string>
): void {
  cy.batch(() => {
    cy.nodes().forEach((n) => {
      const label = resolveNodeLabel(
        n.data() as Record<string, unknown>,
        nodePrefs
      )
      n.data('label', label)
    })
    cy.edges().forEach((e) => {
      const label = resolveEdgeLabel(
        e.data() as Record<string, unknown>,
        edgePrefs
      )
      e.data('type', label)
    })
  })
}

// Hide every node whose label-bucket is in `hidden`, and propagate the
// hide to every adjacent edge (so the canvas isn't littered with arrows
// pointing into nothing). Idempotent — calling it twice with the same
// `hidden` set is a no-op.
export function applyVisibility(cy: Core, hidden: Set<string>): void {
  cy.batch(() => {
    cy.nodes().forEach((n) => {
      const data = n.data() as Record<string, unknown>
      const bucket = nodeLabelOf(data)
      if (hidden.has(bucket)) {
        n.addClass('gv-hidden')
      } else {
        n.removeClass('gv-hidden')
      }
    })
    cy.edges().forEach((e) => {
      const src = e.source()
      const tgt = e.target()
      if (src.hasClass('gv-hidden') || tgt.hasClass('gv-hidden')) {
        e.addClass('gv-hidden')
      } else {
        e.removeClass('gv-hidden')
      }
    })
  })
}

// Apply 1-hop neighborhood emphasis around the selected element.
// No-ops the .gv-faded / .gv-emphasized classes when nothing is
// selected so the canvas reads at full saturation by default.
export function applyEmphasis(cy: Core, sel: Selected | null): void {
  cy.batch(() => {
    cy.elements().removeClass('gv-faded').removeClass('gv-emphasized')
    if (!sel) return
    const id = String(sel.data.id ?? '')
    if (!id) return
    const target = cy.$id(id)
    if (target.empty()) return
    const neighborhood =
      sel.kind === 'node'
        ? target.closedNeighborhood()
        : target.union(target.connectedNodes())
    cy.elements().difference(neighborhood).addClass('gv-faded')
    neighborhood.addClass('gv-emphasized')
  })
}

// Streaming-aware row signature. Used by the orchestrator to gate the
// debounced rebuild — two responses with the same row_count + query
// hash to the same value so the rebuild fires once per real change.
export function respSignature(resp: {
  row_count?: number
  rows?: unknown[]
}): number {
  // Stream messages do NOT include row_count until the summary frame; for
  // the streaming case we fall back to rows.length so the signature
  // changes monotonically as rows arrive. Single-shot resps include
  // row_count once and the signature is stable thereafter.
  if (typeof resp.row_count === 'number') return resp.row_count
  return resp.rows ? resp.rows.length : 0
}
