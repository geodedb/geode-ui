import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import { useNavigate } from 'react-router-dom'
import { client } from '../../api/client'
import { useQueryStore } from '../../lib/queryStore'

// LabelList renders the node-label set returned by GET
// /api/v1/graphs/{graph}/labels for the active graph. Clicking a label
// stages a `MATCH (n:Label) RETURN n LIMIT 25` statement in the
// queryStore and routes to '/'. QueryPage's mount-effect picks the
// staged statement up and seeds the Monaco editor with it.
//
// Labels are emitted bare (no backticks). Geode v0.5.11 rejects
// backtick-quoted identifiers with `42000: expected identifier or
// keyword, got 'invalid'`. If a future Geode supports backticks AND a
// project starts using labels with reserved characters, revisit.
const List = styled.ul`
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
  padding: 0;
  margin: 0;
`

const Btn = styled.button`
  text-align: left;
  padding: 8px 12px;
  min-height: 36px;
  background: ${({ theme }) => theme.bg.surface};
  color: ${({ theme }) => theme.text.primary};
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
  cursor: pointer;
  font-family: inherit;
  font-size: ${({ theme }) => theme.font.sizes.md};

  &:hover {
    background: ${({ theme }) => theme.bg.subtle};
    border-color: ${({ theme }) => theme.border.default};
  }

  &:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
  }
`

const Empty = styled.p`
  color: ${({ theme }) => theme.text.muted};
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
              // Prepend `USE GRAPH <graph>;` so the staged query runs
              // against the active graph when the operator clicks Run
              // on the Query page. Without it Geode executes against
              // no graph context and silently returns 0 rows.
              setStaged(
                'USE GRAPH ' + graph + '; MATCH (n:' + l + ') RETURN n LIMIT 25'
              )
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
