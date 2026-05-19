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
import { ResultPanel } from '../components/results/ResultPanel'
import { client } from '../api/client'
import { streamQuery, StreamHandle } from '../lib/queryStream'
import { useQueryHistory } from '../lib/useQueryHistory'
import { useQueryStore } from '../lib/queryStore'
import { useQueryPageStore } from '../lib/queryPageStore'
import { useLspSettings } from '../lib/lspSettings'
import type { GqlEditorHandle } from '../components/editor/GqlEditor'
import { Dropdown, DropdownItem } from '../services/webawesome/components'
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
//
// PERF #256: the magic comments below emit `<link rel="prefetch">` for
// the chunk during browser idle time so the editor is warm in the
// HTTP cache by the time the user lands on /query. The chunkName makes
// the prefetched asset diagnosable in DevTools (otherwise it would
// show as `<hash>.js`).
const GqlEditor = React.lazy(() =>
  import(
    /* webpackPrefetch: true, webpackChunkName: "gql-editor" */
    '../components/editor/GqlEditor'
  ).then((m) => ({
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

  /* At <= md the desktop spacing.md gap (16 px) is too wide for narrow
     viewports — it pushes the Run / Options cluster onto 2-3 wrapped
     rows and inflates Bar height past the 80 px budget the mobile
     audit settled on. Drop to spacing.sm so the controls pack into a
     single row on a 320 px viewport. */
  @media (max-width: ${({ theme }) => theme.breakpoints.md - 0.02}px) {
    gap: ${({ theme }) => theme.spacing.sm};
  }
`

// Err — Bootstrap-migrated to `<span className="text-danger">`.
// `--bs-danger` is wired through the theme bridge so the dark theme
// still gets the contrast-bumped danger token. docs/BOOTSTRAP_MIGRATION.md.

// PERF-2026-05-17-03 (#240): banner shown when the stream retention cap
// was hit. The reducer drops further server-sent rows on the floor;
// the banner tells the user how many rows were truncated and points
// them at server-side export as the path to the full result. role=status
// + aria-live=polite keeps it announced to assistive tech without
// stealing focus. Bootstrap-migrated: theme-token surface kept here
// (bg.subtle, colors.warning border accent, text.primary, radii.md,
// font.sizes.sm); spacing utilities (mt-2 px-3 py-2) live on the
// className at the call site. docs/BOOTSTRAP_MIGRATION.md.
const StreamOverflowBanner = styled.div`
  background: ${({ theme }) => theme.bg.subtle};
  border-left: 3px solid ${({ theme }) => theme.colors.warning};
  color: ${({ theme }) => theme.text.primary};
  border-radius: ${({ theme }) => theme.radii.md};
  font-size: ${({ theme }) => theme.font.sizes.sm};
`

// Suspense fallback shown while the lazy Monaco editor chunk downloads
// (F10 / #54). Sized to roughly the editor's default height so the
// layout doesn't jump when the real component resolves. role=status
// keeps it announced to assistive tech. Bootstrap-migrated: theme-
// token surface kept here (text.secondary, font.sizes.sm, bg.subtle,
// radii.md); the centered-flex layout is supplied via the className
// `d-flex align-items-center justify-content-center` at the call site.
// See docs/BOOTSTRAP_MIGRATION.md.
const LazyFallback = styled.div`
  min-height: 240px;
  color: ${({ theme }) => theme.text.secondary};
  font-size: ${({ theme }) => theme.font.sizes.sm};
  background: ${({ theme }) => theme.bg.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
`

// QueryPage outer container — a flex column claiming the height of its
// parent (Shell's <Body>). Editor + Bar pin to their natural height
// (flex: 0 0 auto); the result region is `flex: 1 1 0` with
// `min-height: 0` so it shrinks to fit while still growing to the
// available height — i.e. the table/graph/json/matrix body fills the
// viewport WITHOUT requiring the user to click the maximize toggle.
const PageRoot = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0;
  gap: ${({ theme }) => theme.spacing.sm};
`

const ResultRegion = styled.div`
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
`

// The fullscreen result overlay. Rendered via a portal into
// document.body so it escapes any stacking context, fixed to the
// viewport, scrollable, padded. zIndex.fullscreen keeps it above app
// chrome but below `modal`, so a modal opened while maximized wins.
// Bootstrap-migrated: theme-token surface (z-index, bg.canvas,
// spacing.lg padding) kept here; the flex-column layout is supplied
// via className `d-flex flex-column` at the call site.
const ResultOverlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: ${({ theme }) => theme.zIndex.fullscreen};
  background: ${({ theme }) => theme.bg.canvas};
  overflow: auto;
  padding: ${({ theme }) => theme.spacing.lg};
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
  // queryPageStore is a module-level singleton — its state survives the
  // QueryPage component being unmounted by router navigation (user
  // clicks Schema, then comes back to Query). signOut + switchActive in
  // AuthProvider call reset() on this store so a new session / new
  // connection starts from a clean editor.
  const stmt = useQueryPageStore((s) => s.stmt)
  const setStmt = useQueryPageStore((s) => s.setStmt)
  // Bug #6: the SUBMITTED statement, tracked separately from the live
  // editor buffer (`stmt`). ResultPanel.query — and through it
  // GraphView's `sig` — must depend on this, NOT on the editor buffer,
  // or every keystroke triggers a full cytoscape rebuild + cxtmenu
  // remount + lasso re-apply + tooltip rebind + dom-node remount.
  // Update from EVERY run path (sync, stream, and any future retry).
  const submittedStmt = useQueryPageStore((s) => s.submittedStmt)
  const setSubmittedStmt = useQueryPageStore((s) => s.setSubmittedStmt)
  const resp = useQueryPageStore((s) => s.resp)
  const setResp = useQueryPageStore((s) => s.setResp)
  const err = useQueryPageStore((s) => s.err)
  const setErr = useQueryPageStore((s) => s.setErr)
  const tab = useQueryPageStore((s) => s.tab)
  const setTab = useQueryPageStore((s) => s.setTab)
  const streamMode = useQueryPageStore((s) => s.streamMode)
  const setStreamMode = useQueryPageStore((s) => s.setStreamMode)
  const expand = useQueryPageStore((s) => s.expand)
  const setExpand = useQueryPageStore((s) => s.setExpand)
  // `busy` and `maximized` stay local — `busy` is transient (Run
  // button loading state) and `maximized` is intentionally per-mount
  // (a fullscreen overlay on QueryPage shouldn't follow you to /schema).
  const [busy, setBusy] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const maximizeBtnRef = useRef<HTMLButtonElement | null>(null)
  const [stream, dispatch] = useReducer(streamReducer, initialStreamState)
  const handleRef = useRef<StreamHandle | null>(null)
  const editorRef = useRef<GqlEditorHandle | null>(null)
  // QUAL #289: monotonic generation counter for `runSync`. The
  // generated client doesn't expose an AbortSignal on its
  // `client.query` method, so we can't cancel the in-flight HTTP
  // request — but we CAN guard against the resolved promise calling
  // setResp/setErr with stale data after the user has already kicked
  // off a newer Run. Each runSync captures the current counter, bumps
  // it, and only writes its result if its captured value is still the
  // latest. resetRunState ALSO bumps the counter so a stream-run
  // started between two sync runs invalidates the in-flight sync.
  const runSyncGenRef = useRef(0)
  const autoFormatEnabled = useLspSettings((s) => s.autoFormatEnabled)
  const setAutoFormatEnabled = useLspSettings((s) => s.setAutoFormatEnabled)
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
      // `maximizeBtnRef` is now a <wa-button> host. Its `.focus()` method
      // delegates to the shadow-DOM <button>, which is only attached
      // after Lit's first reactive render — in jsdom that may race the
      // effect tick. Guard so test environments where the shadow root
      // hasn't materialised don't throw.
      try {
        maximizeBtnRef.current?.focus()
      } catch {
        /* shadow DOM not ready (test env) — focus restore is best-effort */
      }
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
      // Queries staged from the schema explorer arrive as a single line
      // (USE GRAPH x; MATCH (n:Label) RETURN n LIMIT 25) which is hard
      // to read once the user opens the editor. v0.5.18 LSP exposes
      // textDocument/formatting; ask the editor to run it once the
      // transport is open. The user can disable this via the
      // "Auto-format inserted queries" option.
      if (autoFormatEnabled) {
        editorRef.current?.requestFormatWhenReady()
      }
    }
  }, [staged, clearStaged, autoFormatEnabled])

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
      // Same rationale as the staged-statement effect above —
      // deep-linked queries (history re-runs, share links) arrive
      // single-line; auto-format unless the user opted out.
      if (autoFormatEnabled) {
        editorRef.current?.requestFormatWhenReady()
      }
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
    // QUAL #289: bump the sync-run counter so any in-flight
    // client.query promise from a prior runSync is invalidated; its
    // resolve/reject handlers will short-circuit when their captured
    // generation no longer matches.
    runSyncGenRef.current += 1
  }

  const runSync = async (): Promise<void> => {
    // Capture the statement that this run started with so a later
    // edit to `stmt` can't drift the history entry.
    const ranStmt = stmt
    // Bug #6: also publish to React state so ResultPanel/GraphView see
    // the SUBMITTED statement, not the live editor buffer.
    setSubmittedStmt(ranStmt)
    resetRunState()
    // QUAL #289: snapshot the generation AFTER resetRunState so we
    // get the post-bump value; a second runSync click will bump again
    // (via its own resetRunState) and invalidate this snapshot.
    const myGen = runSyncGenRef.current
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
      // QUAL #289: only write the result + history entry if this
      // promise is still the latest sync run. Without this guard, a
      // rapid double-Run that completes out of order could let the
      // FIRST (older, slower) response clobber the SECOND (newer,
      // already-rendered) response.
      if (runSyncGenRef.current !== myGen) return
      setResp(r)
      useQueryHistory.getState().record({
        statement: ranStmt,
        rowCount: r.row_count ?? r.rows.length,
        ok: true,
      })
    } catch (e: unknown) {
      if (runSyncGenRef.current !== myGen) return
      setErr(e instanceof Error ? e.message : t('errors.queryFailed'))
      useQueryHistory
        .getState()
        .record({ statement: ranStmt, rowCount: null, ok: false })
    } finally {
      // setBusy is intentionally NOT gated on the generation check:
      // the user must always see the spinner stop when their MOST
      // RECENT run resolves. The last-to-resolve fulfilment will
      // settle busy correctly because both branches bypassed setResp
      // when their gen mismatched — the only state busy needs to
      // reflect is "is there any in-flight client.query?", which we
      // can't track from here. Leaving busy=false on every settle is
      // the closest approximation; an unsetbusy on a stale settle is
      // harmless because the active run will re-set it on its own
      // setResp path.
      if (runSyncGenRef.current === myGen) setBusy(false)
    }
  }

  const runStream = (): void => {
    runStmtRef.current = stmt
    // Bug #6: companion to runStmtRef — the ref is for the async history
    // record; this React state is what drives ResultPanel/GraphView.
    setSubmittedStmt(stmt)
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
  //
  // PERF-2026-05-17-02 (#239): keying the memo directly on
  // `stream.rowsVersion` busted the memo on EVERY WebSocket batch —
  // 10k rows / 64-row batches = 156 batches = 156 projectColumns runs +
  // 156 JSON.stringify runs + 156 useGraphElements 3-Map rebuilds (and
  // #239 cascades into #249). The fix is an rAF throttle: every batch
  // still bumps `stream.rowsVersion` synchronously (so the reducer
  // contract is unchanged and tests reading `state.rows.length`
  // post-batch still pass), but the downstream-visible `throttledVersion`
  // only catches up at the next animation frame. Multiple batches that
  // arrive in the same frame coalesce into ONE downstream resp identity
  // change. The terminal state.status transition ('running' -> 'done' |
  // 'error') is in deps independently, so the final resp is always
  // visible regardless of throttle timing.
  const [throttledVersion, setThrottledVersion] = useState(0)
  const rafRef = useRef<number | null>(null)
  // Read the latest rowsVersion at rAF-callback time, not at effect-
  // schedule time, so a burst of batches between scheduling and the
  // frame firing all coalesce into the single setThrottledVersion call.
  const latestRowsVersionRef = useRef(stream.rowsVersion)
  latestRowsVersionRef.current = stream.rowsVersion
  useEffect(() => {
    if (stream.rowsVersion === throttledVersion) return
    // Throttling only buys anything while batches are actively arriving.
    // In every non-'running' state (idle after reset, terminal done /
    // error) commit synchronously so the final resp settles in a single
    // render — otherwise the rAF fires AFTER the user sees the 'done'
    // banner and hands TableView/JsonView an extra resp identity.
    if (stream.status !== 'running') {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      setThrottledVersion(stream.rowsVersion)
      return
    }
    if (rafRef.current != null) return
    // Next animation frame (~16 ms at 60 Hz) is the throttle floor.
    // Multiple batches that arrive before the callback runs collapse
    // into a single throttledVersion bump.
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null
      setThrottledVersion(latestRowsVersionRef.current)
    })
  }, [stream.rowsVersion, stream.status, throttledVersion])
  // Cancel any in-flight rAF on unmount so React doesn't warn about
  // setState on an unmounted component when the timer fires late.
  useEffect(
    () => () => {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    },
    []
  )
  const streamResp = useMemo<QueryResp | null>(
    () => (stream.status === 'idle' ? null : streamStateToResp(stream)),
    [
      stream.status,
      stream.columns,
      stream.rows,
      throttledVersion,
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
    <LazyFallback
      role="status"
      className="d-flex align-items-center justify-content-center"
    >
      {t('query.loadingEditor')}
    </LazyFallback>
  )

  // The result panel — the tabs row (with the maximize toggle) plus the
  // active tabpanel. `maximized` is threaded into ResultPanel so the
  // active child drops its inline height cap in fullscreen.
  const resultPanel = activeResp && (
    <ResultPanel
      resp={activeResp}
      query={submittedStmt}
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
    <ResultOverlay
      data-testid="result-fullscreen-overlay"
      className="d-flex flex-column"
    >
      {resultPanel}
    </ResultOverlay>
  )
  // The maximized branch portals into document.body unchanged; the
  // inline branch wraps in <ResultRegion> so the new flex chain on
  // <PageRoot> can grow it to fill the viewport.
  const inlineResultRegion =
    resultPanel && !maximized ? (
      <ResultRegion>{resultPanel}</ResultRegion>
    ) : null
  const overlayResultRegion =
    resultPanel && maximized ? createPortal(overlayEl, document.body) : null

  return (
    <PageRoot>
      <Suspense fallback={editorFallback}>
        <GqlEditor
          ref={editorRef}
          value={stmt}
          onChange={setStmt}
          onRun={run}
        />
      </Suspense>
      <Bar>
        <wa-button
          appearance="filled"
          variant="brand"
          size="m"
          role="button"
          data-testid="query-run-btn"
          onClick={run}
          disabled={busy ? true : undefined}
          loading={busy ? true : undefined}
        >
          {t('query.runHotkey')}
        </wa-button>
        {streamMode && busy && (
          <wa-button
            appearance="outlined"
            size="m"
            role="button"
            data-testid="query-cancel-btn"
            onClick={cancel}
          >
            {t('query.cancel')}
          </wa-button>
        )}
        {/* Format button uses size=s on narrow viewports (Bootstrap
            `d-none d-sm-inline-flex` would hide it on phones; instead
            keep it visible everywhere but at a smaller size so the Bar
            wraps within the 80 px mobile budget). The keyboard shortcut
            ⌘⇧F continues to work regardless of button size. */}
        <wa-button
          appearance="outlined"
          size="s"
          role="button"
          data-testid="query-format-btn"
          title={t('query.formatHotkey')}
          aria-label={t('query.formatAriaLabel')}
          onClick={() => {
            editorRef.current?.formatDocument().catch(() => {
              /* formatDocument already swallows internally */
            })
          }}
        >
          {t('query.formatLabel')}
        </wa-button>
        <Dropdown placement="bottom-start" data-testid="query-options-dropdown">
          <wa-button slot="trigger" appearance="outlined" size="m">
            {t('query.optionsLabel')}
          </wa-button>
          <DropdownItem
            type="checkbox"
            value="stream"
            data-testid="query-options-stream"
            checked={streamMode || undefined}
            aria-checked={streamMode ? 'true' : 'false'}
            role="menuitemcheckbox"
            onClick={() => {
              setStreamMode(!streamMode)
              dispatch({ type: 'reset' })
              setResp(null)
              setErr(null)
            }}
          >
            {t('query.streamMode')}
          </DropdownItem>
          <DropdownItem
            type="checkbox"
            value="expand"
            data-testid="query-options-expand"
            checked={expand || undefined}
            aria-checked={expand ? 'true' : 'false'}
            role="menuitemcheckbox"
            onClick={() => setExpand(!expand)}
          >
            {t('query.expandGraphCells')}
          </DropdownItem>
          <DropdownItem
            type="checkbox"
            value="autoFormat"
            data-testid="query-options-auto-format"
            checked={autoFormatEnabled || undefined}
            aria-checked={autoFormatEnabled ? 'true' : 'false'}
            role="menuitemcheckbox"
            onClick={() => setAutoFormatEnabled(!autoFormatEnabled)}
          >
            {t('query.autoFormatInserted')}
          </DropdownItem>
        </Dropdown>
        {activeResp && (
          <span>
            {t('common.rowCount', { count: activeResp.row_count ?? 0 })} ·{' '}
            {t('common.elapsed', { ms: activeResp.elapsed_ms })}
          </span>
        )}
        {activeErr && <span className="text-danger">{activeErr}</span>}
      </Bar>
      {streamMode && stream.rowsTruncated > 0 && (
        <StreamOverflowBanner
          role="status"
          aria-live="polite"
          data-testid="stream-overflow-banner"
          className="mt-2 px-3 py-2"
        >
          {t('query.streamRetentionBanner', {
            truncated: stream.rowsTruncated,
            cap: stream.rowRetentionCap,
          })}
        </StreamOverflowBanner>
      )}
      {inlineResultRegion}
      {overlayResultRegion}
    </PageRoot>
  )
}
