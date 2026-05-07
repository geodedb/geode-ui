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
              setStaged('MATCH ()-[r:' + t + ']->() RETURN r LIMIT 25')
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
