import type { Core, ElementDefinition } from 'cytoscape'

// graphActions — small, mostly-pure helpers that mutate a Cytoscape Core
// for the Phase-2 node-inspector workflow (Hide / Collapse / Restore /
// Explore-neighbours-merge). Each helper takes a `cy: Core`, mutates it,
// and returns the affected element ids so callers (GraphView's state) can
// track what was changed and the unit tests can assert on the effect
// without a full canvas.
//
// "Hidden" is implemented purely via a CSS class — `.hidden-node` →
// `display: none` (added to cytoscapeStyle.ts in Task 2.1). This keeps
// the element in the graph (so a Restore is just a class removal and the
// id index / pickers still resolve it) while taking it out of the render
// and layout passes.

// The class used to visually hide a node (and, transitively, its
// adjacent edges via Cytoscape's display:none-on-an-endpoint behaviour).
export const HIDDEN_CLASS = 'hidden-node'

/**
 * Hide a single node by adding the `.hidden-node` class. Returns `[id]`
 * (always — even if the id resolves to nothing in `cy`, so callers get a
 * stable shape; Cytoscape's getElementById on a missing id yields an
 * empty collection whose addClass is a harmless no-op).
 */
export function hideNode(cy: Core, id: string): string[] {
  cy.getElementById(id).addClass(HIDDEN_CLASS)
  return [id]
}

/**
 * Un-hide a single node — removes the `.hidden-node` class. Idempotent.
 */
export function restoreNode(cy: Core, id: string): void {
  cy.getElementById(id).removeClass(HIDDEN_CLASS)
}

/**
 * Collapse a node's *leaf* neighbours: hide every neighbour that is
 * connected only to this node (degree 1 within the current rendered
 * graph). Does NOT hide the node itself. Returns the ids of the
 * neighbours that were hidden (possibly empty). Caller records the
 * (nodeId → hiddenNeighbourIds) mapping so a later Expand can restore
 * exactly that set.
 *
 * Degree is read via `el.degree()` (Cytoscape includes both incoming and
 * outgoing edges; loops are excluded by passing `false`). A neighbour
 * already carrying `.hidden-node` is skipped — it's already accounted for
 * by a previous hide/collapse, and re-recording it here would make the
 * later Expand un-hide something the user hid by hand.
 */
export function collapseNode(cy: Core, id: string): string[] {
  const node = cy.getElementById(id)
  if (node.empty()) return []
  const hidden: string[] = []
  node
    .neighborhood()
    .nodes()
    .forEach((nb) => {
      if (nb.hasClass(HIDDEN_CLASS)) return
      // degree(false) — exclude self-loops; a leaf is degree 1.
      if (nb.degree(false) !== 1) return
      const nbId = String(nb.data('id') ?? '')
      if (!nbId || nbId === id) return
      nb.addClass(HIDDEN_CLASS)
      hidden.push(nbId)
    })
  return hidden
}

/**
 * Expand a previously-collapsed node: un-hide every id in `ids`
 * (removes `.hidden-node`). Idempotent; ids that aren't in `cy` are
 * harmlessly no-op'd.
 */
export function expandCollapsed(cy: Core, ids: string[]): void {
  ids.forEach((id) => cy.getElementById(id).removeClass(HIDDEN_CLASS))
}

/**
 * Merge a subgraph (the element list `extractElements` produced for an
 * "Explore neighbours" fetch) into `cy`: add only the elements whose
 * `data.id` isn't already present, leaving existing nodes/edges (and
 * their positions / classes) untouched. Returns the ids that were added
 * (empty when the subgraph was wholly contained in the current graph).
 * The caller re-runs the layout afterwards so the new elements get
 * positioned.
 */
export function mergeSubgraph(cy: Core, els: ElementDefinition[]): string[] {
  const toAdd: ElementDefinition[] = []
  const addedIds: string[] = []
  els.forEach((el) => {
    const data = (el.data ?? {}) as { id?: unknown }
    const id = data.id == null ? '' : String(data.id)
    if (!id) return
    if (!cy.getElementById(id).empty()) return
    if (addedIds.includes(id)) return
    toAdd.push(el)
    addedIds.push(id)
  })
  if (toAdd.length > 0) cy.add(toAdd)
  return addedIds
}
