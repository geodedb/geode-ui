import { useCallback, useEffect, useState } from 'react'
import type { Core } from 'cytoscape'

export type NodeMenuState = {
  open: boolean
  // Page coordinates so the menu portal can `position: fixed` cleanly.
  x: number
  y: number
  nodeId: string | null
}

export type UseNodeContextMenuArgs = {
  cyRef: React.MutableRefObject<Core | null>
  enabled: boolean
  // Rebuild key — the orchestrator's `sig`. Including this in the
  // effect's deps forces re-subscription when the cy core is rebuilt
  // (cyRef is a ref object whose identity is stable across rebuilds, so
  // it alone won't trigger a re-effect).
  sig?: string
}

export type UseNodeContextMenuResult = {
  state: NodeMenuState
  close: () => void
}

const CLOSED: NodeMenuState = { open: false, x: 0, y: 0, nodeId: null }

export function useNodeContextMenu(
  args: UseNodeContextMenuArgs
): UseNodeContextMenuResult {
  const { cyRef, enabled, sig } = args
  const [state, setState] = useState<NodeMenuState>(CLOSED)

  useEffect(() => {
    if (!enabled) return undefined
    const cy = cyRef.current
    if (!cy) return undefined

    const open = (ev: {
      target: { id: () => string }
      renderedPosition: { x: number; y: number }
      originalEvent?: {
        clientX?: number
        clientY?: number
        preventDefault?: () => void
      }
    }): void => {
      const id = ev.target.id()
      const orig = ev.originalEvent
      const x = orig?.clientX ?? ev.renderedPosition.x
      const y = orig?.clientY ?? ev.renderedPosition.y
      if (orig?.preventDefault) orig.preventDefault()
      setState({ open: true, x, y, nodeId: id })
    }

    // cxttap = canvas right-click on an element. taphold = long-press
    // (touch or mouse). Both route through the same `open` handler.
    cy.on('cxttap', 'node', open as never)
    cy.on('taphold', 'node', open as never)
    // A normal tap on background closes the menu — same gesture model
    // as background-tap clearing selection.
    const closeOnBg = (ev: { target: unknown }): void => {
      if (ev.target === cy) setState(CLOSED)
    }
    cy.on('tap', closeOnBg as never)

    return () => {
      cy.off('cxttap', 'node', open as never)
      cy.off('taphold', 'node', open as never)
      cy.off('tap', closeOnBg as never)
    }
  }, [cyRef, enabled, sig])

  const close = useCallback(() => setState(CLOSED), [])
  return { state, close }
}
