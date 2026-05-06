import React, { useState } from 'react'
import styled from 'styled-components'
import type { QueryResp } from '@api'
import { GqlEditor } from '../components/editor/GqlEditor'
import { TableView } from '../components/results/TableView'
import { JsonView } from '../components/results/JsonView'
import { client } from '../api/client'

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
const TabBtn = styled.button<{ $active: boolean }>`
  padding: 4px 10px;
  background: ${({ $active, theme }) => ($active ? theme.colors.surface : 'transparent')};
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

export const QueryPage: React.FC = () => {
  const [stmt, setStmt] = useState('MATCH (n) RETURN n LIMIT 25')
  const [resp, setResp] = useState<QueryResp | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<Tab>('table')

  const run = async (): Promise<void> => {
    setBusy(true)
    setErr(null)
    try {
      const r = await client.query({ statement: stmt })
      setResp(r)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'query failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <GqlEditor value={stmt} onChange={setStmt} onRun={run} />
      <Bar>
        <RunBtn onClick={run} disabled={busy}>
          {busy ? 'Running…' : 'Run (⌘+Enter)'}
        </RunBtn>
        {resp && (
          <span>
            {resp.row_count} rows · {resp.elapsed_ms} ms
          </span>
        )}
        {err && <Err>{err}</Err>}
      </Bar>
      {resp && (
        <>
          <Tabs role="tablist">
            {(['table', 'json', 'graph'] as const).map((t) => (
              <TabBtn key={t} $active={tab === t} onClick={() => setTab(t)}>
                {t}
              </TabBtn>
            ))}
          </Tabs>
          {tab === 'table' && <TableView resp={resp} />}
          {tab === 'json' && <JsonView data={resp} />}
          {tab === 'graph' && <div>graph (TODO C5)</div>}
        </>
      )}
    </div>
  )
}
