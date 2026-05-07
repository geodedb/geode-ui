import React, { useState } from 'react'
import styled from 'styled-components'
import { client } from '../../api/client'
import { useApiResource } from '../../hooks/useApiResource'

// PoliciesPage drives the /admin/policies tab (Geode B6 endpoints):
//
//   list    GET    /api/v1/policies         -> client.getPolicies
//   create  POST   /api/v1/policies         -> client.postPolicies
//   delete  DELETE /api/v1/policies/{name}  -> client.deleteName
//
// The generator emits `deleteName` (rather than `deletePolicy`) because
// the path leaf is the parameter `{name}`. PolicyList.policies is
// `Array<unknown>`; we cast each entry to the structural Policy shape.
type Policy = {
  name: string
  expression?: string
  resource?: string
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

const Empty = styled.td`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-style: italic;
  text-align: center;
`

const Code = styled.code`
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85em;
`

export const PoliciesPage: React.FC = () => {
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const {
    data,
    error: loadErr,
    refetch,
  } = useApiResource(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async (_signal) => {
      const r = await client.getPolicies({})
      return ((r.policies ?? []) as Policy[]) ?? []
    },
    []
  )
  const policies = data ?? []
  const err = actionErr ?? loadErr

  const onDelete = async (name: string): Promise<void> => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Delete policy ' + name + '?')) return
    try {
      await client.deleteName({ name })
      setActionErr(null)
      refetch()
    } catch (e: unknown) {
      setActionErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Wrap>
      <ToolBar>
        <h2>Policies ({policies.length})</h2>
        <NewBtn onClick={() => setShowCreate(true)}>+ New policy</NewBtn>
      </ToolBar>
      {err && <Err>{err}</Err>}
      <Table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Resource</th>
            <th>Expression</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {policies.length === 0 ? (
            <tr>
              <Empty colSpan={4}>No policies.</Empty>
            </tr>
          ) : (
            policies.map((p) => (
              <tr key={p.name}>
                <td>{p.name}</td>
                <td>{p.resource ?? ''}</td>
                <td>
                  <Code>{p.expression ?? ''}</Code>
                </td>
                <td>
                  <RowBtn onClick={() => onDelete(p.name)}>Delete</RowBtn>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
      {showCreate && (
        <CreatePolicyModal
          onClose={() => {
            setShowCreate(false)
            refetch()
          }}
        />
      )}
    </Wrap>
  )
}

const CreatePolicyModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [name, setName] = useState('')
  const [resource, setResource] = useState('')
  const [expression, setExpression] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      await client.postPolicies({ name, resource, expression })
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
        <h3>New policy</h3>
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
          <input
            placeholder="resource (e.g. graph:default)"
            value={resource}
            onChange={(e) => setResource(e.target.value)}
          />
          <textarea
            placeholder="expression"
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            rows={3}
            required
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
