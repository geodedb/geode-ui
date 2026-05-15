import { useEffect, useRef, useState } from 'react'
import type { Core } from 'cytoscape'

export type Badge =
  | { kind: 'pin'; nodeId: string; x: number; y: number }
  | { kind: 'collapsed'; nodeId: string; count: number; x: number; y: number }

export type UseGraphBadgesArgs = {
  cyRef: React.MutableRefObject<Core | null>
  pinned: Set<string>
  collapsed: Map<string, string[]>
  sig?: string
}

// Compute badge positions from the live cy core. Subscribes to
// viewport / pan / zoom / render so badges track the camera without
// React render churn (a RAF token coalesces bursts).
//
// pinned + collapsed are passed in by reference but their identities
// churn on every parent render. We hold them via refs inside the
// effect and gate effect-restart on a CONTENT signature of their
// values instead of the Set/Map identities. Otherwise: render →
// effect → setState → render with fresh Set/Map → effect re-runs
// → infinite loop.
export function useGraphBadges(args: UseGraphBadgesArgs): Badge[] {
  const { cyRef, pinned, collapsed, sig } = args
  const [badges, setBadges] = useState<Badge[]>([])
  const rafRef = useRef<number>(0)
  const pinnedRef = useRef(pinned)
  pinnedRef.current = pinned
  const collapsedRef = useRef(collapsed)
  collapsedRef.current = collapsed

  // Content signature — recomputed on every render but a content-equal
  // string is dep-equal to React. Cheap because pinned/collapsed are
  // small (typical: <20 ids).
  const pinPart = Array.from(pinned).sort().join(',')
  const colPart = Array.from(collapsed.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v.length}`)
    .join(',')
  const badgesSig = `${pinPart}|${colPart}`

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) {
      setBadges([])
      return undefined
    }

    const compute = (): Badge[] => {
      const out: Badge[] = []
      pinnedRef.current.forEach((id) => {
        const n = cy.getElementById(id)
        if (n.empty()) return
        const pos = n.renderedPosition()
        const h = n.renderedHeight()
        out.push({ kind: 'pin', nodeId: id, x: pos.x, y: pos.y - h / 2 })
      })
      collapsedRef.current.forEach((leaves, id) => {
        if (leaves.length === 0) return
        const n = cy.getElementById(id)
        if (n.empty()) return
        const pos = n.renderedPosition()
        const h = n.renderedHeight()
        out.push({
          kind: 'collapsed',
          nodeId: id,
          count: leaves.length,
          x: pos.x,
          y: pos.y + h / 2,
        })
      })
      return out
    }

    const flush = (): void => {
      rafRef.current = 0
      setBadges(compute())
    }
    const schedule = (): void => {
      if (rafRef.current !== 0) return
      if (typeof requestAnimationFrame !== 'function') {
        flush()
        return
      }
      rafRef.current = requestAnimationFrame(flush)
    }

    setBadges(compute())
    cy.on('viewport pan zoom render', schedule)
    return () => {
      cy.off('viewport pan zoom render', schedule)
      if (rafRef.current !== 0 && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
    }
  }, [cyRef, sig, badgesSig])

  return badges
}
