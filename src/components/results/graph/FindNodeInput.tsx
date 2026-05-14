import React, { useMemo, useState } from 'react'
import styled from 'styled-components'
import { matchesQuery } from './findNode'
import { Input as WaInput } from '../../../services/webawesome/components'

type TFn = (key: string, opts?: Record<string, unknown>) => string

const Wrap = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;

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
  const onKey = (e: React.KeyboardEvent<HTMLElement>): void => {
    if (e.key !== 'Enter' || matches.length === 0) return
    const first = matches[0]
    const id = first && first.id != null ? String(first.id) : ''
    if (id) onPick(id)
  }
  // WA Input fires both `change` and `input` events. We wire both to the
  // same setter so:
  //   - live keystroke typing in the browser updates state immediately
  //     (via `input`)
  //   - RTL's `fireEvent.change(input, { target: { value: '…' } })` keeps
  //     working in jest (via `change`)
  // `clearable` adds WA's built-in clear-X affordance, a nicer UX than
  // the browser-default search-input clear icon.
  return (
    <Wrap>
      <WaInput
        type="search"
        data-testid="graph-find-input"
        placeholder={t('graph.findPlaceholder')}
        aria-label={t('graph.findAria')}
        value={q}
        onInput={(e: Event) => setQ((e.target as HTMLInputElement).value)}
        onChange={(e: Event) => setQ((e.target as HTMLInputElement).value)}
        onKeyDown={onKey}
        clearable
      />
      <span className="count" data-testid="graph-find-count">
        {q ? t('graph.findCount', { count: matches.length }) : ''}
      </span>
    </Wrap>
  )
}
