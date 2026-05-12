// usePane — per-pane streaming query state for the workspace.
//
// This mirrors the streaming machinery on QueryPage (the
// useReducer(streamReducer, initialStreamState), the streamQuery() call,
// the handleRef, streamStateToResp, and the streamResp useMemo) but
// packaged as a reusable hook so every workspace pane gets its own
// independent stream. streamQuery() is re-entrant — each call opens its
// own WebSocket — so N usePane() instances drive N concurrent streams.
//
// Workspace panes always stream; there is no sync-vs-stream toggle here.

import { useCallback, useMemo, useReducer, useRef, useState } from 'react'

import type { QueryResp } from '@api'
import { streamQuery, type StreamHandle } from '../../lib/queryStream'
import {
  initialStreamState,
  streamReducer,
  type StreamState,
} from '../queryStreamReducer'
import type { ResultTab } from '../../components/results/ResultPanel'

const DEFAULT_STATEMENT = 'MATCH (n) RETURN n LIMIT 25'

// streamStateToResp turns the reducer's accumulated stream state into a
// QueryResp — copied verbatim from QueryPage so the result panel sees
// exactly the same shape on both pages.
function streamStateToResp(s: StreamState): QueryResp {
  return {
    columns: s.columns as unknown as Array<Record<string, unknown>>,
    rows: s.rows as Array<Array<unknown>>,
    row_count: s.rowCount || s.rows.length,
    elapsed_ms: s.elapsedMs,
  }
}

export type Pane = {
  statement: string
  setStatement: (s: string) => void
  tab: ResultTab
  setTab: (t: ResultTab) => void
  resp: QueryResp | null
  err: string | null
  busy: boolean
  run: () => void
  cancel: () => void
}

export function usePane(initialStatement: string = DEFAULT_STATEMENT): Pane {
  const [statement, setStatement] = useState(initialStatement)
  const [tab, setTab] = useState<ResultTab>('table')
  const [busy, setBusy] = useState(false)
  const [stream, dispatch] = useReducer(streamReducer, initialStreamState)
  const handleRef = useRef<StreamHandle | null>(null)

  const cancel = useCallback(() => {
    if (handleRef.current) {
      handleRef.current.cancel()
      handleRef.current = null
    }
    setBusy(false)
  }, [])

  const run = useCallback(() => {
    if (handleRef.current) {
      handleRef.current.cancel()
      handleRef.current = null
    }
    dispatch({ type: 'reset' })
    dispatch({ type: 'start' })
    setBusy(true)
    const h = streamQuery(statement, undefined, (m) => {
      dispatch({ type: 'msg', msg: m })
      if (m.kind === 'end' || m.kind === 'error') setBusy(false)
    })
    handleRef.current = h
    h.done.then(() => {
      dispatch({ type: 'closed' })
      setBusy(false)
      handleRef.current = null
      // TODO(B1): record into useQueryHistory
    })
  }, [statement])

  // Memoize the QueryResp on the structurally-relevant stream fields so
  // its identity changes only when the underlying data does (mirrors
  // PERF-2026-05-11-02 / #130 on QueryPage). stream.rows is the stable
  // mutable array reference; rowsVersion is what moves on append.
  const resp = useMemo<QueryResp | null>(
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
  const err = stream.error

  return { statement, setStatement, tab, setTab, resp, err, busy, run, cancel }
}
