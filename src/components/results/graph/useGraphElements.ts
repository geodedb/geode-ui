import { useMemo } from 'react'
import type { ElementDefinition } from 'cytoscape'
import {
  QueryRespLike,
  buildCompoundElements,
  extractElements,
  labelOptions,
  typeOptions,
} from '../../../lib/graphResult'
import { computeDegrees, degreeToSize } from './nodeDegree'

// Node-label palette — duplicated lookup of cytoscapeStyle's hash so
// the visibility-toggle row in the sidebar can show the matching
// swatch without going through Cytoscape. Exported so the orchestrator
// can also use it for the nodeLabelOf bucketing in the visibility row.
export function nodeLabelOf(data: Record<string, unknown>): string {
  // The graph data carries a top-level `label` (one or many) on each
  // node; we use the first as the bucketing key for visibility.
  const labelField = data.label
  if (typeof labelField === 'string' && labelField) return labelField
  if (Array.isArray(labelField) && labelField.length > 0) {
    const first = labelField[0]
    if (typeof first === 'string') return first
  }
  // Some shapes carry `labels` (plural) instead.
  const labels = data.labels
  if (Array.isArray(labels) && labels.length > 0) {
    const first = labels[0]
    if (typeof first === 'string') return first
  }
  return ''
}

export type UseGraphElementsArgs = {
  // Streaming-aware response payload. Re-derived as rows arrive (under
  // streaming) or once for single-shot responses. extractElements is
  // pure; the memo gates re-derivation on the resp + query identity.
  resp: QueryRespLike & { row_count?: number }
  query?: string
  // When true the rendered element set wraps `baseEls` in per-label
  // compound parents (fcose-friendly). Off by default; sticky.
  clusterByLabel: boolean
  // When true the per-node log-scaled `size` is stamped on data so the
  // stylesheet's width/height resolvers can read it. When false, only
  // `degree` is stamped (cheap, harmless) and the stylesheet falls back
  // to the legacy flat 38px.
  degreeSizing: boolean
}

export type UseGraphElementsResult = {
  // The plain element set — what the pickers / visibility buckets /
  // display selectors read. The *rendered* set (`elements`) is the same
  // thing wrapped in per-label compound parents when group-by-label
  // is on.
  baseEls: ElementDefinition[]
  // The set that actually feeds the cytoscape() call. Equal to baseEls
  // unless clusterByLabel is on.
  elements: ElementDefinition[]
  // Per-bucket label options for the display picker.
  nodeOptions: ReturnType<typeof labelOptions>
  // Per-type field options for the edge display picker.
  edgeOptions: ReturnType<typeof typeOptions>
  // Per-id lookups + bucketing for keyboard pickers and visibility row.
  nodeIds: string[]
  edgeIds: string[]
  nodeDataById: Map<string, Record<string, unknown>>
  edgeDataById: Map<string, Record<string, unknown>>
  nodeLabelBuckets: Map<string, number>
}

// useGraphElements is the data-model hook for GraphView. It takes the
// streaming-aware response + the original query text + the cluster
// toggle, walks them through extractElements (and the compound-element
// wrapper when clustering is on), and surfaces the derived option lists
// / id indices the orchestrator uses to populate the toolbar pickers,
// the visibility row, and the inline keyboard pickers.
//
// All work is memoized on (resp, query, clusterByLabel) so the orchestrator's
// effects can read these values cheaply on every render. The hook does NOT
// touch any zustand store or the i18n catalogue — those go through the
// orchestrator (closure-capture rule, per the refactor brief).
export function useGraphElements(
  args: UseGraphElementsArgs
): UseGraphElementsResult {
  const { resp, query, clusterByLabel, degreeSizing } = args

  // The plain element set for this resp (no synthetic cluster parents) —
  // this is what the pickers / visibility buckets / display selectors
  // read. The *rendered* set (`elements`) is the same thing wrapped in
  // per-label compound parents when group-by-label is on.
  const baseEls = useMemo<ElementDefinition[]>(() => {
    const raw = extractElements(resp, query)
    const degrees = computeDegrees(raw)
    // Stamp `degree` on every node (cheap, used by later neighbor-count
    // surfaces even when sizing is off). Stamp `size` only when the
    // degree-sizing toggle is on — the stylesheet's width/height
    // resolvers fall back to a flat 38px when the key is absent. Edges
    // pass through unchanged.
    return raw.map((el) => {
      const d = el.data as Record<string, unknown> | undefined
      if (!d || d.id == null) return el
      const isEdge = d.source !== undefined && d.target !== undefined
      if (isEdge) return el
      const id = String(d.id)
      const degree = degrees.get(id) ?? 0
      const size = degreeSizing ? degreeToSize(degree) : undefined
      return {
        ...el,
        data: { ...d, degree, ...(size != null ? { size } : {}) },
      }
    })
  }, [resp, query, degreeSizing])
  const elements = useMemo<ElementDefinition[]>(
    () => (clusterByLabel ? buildCompoundElements(baseEls) : baseEls),
    [baseEls, clusterByLabel]
  )

  // Options / id index are derived from the plain set so the cluster
  // parents never leak into the dropdowns.
  const nodeOptions = useMemo(() => labelOptions(baseEls), [baseEls])
  const edgeOptions = useMemo(() => typeOptions(baseEls), [baseEls])

  // Per-element id index for the keyboard pickers (GAP-03). Built from
  // the plain element set (`baseEls`) so synthetic cluster parents
  // never show up in the id pickers or visibility buckets.
  const { nodeIds, edgeIds, nodeDataById, edgeDataById, nodeLabelBuckets } =
    useMemo(() => {
      const nIds: string[] = []
      const eIds: string[] = []
      const nMap = new Map<string, Record<string, unknown>>()
      const eMap = new Map<string, Record<string, unknown>>()
      const buckets = new Map<string, number>()
      baseEls.forEach((el) => {
        const data = el.data as Record<string, unknown> | undefined
        if (!data) return
        const id = data.id != null ? String(data.id) : ''
        if (!id) return
        // Cytoscape v3 marks edges by the presence of `source` + `target`
        // on the data bag.
        const isEdge = data.source !== undefined && data.target !== undefined
        if (isEdge) {
          eIds.push(id)
          eMap.set(id, data)
        } else {
          nIds.push(id)
          nMap.set(id, data)
          const bucket = nodeLabelOf(data)
          buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1)
        }
      })
      return {
        nodeIds: nIds,
        edgeIds: eIds,
        nodeDataById: nMap,
        edgeDataById: eMap,
        nodeLabelBuckets: buckets,
      }
    }, [baseEls])

  return {
    baseEls,
    elements,
    nodeOptions,
    edgeOptions,
    nodeIds,
    edgeIds,
    nodeDataById,
    edgeDataById,
    nodeLabelBuckets,
  }
}
