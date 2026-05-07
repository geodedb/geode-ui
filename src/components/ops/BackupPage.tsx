import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import { client } from '../../api/client'

// BackupPage drives the /ops/backups tab. The Geode B7 endpoints back
// every action:
//
//   list   GET    /api/v1/backups          -> client.getBackups
//   create POST   /api/v1/backups          -> client.postBackups
//   delete DELETE /api/v1/backups/{file}   -> client.deleteFile
//
// The download action stays disabled because the API does not yet
// expose a streaming download; restore navigates to /ops/restore with
// the file pre-filled via the location state.
type Backup = {
  file: string
  path?: string
  size_bytes?: number
  created_at?: string
  graph_count?: number
  node_count?: number
  edge_count?: number
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const ToolBar = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;

  h2 {
    font-size: 1.1rem;
    color: ${({ theme }) => theme.colors.text};
  }
`

const NewBtn = styled.button`
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

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  color: ${({ theme }) => theme.colors.text};

  th,
  td {
    padding: 8px;
    text-align: left;
    border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  }

  th {
    background: ${({ theme }) => theme.colors.surface};
    font-weight: 600;
  }
`

const RowBtn = styled.button`
  padding: 4px 8px;
  margin-right: 4px;
  background: transparent;
  color: ${({ theme }) => theme.colors.text};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85em;

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.surface};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`

const Modal = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
`

const ModalCard = styled.div`
  background: ${({ theme }) => theme.colors.surface};
  padding: 24px;
  border-radius: 8px;
  min-width: 320px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: ${({ theme }) => theme.colors.text};

  h3 {
    margin: 0;
  }

  input {
    padding: 6px 8px;
    background: ${({ theme }) => theme.colors.background};
    color: inherit;
    border: 1px solid ${({ theme }) => theme.colors.border};
    border-radius: 4px;
  }
`

const Err = styled.p`
  color: #ef4444;
  margin-top: 8px;
`

const Empty = styled.td`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-style: italic;
  text-align: center;
`

const fmtBytes = (n?: number): string => {
  if (n === undefined || n === null) return ''
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB'
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

export const BackupPage: React.FC = () => {
  const navigate = useNavigate()
  const [backups, setBackups] = useState<Backup[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const load = (): void => {
    client
      .getBackups({})
      .then((r) => {
        const list = (r.backups ?? []) as Backup[]
        setBackups(list)
      })
      .catch((e: unknown) => {
        setErr(e instanceof Error ? e.message : String(e))
      })
  }

  useEffect(() => {
    load()
  }, [])

  const onDelete = async (file: string): Promise<void> => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Delete backup ' + file + '?')) return
    try {
      await client.deleteFile({ file })
      load()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const onRestore = (file: string): void => {
    // Navigate to the restore tab with the file pre-filled. RestorePage
    // reads location.state.file in a useEffect.
    navigate('/ops/restore', { state: { file } })
  }

  return (
    <Wrap>
      <ToolBar>
        <h2>Backups ({backups.length})</h2>
        <NewBtn onClick={() => setShowCreate(true)}>+ New backup</NewBtn>
      </ToolBar>
      {err && <Err>{err}</Err>}
      <Table>
        <thead>
          <tr>
            <th>File</th>
            <th>Size</th>
            <th>Created</th>
            <th>Graphs</th>
            <th>Nodes</th>
            <th>Edges</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {backups.length === 0 ? (
            <tr>
              <Empty colSpan={7}>No backups.</Empty>
            </tr>
          ) : (
            backups.map((b) => (
              <tr key={b.file}>
                <td>{b.file}</td>
                <td>{fmtBytes(b.size_bytes)}</td>
                <td>{b.created_at ?? ''}</td>
                <td>{b.graph_count ?? ''}</td>
                <td>{b.node_count ?? ''}</td>
                <td>{b.edge_count ?? ''}</td>
                <td>
                  <RowBtn disabled title="not yet wired">
                    Download
                  </RowBtn>
                  <RowBtn onClick={() => onRestore(b.file)}>Restore</RowBtn>
                  <RowBtn onClick={() => onDelete(b.file)}>Delete</RowBtn>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
      {showCreate && (
        <CreateBackupModal
          onClose={() => {
            setShowCreate(false)
            load()
          }}
        />
      )}
    </Wrap>
  )
}

const CreateBackupModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [graph, setGraph] = useState('')
  const [output, setOutput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      // graph and output are both optional; the server defaults them
      // when the field is empty -- send blank strings rather than
      // omitting the keys so the request shape stays uniform.
      await client.postBackups({ graph, output })
      onClose()
    } catch (e2: unknown) {
      setErr(e2 instanceof Error ? e2.message : String(e2))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClick={onClose}>
      <ModalCard onClick={(e) => e.stopPropagation()}>
        <h3>New backup</h3>
        <form
          onSubmit={submit}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <input
            placeholder="graph (optional)"
            value={graph}
            onChange={(e) => setGraph(e.target.value)}
          />
          <input
            placeholder="output (optional)"
            value={output}
            onChange={(e) => setOutput(e.target.value)}
          />
          <NewBtn type="submit" disabled={busy}>
            {busy ? '...' : 'Create'}
          </NewBtn>
          {err && <Err>{err}</Err>}
        </form>
      </ModalCard>
    </Modal>
  )
}
