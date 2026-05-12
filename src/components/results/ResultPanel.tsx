import React, { Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import type { QueryResp } from '@api'
import type { Theme } from '../../theme'
import { TableView } from './TableView'
import { JsonView } from './JsonView'
import { MatrixView } from './MatrixView'

// F10 (#54): Cytoscape (~hundreds of KiB) is React.lazy'd so webpack
// emits it as a separate async chunk that is only fetched when the
// graph tab mounts.
const GraphView = React.lazy(() =>
  import('./GraphView').then((m) => ({
    default: m.GraphView,
  }))
)

interface TabProps {
  theme: Theme
  $active: boolean
}

function tabBg({ $active, theme }: TabProps): string {
  return $active ? theme.bg.subtle : 'transparent'
}

function tabColor({ $active, theme }: TabProps): string {
  return $active ? theme.text.primary : theme.text.secondary
}

function tabBorder({ $active, theme }: TabProps): string {
  return $active ? theme.border.default : 'transparent'
}

export type ResultTab = 'table' | 'json' | 'graph' | 'matrix'

export type ResultPanelProps = {
  resp: QueryResp
  query?: string
  tab: ResultTab
  onTabChange: (t: ResultTab) => void
  maximized?: boolean
  expand?: boolean
  onToggleMaximize?: () => void
  maximizeBtnRef?: React.Ref<HTMLButtonElement>
}

// Tab buttons drive content swap inside the result panel. We keep them
// as a styled element (not the shared Button primitive) because
// role=tab + aria-selected differs from role=button — the WAI tab
// pattern is its own a11y contract.
const TabBtn = styled.button<{ $active: boolean }>`
  padding: 6px 14px;
  background: ${tabBg};
  color: ${tabColor};
  border: 1px solid ${tabBorder};
  border-radius: ${({ theme }) => theme.radii.md};
  cursor: pointer;
  font-family: inherit;
  font-weight: ${({ theme }) => theme.font.weights.medium};
  text-transform: capitalize;
  min-height: 32px;

  &:hover {
    background: ${({ theme }) => theme.bg.subtle};
    color: ${({ theme }) => theme.text.primary};
  }

  &:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
  }
`

const Tabs = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.xs};
  margin: ${({ theme }) => theme.spacing.md} 0
    ${({ theme }) => theme.spacing.sm};
`

// Maximize toggle in the result-panel toolbar. Styled like the tab
// buttons (it sits in the same row) but it's a plain button, not a
// WAI tab — aria-pressed reflects the maximized state.
const MaximizeBtn = styled.button`
  margin-left: auto;
  padding: 6px 12px;
  background: transparent;
  color: ${({ theme }) => theme.text.secondary};
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.md};
  cursor: pointer;
  font-family: inherit;
  font-weight: ${({ theme }) => theme.font.weights.medium};
  min-height: 32px;

  &:hover {
    background: ${({ theme }) => theme.bg.subtle};
    color: ${({ theme }) => theme.text.primary};
  }
  &[aria-pressed='true'] {
    background: ${({ theme }) => theme.bg.subtle};
    color: ${({ theme }) => theme.text.primary};
    border-color: ${({ theme }) => theme.border.strong};
  }
  &:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
  }
`

export const ResultPanel: React.FC<ResultPanelProps> = ({
  resp,
  query,
  tab,
  onTabChange,
  maximized = false,
  expand = true,
  onToggleMaximize,
  maximizeBtnRef,
}) => {
  const { t } = useTranslation()

  // F10 (#54): Suspense fallback shown while the lazy Cytoscape graph
  // chunk downloads. Held as a local so the multiline JSX doesn't run
  // into the airbnb/prettier disagreement on parenthesising JSX in
  // props. role=status keeps it announced to assistive tech.
  const graphFallback = <div role="status">{t('query.loadingGraph')}</div>

  return (
    <>
      <Tabs role="tablist" aria-label={t('query.resultViewLabel')}>
        {(
          [
            ['table', t('query.tabTable')],
            ['json', t('query.tabJson')],
            ['graph', t('query.tabGraph')],
            ['matrix', t('query.tabMatrix')],
          ] as const
        ).map(([kind, label]) => (
          <TabBtn
            key={kind}
            role="tab"
            aria-selected={tab === kind}
            aria-controls={`result-panel-${kind}`}
            tabIndex={tab === kind ? 0 : -1}
            $active={tab === kind}
            onClick={() => onTabChange(kind)}
          >
            {label}
          </TabBtn>
        ))}
        {onToggleMaximize && (
          <MaximizeBtn
            ref={maximizeBtnRef}
            type="button"
            data-testid="result-fullscreen-toggle"
            aria-pressed={maximized}
            aria-label={
              maximized ? t('query.exitFullscreen') : t('query.maximizeResults')
            }
            title={
              maximized ? t('query.exitFullscreen') : t('query.maximizeResults')
            }
            onClick={onToggleMaximize}
          >
            {maximized ? '⤡' : '⤢'}
          </MaximizeBtn>
        )}
      </Tabs>
      <div
        id={`result-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`result-panel-${tab}`}
      >
        {tab === 'table' && (
          <TableView resp={resp} expand={expand} fillHeight={maximized} />
        )}
        {tab === 'json' && <JsonView data={resp} fillHeight={maximized} />}
        {tab === 'graph' && (
          <Suspense fallback={graphFallback}>
            <GraphView resp={resp} query={query} fillHeight={maximized} />
          </Suspense>
        )}
        {tab === 'matrix' && <MatrixView resp={resp} query={query} />}
      </div>
    </>
  )
}
