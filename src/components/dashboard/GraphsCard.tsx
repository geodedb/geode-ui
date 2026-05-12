import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { Card } from './Card'

// GraphsCard — the overview card listing every graph on the connected
// server. Mirrors the loading / error / empty / data quadrants of the
// other overview cards. Data comes from useOverviewData (`graphs`,
// `loading`, `graphsError`).
const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xxs};

  li {
    color: ${({ theme }) => theme.text.primary};
    font-size: ${({ theme }) => theme.font.sizes.md};
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

const Empty = styled.p`
  color: ${({ theme }) => theme.text.muted};
  font-style: italic;
  margin: 0;
`

export interface GraphsCardProps {
  graphs: string[] | null
  loading: boolean
  error: string | null
}

export const GraphsCard: React.FC<GraphsCardProps> = ({
  graphs,
  loading,
  error,
}) => {
  const { t } = useTranslation()

  const renderBody = (): React.ReactNode => {
    if (loading) {
      return <Status role="status">{t('dashboard.loading')}</Status>
    }
    if (error) {
      return <ErrorText role="alert">{error}</ErrorText>
    }
    if (graphs && graphs.length) {
      return (
        <List>
          {graphs.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </List>
      )
    }
    return <Empty role="note">{t('dashboard.graphsEmpty')}</Empty>
  }

  return (
    <Card
      title={t('dashboard.graphsTitle', { count: graphs?.length ?? 0 })}
      data-testid="dashboard-graphs-card"
    >
      {renderBody()}
    </Card>
  )
}
