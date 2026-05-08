import React, { useEffect, useMemo, useRef, useState } from 'react'
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
type Props = { resp: QueryRespLike & { row_count?: number }; height?: number }

const REBUILD_DEBOUNCE_MS = 250

const Wrap = styled.div`
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 12px;
`
const Canvas = styled.div<{ $height: number }>`
  height: ${({ $height }) => $height}px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: #fff;
`
const Side = styled.aside<{ $height: number }>`
  height: ${({ $height }) => $height}px;
  overflow: auto;
  border: 1px solid ${({ theme }) => theme.colors.border};
  padding: 12px;
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.text};
  pre {
    white-space: pre-wrap;
    word-break: break-all;
  }
`
const ControlsBlock = styled.section`
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  h5 {
    margin: 0 0 6px 0;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.7;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 6px;
    align-items: center;
    margin-bottom: 4px;
    font-size: 12px;
  }
  select {
    font-size: 12px;
    padding: 2px 4px;
    background: ${({ theme }) => theme.colors.background};
    color: ${({ theme }) => theme.colors.text};
    border: 1px solid ${({ theme }) => theme.colors.border};
    border-radius: 2px;
  }
  .empty {
    font-size: 12px;
    opacity: 0.6;
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

export const GraphView: React.FC<Props> = ({ resp, height = 480 }) => {
  const ref = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const [selected, setSelected] = useState<Selected | null>(null)
  const [nodeLabelPrefs, setNodeLabelPrefs] = useState<Record<string, string>>(
    {}
  )
  const [edgeLabelPrefs, setEdgeLabelPrefs] = useState<Record<string, string>>(
    {}
  )

  // Track the resp by reference so the debounced rebuild always reads
  // the latest snapshot when it fires (without re-creating the timer
  // every render).
  const respRef = useRef(resp)
  respRef.current = resp

  // Track the latest preference maps so the build effect picks them
  // up without rebuilding when only the preference changes.
  const nodePrefsRef = useRef(nodeLabelPrefs)
  nodePrefsRef.current = nodeLabelPrefs
  const edgePrefsRef = useRef(edgeLabelPrefs)
  edgePrefsRef.current = edgeLabelPrefs

  const sig = respSignature(resp)

  // Compute available options from the current resp (cheap; same data
  // extractElements would walk).
  const elements = useMemo<ElementDefinition[]>(
    () => extractElements(resp),
    [resp]
  )
  const nodeOptions = useMemo(() => labelOptions(elements), [elements])
  const edgeOptions = useMemo(() => typeOptions(elements), [elements])

  useEffect(() => {
    if (!ref.current) return undefined
    let canceled = false

    const build = (): void => {
      if (canceled || !ref.current) return
      // Tear down a previous core if any. We accept this cost because
      // the rebuild is gated by row_count + debounce (PERF-F9), so a
      // streaming run produces exactly one teardown+rebuild instead of
      // one per row.
      if (cyRef.current) {
        cyRef.current.destroy()
        cyRef.current = null
      }
      const els = extractElements(respRef.current)
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
    }

    const t = setTimeout(build, REBUILD_DEBOUNCE_MS)

    return () => {
      canceled = true
      clearTimeout(t)
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

  return (
    <Wrap>
      <Canvas ref={ref} $height={height} />
      <Side $height={height}>
        <ControlsBlock data-testid="graph-display-controls">
          <h5>Display</h5>
          {nodeOptions.size === 0 ? (
            <p className="empty">No nodes to configure.</p>
          ) : (
            Array.from(nodeOptions.entries()).map(([label, opts]) => (
              <div className="row" key={`n-${label}`}>
                <span>{label || '(unlabeled)'}</span>
                <select
                  aria-label={`Display field for ${label || 'unlabeled'} nodes`}
                  value={nodeLabelPrefs[label] ?? NODE_LABEL_DEFAULT}
                  onChange={(e) => setNodePref(label, e.target.value)}
                >
                  {opts.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt === NODE_LABEL_DEFAULT ? '(label name)' : opt}
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
                  aria-label={`Display field for ${type} edges`}
                  value={edgeLabelPrefs[type] ?? EDGE_TYPE_DEFAULT}
                  onChange={(e) => setEdgePref(type, e.target.value)}
                >
                  {opts.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt === EDGE_TYPE_DEFAULT ? '(type)' : opt}
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
                ? `Node ${String(selected.data.id)}`
                : `Edge ${String(selected.data.id)}`}
            </h4>
            <pre>{JSON.stringify(selected.data, null, 2)}</pre>
          </>
        ) : (
          <p style={{ opacity: 0.6 }}>
            Click a node or edge to inspect properties.
          </p>
        )}
      </Side>
    </Wrap>
  )
}
