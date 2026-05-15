import React, { Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import type { QueryResp } from '@api'
import { TableView } from './TableView'
import { JsonView } from './JsonView'
import { MatrixView } from './MatrixView'
import { TabGroup, Tab, TabPanel } from '../../services/webawesome/components'

// F10 (#54): Cytoscape (~hundreds of KiB) is React.lazy'd so webpack
// emits it as a separate async chunk that is only fetched when the
// graph tab mounts.
const GraphView = React.lazy(() =>
  import('./GraphView').then((m) => ({
    default: m.GraphView,
  }))
)

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

// TabsRow hosts the WA <wa-tab-group> + the maximize toggle. It is a
// flex column (not row!) so the active TabPanel below the tab strip
// grows to fill the available height. The tab strip itself stays as a
// horizontal row via tab-group's internal styling. flex: 1 1 0 +
// min-height: 0 propagate the viewport-fill chain from QueryPage's
// ResultRegion down into the active panel.
const TabsRow = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0;
  margin: ${({ theme }) => theme.spacing.sm} 0 0;
  gap: ${({ theme }) => theme.spacing.xs};

  /* The WA tab-group host renders the nav row + the active panel. Pin
     its flex to grow so the active panel uses the column height. */
  wa-tab-group {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* WA mounts active panels as the slot consumer; force the wrapper
     to expand. The light-DOM <wa-tab-panel> elements participate in
     the flex chain through ::part(body) only on browsers; in jsdom
     the styled descendant selector below is enough for the unit
     tests. */
  wa-tab-panel {
    flex: 1 1 0;
    min-height: 0;
  }

  wa-tab-panel[active] {
    display: flex;
    flex-direction: column;
  }
`

// MaximizeBtnRow is a separate row that floats the toggle to the
// right above the tab strip (the previous design placed it as a
// sibling of <wa-tab-group> in a single row; with tab-group as
// flex: 1 1 0 the toggle would have stretched the tab strip).
const MaximizeBtnRow = styled.div`
  display: flex;
  justify-content: flex-end;
  margin-bottom: -${({ theme }) => theme.spacing.xs};
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
    <TabsRow>
      {onToggleMaximize && (
        <MaximizeBtnRow>
          <wa-button
            ref={maximizeBtnRef as React.Ref<HTMLElement>}
            appearance="outlined"
            size="s"
            data-testid="result-fullscreen-toggle"
            aria-pressed={maximized ? 'true' : 'false'}
            aria-label={
              maximized ? t('query.exitFullscreen') : t('query.maximizeResults')
            }
            title={
              maximized ? t('query.exitFullscreen') : t('query.maximizeResults')
            }
            onClick={onToggleMaximize}
          >
            {maximized ? '⤡' : '⤢'}
          </wa-button>
        </MaximizeBtnRow>
      )}
      <TabGroup
        role="tablist"
        aria-label={t('query.resultViewLabel')}
        active={tab}
        onWaTabShow={(e: Event) => {
          // Forward keyboard-driven tab switches (arrow keys inside the
          // tab strip) — the click path is handled per-<Tab> below
          // because jsdom's shadow-DOM event retargeting doesn't reach
          // tab-group's internal click handler in unit tests.
          const detail = (e as CustomEvent<{ name: string }>).detail
          if (detail && typeof detail.name === 'string') {
            onTabChange(detail.name as ResultTab)
          }
        }}
      >
        <Tab
          slot="nav"
          panel="table"
          data-testid="result-tab-table"
          onClick={() => onTabChange('table')}
        >
          {t('query.tabTable')}
        </Tab>
        <Tab
          slot="nav"
          panel="json"
          data-testid="result-tab-json"
          onClick={() => onTabChange('json')}
        >
          {t('query.tabJson')}
        </Tab>
        <Tab
          slot="nav"
          panel="graph"
          data-testid="result-tab-graph"
          onClick={() => onTabChange('graph')}
        >
          {t('query.tabGraph')}
        </Tab>
        <Tab
          slot="nav"
          panel="matrix"
          data-testid="result-tab-matrix"
          onClick={() => onTabChange('matrix')}
        >
          {t('query.tabMatrix')}
        </Tab>

        {/* All four TabPanels stay mounted so WA's tab-group can track
            them in its own panels[] cache, but we gate each panel's
            BODY on `tab` and also force `active` + `aria-hidden`
            ourselves rather than rely on WA's setActiveTab side-effect:
              - GraphView pulls in the lazy Cytoscape chunk (F10 / #54)
                and must NOT download until the user opens the graph
                tab; conditional content keeps that contract.
              - TableView / JsonView / MatrixView re-derive from the
                full response on every re-render; keeping their work
                running while hidden burns CPU for no UX benefit.
              - aria-hidden is forced by us so the single-tabpanel a11y
                contract holds even in test environments (jsdom) where
                the tab-group's slot/MutationObserver chain that
                normally sets aria-hidden does not run. */}
        <TabPanel
          name="table"
          id="result-panel-table"
          active={tab === 'table'}
          aria-hidden={tab === 'table' ? 'false' : 'true'}
        >
          {tab === 'table' && <TableView resp={resp} expand={expand} />}
        </TabPanel>
        <TabPanel
          name="json"
          id="result-panel-json"
          active={tab === 'json'}
          aria-hidden={tab === 'json' ? 'false' : 'true'}
        >
          {tab === 'json' && <JsonView data={resp} />}
        </TabPanel>
        <TabPanel
          name="graph"
          id="result-panel-graph"
          active={tab === 'graph'}
          aria-hidden={tab === 'graph' ? 'false' : 'true'}
        >
          {tab === 'graph' && (
            <Suspense fallback={graphFallback}>
              <GraphView resp={resp} query={query} />
            </Suspense>
          )}
        </TabPanel>
        <TabPanel
          name="matrix"
          id="result-panel-matrix"
          active={tab === 'matrix'}
          aria-hidden={tab === 'matrix' ? 'false' : 'true'}
        >
          {tab === 'matrix' && <MatrixView resp={resp} query={query} />}
        </TabPanel>
      </TabGroup>
    </TabsRow>
  )
}
