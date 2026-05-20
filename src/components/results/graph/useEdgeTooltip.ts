import { useEffect, useState } from 'react'
import type { Core } from 'cytoscape'

import type { TooltipTargetData } from './useNodeTooltip'

// GAP-059: edge counterpart to useNodeTooltip. Pre-fix the SPA bound
// mouseover / mouseout to `'node'` only, so edges had no hover surface
// at all — a user expecting parity with the node tooltip ("hover an
// edge to preview its type + props") saw nothing happen. This hook
// mirrors useNodeTooltip's contract verbatim so the existing
// GraphTooltip / GraphCanvasOverlay rendering path can render both
// kinds through the same TooltipTargetData shape.
//
// The label resolution differs subtly from the node version: edges
// carry `data.type` (the relationship type, e.g. "ACTED_IN"), while
// nodes carry `data.label`. We surface whichever the element has, so
// the tooltip shows ":ACTED_IN" for an edge and "Person" for a node.
export type UseEdgeTooltipArgs = {
  cyRef: React.MutableRefObject<Core | null>
  sig?: string
}
export type UseEdgeTooltipResult = {
  targetData: TooltipTargetData | null
}

export function useEdgeTooltip(args: UseEdgeTooltipArgs): UseEdgeTooltipResult {
  const { cyRef, sig } = args
  const [targetData, setTargetData] = useState<TooltipTargetData | null>(null)

  useEffect(() => {
    const resolveLabel = (data: Record<string, unknown>): string => {
      // `data.label` is the cytoscape display string the renderer
      // mutates (applyLabels rewrites it for the operator-picked
      // "Display field"); `data.type` is the IMMUTABLE relationship
      // type stamped by pushRealEdges. Prefer `type` so the tooltip
      // reads ":ACTED_IN" even after the display field has been
      // remapped to a property. Fall back to `label` for synthesised
      // edges that never carried a type.
      const t = data.type
      if (typeof t === 'string' && t) return `:${t}`
      const l = data.label
      if (typeof l === 'string' && l) return l
      return ''
    }

    const onEnter = (ev: {
      target: { data: () => Record<string, unknown> }
    }): void => {
      const data = ev.target.data() ?? {}
      const id = data.id != null ? String(data.id) : ''
      const label = resolveLabel(data)
      const props =
        data.props &&
        typeof data.props === 'object' &&
        !Array.isArray(data.props)
          ? (data.props as Record<string, unknown>)
          : {}
      setTargetData({ id, label, props })
    }
    const onLeave = (): void => setTargetData(null)

    // Same poll-until-cy-mounted pattern useNodeTooltip uses — the
    // cytoscape rebuild is debounced, so when `sig` changes this
    // effect fires BEFORE the new core is constructed.
    let bound: { cy: Core } | null = null
    let cancelled = false
    const tryBind = (): void => {
      if (cancelled || bound) return
      const cy = cyRef.current
      if (!cy) {
        setTimeout(tryBind, 50)
        return
      }
      cy.on('mouseover', 'edge', onEnter as never)
      cy.on('mouseout', 'edge', onLeave as never)
      bound = { cy }
    }
    tryBind()
    return () => {
      cancelled = true
      if (bound) {
        try {
          bound.cy.off('mouseover', 'edge', onEnter as never)
          bound.cy.off('mouseout', 'edge', onLeave as never)
        } catch {
          // cy may already be destroyed; off() is best-effort.
        }
      }
    }
  }, [cyRef, sig])

  return { targetData }
}
