import React, {
  Suspense,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import styled from 'styled-components'

import type { QueryResp } from '@api'
import { ResultPanel, type ResultTab } from '../components/results/ResultPanel'
import { Button } from '../components/ui'
import { client } from '../api/client'
import { streamQuery, StreamHandle } from '../lib/queryStream'
import { useQueryHistory } from '../lib/useQueryHistory'
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

const Bar = styled.div`
  margin-top: ${({ theme }) => theme.spacing.sm};
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
  align-items: center;
  flex-wrap: wrap;
  color: ${({ theme }) => theme.text.secondary};
  font-size: ${({ theme }) => theme.font.sizes.sm};
`

const Err = styled.span`
  color: ${({ theme }) => theme.text.danger};
`

// Suspense fallback shown while the lazy Monaco editor chunk downloads
// (F10 / #54). Sized to roughly the editor's default height so the
// layout doesn't jump when the real component resolves. role=status
// keeps it announced to assistive tech.
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

const ToggleLabel = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
`

// The fullscreen result overlay. Rendered via a portal into
// document.body so it escapes any stacking context, fixed to the
// viewport, scrollable, padded. zIndex.fullscreen keeps it above app
// chrome but below `modal`, so a modal opened while maximized wins.
const ResultOverlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: ${({ theme }) => theme.zIndex.fullscreen};
  background: ${({ theme }) => theme.bg.canvas};
  overflow: auto;
  padding: ${({ theme }) => theme.spacing.lg};
  display: flex;
  flex-direction: column;
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
  const [tab, setTab] = useState<ResultTab>('table')
  const [streamMode, setStreamMode] = useState(false)
  const [expand, setExpand] = useState(true)
  // Result panel maximized into a viewport-filling overlay. Session-
  // local (defaults closed); Esc and the toggle both close it.
  const [maximized, setMaximized] = useState(false)
  const maximizeBtnRef = useRef<HTMLButtonElement | null>(null)
  const [stream, dispatch] = useReducer(streamReducer, initialStreamState)
  const handleRef = useRef<StreamHandle | null>(null)
  // The statement that the in-flight stream run actually started with.
  // The `stream` reducer state inside h.done.then(...) is the value at
  // run-time but `stmt` (the editor state) can drift before the run
  // completes — so we record from a useEffect keyed on the terminal
  // status and read the run-time statement from this ref.
  const runStmtRef = useRef('')

  // While maximized, Escape exits fullscreen. Restore focus to the
  // toggle button on exit so keyboard users land back where they were.
  useEffect(() => {
    if (!maximized) return undefined
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMaximized(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [maximized])
  const prevMaximizedRef = useRef(maximized)
  useEffect(() => {
    if (prevMaximizedRef.current && !maximized) {
      maximizeBtnRef.current?.focus()
    }
    prevMaximizedRef.current = maximized
  }, [maximized])

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

  // The dashboard's recent-queries card deep-links here with
  // `?statement=<query>` so a click re-loads the editor with that text.
  // Read it ONCE on mount: copy it into local editor state and then
  // strip the param (replace, so it doesn't pollute history) — that way
  // a manual edit isn't clobbered by a re-render and a refresh doesn't
  // re-apply the (now stale) query.
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const s = searchParams.get('statement')
    if (s) {
      setStmt(s)
      const next = new URLSearchParams(searchParams)
      next.delete('statement')
      setSearchParams(next, { replace: true })
    }
    // Intentionally mount-only: see comment above.
  }, [])

  // Record a stream run into the query history exactly once, when the
  // reducer reaches a terminal status ('done' | 'error'). We cannot read
  // stream.* from the h.done.then() closure (it captures the run-time
  // value), so this fires on the status transition instead and reads the
  // run-time statement from runStmtRef. `dispatch({type:'reset'})` moves
  // status back to 'idle', so the next run can re-fire on the next
  // terminal transition. Keyed on stream.status so it runs once per
  // terminal transition; rowCount/rows are read at fire time (they're
  // settled by then) and runStmtRef is a stable ref.
  useEffect(() => {
    if (stream.status === 'done' || stream.status === 'error') {
      useQueryHistory.getState().record({
        statement: runStmtRef.current,
        rowCount:
          stream.status === 'done'
            ? stream.rowCount || stream.rows.length
            : null,
        ok: stream.status === 'done',
      })
    }
  }, [stream.status])

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
    // Capture the statement that this run started with so a later
    // edit to `stmt` can't drift the history entry.
    const ranStmt = stmt
    resetRunState()
    setBusy(true)
    try {
      // The server validator (gen/types/types.gen.go QueryReq.Valid) treats
      // page_size and timeout_ms as required (>= 1). The TS interface
      // marks them optional but the Go zero-value of int64 is 0, so
      // omitting them yields "page_size: too small". Send sensible
      // defaults so the synchronous query path is usable.
      const r = await client.query({
        statement: ranStmt,
        page_size: 1000,
        timeout_ms: 30000,
      })
      setResp(r)
      useQueryHistory.getState().record({
        statement: ranStmt,
        rowCount: r.row_count ?? r.rows.length,
        ok: true,
      })
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : t('errors.queryFailed'))
      useQueryHistory
        .getState()
        .record({ statement: ranStmt, rowCount: null, ok: false })
    } finally {
      setBusy(false)
    }
  }

  const runStream = (): void => {
    runStmtRef.current = stmt
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

  // PERF-2026-05-11-02 (#130): streamStateToResp() allocates a fresh
  // QueryResp on every call, so calling it inline made `activeResp`'s
  // identity change on *every* render — busting TableView's
  // `useMemo(() => projectColumns(resp), [resp, expand])` and JsonView's
  // memo (so projectColumns re-ran per row, JsonView re-stringified per
  // render). Memoize it on the structurally-relevant stream fields so
  // its identity changes ONLY when the underlying data does.
  // `stream.rows` is the stable mutable array reference (see
  // queryStreamReducer); `rowsVersion` is what actually moves on append.
  const streamResp = useMemo<QueryResp | null>(
    () => (stream.status === 'idle' ? null : streamStateToResp(stream)),
    [
      stream.status,
      stream.columns,
      stream.rows,
      stream.rowsVersion,
      stream.rowCount,
      stream.elapsedMs,
    ]
  )
  const activeResp: QueryResp | null = streamMode ? streamResp : resp
  const activeErr = streamMode ? stream.error || err : err

  // F10 (#54): Suspense fallback for the lazy Monaco editor chunk. Held
  // as a local so the multiline JSX doesn't run into the airbnb/prettier
  // disagreement on parenthesising JSX in props.
  const editorFallback = (
    <LazyFallback role="status">{t('query.loadingEditor')}</LazyFallback>
  )

  // The result panel — the tabs row (with the maximize toggle) plus the
  // active tabpanel. `maximized` is threaded into ResultPanel so the
  // active child drops its inline height cap in fullscreen.
  const resultPanel = activeResp && (
    <ResultPanel
      resp={activeResp}
      query={stmt}
      tab={tab}
      onTabChange={setTab}
      expand={expand}
      maximized={maximized}
      onToggleMaximize={() => setMaximized((m) => !m)}
      maximizeBtnRef={maximizeBtnRef}
    />
  )

  // When maximized, portal the panel into document.body as a fixed
  // inset:0 overlay so it escapes any stacking context and fills the
  // viewport; otherwise render it inline below the editor toolbar.
  const overlayEl = (
    <ResultOverlay data-testid="result-fullscreen-overlay">
      {resultPanel}
    </ResultOverlay>
  )
  let resultRegion: React.ReactNode = null
  if (resultPanel) {
    resultRegion = maximized
      ? createPortal(overlayEl, document.body)
      : resultPanel
  }

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
      {resultRegion}
    </div>
  )
}
