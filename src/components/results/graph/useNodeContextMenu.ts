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
    const closeOnBg = (ev: { target: unknown }): void => {
      const cy = cyRef.current
      if (ev.target === cy) setState(CLOSED)
    }

    // useGraphCytoscape's rebuild is debounced via setTimeout, so when
    // sig changes our effect runs BEFORE the new cy is constructed and
    // cyRef.current is null. A simple !cyRef.current return-early would
    // miss the cxttap/taphold subscription forever. Poll instead until
    // cy is mounted (or the effect is torn down).
    let bound: { cy: import('cytoscape').Core } | null = null
    let cancelled = false
    const tryBind = (): void => {
      if (cancelled || bound) return
      const cy = cyRef.current
      if (!cy) {
        // Re-check after the debounced build is likely to have run.
        setTimeout(tryBind, 50)
        return
      }
      // cxttap = canvas right-click on an element. taphold = long-press
      // (touch or mouse). Both route through the same `open` handler.
      cy.on('cxttap', 'node', open as never)
      cy.on('taphold', 'node', open as never)
      // A normal tap on background closes the menu — same gesture model
      // as background-tap clearing selection.
      cy.on('tap', closeOnBg as never)
      bound = { cy }
    }
    tryBind()

    return () => {
      cancelled = true
      if (bound) {
        try {
          bound.cy.off('cxttap', 'node', open as never)
          bound.cy.off('taphold', 'node', open as never)
          bound.cy.off('tap', closeOnBg as never)
        } catch {
          // cy may already be destroyed; off() is best-effort.
        }
      }
    }
  }, [cyRef, enabled, sig])

  const close = useCallback(() => setState(CLOSED), [])
  return { state, close }
}
