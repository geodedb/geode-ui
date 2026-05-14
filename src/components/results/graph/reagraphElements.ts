import type { ElementDefinition } from 'cytoscape'
import { labelToColor } from '../cytoscapeStyle'

// Minimal reagraph element shapes. We intentionally keep these to the
// fields GraphViewReagraph actually reads in Phase 0 — `id` + `label`
// for display, `fill` for theme parity, and `data` so downstream
// selection / inspector code can recover the original cytoscape data
// bag. Full type parity (size, icons, subLabel, etc.) lands in P3 with
// the custom-node-overlay port.
export type ReagraphNode = {
  id: string
  label: string
  fill: string
  data: Record<string, unknown>
}

export type ReagraphEdge = {
  id: string
  source: string
  target: string
  label?: string
}

// Project a cytoscape element-set (the shape `useGraphElements`
// produces) into the flat `{nodes, edges}` reagraph wants. The
// `variant` argument is the active theme variant ('light' | 'dark')
// so labelToColor returns the right palette entry.
//
// Defensive on input: an element with an empty/missing id is dropped
// rather than rendered as an orphan, and an edge with a missing source
// or target is treated the same way. Label arrays (Neo4j multi-label)
// collapse to the first string entry so node-coloring is deterministic.
export function toReagraphElements(
  elements: ElementDefinition[],
  variant: 'light' | 'dark'
): { nodes: ReagraphNode[]; edges: ReagraphEdge[] } {
  const nodes: ReagraphNode[] = []
  const edges: ReagraphEdge[] = []
  elements.forEach((el) => {
    const data = el.data ?? {}
    const id = data.id != null ? String(data.id) : ''
    if (!id) return
    const source = data.source != null ? String(data.source) : ''
    const target = data.target != null ? String(data.target) : ''
    if (source && target) {
      const typeRaw = data.type ?? data.label
      const label = typeof typeRaw === 'string' ? typeRaw : undefined
      edges.push({ id, source, target, label })
      return
    }
    const labelField = data.label
    let label = ''
    if (typeof labelField === 'string') {
      label = labelField
    } else if (Array.isArray(labelField) && typeof labelField[0] === 'string') {
      label = labelField[0]
    }
    nodes.push({
      id,
      label,
      fill: labelToColor(label, variant),
      data,
    })
  })
  return { nodes, edges }
}
