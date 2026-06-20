import { useCallback, useRef, useState } from 'react'
import type { Core } from 'cytoscape'
import {
  collapseNode,
  expandCollapsed,
  hideNode,
  mergeSubgraph,
  restoreNode,
} from '../graphActions'
import { client } from '../../../api/client'
import { QueryRespLike, extractElements } from '../../../lib/graphResult'
import { graphNameOf, isRealNodeId } from './explore'
import { buildExpandStatement } from './buildExpand'
import type { ExpandDirection } from './buildExpand'
import { layoutConfig } from './layouts'
import type { LayoutName } from '../useGraphPrefs'

export type ExploreOpts = {
  direction?: ExpandDirection
  labelFilter?: string
  limit?: number
}

type TFn = (key: string, opts?: Record<string, unknown>) => string

export type UseGraphActionsArgs = {
  // Live Cytoscape core ref (owned by the orchestrator).
  cyRef: React.MutableRefObject<Core | null>
  // Layout ref so the explore re-layout uses the *current* layout
  // rather than capturing one at hook-mount time.
  layoutRef: React.MutableRefObject<LayoutName>
  // Original query ref (so explore can inherit USE GRAPH).
  queryRef: React.MutableRefObject<string | undefined>
  // Drives selection clearing when a node is hidden.
  setSelected: (s: null) => void
  // Drives the error-banner state for explore failures.
  setError: (msg: string | null) => void
  // i18n function for the error banner.
  t: TFn
}

export type UseGraphActionsResult = {
  // Result-scoped state: ids the user has hidden, the (id → leaves) map
  // for collapsed groups, and the in-flight explore id (null when idle).
  hidden: Set<string>
  collapsed: Map<string, string[]>
  exploringId: string | null
  // Setters for the orchestrator's sig-keyed reset (a new query result
  // clears all three).
  setHidden: React.Dispatch<React.SetStateAction<Set<string>>>
  setCollapsed: React.Dispatch<React.SetStateAction<Map<string, string[]>>>
  setExploringId: React.Dispatch<React.SetStateAction<string | null>>
  // Handlers exposed to the inspector / sidebar restore lists.
  onHideNode: (id: string) => void
  onCollapseNode: (id: string) => void
  onRestoreHidden: (id: string) => void
  onExpandCollapsed: (id: string) => void
  onExploreNeighbours: (id: string, opts?: ExploreOpts) => void
}

// useGraphActions owns the Phase-2 hide/collapse/expand bookkeeping
// and the "Explore neighbours" fetch flow. The orchestrator hands in
// the cy core ref + a few state setters; the hook returns the resulting
// state + handlers ready to wire into the inspector and the restore
// lists. Result-scoped state — the orchestrator resets it from its
// sig-keyed effect on a new query result.
export function useGraphActions(
  args: UseGraphActionsArgs
): UseGraphActionsResult {
  const { cyRef, layoutRef, queryRef, setSelected, setError, t } = args
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Map<string, string[]>>(new Map())
  const [exploringId, setExploringId] = useState<string | null>(null)
  // Mirror `collapsed` in a ref so onExpandCollapsed can read the
  // current value synchronously without listing it as a dep (which
  // would re-create the callback on every collapse / expand).
  const collapsedRef = useRef(collapsed)
  collapsedRef.current = collapsed

  const onHideNode = useCallback(
    (id: string): void => {
      if (!id) return
      // State-first, mirroring onRestoreHidden: the `hidden` set is the
      // source of truth for the Hidden list, so record the intent even
      // when the cytoscape core is momentarily absent. The core is torn
      // down and rebuilt on a debounced result change (cyRef.current is
      // null during that window); the old guard `if (!cy || !id) return`
      // dropped a Hide click that landed mid-rebuild, leaving the node
      // both visible AND missing from the Hidden list. Apply the visual
      // hide when the core is present; the state update always lands.
      const cy = cyRef.current
      if (cy) hideNode(cy, id)
      setHidden((prev) => {
        const next = new Set(prev)
        next.add(id)
        return next
      })
      setSelected(null)
    },
    [cyRef, setSelected]
  )

  const onCollapseNode = useCallback(
    (id: string): void => {
      const cy = cyRef.current
      if (!cy || !id) return
      const leaves = collapseNode(cy, id)
      if (leaves.length === 0) return
      setCollapsed((prev) => {
        const next = new Map(prev)
        const existing = next.get(id) ?? []
        next.set(id, Array.from(new Set([...existing, ...leaves])))
        return next
      })
      setHidden((prev) => {
        const next = new Set(prev)
        leaves.forEach((l) => next.add(l))
        return next
      })
    },
    [cyRef]
  )

  const onRestoreHidden = useCallback(
    (id: string): void => {
      const cy = cyRef.current
      if (cy) restoreNode(cy, id)
      setHidden((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      setCollapsed((prev) => {
        let changed = false
        const next = new Map<string, string[]>()
        prev.forEach((leaves, nodeId) => {
          const filtered = leaves.filter((l) => l !== id)
          if (filtered.length !== leaves.length) changed = true
          if (filtered.length > 0) next.set(nodeId, filtered)
          else changed = true
        })
        return changed ? next : prev
      })
    },
    [cyRef]
  )

  const onExpandCollapsed = useCallback(
    (nodeId: string): void => {
      const cy = cyRef.current
      // Read the leaves from the ref (always points at the latest
      // collapsed map) so the callback identity doesn't churn on every
      // collapse / expand. Calling expandCollapsed before mutating the
      // hidden / collapsed state matches the pre-extraction order.
      const leaves = collapsedRef.current.get(nodeId) ?? []
      if (cy) expandCollapsed(cy, leaves)
      setHidden((prev) => {
        const next = new Set(prev)
        leaves.forEach((l) => next.delete(l))
        return next
      })
      setCollapsed((prev) => {
        if (!prev.has(nodeId)) return prev
        const next = new Map(prev)
        next.delete(nodeId)
        return next
      })
    },
    [cyRef]
  )

  const onExploreNeighbours = useCallback(
    (id: string, opts?: ExploreOpts): void => {
      const cy = cyRef.current
      if (!cy || !id) return
      if (!isRealNodeId(id)) return
      // Snapshot the core before the await: if a fresh query result
      // lands and the graph is rebuilt while this request is in flight,
      // the explore result is for the *old* graph — bail.
      const capturedCy = cy
      // Bail if another explore is in flight.
      let alreadyInFlight = false
      setExploringId((cur) => {
        if (cur) {
          alreadyInFlight = true
          return cur
        }
        return id
      })
      if (alreadyInFlight) return
      setError(null)
      // Build the statement up front so any validation error surfaces
      // synchronously via the banner (and doesn't leave exploringId
      // pinned to this id).
      let statement: string
      try {
        statement = buildExpandStatement({ id, ...(opts ?? {}) })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        setError(t('graph.exploreNeighboursFailed', { message: msg }))
        setExploringId((cur) => (cur === id ? null : cur))
        return
      }
      client
        .query({
          statement,
          graph: graphNameOf(queryRef.current),
          // Scale page_size with the requested limit (so a small expand
          // doesn't pull a large window) but keep the legacy 200 default
          // for unbounded callers.
          pageSize: opts?.limit ? Math.max(opts.limit, 1) * 2 : 200,
          timeoutMs: 30000,
        })
        .then((result) => {
          const live = cyRef.current
          if (!live || live !== capturedCy) return
          const newEls = extractElements(result as QueryRespLike)
          const added = mergeSubgraph(live, newEls)
          if (added.length > 0) {
            live.layout(layoutConfig(layoutRef.current)).run()
            live.fit(undefined, 24)
          }
        })
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e)
          setError(t('graph.exploreNeighboursFailed', { message: msg }))
        })
        .finally(() => {
          setExploringId((cur) => (cur === id ? null : cur))
        })
    },
    [cyRef, layoutRef, queryRef, setError, t]
  )

  return {
    hidden,
    collapsed,
    exploringId,
    setHidden,
    setCollapsed,
    setExploringId,
    onHideNode,
    onCollapseNode,
    onRestoreHidden,
    onExpandCollapsed,
    onExploreNeighbours,
  }
}
