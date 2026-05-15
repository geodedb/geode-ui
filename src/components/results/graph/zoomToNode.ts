import type { Core } from 'cytoscape'

export type ZoomToNodeOpts = {
  // Target zoom level. 1 is the default cy.zoom(); 1.5 is a nice
  // "close enough to see the labels" framing for typical graphs.
  zoom?: number
  // Animation duration in ms.
  duration?: number
}

const DEFAULTS: Required<ZoomToNodeOpts> = {
  zoom: 1.5,
  duration: 400,
}

// Animate the viewport to center on `id` at the requested zoom level.
// No-op when the node does not exist on the current core (the caller
// is responsible for selection-state plumbing — this helper only owns
// the camera move).
export function zoomToNode(cy: Core, id: string, opts?: ZoomToNodeOpts): void {
  const node = cy.getElementById(id)
  if (node.empty()) return
  const { zoom, duration } = { ...DEFAULTS, ...(opts ?? {}) }
  cy.animate({
    center: { eles: node },
    zoom,
    duration,
    easing: 'ease-in-out',
  })
}
