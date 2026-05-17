import type { ElementDefinition } from 'cytoscape'
import type { MutableRefObject } from 'react'
import { useEffect, useRef } from 'react'
import { COSE_NODE_LIMIT } from './layouts'
import { DEFAULT_LAYOUT } from '../useGraphPrefs'
import type { LayoutName } from '../useGraphPrefs'
import type { Selected } from './GraphInspector'

// useGraphSigReset hoists the sig-keyed reset effect that the
// orchestrator used to inline (QUAL #164). The effect fires when the
// rebuild signature changes -- a new query result, a cluster toggle,
// etc. -- and clears every piece of result-scoped state that
// belonged to the previous graph:
//
//   - the path-mode state machine (resetPath)
//   - hidden / collapsed bookkeeping + the exploring-id snapshot
//   - pinned-node ids (via pinning.clear -- null-safe)
//   - focus-mode focal node (via focusMode.clear -- null-safe)
//   - the previous selection (so the inspector doesn't show stale data)
//
// It also auto-picks the `grid` layout for responses larger than
// COSE_NODE_LIMIT so the default cose layout doesn't freeze the tab.
// The effect intentionally has `sig` as its only React dep -- every
// other input is a ref or a stable callback, and we want the reset
// behaviour to fire ONLY on a real sig change.
export function useGraphSigReset(args: {
  sig: string
  layoutRef: MutableRefObject<LayoutName>
  elementsRef: MutableRefObject<ElementDefinition[]>
  resetPath: () => void
  setHidden: (s: Set<string>) => void
  setCollapsed: (m: Map<string, string[]>) => void
  setExploringId: (id: string | null) => void
  pinningClear: () => void
  focusClear: () => void
  setSelected: (s: Selected | null) => void
  setLayout: (l: LayoutName) => void
}): void {
  const {
    sig,
    layoutRef,
    elementsRef,
    resetPath,
    setHidden,
    setCollapsed,
    setExploringId,
    pinningClear,
    focusClear,
    setSelected,
    setLayout,
  } = args
  const lastSigRef = useRef<string>('')
  useEffect(() => {
    if (lastSigRef.current === sig) return
    lastSigRef.current = sig
    resetPath()
    setHidden(new Set())
    setCollapsed(new Map())
    setExploringId(null)
    pinningClear()
    focusClear()
    setSelected(null)
    if (
      layoutRef.current === DEFAULT_LAYOUT &&
      elementsRef.current.length > COSE_NODE_LIMIT
    ) {
      setLayout('grid')
    }
    // The reset behaviour fires only on a real sig change. Every
    // other input is a ref or a stable callback.
  }, [sig])
}
