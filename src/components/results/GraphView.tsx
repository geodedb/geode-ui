import React, { useEffect, useRef, useState } from 'react'
import cytoscape, { Core, ElementDefinition } from 'cytoscape'
import styled from 'styled-components'
import { cytoscapeStyle } from './cytoscapeStyle'
import { extractElements, QueryRespLike } from '../../lib/graphResult'

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

function respSignature(resp: QueryRespLike & { row_count?: number }): number {
  // Stream messages do NOT include row_count until the summary frame; for
  // the streaming case we fall back to rows.length so the signature
  // changes monotonically as rows arrive. Single-shot resps include
  // row_count once and the signature is stable thereafter.
  if (typeof resp.row_count === 'number') return resp.row_count
  return resp.rows ? resp.rows.length : 0
}

export const GraphView: React.FC<Props> = ({ resp, height = 480 }) => {
  const ref = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const [selected, setSelected] = useState<Selected | null>(null)

  // Track the resp by reference so the debounced rebuild always reads
  // the latest snapshot when it fires (without re-creating the timer
  // every render).
  const respRef = useRef(resp)
  respRef.current = resp

  const sig = respSignature(resp)

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
      const els: ElementDefinition[] = extractElements(respRef.current)
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

  return (
    <Wrap>
      <Canvas ref={ref} $height={height} />
      <Side $height={height}>
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
