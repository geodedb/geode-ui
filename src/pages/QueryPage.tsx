import React, { useEffect, useReducer, useRef, useState } from 'react'
import styled from 'styled-components'
import type { QueryResp } from '@api'
import { GqlEditor } from '../components/editor/GqlEditor'
import { TableView } from '../components/results/TableView'
import { JsonView } from '../components/results/JsonView'
import { GraphView } from '../components/results/GraphView'
import { client } from '../api/client'
import { streamQuery, StreamHandle } from '../lib/queryStream'
import { useQueryStore } from '../lib/queryStore'
import {
  StreamState,
  initialStreamState,
  streamReducer,
} from './queryStreamReducer'

type Tab = 'table' | 'json' | 'graph'

const Bar = styled.div`
  margin-top: 8px;
  display: flex;
  gap: 12px;
  align-items: center;
  color: ${({ theme }) => theme.colors.textSecondary};
`
const RunBtn = styled.button`
  padding: 6px 12px;
  background: ${({ theme }) => theme.colors.primary};
  color: #fff;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
  &:disabled {
    opacity: 0.6;
    cursor: wait;
  }
`
function tabBtnBg(props: {
  $active: boolean
  theme: { colors: { surface: string } }
}): string {
  return props.$active ? props.theme.colors.surface : 'transparent'
}

const TabBtn = styled.button<{ $active: boolean }>`
  padding: 4px 10px;
  background: ${tabBtnBg};
  color: ${({ theme }) => theme.colors.text};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  cursor: pointer;
`
const Err = styled.span`
  color: #ef4444;
`
const Tabs = styled.div`
  display: flex;
  gap: 8px;
  margin: 16px 0 8px;
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
      setErr(e instanceof Error ? e.message : 'query failed')
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

  return (
    <div>
      <GqlEditor value={stmt} onChange={setStmt} onRun={run} />
      <Bar>
        <RunBtn onClick={run} disabled={busy}>
          {busy ? 'Running…' : 'Run (⌘+Enter)'}
        </RunBtn>
        {streamMode && busy && (
          <RunBtn onClick={cancel} disabled={!busy}>
            Cancel
          </RunBtn>
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
          Stream
        </ToggleLabel>
        <ToggleLabel>
          <input
            type="checkbox"
            checked={expand}
            onChange={(e) => setExpand(e.target.checked)}
          />
          Expand graph cells
        </ToggleLabel>
        {activeResp && (
          <span>
            {activeResp.row_count} rows · {activeResp.elapsed_ms} ms
          </span>
        )}
        {activeErr && <Err>{activeErr}</Err>}
      </Bar>
      {activeResp && (
        <>
          <Tabs role="tablist">
            {(['table', 'json', 'graph'] as const).map((t) => (
              <TabBtn key={t} $active={tab === t} onClick={() => setTab(t)}>
                {t}
              </TabBtn>
            ))}
          </Tabs>
          {tab === 'table' && <TableView resp={activeResp} expand={expand} />}
          {tab === 'json' && <JsonView data={activeResp} />}
          {tab === 'graph' && <GraphView resp={activeResp} query={stmt} />}
        </>
      )}
    </div>
  )
}
