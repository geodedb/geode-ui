// DashboardPage — mounted at /dashboard. The "overview" home view: a
// responsive grid of small cards summarising the connected server (graph
// list, recent queries, connection/capabilities, default-graph stats).
// Each card is a presentational component from src/components/dashboard/;
// the data is supplied by useOverviewData() and useQueryHistory().

import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { useOverviewData } from '../lib/useOverviewData'
import { useQueryHistory } from '../lib/useQueryHistory'
import { GraphsCard } from '../components/dashboard/GraphsCard'
import { RecentQueriesCard } from '../components/dashboard/RecentQueriesCard'
import { ConnectionCard } from '../components/dashboard/ConnectionCard'
import { GraphStatsCard } from '../components/dashboard/GraphStatsCard'

const Grid = styled.div`
  display: grid;
  gap: ${({ theme }) => theme.spacing.md};
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  margin-top: ${({ theme }) => theme.spacing.md};
`

// The graph whose stats the GraphStatsCard offers to load: prefer a
// graph literally named 'default', else the first graph, else nothing.
function pickDefaultGraph(graphs: string[] | null): string | null {
  if (!graphs || graphs.length === 0) return null
  if (graphs.includes('default')) return 'default'
  return graphs[0] ?? null
}

export const DashboardPage: React.FC = () => {
  const { t } = useTranslation()
  const ov = useOverviewData()
  const entries = useQueryHistory((s) => s.entries)
  const clear = useQueryHistory((s) => s.clear)
  const defaultGraph = pickDefaultGraph(ov.graphs)
  return (
    <div>
      <h1>{t('dashboard.title')}</h1>
      <Grid>
        <GraphsCard
          graphs={ov.graphs}
          loading={ov.loading}
          error={ov.graphsError}
        />
        <RecentQueriesCard entries={entries} onClear={clear} />
        <ConnectionCard
          geodeVersion={ov.geodeVersion}
          adminWritable={ov.adminWritable}
          loading={ov.loading}
          error={ov.capsError}
        />
        <GraphStatsCard
          defaultGraph={defaultGraph}
          stats={ov.defaultGraphStats}
          loading={ov.statsLoading}
          error={ov.statsError}
          onLoad={() => {
            if (defaultGraph) ov.loadStats(defaultGraph)
          }}
        />
      </Grid>
    </div>
  )
}
