import React, { useEffect, useRef, useState } from 'react'
import cytoscape, { Core, ElementDefinition } from 'cytoscape'
import styled from 'styled-components'
import { cytoscapeStyle } from './cytoscapeStyle'
import { extractElements, QueryRespLike } from '../../lib/graphResult'

type Selected = { kind: 'node' | 'edge'; data: Record<string, unknown> }

type Props = { resp: QueryRespLike; height?: number }

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

export const GraphView: React.FC<Props> = ({ resp, height = 480 }) => {
  const ref = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const [selected, setSelected] = useState<Selected | null>(null)

  useEffect(() => {
    if (!ref.current) return undefined
    const els: ElementDefinition[] = extractElements(resp)
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
    return () => {
      cy.destroy()
    }
  }, [resp])

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
