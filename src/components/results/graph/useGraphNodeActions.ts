// useGraphNodeActions — the seven node-action callbacks the radial
// context menu (and adjacent entry points) wire into.
//
// Each handler closes over the orchestrator's hook state but the bodies
// are pure routing: zoom, expand-popover open, hide/collapse delegation,
// focus-mode entry, pin toggle, clipboard copy. Keeping them as a hook
// (rather than inline closures inside GraphViewCytoscape) lets the
// orchestrator pass a single bag to useCxtMenu without polluting its
// own render scope, and lets unit tests target the handler shape
// directly. QUALITY #164.

import { useCallback } from 'react'
import type { Core } from 'cytoscape'
import { zoomToNode } from './zoomToNode'

export type GraphNodeActionHandlers = {
  onZoomTo: (id: string) => void
  onExpand: (id: string) => void
  onHide: (id: string) => void
  onCollapse: (id: string) => void
  onFocus: (id: string) => void
  onPin: (id: string) => void
  onCopyId: (id: string) => void
}

export function useGraphNodeActions(opts: {
  cyRef: React.RefObject<Core | null>
  setExpandFor: (id: string | null) => void
  onHideNode: (id: string) => void
  onCollapseNode: (id: string) => void
  focusMode: { focus: (target: { id: string; hops: number }) => void }
  focusHops: number
  pinning: { togglePin: (id: string) => void }
}): GraphNodeActionHandlers {
  const {
    cyRef,
    setExpandFor,
    onHideNode,
    onCollapseNode,
    focusMode,
    focusHops,
    pinning,
  } = opts

  const onZoomTo = useCallback(
    (id: string): void => {
      if (cyRef.current) zoomToNode(cyRef.current, id)
    },
    [cyRef]
  )
  const onExpand = useCallback(
    (id: string): void => {
      // Open the configurable popover. The user's chosen
      // direction / labelFilter / limit is forwarded to
      // onExploreNeighbours via the orchestrator's onExpandRun.
      setExpandFor(id)
    },
    [setExpandFor]
  )
  const onHide = useCallback(
    (id: string): void => {
      onHideNode(id)
    },
    [onHideNode]
  )
  const onCollapse = useCallback(
    (id: string): void => {
      onCollapseNode(id)
    },
    [onCollapseNode]
  )
  const onFocus = useCallback(
    (id: string): void => {
      focusMode.focus({ id, hops: focusHops })
    },
    [focusMode, focusHops]
  )
  const onPin = useCallback(
    (id: string): void => {
      pinning.togglePin(id)
    },
    [pinning]
  )
  const onCopyId = useCallback((id: string): void => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(id).catch(() => {})
    }
  }, [])

  return { onZoomTo, onExpand, onHide, onCollapse, onFocus, onPin, onCopyId }
}
