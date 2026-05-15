import { useCallback, useState } from 'react'
import type { Core } from 'cytoscape'

export type UsePinnedNodesArgs = {
  cyRef: React.MutableRefObject<Core | null>
}

export type UsePinnedNodesResult = {
  // Read-only Set of pinned ids. Treat as immutable; use togglePin/clear.
  pinned: Set<string>
  isPinned: (id: string) => boolean
  togglePin: (id: string) => void
  clear: () => void
  // Re-apply every pinned id on the current cy core. Used after a
  // rebuild — Cytoscape persists `locked` across .layout().run() calls
  // on the same core, but a fresh core has no memory of it. The
  // orchestrator hands this callback to useGraphCytoscape so it fires
  // on rebuild and on layout-rerun.
  reapplyAll: () => void
}

const PINNED_CLASS = 'gv-pinned'

export function usePinnedNodes(args: UsePinnedNodesArgs): UsePinnedNodesResult {
  const { cyRef } = args
  const [pinned, setPinned] = useState<Set<string>>(new Set())

  const apply = useCallback(
    (id: string, on: boolean): void => {
      const cy = cyRef.current
      if (!cy) return
      const node = cy.getElementById(id)
      if (node.empty()) return
      if (on) {
        node.lock()
        node.addClass(PINNED_CLASS)
      } else {
        node.unlock()
        node.removeClass(PINNED_CLASS)
      }
    },
    [cyRef]
  )

  const togglePin = useCallback(
    (id: string): void => {
      setPinned((prev) => {
        const next = new Set(prev)
        const on = !next.has(id)
        if (on) next.add(id)
        else next.delete(id)
        apply(id, on)
        return next
      })
    },
    [apply]
  )

  const clear = useCallback((): void => {
    setPinned((prev) => {
      prev.forEach((id) => apply(id, false))
      return new Set()
    })
  }, [apply])

  const reapplyAll = useCallback((): void => {
    setPinned((prev) => {
      prev.forEach((id) => apply(id, true))
      return prev
    })
  }, [apply])

  return {
    pinned,
    isPinned: (id) => pinned.has(id),
    togglePin,
    clear,
    reapplyAll,
  }
}
