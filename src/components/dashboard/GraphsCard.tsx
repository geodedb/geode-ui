import React from 'react'
import { useTranslation } from 'react-i18next'

import { Card } from './Card'

// GraphsCard — the overview card listing every graph on the connected
// server. Mirrors the loading / error / empty / data quadrants of the
// other overview cards. Data comes from useOverviewData (`graphs`,
// `loading`, `graphsError`).
//
// Bootstrap-migrated (docs/BOOTSTRAP_MIGRATION.md): every styled-component
// here was a single-block CSS rule whose theme tokens (text.*) resolve
// through the `--bs-*` bridge, so they collapse to plain elements with
// utility classes. The list 2 px gap and 14 px font-size are the only
// values without exact utility equivalents and stay as inline style.

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
    if (graphs && graphs.length) {
      return (
        <ul
          className="list-unstyled m-0 p-0 d-flex flex-column"
          style={{ gap: '2px' }}
        >
          {graphs.map((g) => (
            <li key={g} className="text-body" style={{ fontSize: '14px' }}>
              {g}
            </li>
          ))}
        </ul>
      )
    }
    return (
      <p className="m-0 fst-italic text-body-tertiary" role="note">
        {t('dashboard.graphsEmpty')}
      </p>
    )
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
