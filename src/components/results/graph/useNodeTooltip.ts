import { useEffect, useState } from 'react'
import type { Core } from 'cytoscape'

export type TooltipTargetData = {
  id: string
  label: string
  props: Record<string, unknown>
}

export type UseNodeTooltipArgs = {
  cyRef: React.MutableRefObject<Core | null>
  sig?: string
}

export type UseNodeTooltipResult = {
  targetData: TooltipTargetData | null
}

// Subscribes to node-level mouseover/mouseout on the live cy core and
// exposes the hovered node's id + label + props as React state. The
// caller renders the actual tooltip body.
export function useNodeTooltip(args: UseNodeTooltipArgs): UseNodeTooltipResult {
  const { cyRef, sig } = args
  const [targetData, setTargetData] = useState<TooltipTargetData | null>(null)

  useEffect(() => {
    const resolveLabel = (raw: unknown): string => {
      if (typeof raw === 'string') return raw
      if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0]
      return ''
    }
    const onEnter = (ev: {
      target: { data: () => Record<string, unknown> }
    }): void => {
      const data = ev.target.data() ?? {}
      const id = data.id != null ? String(data.id) : ''
      const label = resolveLabel(data.label)
      const props =
        data.props &&
        typeof data.props === 'object' &&
        !Array.isArray(data.props)
          ? (data.props as Record<string, unknown>)
          : {}
      setTargetData({ id, label, props })
    }
    const onLeave = (): void => setTargetData(null)

    // useGraphCytoscape's rebuild is debounced via setTimeout, so when
    // sig changes this effect runs BEFORE the new cy is constructed and
    // cyRef.current is null. Poll until cy is mounted (or the effect is
    // torn down) so the mouseover/mouseout listeners always bind to the
    // live core.
    let bound: { cy: Core } | null = null
    let cancelled = false
    const tryBind = (): void => {
      if (cancelled || bound) return
      const cy = cyRef.current
      if (!cy) {
        setTimeout(tryBind, 50)
        return
      }
      cy.on('mouseover', 'node', onEnter as never)
      cy.on('mouseout', 'node', onLeave as never)
      bound = { cy }
    }
    tryBind()
    return () => {
      cancelled = true
      if (bound) {
        try {
          bound.cy.off('mouseover', 'node', onEnter as never)
          bound.cy.off('mouseout', 'node', onLeave as never)
        } catch {
          // cy may already be destroyed; off() is best-effort.
        }
      }
    }
  }, [cyRef, sig])

  return { targetData }
}
