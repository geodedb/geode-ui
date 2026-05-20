import React from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import styled from 'styled-components'

import { Card } from './Card'
import type { QueryHistoryEntry } from '../../lib/useQueryHistory'

// RecentQueriesCard — the overview card listing the last few statements
// the operator ran (from useQueryHistory). Each row deep-links back to
// the Query page with `?statement=` so a click re-loads the editor with
// that text. The header action clears the whole log.
const Row = styled.li`
  display: flex;
  align-items: baseline;
  gap: ${({ theme }) => theme.spacing.sm};
  font-size: ${({ theme }) => theme.font.sizes.sm};

  a {
    color: ${({ theme }) => theme.text.link};
    font-family: ${({ theme }) => theme.font.family.mono};
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    color: ${({ theme }) => theme.text.muted};
    white-space: nowrap;
  }
`

const ClearButton = styled.button`
  background: transparent;
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.sm};
  color: ${({ theme }) => theme.text.secondary};
  cursor: pointer;
  font-family: inherit;
  font-size: ${({ theme }) => theme.font.sizes.sm};
  padding: 2px 10px;
  min-height: 28px;

  &:hover {
    background: ${({ theme }) => theme.bg.subtle};
    color: ${({ theme }) => theme.text.primary};
  }

  &:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
  }
`

const Empty = styled.p`
  color: ${({ theme }) => theme.text.muted};
  font-style: italic;
  margin: 0;
`

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

export interface RecentQueriesCardProps {
  entries: QueryHistoryEntry[]
  onClear: () => void
}

export const RecentQueriesCard: React.FC<RecentQueriesCardProps> = ({
  entries,
  onClear,
}) => {
  const { t } = useTranslation()
  const clearAction = (
    <ClearButton onClick={onClear}>{t('dashboard.clearHistory')}</ClearButton>
  )
  // The card describes itself as "session query history" rather than
  // the prior "recent queries" because the store (useQueryHistory) is
  // localStorage-only — clearing the browser, switching devices, or
  // signing in from a fresh OS user wipes it silently. The scope-hint
  // line keeps that contract visible alongside the title so a hurried
  // operator doesn't mistake it for a server-backed audit slice.
  return (
    <Card
      title={t('dashboard.recentTitle')}
      action={clearAction}
      data-testid="dashboard-recent-card"
    >
      <p
        className="mb-2 small text-body-secondary fst-italic"
        data-testid="dashboard-recent-scope-hint"
      >
        {t('dashboard.recentScopeHint')}
      </p>
      {entries.length ? (
        <ul className="list-unstyled m-0 p-0 d-flex flex-column gap-1">
          {entries.map((e) => (
            <Row
              key={`${e.ranAt}:${e.statement}`}
              data-testid="dashboard-recent-row"
            >
              <Link to={`/?statement=${encodeURIComponent(e.statement)}`}>
                {truncate(e.statement, 80)}
              </Link>
              <span>{new Date(e.ranAt).toLocaleString()}</span>
              <span>
                {e.rowCount == null
                  ? t('dashboard.recentFailed')
                  : t('common.rowCount', { count: e.rowCount })}
              </span>
            </Row>
          ))}
        </ul>
      ) : (
        <Empty role="note">{t('dashboard.recentEmpty')}</Empty>
      )}
    </Card>
  )
}
