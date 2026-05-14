import { useCallback, useState } from 'react'
import type { Core } from 'cytoscape'
import { nHopNeighborhood } from './focus'

export type FocusState = {
  id: string
  hops: number
  // Camera state captured at focus-on so clear() restores
  // exactly the user's pre-focus viewport.
  prevPan: { x: number; y: number }
  prevZoom: number
} | null

export type UseFocusModeArgs = {
  cyRef: React.MutableRefObject<Core | null>
}

export type UseFocusModeResult = {
  state: FocusState
  focus: (s: { id: string; hops: number }) => void
  clear: () => void
  // Re-apply after rebuilds / layout reruns so the hide + camera
  // survive a new core.
  reapply: () => void
}

const FOCUS_CLASS = 'gv-out-of-focus'
const FIT_PADDING = 32

export function useFocusMode(args: UseFocusModeArgs): UseFocusModeResult {
  const { cyRef } = args
  const [state, setState] = useState<FocusState>(null)

  // applyHide owns the class-mutation pass. Returns the keep-set so
  // callers can fit() to it.
  const applyHide = useCallback(
    (s: { id: string; hops: number } | null): Set<string> | null => {
      const cy = cyRef.current
      if (!cy) return null
      let keep: Set<string> | null = null
      cy.batch(() => {
        cy.nodes().forEach((n) => {
          n.removeClass(FOCUS_CLASS)
        })
        if (!s) return
        keep = nHopNeighborhood(cy, s.id, s.hops)
        cy.nodes().forEach((n) => {
          if (!keep!.has(n.id())) n.addClass(FOCUS_CLASS)
        })
      })
      return keep
    },
    [cyRef]
  )

  // Fit the camera onto the keep-set with padding. No-op when keep
  // is empty or null.
  const fitToKeep = useCallback(
    (keep: Set<string> | null): void => {
      const cy = cyRef.current
      if (!cy || !keep || keep.size === 0) return
      const keepEls = cy.elements().filter((e) => keep.has(e.id()))
      cy.fit(keepEls, FIT_PADDING)
    },
    [cyRef]
  )

  const focus = useCallback(
    (s: { id: string; hops: number }): void => {
      const cy = cyRef.current
      if (!cy) return
      // Capture camera BEFORE we mutate it. State retains them so
      // clear() restores precisely the pre-focus view.
      const prevPan = cy.pan()
      const prevZoom = cy.zoom()
      const next: FocusState = { ...s, prevPan, prevZoom }
      setState(next)
      const keep = applyHide(s)
      fitToKeep(keep)
    },
    [applyHide, cyRef, fitToKeep]
  )

  const clear = useCallback((): void => {
    const cy = cyRef.current
    const prev = state
    setState(null)
    applyHide(null)
    if (cy && prev) {
      cy.pan(prev.prevPan)
      cy.zoom(prev.prevZoom)
    }
  }, [applyHide, cyRef, state])

  const reapply = useCallback((): void => {
    if (!state) return
    const keep = applyHide(state)
    fitToKeep(keep)
  }, [applyHide, fitToKeep, state])

  return { state, focus, clear, reapply }
}
