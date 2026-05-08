import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import cytoscape, { Core, ElementDefinition } from 'cytoscape'
import styled from 'styled-components'
import { cytoscapeStyle } from './cytoscapeStyle'
import {
  EDGE_TYPE_DEFAULT,
  NODE_LABEL_DEFAULT,
  QueryRespLike,
  extractElements,
  labelOptions,
  resolveEdgeLabel,
  resolveNodeLabel,
  typeOptions,
} from '../../lib/graphResult'

type Selected = { kind: 'node' | 'edge'; data: Record<string, unknown> }

// Props.resp is a QueryRespLike from the row stream, which under streaming
// is a freshly minted object every row. Building a Cytoscape Core +
// running cose layout per row is catastrophic (O(N) teardown / re-layouts
// for an N-row stream). The component intentionally debounces the
// (re)build so streaming converges to a single mount once the row count
// settles. See PERF-F9 / issue #53.
type Props = {
  resp: QueryRespLike & { row_count?: number }
  // Original query text. Used to recover variable bindings and
  // synthesise nodes/edges when the response is scalar-only (no
  // NODE/EDGE columns ⇒ empty graph_summary).
  query?: string
  height?: number
}

const REBUILD_DEBOUNCE_MS = 250

// P-NEW-2 / Q-NEW-3: cap the datalist option count rendered by the
// keyboard pickers. A 5k-node graph would otherwise materialise 5k
// <option> elements unconditionally, wasting DOM, retained memory,
// and an extra style/layout pass on every <input> focus. Datalists
// behave like type-ahead suggestions: 1000 entries is more than any
// human will scroll, and the input still accepts an exact id beyond
// the cap (the lookup Maps are NOT capped, so resolving a typed-in id
// always works).
const ID_PICKER_OPTION_CAP = 1000

const Wrap = styled.div`
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: ${({ theme }) => theme.spacing.sm};

  @media (max-width: ${({ theme }) => theme.breakpoints.md - 0.02}px) {
    grid-template-columns: 1fr;
  }
`
// Holds the Cytoscape canvas plus any absolutely-positioned overlays
// (empty-graph state, build-error banner). Position-relative so the
// overlay can stack on top of the canvas without entering Cytoscape's
// internal DOM tree.
const CanvasArea = styled.div`
  position: relative;
`
const Canvas = styled.div<{ $height: number }>`
  height: ${({ $height }) => $height}px;
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
  background: ${({ theme }) => theme.bg.graphCanvas};
`
const Overlay = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: ${({ theme }) => theme.spacing.md};
  pointer-events: none;
  color: ${({ theme }) => theme.text.muted};
  font-size: ${({ theme }) => theme.font.sizes.sm};
  font-style: italic;
  text-align: center;
`
const ErrorBanner = styled.div`
  position: absolute;
  inset: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.sm}
    auto;
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.colors.danger};
  border-left-width: 3px;
  color: ${({ theme }) => theme.text.danger};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  border-radius: ${({ theme }) => theme.radii.md};
  font-size: ${({ theme }) => theme.font.sizes.sm};
  box-shadow: ${({ theme }) => theme.shadows.sm};
`
const Side = styled.aside<{ $height: number }>`
  height: ${({ $height }) => $height}px;
  overflow: auto;
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.sm};
  background: ${({ theme }) => theme.bg.surface};
  color: ${({ theme }) => theme.text.primary};

  pre {
    white-space: pre-wrap;
    word-break: break-all;
  }

  /* Below the md breakpoint the sidebar follows the canvas in stacked
     order; cap its height so a long property dump doesn't push the
     editor and the rest of the page off-screen on phone form factors. */
  @media (max-width: ${({ theme }) => theme.breakpoints.md - 0.02}px) {
    height: auto;
    max-height: 320px;
  }
`
const ControlsBlock = styled.section`
  margin-bottom: ${({ theme }) => theme.spacing.sm};
  padding-bottom: ${({ theme }) => theme.spacing.sm};
  border-bottom: 1px solid ${({ theme }) => theme.border.subtle};

  h5 {
    margin: 0 0 ${({ theme }) => theme.spacing.xs};
    font-family: ${({ theme }) => theme.font.family.display};
    font-size: ${({ theme }) => theme.font.sizes.xs};
    font-weight: ${({ theme }) => theme.font.weights.semibold};
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: ${({ theme }) => theme.text.secondary};
  }
  .row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: ${({ theme }) => theme.spacing.xs};
    align-items: center;
    margin-bottom: ${({ theme }) => theme.spacing.xxs};
    font-size: ${({ theme }) => theme.font.sizes.xs};
  }
  select,
  input[list] {
    font-family: inherit;
    font-size: ${({ theme }) => theme.font.sizes.xs};
    padding: 2px 6px;
    background: ${({ theme }) => theme.bg.surface};
    color: ${({ theme }) => theme.text.primary};
    border: 1px solid ${({ theme }) => theme.border.default};
    border-radius: ${({ theme }) => theme.radii.sm};
    min-width: 0;
  }
  select:focus-visible,
  input[list]:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
    border-color: ${({ theme }) => theme.border.focus};
  }
  .empty {
    font-size: ${({ theme }) => theme.font.sizes.xs};
    color: ${({ theme }) => theme.text.muted};
  }
`

function respSignature(resp: QueryRespLike & { row_count?: number }): number {
  // Stream messages do NOT include row_count until the summary frame; for
  // the streaming case we fall back to rows.length so the signature
  // changes monotonically as rows arrive. Single-shot resps include
  // row_count once and the signature is stable thereafter.
  if (typeof resp.row_count === 'number') return resp.row_count
  return resp.rows ? resp.rows.length : 0
}

function applyLabels(
  cy: Core,
  nodePrefs: Record<string, string>,
  edgePrefs: Record<string, string>
): void {
  cy.batch(() => {
    cy.nodes().forEach((n) => {
      const label = resolveNodeLabel(
        n.data() as Record<string, unknown>,
        nodePrefs
      )
      n.data('label', label)
    })
    cy.edges().forEach((e) => {
      const label = resolveEdgeLabel(
        e.data() as Record<string, unknown>,
        edgePrefs
      )
      e.data('type', label)
    })
  })
}

export const GraphView: React.FC<Props> = ({ resp, query, height = 480 }) => {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const [selected, setSelected] = useState<Selected | null>(null)
  // GAP-04: errors thrown by extractElements / cytoscape() during the
  // build pass. Surfaced as a banner over the canvas instead of an
  // unhandled console rejection.
  const [error, setError] = useState<string | null>(null)
  const [nodeLabelPrefs, setNodeLabelPrefs] = useState<Record<string, string>>(
    {}
  )
  const [edgeLabelPrefs, setEdgeLabelPrefs] = useState<Record<string, string>>(
    {}
  )

  // Track the resp + query by reference so the debounced rebuild
  // always reads the latest snapshot when it fires (without
  // re-creating the timer every render).
  const respRef = useRef(resp)
  respRef.current = resp
  const queryRef = useRef(query)
  queryRef.current = query
  // P-NEW-5: hold the same `elements` snapshot the option / id maps
  // are built from so the build effect doesn't re-walk extractElements
  // a second time. The rebuild trigger (sig) gates on (row_count|query),
  // so when the build callback fires the latest memoized `elements`
  // is the one to render.
  const elementsRef = useRef<ElementDefinition[]>([])

  // Track the latest preference maps so the build effect picks them
  // up without rebuilding when only the preference changes.
  const nodePrefsRef = useRef(nodeLabelPrefs)
  nodePrefsRef.current = nodeLabelPrefs
  const edgePrefsRef = useRef(edgeLabelPrefs)
  edgePrefsRef.current = edgeLabelPrefs

  // GAP-01 / GAP-07: rebuild key combines row_count with the query
  // text. Two queries that happen to return the same row count would
  // previously fail to trigger the rebuild and leave a stale graph
  // on the canvas.
  const sig = `${respSignature(resp)}|${query ?? ''}`

  // Compute available options from the current resp (cheap; same data
  // extractElements would walk). The build effect reads through
  // elementsRef so the per-rebuild teardown doesn't repeat the work.
  const elements = useMemo<ElementDefinition[]>(
    () => extractElements(resp, query),
    [resp, query]
  )
  elementsRef.current = elements
  const nodeOptions = useMemo(() => labelOptions(elements), [elements])
  const edgeOptions = useMemo(() => typeOptions(elements), [elements])

  // Per-element id index for the keyboard pickers (GAP-03). Both
  // arrays are derived from the memoized `elements` so they're cheap
  // to recompute on resp change.
  const { nodeIds, edgeIds, nodeDataById, edgeDataById } = useMemo(() => {
    const nIds: string[] = []
    const eIds: string[] = []
    const nMap = new Map<string, Record<string, unknown>>()
    const eMap = new Map<string, Record<string, unknown>>()
    elements.forEach((el) => {
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
      }
    })
    return {
      nodeIds: nIds,
      edgeIds: eIds,
      nodeDataById: nMap,
      edgeDataById: eMap,
    }
  }, [elements])

  useEffect(() => {
    if (!ref.current) return undefined
    let canceled = false

    const build = (): void => {
      if (canceled || !ref.current) return
      // GAP-02 / GAP-06: drop the previous selection so the inspector
      // doesn't keep showing data from a graph that was just torn
      // down. Reset before any throw so the side panel never shows
      // stale state.
      setSelected(null)
      setError(null)
      // Tear down a previous core if any. We accept this cost because
      // the rebuild is gated by row_count + debounce (PERF-F9), so a
      // streaming run produces exactly one teardown+rebuild instead of
      // one per row.
      if (cyRef.current) {
        cyRef.current.destroy()
        cyRef.current = null
      }
      try {
        // P-NEW-5: reuse the memoized snapshot from `elements` instead
        // of re-walking the full resp here. extractElements on a 5k-
        // element resp is non-trivial; we already paid the cost in
        // the useMemo that drives `nodeOptions` / `edgeOptions`.
        const els = elementsRef.current
        // GAP-05: when the response has no graph elements (e.g. a
        // scalar projection like RETURN p.name), skip the cytoscape
        // mount entirely. The render pass shows an empty-state
        // overlay over the bare Canvas.
        if (els.length === 0) return
        const cy = cytoscape({
          container: ref.current,
          elements: els,
          style: cytoscapeStyle,
          layout: { name: 'cose', animate: false, padding: 24 },
          wheelSensitivity: 0.2,
        })
        cy.on('tap', 'node', (ev) =>
          setSelected({ kind: 'node', data: ev.target.data() })
        )
        cy.on('tap', 'edge', (ev) =>
          setSelected({ kind: 'edge', data: ev.target.data() })
        )
        cy.on('tap', (ev) => {
          if (ev.target === cy) setSelected(null)
        })
        cyRef.current = cy
        // Apply current label preferences to this fresh core. Subsequent
        // pref changes are handled by the dedicated effect below without
        // re-running the layout.
        applyLabels(cy, nodePrefsRef.current, edgePrefsRef.current)
      } catch (e: unknown) {
        // GAP-04: surface the failure as a visible banner instead of
        // an uncaught console rejection. The build is best-effort —
        // the rest of the page (sidebar, picker) still works.
        setError(e instanceof Error ? e.message : String(e))
      }
    }

    const timer = setTimeout(build, REBUILD_DEBOUNCE_MS)

    return () => {
      canceled = true
      clearTimeout(timer)
      if (cyRef.current) {
        cyRef.current.destroy()
        cyRef.current = null
      }
    }
  }, [sig])

  // Re-apply labels when preferences change. This does NOT rebuild
  // the core or run the layout — it just rewrites data.label on the
  // existing nodes/edges so cytoscape's style binding picks up the
  // new value.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    applyLabels(cy, nodeLabelPrefs, edgeLabelPrefs)
  }, [nodeLabelPrefs, edgeLabelPrefs])

  const setNodePref = (label: string, key: string): void => {
    setNodeLabelPrefs((prev) => ({ ...prev, [label]: key }))
  }
  const setEdgePref = (type: string, key: string): void => {
    setEdgeLabelPrefs((prev) => ({ ...prev, [type]: key }))
  }

  // GAP-03: keyboard-only operators can't tap on the canvas. The id
  // pickers below let them select a node or edge via the Display
  // panel; this handler resolves the typed/picked id back to the
  // element's data and updates the inspector. We also call cy.$id
  // when the core is mounted so the canvas highlights the selection.
  const onPickNodeId = (rawId: string): void => {
    const id = rawId.trim()
    if (!id) return
    const data = nodeDataById.get(id)
    if (!data) return
    setSelected({ kind: 'node', data })
    cyRef.current?.$id(id).select()
  }
  const onPickEdgeId = (rawId: string): void => {
    const id = rawId.trim()
    if (!id) return
    const data = edgeDataById.get(id)
    if (!data) return
    setSelected({ kind: 'edge', data })
    cyRef.current?.$id(id).select()
  }

  const empty = elements.length === 0 && !error

  return (
    <Wrap>
      <CanvasArea>
        <Canvas
          ref={ref}
          $height={height}
          role="img"
          aria-label={t('graph.canvasAria')}
        />
        {empty && (
          <Overlay data-testid="graph-empty-state">{t('graph.empty')}</Overlay>
        )}
        {error && (
          <ErrorBanner role="alert">
            {t('graph.errorBanner', { message: error })}
          </ErrorBanner>
        )}
      </CanvasArea>
      <Side $height={height}>
        {(nodeIds.length > 0 || edgeIds.length > 0) && (
          <ControlsBlock data-testid="graph-selection-controls">
            <h5>{t('graph.selectionHeading')}</h5>
            {nodeIds.length > 0 && (
              <div className="row">
                <span>{t('graph.selectNodeById')}</span>
                <input
                  list="graph-node-ids"
                  data-testid="graph-node-id-picker"
                  aria-label={t('graph.selectNodeById')}
                  placeholder={t('graph.nodeIdPlaceholder')}
                  onChange={(e) => onPickNodeId(e.target.value)}
                />
                <datalist id="graph-node-ids">
                  {nodeIds.slice(0, ID_PICKER_OPTION_CAP).map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </datalist>
              </div>
            )}
            {edgeIds.length > 0 && (
              <div className="row">
                <span>{t('graph.selectEdgeById')}</span>
                <input
                  list="graph-edge-ids"
                  data-testid="graph-edge-id-picker"
                  aria-label={t('graph.selectEdgeById')}
                  placeholder={t('graph.edgeIdPlaceholder')}
                  onChange={(e) => onPickEdgeId(e.target.value)}
                />
                <datalist id="graph-edge-ids">
                  {edgeIds.slice(0, ID_PICKER_OPTION_CAP).map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </datalist>
              </div>
            )}
          </ControlsBlock>
        )}
        <ControlsBlock data-testid="graph-display-controls">
          <h5>{t('graph.displayHeading')}</h5>
          {nodeOptions.size === 0 ? (
            <p className="empty">{t('graph.noNodesToConfigure')}</p>
          ) : (
            Array.from(nodeOptions.entries()).map(([label, opts]) => (
              <div className="row" key={`n-${label}`}>
                <span>{label || `(${t('graph.unlabeledNode')})`}</span>
                <select
                  aria-label={t('graph.nodeFieldLabel', {
                    label: label || t('graph.unlabeledNode'),
                  })}
                  value={nodeLabelPrefs[label] ?? NODE_LABEL_DEFAULT}
                  onChange={(e) => setNodePref(label, e.target.value)}
                >
                  {opts.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt === NODE_LABEL_DEFAULT
                        ? `(${t('graph.optionLabelName')})`
                        : opt}
                    </option>
                  ))}
                </select>
              </div>
            ))
          )}
          {edgeOptions.size > 0 &&
            Array.from(edgeOptions.entries()).map(([type, opts]) => (
              <div className="row" key={`e-${type}`}>
                <span>{type}</span>
                <select
                  aria-label={t('graph.edgeFieldLabel', { type })}
                  value={edgeLabelPrefs[type] ?? EDGE_TYPE_DEFAULT}
                  onChange={(e) => setEdgePref(type, e.target.value)}
                >
                  {opts.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt === EDGE_TYPE_DEFAULT
                        ? `(${t('graph.optionType')})`
                        : opt}
                    </option>
                  ))}
                </select>
              </div>
            ))}
        </ControlsBlock>
        {selected ? (
          <>
            <h4>
              {selected.kind === 'node'
                ? t('graph.selectedNode', { id: String(selected.data.id) })
                : t('graph.selectedEdge', { id: String(selected.data.id) })}
            </h4>
            <pre>{JSON.stringify(selected.data, null, 2)}</pre>
          </>
        ) : (
          <p style={{ opacity: 0.6 }}>{t('graph.inspectHint')}</p>
        )}
      </Side>
    </Wrap>
  )
}
