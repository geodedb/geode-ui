import { useCallback, useEffect, useRef, useState } from 'react'
import type { Core } from 'cytoscape'

// ----- path mode -----
//
// Path mode lets the operator click two nodes; GraphView runs Cytoscape's
// built-in Dijkstra on the *rendered* graph and highlights the shortest
// path between them (dimming everything else). State machine:
//   off → pickSource → pickTarget → shown → (Clear) → off
export type PathState =
  | { phase: 'off' }
  | { phase: 'pickSource' }
  | { phase: 'pickTarget'; sourceId: string }
  | { phase: 'shown'; from: string; to: string; hops: number | null }

// Strip the path-highlight classes from every element. Idempotent.
export function clearPathHighlight(cy: Core): void {
  cy.elements().removeClass('highlighted').removeClass('dimmed')
}

// Translation function signature compatible with react-i18next's `t`.
type TFn = (key: string, opts?: Record<string, unknown>) => string

export type UseGraphPathModeArgs = {
  // Ref pointing at the live Cytoscape Core. The hook reads it (never
  // writes) so callers retain full ownership of the cy lifecycle.
  cyRef: React.MutableRefObject<Core | null>
  // Translation function. Passed in (not re-acquired via useTranslation
  // here) to keep the closure-capture rule from the refactor brief — the
  // hook never double-subscribes to react-i18next.
  t: TFn
}

export type UseGraphPathModeResult = {
  // Current state machine value (for downstream rendering / aria).
  pathState: PathState
  // Stable ref to `handlePathNodeTap` so the cy.on('tap', 'node') handler
  // registered in the build effect always reads the latest state without
  // re-binding. Mirrors the pre-extraction pattern.
  pathTapRef: React.MutableRefObject<(nodeId: string) => boolean>
  // Toolbar handlers.
  onTogglePathMode: () => void
  exitPathMode: () => void
  // sig-keyed reset: a new query result clears any in-progress / shown
  // path. Exposed so the orchestrator's existing reset effect can call
  // it alongside the other result-scoped state resets.
  resetPath: () => void
  // Pre-rendered path-mode status line for the bar under the toolbar.
  // null when path mode is off.
  pathStatusText: string | null
}

export function useGraphPathMode(
  args: UseGraphPathModeArgs
): UseGraphPathModeResult {
  const { cyRef, t } = args
  const [pathState, setPathState] = useState<PathState>({ phase: 'off' })
  const pathStateRef = useRef(pathState)
  pathStateRef.current = pathState

  const enterPathMode = useCallback((): void => {
    const cy = cyRef.current
    if (cy) clearPathHighlight(cy)
    setPathState({ phase: 'pickSource' })
  }, [cyRef])

  const exitPathMode = useCallback((): void => {
    const cy = cyRef.current
    if (cy) clearPathHighlight(cy)
    setPathState({ phase: 'off' })
  }, [cyRef])

  const onTogglePathMode = useCallback((): void => {
    if (pathStateRef.current.phase === 'off') {
      enterPathMode()
    } else {
      exitPathMode()
    }
  }, [enterPathMode, exitPathMode])

  const handlePathNodeTap = useCallback(
    (nodeId: string): boolean => {
      const state = pathStateRef.current
      if (state.phase === 'off') return false
      const cy = cyRef.current
      if (!cy) return true
      if (state.phase === 'pickSource' || state.phase === 'shown') {
        clearPathHighlight(cy)
        setPathState({ phase: 'pickTarget', sourceId: nodeId })
        return true
      }
      // pickTarget — run Dijkstra from the recorded source to this node.
      const src = cy.getElementById(state.sourceId)
      const dst = cy.getElementById(nodeId)
      clearPathHighlight(cy)
      const dij = cy.elements().dijkstra({ root: src, directed: false })
      const path = dij.pathTo(dst)
      if (!path || path.length === 0) {
        setPathState({
          phase: 'shown',
          from: state.sourceId,
          to: nodeId,
          hops: null,
        })
        return true
      }
      cy.elements().difference(path).addClass('dimmed')
      path.addClass('highlighted')
      setPathState({
        phase: 'shown',
        from: state.sourceId,
        to: nodeId,
        hops: path.edges().length,
      })
      return true
    },
    [cyRef]
  )

  const pathTapRef = useRef(handlePathNodeTap)
  // Keep the ref in sync with the latest callback identity so the tap
  // handler registered against the Cytoscape core (which closes over
  // pathTapRef once at build time) always dispatches to the current
  // pathState. useEffect (not assignment-in-render) so concurrent
  // rendering can't observe a torn state.
  useEffect(() => {
    pathTapRef.current = handlePathNodeTap
  }, [handlePathNodeTap])

  const resetPath = useCallback((): void => {
    setPathState({ phase: 'off' })
  }, [])

  let pathStatusText: string | null = null
  if (pathState.phase === 'pickSource') {
    pathStatusText = t('graph.pathPickSource')
  } else if (pathState.phase === 'pickTarget') {
    pathStatusText = t('graph.pathPickTarget')
  } else if (pathState.phase === 'shown' && pathState.hops === null) {
    pathStatusText = t('graph.pathNone', {
      from: pathState.from,
      to: pathState.to,
    })
  } else if (pathState.phase === 'shown') {
    pathStatusText = t('graph.pathResult', {
      from: pathState.from,
      to: pathState.to,
      hops: pathState.hops,
    })
  }

  return {
    pathState,
    pathTapRef,
    onTogglePathMode,
    exitPathMode,
    resetPath,
    pathStatusText,
  }
}
