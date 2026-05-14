import React, { useMemo, useState } from 'react'
import styled from 'styled-components'
import { matchesQuery } from './findNode'

type TFn = (key: string, opts?: Record<string, unknown>) => string

const Wrap = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;

  input {
    font: inherit;
    color: ${({ theme }) => theme.text.primary};
    background: ${({ theme }) => theme.bg.canvas};
    border: 1px solid ${({ theme }) => theme.border.default};
    border-radius: ${({ theme }) => theme.radii.sm};
    padding: 2px 8px;
    min-width: 140px;
  }
  .count {
    color: ${({ theme }) => theme.text.muted};
    font-size: ${({ theme }) => theme.font.sizes.xs};
  }
`

export type FindNodeInputProps = {
  nodes: Record<string, unknown>[]
  onPick: (id: string) => void
  t: TFn
}

// FindNodeInput is the toolbar's substring search field. It keeps a
// local query string, filters the supplied `nodes` (typically the
// orchestrator's `nodeDataById.values()` spread) with the pure
// `matchesQuery` helper, surfaces a live match count, and on Enter
// dispatches the first match's id to `onPick`. The toolbar intentionally
// avoids a dropdown — narrow with more typing, then Enter to select.
export const FindNodeInput: React.FC<FindNodeInputProps> = ({
  nodes,
  onPick,
  t,
}) => {
  const [q, setQ] = useState('')
  const matches = useMemo(
    () => nodes.filter((n) => matchesQuery(n, q)),
    [nodes, q]
  )
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== 'Enter' || matches.length === 0) return
    const first = matches[0]
    const id = first && first.id != null ? String(first.id) : ''
    if (id) onPick(id)
  }
  return (
    <Wrap>
      <input
        data-testid="graph-find-input"
        type="search"
        placeholder={t('graph.findPlaceholder')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKey}
        aria-label={t('graph.findAria')}
      />
      <span className="count" data-testid="graph-find-count">
        {q ? t('graph.findCount', { count: matches.length }) : ''}
      </span>
    </Wrap>
  )
}
