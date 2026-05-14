import { useEffect } from 'react'
import cytoscape, { Core } from 'cytoscape'
import domNode from 'cytoscape-dom-node'

cytoscape.use(domNode as unknown as cytoscape.Ext)

type CoreWithDomNode = Core & {
  domNode: (opts?: unknown) => void
}

export type UseDomNodesArgs = {
  cyRef: React.MutableRefObject<Core | null>
  enabled: boolean
  // renderNode is invoked per node when the toggle flips on. Returns
  // an HTMLElement that cytoscape-dom-node positions on the canvas.
  // The orchestrator owns the React root lifecycle — this hook just
  // stamps the element into the data bag.
  renderNode: (data: Record<string, unknown>) => HTMLElement
  sig?: string
}

// useDomNodes initializes cytoscape-dom-node on the live core when
// `enabled` is true and stamps a DOM element on every node's data bag
// under the `dom` key. cytoscape-dom-node reads `data.dom` per node.
// No-op when disabled or when cy isn't mounted yet.
export function useDomNodes(args: UseDomNodesArgs): void {
  const { cyRef, enabled, renderNode, sig } = args
  useEffect(() => {
    const cy = cyRef.current as CoreWithDomNode | null
    if (!cy) return undefined
    if (!enabled) return undefined
    if (typeof cy.domNode !== 'function') return undefined

    cy.domNode()
    cy.nodes().forEach((n) => {
      const data = n.data() as Record<string, unknown>
      const el = renderNode(data)
      n.data('dom', el)
    })
    return undefined
  }, [cyRef, enabled, renderNode, sig])
}
