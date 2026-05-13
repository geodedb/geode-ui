import type { ElementDefinition } from 'cytoscape'

// Pixel bounds for degree-based sizing. The default Cytoscape style
// (cytoscapeStyle.ts) used a flat width/height of 38; degree sizing
// extends that to 28–72 so isolated nodes shrink visibly and hubs grow
// visibly without becoming the whole canvas.
export const MIN_NODE_SIZE = 28
export const MAX_NODE_SIZE = 72
// Log scale tuned so each 10x degree adds STEP pixels — gives a roughly
// constant visual step between degree=1, 10, 100, etc. (the contract the
// log-scaling spec asserts). Degree 0 is handled separately so isolated
// nodes pin to MIN_NODE_SIZE rather than diverging from log10(0).
const STEP = 12
// Pixel offset added to MIN_NODE_SIZE at degree=1, so single-edge nodes
// already grow visibly above the isolated minimum.
const BASE_OFFSET = 4

export function computeDegrees(
  elements: readonly ElementDefinition[]
): Map<string, number> {
  // First pass: collect node ids so we can ignore dangling edge endpoints.
  const nodeIds = new Set<string>()
  elements.forEach((el) => {
    const d = el.data as Record<string, unknown> | undefined
    if (!d || d.id == null) return
    const isEdge = d.source !== undefined && d.target !== undefined
    if (!isEdge) nodeIds.add(String(d.id))
  })
  const out = new Map<string, number>()
  nodeIds.forEach((id) => out.set(id, 0))
  // Second pass: count each edge endpoint that points at a known node.
  elements.forEach((el) => {
    const d = el.data as Record<string, unknown> | undefined
    if (!d) return
    const src = d.source != null ? String(d.source) : undefined
    const tgt = d.target != null ? String(d.target) : undefined
    if (!src || !tgt) return
    if (nodeIds.has(src)) out.set(src, (out.get(src) ?? 0) + 1)
    if (nodeIds.has(tgt)) out.set(tgt, (out.get(tgt) ?? 0) + 1)
  })
  return out
}

export function degreeToSize(degree: number): number {
  const d = Math.max(0, degree)
  if (d === 0) return MIN_NODE_SIZE
  const px = MIN_NODE_SIZE + BASE_OFFSET + STEP * Math.log10(d)
  return Math.min(MAX_NODE_SIZE, Math.round(px))
}
