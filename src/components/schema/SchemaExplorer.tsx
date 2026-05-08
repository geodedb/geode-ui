import React, { useEffect, useState } from 'react'
import styled from 'styled-components'

import { client } from '../../api/client'
import type { Theme } from '../../theme'
import { below } from '../../theme'
import { LabelList } from './LabelList'
import { EdgeTypeList } from './EdgeTypeList'

interface ActiveProps {
  theme: Theme
  $active: boolean
}

function graphBtnBg({ $active, theme }: ActiveProps): string {
  return $active ? theme.bg.subtle : 'transparent'
}

function graphBtnBorder({ $active, theme }: ActiveProps): string {
  return $active ? theme.border.default : theme.border.subtle
}

// SchemaExplorer is the three-column panel:
//
//   1. Graph picker (driven by GET /api/v1/graphs)
//   2. Labels for the active graph
//   3. Edge types + indexes + constraints for the active graph
//
// The picker auto-selects the first graph the server returns so the
// Labels / Edge-types panes have something to render on first load. If
// the server returns no graphs, the right-hand panes stay empty. Both
// indexes and constraints are dumped as JSON for now -- the underlying
// API returns `Array<Record<string, unknown>>`, which we don't yet have
// strong typing for at the UI layer.
const Layout = styled.div`
  display: grid;
  grid-template-columns: 220px 1fr 1fr;
  gap: ${({ theme }) => theme.spacing.md};
  align-items: start;

  ${below('lg')`
    grid-template-columns: 1fr 1fr;
  `}

  ${below('md')`
    grid-template-columns: 1fr;
  `}
`

const Pane = styled.section`
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.lg};
  padding: ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.text.primary};

  h3 {
    margin: 0 0 ${({ theme }) => theme.spacing.sm};
    font-family: ${({ theme }) => theme.font.family.display};
    font-size: ${({ theme }) => theme.font.sizes.lg};
    font-weight: ${({ theme }) => theme.font.weights.semibold};
  }

  h4 {
    margin: ${({ theme }) => theme.spacing.md} 0
      ${({ theme }) => theme.spacing.xs};
    font-size: ${({ theme }) => theme.font.sizes.sm};
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: ${({ theme }) => theme.text.secondary};
  }
`

const GraphList = styled.ul`
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
  padding: 0;
  margin: 0;
`

const GraphBtn = styled.button<{ $active: boolean }>`
  text-align: left;
  padding: 8px 12px;
  width: 100%;
  min-height: 36px;
  background: ${graphBtnBg};
  color: ${({ theme }) => theme.text.primary};
  border: 1px solid ${graphBtnBorder};
  border-radius: ${({ theme }) => theme.radii.md};
  cursor: pointer;
  font-family: inherit;
  font-size: ${({ theme }) => theme.font.sizes.md};

  &:hover {
    background: ${({ theme }) => theme.bg.subtle};
  }

  &:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
  }
`

const Pre = styled.pre`
  background: ${({ theme }) => theme.bg.canvas};
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.sm};
  font-family: ${({ theme }) => theme.font.family.mono};
  font-size: ${({ theme }) => theme.font.sizes.xs};
  overflow: auto;
  max-height: 200px;
  color: ${({ theme }) => theme.text.primary};
`

const Empty = styled.p`
  color: ${({ theme }) => theme.text.muted};
  font-style: italic;
`

const ErrText = styled.p`
  color: ${({ theme }) => theme.text.danger};
`

export const SchemaExplorer: React.FC = () => {
  const [graphs, setGraphs] = useState<string[]>([])
  const [active, setActive] = useState<string>('')
  const [err, setErr] = useState<string | null>(null)
  const [indexes, setIndexes] = useState<Array<Record<string, unknown>>>([])
  const [constraints, setConstraints] = useState<
    Array<Record<string, unknown>>
  >([])

  // Initial graph fetch. Empty deps -- runs once on mount. The first
  // returned graph becomes active so the right-hand panes have data.
  useEffect(() => {
    let cancelled = false
    client
      .graphs({})
      .then((r) => {
        if (cancelled) return
        const list = r?.graphs ?? []
        setGraphs(list)
        const first = list[0]
        if (first !== undefined) setActive(first)
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Re-fetch indexes & constraints whenever the active graph changes.
  // The genapi client returns ConstraintList / IndexList where each
  // entry is `Record<string, unknown>`, which we render as JSON.
  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    client
      .indexes({ graph: active })
      .then((r) => {
        if (!cancelled) setIndexes(r.indexes ?? [])
      })
      .catch(() => {
        if (!cancelled) setIndexes([])
      })
    client
      .constraints({ graph: active })
      .then((r) => {
        if (!cancelled) setConstraints(r.constraints ?? [])
      })
      .catch(() => {
        if (!cancelled) setConstraints([])
      })
    return () => {
      cancelled = true
    }
  }, [active])

  return (
    <Layout>
      <Pane>
        <h3>Graphs</h3>
        {err && <ErrText>{err}</ErrText>}
        {graphs.length === 0 && !err && <Empty>No graphs.</Empty>}
        <GraphList>
          {graphs.map((g) => (
            <li key={g}>
              <GraphBtn $active={g === active} onClick={() => setActive(g)}>
                {g}
              </GraphBtn>
            </li>
          ))}
        </GraphList>
      </Pane>
      <Pane>
        <h3>{active ? 'Labels (' + active + ')' : 'Labels'}</h3>
        {active ? <LabelList graph={active} /> : <Empty>Select a graph.</Empty>}
      </Pane>
      <Pane>
        <h3>{active ? 'Edge types (' + active + ')' : 'Edge types'}</h3>
        {active ? (
          <EdgeTypeList graph={active} />
        ) : (
          <Empty>Select a graph.</Empty>
        )}
        {active && (
          <>
            <h4>Indexes</h4>
            {indexes.length > 0 ? (
              <Pre>{JSON.stringify(indexes, null, 2)}</Pre>
            ) : (
              <Empty>No indexes.</Empty>
            )}
            <h4>Constraints</h4>
            {constraints.length > 0 ? (
              <Pre>{JSON.stringify(constraints, null, 2)}</Pre>
            ) : (
              <Empty>No constraints.</Empty>
            )}
          </>
        )}
      </Pane>
    </Layout>
  )
}
