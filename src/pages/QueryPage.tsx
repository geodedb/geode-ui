import React, { Suspense, useEffect, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import type { QueryResp } from '@api'
import { TableView } from '../components/results/TableView'
import { JsonView } from '../components/results/JsonView'
import { Button } from '../components/ui'
import type { Theme } from '../theme'
import { client } from '../api/client'
import { streamQuery, StreamHandle } from '../lib/queryStream'
import { useQueryStore } from '../lib/queryStore'
import {
  StreamState,
  initialStreamState,
  streamReducer,
} from './queryStreamReducer'

// F10 (#54): Monaco (~MiB-scale) and Cytoscape (~hundreds of KiB) were
// eagerly imported on every route via the static GqlEditor / GraphView
// imports. They are now React.lazy'd here so webpack emits them as
// separate async chunks that are only fetched when the query editor /
// graph tab mounts. The monaco-bootstrap side-effect rides inside the
// GqlEditor module, so it falls into the lazy editor chunk too.
const GqlEditor = React.lazy(() =>
  import('../components/editor/GqlEditor').then((m) => ({
    default: m.GqlEditor,
  }))
)
const GraphView = React.lazy(() =>
  import('../components/results/GraphView').then((m) => ({
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

type Tab = 'table' | 'json' | 'graph'

const Bar = styled.div`
  margin-top: ${({ theme }) => theme.spacing.sm};
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
  align-items: center;
  flex-wrap: wrap;
  color: ${({ theme }) => theme.text.secondary};
  font-size: ${({ theme }) => theme.font.sizes.sm};
`

// Tab buttons drive content swap inside the QueryPage results panel.
// We keep them as a styled element (not the shared Button primitive)
// because role=tab + aria-selected differs from role=button — the WAI
// tab pattern is its own a11y contract.
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

const Err = styled.span`
  color: ${({ theme }) => theme.text.danger};
`

// Suspense fallback shown while the lazy Monaco editor / Cytoscape
// graph chunks download (F10 / #54). Sized to roughly the editor's
// default height so the layout doesn't jump when the real component
// resolves. role=status keeps it announced to assistive tech.
const LazyFallback = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 240px;
  color: ${({ theme }) => theme.text.secondary};
  font-size: ${({ theme }) => theme.font.sizes.sm};
  background: ${({ theme }) => theme.bg.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
`

const Tabs = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.xs};
  margin: ${({ theme }) => theme.spacing.md} 0
    ${({ theme }) => theme.spacing.sm};
`

const ToggleLabel = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
`

function streamStateToResp(s: StreamState): QueryResp {
  return {
    columns: s.columns as unknown as Array<Record<string, unknown>>,
    rows: s.rows as Array<Array<unknown>>,
    row_count: s.rowCount || s.rows.length,
    elapsed_ms: s.elapsedMs,
  }
}

export const QueryPage: React.FC = () => {
  const { t } = useTranslation()
  const [stmt, setStmt] = useState('MATCH (n) RETURN n LIMIT 25')
  const [resp, setResp] = useState<QueryResp | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<Tab>('table')
  const [streamMode, setStreamMode] = useState(false)
  const [expand, setExpand] = useState(true)
  const [stream, dispatch] = useReducer(streamReducer, initialStreamState)
  const handleRef = useRef<StreamHandle | null>(null)

  // The schema explorer (D1) stages a statement in queryStore and
  // navigates here. Pull it once on mount, copy it into local editor
  // state, and clear the slot so a later route change doesn't replay
  // the same query.
  const staged = useQueryStore((s) => s.stagedStatement)
  const clearStaged = useQueryStore((s) => s.setStaged)
  useEffect(() => {
    if (staged != null) {
      setStmt(staged)
      clearStaged(null)
    }
  }, [staged, clearStaged])

  // resetRunState clears every per-run piece of state so a previous
  // run's leftovers (rows, errors, an in-flight WebSocket) cannot
  // leak into the next click. Without this, two sync runs back-to-
  // back show the *first* result for a moment until the second
  // resolves; a sync run after a stream run can show stale stream
  // rows; and a stream-cancel followed by a sync run leaves
  // handleRef pointing at a closed socket.
  const resetRunState = (): void => {
    setErr(null)
    setResp(null)
    dispatch({ type: 'reset' })
    if (handleRef.current) {
      handleRef.current.cancel()
      handleRef.current = null
    }
  }

  const runSync = async (): Promise<void> => {
    resetRunState()
    setBusy(true)
    try {
      // The server validator (gen/types/types.gen.go QueryReq.Valid) treats
      // page_size and timeout_ms as required (>= 1). The TS interface
      // marks them optional but the Go zero-value of int64 is 0, so
      // omitting them yields "page_size: too small". Send sensible
      // defaults so the synchronous query path is usable.
      const r = await client.query({
        statement: stmt,
        page_size: 1000,
        timeout_ms: 30000,
      })
      setResp(r)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : t('errors.queryFailed'))
    } finally {
      setBusy(false)
    }
  }

  const runStream = (): void => {
    resetRunState()
    dispatch({ type: 'start' })
    setBusy(true)
    const h = streamQuery(stmt, undefined, (m) => {
      dispatch({ type: 'msg', msg: m })
      if (m.kind === 'end' || m.kind === 'error') setBusy(false)
    })
    handleRef.current = h
    h.done.then(() => {
      dispatch({ type: 'closed' })
      setBusy(false)
      handleRef.current = null
    })
  }

  const run = (): void => {
    if (streamMode) {
      runStream()
    } else {
      runSync()
    }
  }

  const cancel = (): void => {
    handleRef.current?.cancel()
    handleRef.current = null
    setBusy(false)
  }

  let activeResp: QueryResp | null
  if (streamMode) {
    activeResp = stream.status === 'idle' ? null : streamStateToResp(stream)
  } else {
    activeResp = resp
  }
  const activeErr = streamMode ? stream.error || err : err

  // F10 (#54): Suspense fallbacks for the lazy Monaco editor / Cytoscape
  // graph chunks. Held as locals so the multiline JSX doesn't run into
  // the airbnb/prettier disagreement on parenthesising JSX in props.
  const editorFallback = (
    <LazyFallback role="status">{t('query.loadingEditor')}</LazyFallback>
  )
  const graphFallback = (
    <LazyFallback role="status">{t('query.loadingGraph')}</LazyFallback>
  )

  return (
    <div>
      <Suspense fallback={editorFallback}>
        <GqlEditor value={stmt} onChange={setStmt} onRun={run} />
      </Suspense>
      <Bar>
        <Button onClick={run} loading={busy}>
          {t('query.runHotkey')}
        </Button>
        {streamMode && busy && (
          <Button variant="secondary" onClick={cancel}>
            {t('query.cancel')}
          </Button>
        )}
        <ToggleLabel>
          <input
            type="checkbox"
            checked={streamMode}
            onChange={(e) => {
              setStreamMode(e.target.checked)
              dispatch({ type: 'reset' })
              setResp(null)
              setErr(null)
            }}
          />
          {t('query.streamMode')}
        </ToggleLabel>
        <ToggleLabel>
          <input
            type="checkbox"
            checked={expand}
            onChange={(e) => setExpand(e.target.checked)}
          />
          {t('query.expandGraphCells')}
        </ToggleLabel>
        {activeResp && (
          <span>
            {t('common.rowCount', { count: activeResp.row_count ?? 0 })} ·{' '}
            {t('common.elapsed', { ms: activeResp.elapsed_ms })}
          </span>
        )}
        {activeErr && <Err>{activeErr}</Err>}
      </Bar>
      {activeResp && (
        <>
          <Tabs role="tablist" aria-label={t('query.resultViewLabel')}>
            {(
              [
                ['table', t('query.tabTable')],
                ['json', t('query.tabJson')],
                ['graph', t('query.tabGraph')],
              ] as const
            ).map(([kind, label]) => (
              <TabBtn
                key={kind}
                role="tab"
                aria-selected={tab === kind}
                aria-controls={`result-panel-${kind}`}
                tabIndex={tab === kind ? 0 : -1}
                $active={tab === kind}
                onClick={() => setTab(kind)}
              >
                {label}
              </TabBtn>
            ))}
          </Tabs>
          <div
            id={`result-panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`result-panel-${tab}`}
          >
            {tab === 'table' && <TableView resp={activeResp} expand={expand} />}
            {tab === 'json' && <JsonView data={activeResp} />}
            {tab === 'graph' && (
              <Suspense fallback={graphFallback}>
                <GraphView resp={activeResp} query={stmt} />
              </Suspense>
            )}
          </div>
        </>
      )}
    </div>
  )
}
