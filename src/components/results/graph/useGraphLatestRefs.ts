import type { ElementDefinition } from 'cytoscape'
import type { MutableRefObject } from 'react'
import { useRef } from 'react'
import type { LayoutName } from '../useGraphPrefs'

// useGraphLatestRefs hoists the cluster of "always-latest ref" updates
// the orchestrator used to inline (QUAL #164). Each ref always holds
// the latest snapshot of its corresponding prop / pref so the
// debounced build callback in useGraphCytoscape can read it without
// re-creating the timer every render.
//
// The pattern was repeated six times (query, elements, nodePrefs,
// edgePrefs, layout, selectionMode); the hook keeps the orchestrator
// from needing to declare and write all six refs inline.
export function useGraphLatestRefs(args: {
  query: string | undefined
  elements: ElementDefinition[]
  nodeLabelPrefs: Record<string, string>
  edgeLabelPrefs: Record<string, string>
  layout: LayoutName
  selectionMode: 'pan' | 'box'
}): {
  queryRef: MutableRefObject<string | undefined>
  elementsRef: MutableRefObject<ElementDefinition[]>
  nodePrefsRef: MutableRefObject<Record<string, string>>
  edgePrefsRef: MutableRefObject<Record<string, string>>
  layoutRef: MutableRefObject<LayoutName>
  selectionModeRef: MutableRefObject<'pan' | 'box'>
} {
  const {
    query,
    elements,
    nodeLabelPrefs,
    edgeLabelPrefs,
    layout,
    selectionMode,
  } = args
  const queryRef = useRef(query)
  queryRef.current = query
  const elementsRef = useRef(elements)
  elementsRef.current = elements
  const nodePrefsRef = useRef(nodeLabelPrefs)
  nodePrefsRef.current = nodeLabelPrefs
  const edgePrefsRef = useRef(edgeLabelPrefs)
  edgePrefsRef.current = edgeLabelPrefs
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const selectionModeRef = useRef(selectionMode)
  selectionModeRef.current = selectionMode
  return {
    queryRef,
    elementsRef,
    nodePrefsRef,
    edgePrefsRef,
    layoutRef,
    selectionModeRef,
  }
}
