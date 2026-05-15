// WorkspacePage — mounted at /workspace. Renders a tiled grid of
// independent query panes (each WorkspacePane owns its own stream) plus a
// header with an "Add pane" control. The pane set is managed by
// useWorkspacePanes (capped at MAX_PANES); a pane can be closed via its
// own close button as long as more than one pane remains.

import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { Button } from '../components/ui'
import { WorkspacePane } from './workspace/WorkspacePane'
import { useWorkspacePanes, MAX_PANES } from './workspace/useWorkspacePanes'

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`

const Grid = styled.div<{ $count: number }>`
  display: grid;
  gap: ${({ theme }) => theme.spacing.md};
  grid-template-columns: ${({ $count }) => ($count <= 1 ? '1fr' : '1fr 1fr')};

  @media (max-width: ${({ theme }) => theme.breakpoints.md}px) {
    grid-template-columns: 1fr;
  }
`

export const WorkspacePage: React.FC = () => {
  const { t } = useTranslation()
  const { panes, addPane, removePane } = useWorkspacePanes()
  const full = panes.length >= MAX_PANES
  return (
    <div>
      <Header>
        <h1>{t('workspace.title')}</h1>
        <Button
          data-testid="workspace-add-pane"
          onClick={addPane}
          disabled={full}
          title={full ? t('workspace.panesFull') : t('workspace.addPane')}
        >
          {t('workspace.addPane')}
        </Button>
      </Header>
      <Grid $count={panes.length}>
        {panes.map((id) => (
          <WorkspacePane
            key={id}
            paneId={id}
            canClose={panes.length > 1}
            onClose={removePane}
          />
        ))}
      </Grid>
    </div>
  )
}
