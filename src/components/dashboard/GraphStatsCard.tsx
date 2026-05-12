import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { Card } from './Card'

// GraphStatsCard — the overview card showing node/edge counts for the
// default graph. The counts come from two `count()` scans, which can be
// slow on a big graph, so they are loaded on demand: until the operator
// clicks "Load stats" the card shows only the button (disabled when
// there is no default graph to count). Wired to useOverviewData's
// `defaultGraphStats` / `statsLoading` / `statsError` / `loadStats`.
const Stats = styled.dl`
  margin: 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: ${({ theme }) => theme.spacing.xxs} ${({ theme }) => theme.spacing.sm};

  dt {
    color: ${({ theme }) => theme.text.muted};
    font-size: ${({ theme }) => theme.font.sizes.sm};
  }

  dd {
    margin: 0;
    color: ${({ theme }) => theme.text.primary};
    font-family: ${({ theme }) => theme.font.family.mono};
  }
`

const LoadButton = styled.button`
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.md};
  color: ${({ theme }) => theme.text.primary};
  cursor: pointer;
  font-family: inherit;
  font-size: ${({ theme }) => theme.font.sizes.sm};
  min-height: 32px;
  padding: 4px 12px;

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.bg.subtle};
    border-color: ${({ theme }) => theme.border.strong};
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  &:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
  }
`

const Status = styled.p`
  color: ${({ theme }) => theme.text.secondary};
  margin: 0;
`

const ErrorText = styled.p`
  color: ${({ theme }) => theme.text.danger};
  margin: 0;
`

export interface GraphStatsCardProps {
  defaultGraph: string | null
  stats: { nodes: number; edges: number } | null
  loading: boolean
  error: string | null
  onLoad: () => void
}

export const GraphStatsCard: React.FC<GraphStatsCardProps> = ({
  defaultGraph,
  stats,
  loading,
  error,
  onLoad,
}) => {
  const { t } = useTranslation()

  const renderBody = (): React.ReactNode => {
    if (loading) {
      return <Status role="status">{t('dashboard.loading')}</Status>
    }
    if (error) {
      return <ErrorText role="alert">{error}</ErrorText>
    }
    if (stats) {
      return (
        <Stats>
          <dt>{t('dashboard.statsNodes')}</dt>
          <dd>{stats.nodes}</dd>
          <dt>{t('dashboard.statsEdges')}</dt>
          <dd>{stats.edges}</dd>
        </Stats>
      )
    }
    return (
      <LoadButton
        data-testid="dashboard-stats-load"
        onClick={onLoad}
        disabled={!defaultGraph}
      >
        {t('dashboard.statsLoad')}
      </LoadButton>
    )
  }

  return (
    <Card
      title={t('dashboard.statsTitle', { graph: defaultGraph ?? '—' })}
      data-testid="dashboard-stats-card"
    >
      {renderBody()}
    </Card>
  )
}
