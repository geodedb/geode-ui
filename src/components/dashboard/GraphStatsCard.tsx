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
//
// Bootstrap-migrated (docs/BOOTSTRAP_MIGRATION.md):
//   - Stats: the `auto 1fr` grid track expression has no Bootstrap
//     utility equivalent, but the nested dt/dd customisations are
//     simple enough to lift onto the elements themselves. Inline
//     style covers the grid track + 2 px row gap.
//   - LoadButton: KEPT — `&:hover:not(:disabled)` and `&:focus-visible`
//     pseudo-classes with theme-token CSS overrides are exactly the
//     "nested selectors" case the migration guide reserves for
//     styled-components.
//   - Status, ErrorText: collapsed to `<p className="m-0 text-body-
//     secondary / text-danger">` — `--bs-body-color` and `--bs-danger`
//     are wired through the theme bridge.
const statsGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  rowGap: '2px',
  columnGap: '8px',
}

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
      return (
        <p className="m-0 text-body-secondary" role="status">
          {t('dashboard.loading')}
        </p>
      )
    }
    if (error) {
      return (
        <p className="m-0 text-danger" role="alert">
          {error}
        </p>
      )
    }
    if (stats) {
      return (
        <dl className="m-0" style={statsGridStyle}>
          <dt className="text-body-tertiary" style={{ fontSize: '13px' }}>
            {t('dashboard.statsNodes')}
          </dt>
          <dd className="m-0 text-body font-monospace">{stats.nodes}</dd>
          <dt className="text-body-tertiary" style={{ fontSize: '13px' }}>
            {t('dashboard.statsEdges')}
          </dt>
          <dd className="m-0 text-body font-monospace">{stats.edges}</dd>
        </dl>
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
