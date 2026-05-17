import type { Core } from 'cytoscape'
import type { MutableRefObject } from 'react'
import { useMemo } from 'react'
import { resolveNodeLabel } from '../../../lib/graphResult'
import type { Neighbor, Selected } from './GraphInspector'

// useGraphSelectionActions hoists the small cluster of selection-
// driven derived values + handlers that the orchestrator used to
// inline (QUAL #164): the neighbours memo, the find-node list, the
// jump/find/display-label callbacks. Every callback closes over the
// orchestrator's `cyRef` + setSelected so the wiring is push-up only
// (no new state ownership).
//
// Note: `cyRef.current` is not a reactive value, so the `neighbors`
// memo intentionally lists only `selected` + `nodeLabelPrefs`. A new
// cy core after rebuild triggers the sig-keyed reset effect, which
// clears `selected`, which re-runs this memo against the fresh core.
export function useGraphSelectionActions(args: {
  cyRef: MutableRefObject<Core | null>
  selected: Selected | null
  setSelected: (s: Selected | null) => void
  nodeLabelPrefs: Record<string, string>
  nodeDataById: Map<string, Record<string, unknown>>
}): {
  neighbors: Neighbor[]
  findNodes: Record<string, unknown>[]
  onJumpNeighbor: (id: string) => void
  onFindPick: (id: string) => void
  nodeDisplayLabel: (id: string) => string
} {
  const { cyRef, selected, setSelected, nodeLabelPrefs, nodeDataById } = args

  const neighbors: Neighbor[] = useMemo(() => {
    const cy = cyRef.current
    if (!cy || !selected || selected.kind !== 'node') return []
    const id = String(selected.data.id ?? '')
    if (!id) return []
    const node = cy.$id(id)
    if (node.empty()) return []
    const out: Neighbor[] = []
    node.neighborhood('node').forEach((n) => {
      const nid = String(n.data('id') ?? '')
      if (!nid) return
      const label = resolveNodeLabel(
        n.data() as Record<string, unknown>,
        nodeLabelPrefs
      )
      out.push({ id: nid, label })
    })
    return out
  }, [selected, nodeLabelPrefs])

  const onJumpNeighbor = (id: string): void => {
    const data = nodeDataById.get(id)
    if (!data) return
    setSelected({ kind: 'node', data })
    cyRef.current?.$id(id).select()
  }

  const findNodes = useMemo(
    () => Array.from(nodeDataById.values()),
    [nodeDataById]
  )

  const onFindPick = (id: string): void => {
    const data = nodeDataById.get(id)
    if (!data) return
    setSelected({ kind: 'node', data })
    const node = cyRef.current?.$id(id)
    if (node && !node.empty()) {
      node.select()
      cyRef.current?.center(node)
    }
  }

  const nodeDisplayLabel = (id: string): string => {
    const data = nodeDataById.get(id)
    if (!data) return id
    return resolveNodeLabel(data, nodeLabelPrefs)
  }

  return { neighbors, findNodes, onJumpNeighbor, onFindPick, nodeDisplayLabel }
}
