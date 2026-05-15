import type { Core } from 'cytoscape'

// Breadth-first walk from `id` out to `hops` hops, returning every
// reachable node id (including the start). Used by useFocusMode to
// drive the N-hop dim-the-rest behaviour around a focal node.
//
// hops <= 0 → returns {id} (the start node only). When the start node
// doesn't exist in cy, returns an empty Set.
export function nHopNeighborhood(
  cy: Core,
  id: string,
  hops: number
): Set<string> {
  const visited = new Set<string>()
  const start = cy.getElementById(id)
  if (start.empty()) return visited
  visited.add(id)
  let frontier: string[] = [id]
  const max = Math.max(0, hops)
  for (let i = 0; i < max; i += 1) {
    const next: string[] = []
    frontier.forEach((cur) => {
      const node = cy.getElementById(cur)
      node
        .neighborhood()
        .nodes()
        .forEach((n) => {
          const nid = n.id()
          if (!visited.has(nid)) {
            visited.add(nid)
            next.push(nid)
          }
        })
    })
    if (next.length === 0) break
    frontier = next
  }
  return visited
}
