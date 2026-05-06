import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import { client } from '../../api/client'
import { LabelList } from './LabelList'
import { EdgeTypeList } from './EdgeTypeList'

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
  grid-template-columns: 200px 1fr 1fr;
  gap: 16px;
  align-items: start;
`

const Pane = styled.div`
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  padding: 12px;
  color: ${({ theme }) => theme.colors.text};

  h3 {
    margin-bottom: 8px;
    font-size: 1rem;
  }

  h4 {
    margin: 12px 0 6px;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: ${({ theme }) => theme.colors.textSecondary};
  }
`

const GraphList = styled.ul`
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const GraphBtn = styled.button<{ $active: boolean }>`
  text-align: left;
  padding: 6px 10px;
  width: 100%;
  background: ${({ $active, theme }) => ($active ? theme.colors.background : 'transparent')};
  color: ${({ theme }) => theme.colors.text};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  cursor: pointer;
`

const Pre = styled.pre`
  background: ${({ theme }) => theme.colors.background};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  padding: 8px;
  font-size: 0.8rem;
  overflow: auto;
  max-height: 200px;
  color: ${({ theme }) => theme.colors.text};
`

const Empty = styled.p`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-style: italic;
`

const ErrText = styled.p`
  color: #ef4444;
`

export const SchemaExplorer: React.FC = () => {
  const [graphs, setGraphs] = useState<string[]>([])
  const [active, setActive] = useState<string>('')
  const [err, setErr] = useState<string | null>(null)
  const [indexes, setIndexes] = useState<Array<Record<string, unknown>>>([])
  const [constraints, setConstraints] = useState<Array<Record<string, unknown>>>([])

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
        {active ? <EdgeTypeList graph={active} /> : <Empty>Select a graph.</Empty>}
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
