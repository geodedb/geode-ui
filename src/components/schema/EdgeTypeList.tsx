import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import { useNavigate } from 'react-router-dom'
import { client } from '../../api/client'
import { useQueryStore } from '../../lib/queryStore'

// EdgeTypeList mirrors LabelList for relationship types. Clicking a
// type stages a `MATCH ()-[r:Type]->() RETURN r LIMIT 25` statement
// and navigates to '/'. The LIMIT 25 keeps the preview cheap on large
// graphs; the user can edit before running. Identifiers are emitted
// bare — Geode v0.5.11 rejects backtick-quoted form (42000).
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

export const EdgeTypeList: React.FC<{ graph: string }> = ({ graph }) => {
  const [types, setTypes] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)
  const setStaged = useQueryStore((s) => s.setStaged)
  const nav = useNavigate()

  useEffect(() => {
    if (!graph) return undefined
    let cancelled = false
    setLoaded(false)
    client
      .edgeTypes({ graph })
      .then((r) => {
        if (cancelled) return
        setTypes(r.types ?? [])
        setLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [graph])

  if (loaded && types.length === 0) {
    return <Empty>No edge types.</Empty>
  }

  return (
    <List>
      {types.map((t) => (
        <li key={t}>
          <Btn
            onClick={() => {
              // Prepend `USE GRAPH <graph>;` so the staged query runs
              // against the active graph when the operator clicks Run.
              // Without it Geode executes against no graph context
              // and silently returns 0 rows.
              setStaged(
                'USE GRAPH ' +
                  graph +
                  '; MATCH ()-[r:' +
                  t +
                  ']->() RETURN r LIMIT 25'
              )
              nav('/')
            }}
          >
            {t}
          </Btn>
        </li>
      ))}
    </List>
  )
}
