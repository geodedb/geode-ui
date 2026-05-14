import { useCallback, useState } from 'react'
import type { Core } from 'cytoscape'
import { nHopNeighborhood } from './focus'

// useFocusMode dims every node that isn't within `hops` of the focal
// node. State is result-scoped (the focal node id + hops live in
// component state, not the persisted prefs store) — the slider value
// for `hops` is sticky on useGraphPrefs.focusHops, but the chosen focal
// node is not, because it's only meaningful for the current result.
//
// `reapply` is the rebuild-aware hook the orchestrator passes into
// useGraphCytoscape so the dim survives a layout rerun / element
// rebuild — same shape as usePinnedNodes.reapplyAll.
export type FocusState = { id: string; hops: number } | null

export type UseFocusModeArgs = {
  cyRef: React.MutableRefObject<Core | null>
}

export type UseFocusModeResult = {
  state: FocusState
  focus: (s: { id: string; hops: number }) => void
  clear: () => void
  // Re-apply after rebuilds / layout reruns so the dim persists.
  reapply: () => void
}

const FOCUS_CLASS = 'gv-out-of-focus'

export function useFocusMode(args: UseFocusModeArgs): UseFocusModeResult {
  const { cyRef } = args
  const [state, setState] = useState<FocusState>(null)

  const apply = useCallback(
    (s: FocusState): void => {
      const cy = cyRef.current
      if (!cy) return
      cy.batch(() => {
        cy.nodes().forEach((n) => {
          n.removeClass(FOCUS_CLASS)
        })
        if (!s) return
        const keep = nHopNeighborhood(cy, s.id, s.hops)
        cy.nodes().forEach((n) => {
          if (!keep.has(n.id())) n.addClass(FOCUS_CLASS)
        })
      })
    },
    [cyRef]
  )

  const focus = useCallback(
    (s: { id: string; hops: number }): void => {
      setState(s)
      apply(s)
    },
    [apply]
  )
  const clear = useCallback((): void => {
    setState(null)
    apply(null)
  }, [apply])
  const reapply = useCallback((): void => {
    apply(state)
  }, [apply, state])

  return { state, focus, clear, reapply }
}
