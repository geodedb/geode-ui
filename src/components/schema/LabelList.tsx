import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import { useNavigate } from 'react-router-dom'
import { client } from '../../api/client'
import { useQueryStore } from '../../lib/queryStore'

// LabelList renders the node-label set returned by GET
// /api/v1/graphs/{graph}/labels for the active graph. Clicking a label
// stages a `MATCH (n:`Label`) RETURN n LIMIT 25` statement in the
// queryStore and routes to '/'. QueryPage's mount-effect picks the
// staged statement up and seeds the Monaco editor with it.
//
// The label is wrapped in backticks so labels containing reserved
// characters (spaces, hyphens, etc.) parse cleanly. The LIMIT is fixed
// at 25 to match the schema-explorer plan; users can edit the staged
// statement before running it.
const List = styled.ul`
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const Btn = styled.button`
  text-align: left;
  padding: 6px 10px;
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.text};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  cursor: pointer;
  &:hover {
    background: ${({ theme }) => theme.colors.background};
  }
`

const Empty = styled.p`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-style: italic;
`

export const LabelList: React.FC<{ graph: string }> = ({ graph }) => {
  const [labels, setLabels] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)
  const setStaged = useQueryStore((s) => s.setStaged)
  const nav = useNavigate()

  useEffect(() => {
    if (!graph) return undefined
    let cancelled = false
    setLoaded(false)
    client
      .labels({ graph })
      .then((r) => {
        if (cancelled) return
        setLabels(r.labels ?? [])
        setLoaded(true)
      })
      .catch(() => {
        // The schema explorer presents an empty pane on failure; the
        // surrounding SchemaExplorer component already has the
        // graph-level error UI, and a transient label-fetch failure is
        // not critical enough to surface a second error path here.
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [graph])

  if (loaded && labels.length === 0) {
    return <Empty>No labels.</Empty>
  }

  return (
    <List>
      {labels.map((l) => (
        <li key={l}>
          <Btn
            onClick={() => {
              setStaged('MATCH (n:`' + l + '`) RETURN n LIMIT 25')
              nav('/')
            }}
          >
            {l}
          </Btn>
        </li>
      ))}
    </List>
  )
}
