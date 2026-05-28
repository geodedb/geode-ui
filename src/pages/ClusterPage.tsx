import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { useClusterStatus } from '../lib/useClusterStatus'
import { isClusterMode } from '../api/cluster'
import { MembersTable } from '../components/cluster/MembersTable'

// ClusterPage — full Raft cluster view at /cluster.
//
// Branches by hook state:
//   - snapshot=null + loading      → "Loading cluster status…"
//   - snapshot=null + error        → error panel
//   - snapshot && !isClusterMode   → standalone panel
//   - snapshot && isClusterMode    → header + MembersTable
//
// Polling is owned by the hook (5 s interval here for a fresher
// "operator is watching an election" view; dashboard card uses 10 s).
// Manual refresh button fires hook.refresh() so an operator can pull
// fresh state immediately without waiting for the next tick.
const Page = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.lg};
`

const HeaderRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${({ theme }) => theme.spacing.md};
`

const HeaderText = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const Subtitle = styled.p`
  margin: 0;
  color: ${({ theme }) => theme.text.secondary};
  font-size: 13px;
`

const Updated = styled.span`
  font-size: 12px;
  color: ${({ theme }) => theme.text.muted};
  margin-right: 8px;
`

const RefreshBtn = styled.button`
  background: ${({ theme }) => theme.bg.subtle};
  color: ${({ theme }) => theme.text.primary};
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;

  &:hover {
    background: ${({ theme }) => theme.bg.surface};
  }
  &:disabled {
    opacity: 0.6;
    cursor: progress;
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.border.focus};
    outline-offset: 2px;
  }
`

const Panel = styled.section`
  padding: ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
  color: ${({ theme }) => theme.text.primary};
`

const ErrorPanel = styled(Panel)`
  border-color: ${({ theme }) => theme.colors.danger};
  color: ${({ theme }) => theme.text.primary};
`

function formatUpdated(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const d = new Date(ms)
  return d.toLocaleTimeString()
}

export const ClusterPage: React.FC = () => {
  const { t } = useTranslation()
  const cluster = useClusterStatus({ intervalMs: 5000 })

  const renderBody = (): React.ReactNode => {
    if (cluster.error && !cluster.snapshot) {
      return (
        <ErrorPanel role="alert" data-testid="cluster-error-panel">
          <h2 style={{ margin: 0, fontSize: '15px' }}>
            {t('cluster.errorTitle')}
          </h2>
          <p style={{ margin: '6px 0 0 0' }}>{cluster.error}</p>
        </ErrorPanel>
      )
    }
    if (!cluster.snapshot) {
      return (
        <Panel role="status" data-testid="cluster-loading">
          <p style={{ margin: 0 }}>{t('cluster.loading')}</p>
        </Panel>
      )
    }
    if (!isClusterMode(cluster.snapshot.members)) {
      return (
        <Panel data-testid="cluster-standalone-panel">
          <h2 style={{ margin: 0, fontSize: '15px' }}>
            {t('cluster.standaloneTitle')}
          </h2>
          <p style={{ margin: '6px 0 0 0' }}>{t('cluster.standaloneBody')}</p>
        </Panel>
      )
    }
    return (
      <Panel data-testid="cluster-members-panel">
        <h2 style={{ margin: 0, marginBottom: '8px', fontSize: '15px' }}>
          {t('cluster.membersHeading')}
        </h2>
        <MembersTable
          members={cluster.snapshot.members}
          selfNodeId={cluster.snapshot.selfNodeId}
        />
      </Panel>
    )
  }

  let updatedLabel = ''
  if (cluster.snapshot) {
    const when = formatUpdated(cluster.snapshot.fetchedAt)
    updatedLabel = t('cluster.lastUpdated', { when })
  }

  return (
    <Page>
      <HeaderRow>
        <HeaderText>
          <h1 style={{ margin: 0 }}>{t('cluster.title')}</h1>
          <Subtitle>{t('cluster.subtitle')}</Subtitle>
        </HeaderText>
        <div>
          {updatedLabel ? <Updated>{updatedLabel}</Updated> : null}
          <RefreshBtn
            type="button"
            data-testid="cluster-refresh-btn"
            aria-label={t('cluster.refreshAria')}
            disabled={cluster.loading}
            onClick={() => {
              cluster.refresh().catch(() => {
                /* error surfaces via hook state */
              })
            }}
          >
            {cluster.loading ? t('cluster.refreshing') : t('cluster.refresh')}
          </RefreshBtn>
        </div>
      </HeaderRow>
      {renderBody()}
    </Page>
  )
}
