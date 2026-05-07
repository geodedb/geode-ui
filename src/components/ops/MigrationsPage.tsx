import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import { client } from '../../api/client'

// MigrationsPage drives the /ops/migrations tab. Geode B8 endpoints:
//
//   list   GET    /api/v1/migrations             -> client.getMigrations
//   create POST   /api/v1/migrations             -> client.postMigrations
//   run    POST   /api/v1/migrations/run         -> client.postMigrationsRun
//   sign   POST   /api/v1/migrations/{name}/sign -> client.sign
//
// MigrationStatus.applied is `Array<unknown>`; we cast each entry to the
// structural Migration shape because the runtime payload is stable.
type Migration = {
  name: string
  applied_at?: string
  signed_by?: string
  description?: string
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
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

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 8px;

  h3 {
    font-size: 0.95rem;
    color: ${({ theme }) => theme.colors.textSecondary};
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

  &:hover {
    background: ${({ theme }) => theme.colors.surface};
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
  min-width: 360px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: ${({ theme }) => theme.colors.text};

  h3 {
    margin: 0;
  }

  input,
  textarea {
    padding: 6px 8px;
    background: ${({ theme }) => theme.colors.background};
    color: inherit;
    border: 1px solid ${({ theme }) => theme.colors.border};
    border-radius: 4px;
    font-family: inherit;
  }
`

const Err = styled.p`
  color: #ef4444;
  margin-top: 8px;
`

const OkBanner = styled.p`
  color: #10b981;
  margin-top: 8px;
`

const Empty = styled.td`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-style: italic;
  text-align: center;
`

export const MigrationsPage: React.FC = () => {
  const [applied, setApplied] = useState<Migration[]>([])
  const [pending, setPending] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = (): void => {
    client
      .getMigrations({})
      .then((r) => {
        setApplied(((r.applied ?? []) as Migration[]) ?? [])
        setPending(((r.pending ?? []) as string[]) ?? [])
      })
      .catch((e: unknown) => {
        setErr(e instanceof Error ? e.message : String(e))
      })
  }

  useEffect(() => {
    load()
  }, [])

  const onRunPending = async (): Promise<void> => {
    setBusy(true)
    setErr(null)
    setOkMsg(null)
    try {
      const r = await client.postMigrationsRun({})
      const n = (r.applied ?? []).length
      setOkMsg('Applied ' + n + ' migration(s).')
      load()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onSign = async (name: string): Promise<void> => {
    try {
      await client.sign({ name })
      load()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Wrap>
      <ToolBar>
        <h2>Migrations</h2>
        <NewBtn onClick={() => setShowCreate(true)}>+ New migration</NewBtn>
        <NewBtn onClick={onRunPending} disabled={busy || pending.length === 0}>
          {busy ? '...' : 'Run pending (' + pending.length + ')'}
        </NewBtn>
      </ToolBar>
      {err && <Err>{err}</Err>}
      {okMsg && <OkBanner>{okMsg}</OkBanner>}
      <Section>
        <h3>Pending ({pending.length})</h3>
        <Table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pending.length === 0 ? (
              <tr>
                <Empty colSpan={2}>No pending migrations.</Empty>
              </tr>
            ) : (
              pending.map((name) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>
                    <RowBtn onClick={() => onSign(name)}>Sign</RowBtn>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </Section>
      <Section>
        <h3>Applied ({applied.length})</h3>
        <Table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Applied at</th>
              <th>Signed by</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {applied.length === 0 ? (
              <tr>
                <Empty colSpan={4}>No applied migrations.</Empty>
              </tr>
            ) : (
              applied.map((m) => (
                <tr key={m.name}>
                  <td>{m.name}</td>
                  <td>{m.applied_at ?? ''}</td>
                  <td>{m.signed_by ?? ''}</td>
                  <td>
                    <RowBtn onClick={() => onSign(m.name)}>Sign</RowBtn>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </Section>
      {showCreate && (
        <CreateMigrationModal
          onClose={() => {
            setShowCreate(false)
            load()
          }}
        />
      )}
    </Wrap>
  )
}

const CreateMigrationModal: React.FC<{ onClose: () => void }> = ({
  onClose,
}) => {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      await client.postMigrations({ name, description })
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
        <h3>New migration</h3>
        <form
          onSubmit={submit}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <input
            placeholder="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <textarea
            placeholder="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
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
