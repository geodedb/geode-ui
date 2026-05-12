// WorkspacePane — one pane of the multi-pane workspace.
//
// A pane bundles its own streaming query state (usePane → its own
// WebSocket), the lazy Monaco editor, a small toolbar (Run / Cancel
// plus a "close pane" ×), a row-count / error line, and the shared
// ResultPanel. Maximize lives on QueryPage's single result panel, not
// here — a pane is already a constrained tile, so it renders ResultPanel
// without the maximize toggle.

import React, { Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { Button } from '../../components/ui'
import { ResultPanel } from '../../components/results/ResultPanel'
import { usePane } from './usePane'

// F10 (#54) parity with QueryPage: Monaco (~MiB-scale) is React.lazy'd
// so webpack emits it as a separate async chunk fetched only when a
// pane's editor mounts. The monaco-bootstrap side-effect rides inside
// the GqlEditor module so it falls into the lazy chunk too.
const GqlEditor = React.lazy(() =>
  import('../../components/editor/GqlEditor').then((m) => ({
    default: m.GqlEditor,
  }))
)

const Pane = styled.section`
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.lg};
  background: ${({ theme }) => theme.bg.surface};
  overflow: hidden;
`

const PaneBar = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  align-items: center;
  flex-wrap: wrap;
  padding: ${({ theme }) => theme.spacing.sm};
  color: ${({ theme }) => theme.text.secondary};
  font-size: ${({ theme }) => theme.font.sizes.sm};
`

const CloseBtn = styled.button`
  margin-left: auto;
  background: transparent;
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.md};
  color: ${({ theme }) => theme.text.secondary};
  cursor: pointer;
  min-height: 32px;
  padding: 0 10px;
  font-family: inherit;

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.bg.subtle};
    color: ${({ theme }) => theme.text.primary};
  }
  &:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
  }
`

const PaneBody = styled.div`
  padding: 0 ${({ theme }) => theme.spacing.sm}
    ${({ theme }) => theme.spacing.sm};
  overflow: auto;
`

const Err = styled.span`
  color: ${({ theme }) => theme.text.danger};
`

// Suspense fallback for the lazy Monaco editor chunk (F10 / #54). Held
// as a local so the multiline JSX doesn't run into the airbnb/prettier
// disagreement on parenthesising JSX in props. role=status keeps it
// announced to assistive tech.
const LazyFallback = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  color: ${({ theme }) => theme.text.secondary};
  font-size: ${({ theme }) => theme.font.sizes.sm};
  background: ${({ theme }) => theme.bg.subtle};
`

export type WorkspacePaneProps = {
  paneId: string
  canClose: boolean
  onClose: (paneId: string) => void
}

export const WorkspacePane: React.FC<WorkspacePaneProps> = ({
  paneId,
  canClose,
  onClose,
}) => {
  const { t } = useTranslation()
  const pane = usePane()

  const editorFallback = (
    <LazyFallback role="status">{t('query.loadingEditor')}</LazyFallback>
  )

  return (
    <Pane data-testid="workspace-pane" aria-label={paneId}>
      <Suspense fallback={editorFallback}>
        <GqlEditor
          value={pane.statement}
          onChange={pane.setStatement}
          onRun={pane.run}
        />
      </Suspense>
      <PaneBar>
        <Button
          size="sm"
          onClick={pane.run}
          loading={pane.busy}
          data-testid="pane-run-btn"
        >
          {t('workspace.paneRun')}
        </Button>
        {pane.busy && (
          <Button size="sm" variant="secondary" onClick={pane.cancel}>
            {t('workspace.paneCancel')}
          </Button>
        )}
        {pane.resp && (
          <span>
            {t('common.rowCount', { count: pane.resp.row_count ?? 0 })}
          </span>
        )}
        {pane.err && <Err>{pane.err}</Err>}
        <CloseBtn
          type="button"
          data-testid="pane-close-btn"
          disabled={!canClose}
          aria-label={t('workspace.closePane')}
          title={t('workspace.closePane')}
          onClick={() => onClose(paneId)}
        >
          ×
        </CloseBtn>
      </PaneBar>
      <PaneBody>
        {pane.resp ? (
          <ResultPanel
            resp={pane.resp}
            query={pane.statement}
            tab={pane.tab}
            onTabChange={pane.setTab}
            expand
          />
        ) : (
          <p role="note">{t('workspace.paneEmpty')}</p>
        )}
      </PaneBody>
    </Pane>
  )
}
