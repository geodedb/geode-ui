import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import { client } from '../../api/client'
import { useApiResource } from '../../hooks/useApiResource'
import {
  Button,
  ConfirmModal,
  DataTable,
  EmptyCell,
  Field,
  Input,
  Modal,
  Stack,
  TableScroll,
} from '../ui'

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

const ToolBar = styled.header`
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
  align-items: center;
  flex-wrap: wrap;

  h2 {
    flex: 1 1 auto;
    font-family: ${({ theme }) => theme.font.family.display};
    font-size: ${({ theme }) => theme.font.sizes.xl};
    font-weight: ${({ theme }) => theme.font.weights.semibold};
    color: ${({ theme }) => theme.text.primary};
    margin: 0;
  }
`

const ErrorBanner = styled.div`
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.bg.subtle};
  border-left: 3px solid ${({ theme }) => theme.colors.danger};
  color: ${({ theme }) => theme.text.danger};
  border-radius: ${({ theme }) => theme.radii.md};
  font-size: ${({ theme }) => theme.font.sizes.sm};
`

const RowActions = styled.div`
  display: inline-flex;
  gap: ${({ theme }) => theme.spacing.xs};
`

const fmtBytes = (n?: number): string => {
  if (n === undefined || n === null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export const BackupPage: React.FC = () => {
  const navigate = useNavigate()
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const {
    data,
    error: loadErr,
    refetch,
  } = useApiResource(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async (_signal) => {
      const r = await client.getBackups({})
      return ((r.backups ?? []) as Backup[]) ?? []
    },
    []
  )
  const backups = data ?? []
  const err = actionErr ?? loadErr

  const onDelete = async (): Promise<void> => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await client.deleteFile({ file: confirmDelete })
      setActionErr(null)
      setConfirmDelete(null)
      refetch()
    } catch (e: unknown) {
      setActionErr(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleting(false)
    }
  }

  const onRestore = (file: string): void => {
    // Navigate to the restore tab with the file pre-filled. RestorePage
    // reads location.state.file in a useEffect.
    navigate('/ops/restore', { state: { file } })
  }

  return (
    <Stack $gap="md">
      <ToolBar>
        <h2>Backups ({backups.length})</h2>
        <Button onClick={() => setShowCreate(true)}>+ New backup</Button>
      </ToolBar>
      {err && <ErrorBanner role="alert">{err}</ErrorBanner>}
      <TableScroll>
        <DataTable>
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
                <EmptyCell colSpan={7}>No backups.</EmptyCell>
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
                    <RowActions>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled
                        title="not yet wired"
                      >
                        Download
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onRestore(b.file)}
                      >
                        Restore
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDelete(b.file)}
                      >
                        Delete
                      </Button>
                    </RowActions>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>
      </TableScroll>
      {showCreate && (
        <CreateBackupModal
          onClose={() => {
            setShowCreate(false)
            refetch()
          }}
        />
      )}
      <ConfirmModal
        open={confirmDelete !== null}
        title={`Delete backup "${confirmDelete}"?`}
        body="The file will be removed from disk."
        destructive
        loading={deleting}
        confirmLabel="Delete"
        onConfirm={onDelete}
        onClose={() => setConfirmDelete(null)}
      />
    </Stack>
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

  const modalFooter = (
    <>
      <Button variant="ghost" onClick={onClose} disabled={busy}>
        Cancel
      </Button>
      <Button form="create-backup-form" type="submit" loading={busy}>
        Create
      </Button>
    </>
  )

  return (
    <Modal open onClose={onClose} title="New backup" footer={modalFooter}>
      <form
        id="create-backup-form"
        onSubmit={submit}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <Field
          label="Graph"
          htmlFor="cb-graph"
          hint="Optional — backs up all graphs when blank."
        >
          <Input
            id="cb-graph"
            value={graph}
            onChange={(e) => setGraph(e.target.value)}
            autoFocus
          />
        </Field>
        <Field
          label="Output path"
          htmlFor="cb-output"
          hint="Optional — defaults to the configured backup directory."
        >
          <Input
            id="cb-output"
            value={output}
            onChange={(e) => setOutput(e.target.value)}
          />
        </Field>
        {err && <ErrorBanner role="alert">{err}</ErrorBanner>}
      </form>
    </Modal>
  )
}
