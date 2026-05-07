import React, { useState } from 'react'
import styled from 'styled-components'
import { client } from '../../api/client'
import { useApiResource } from '../../hooks/useApiResource'

// RolesPage drives the /admin/roles tab (Geode B5 endpoints):
//
//   list    GET    /api/v1/roles           -> client.getRoles
//   create  POST   /api/v1/roles           -> client.postApiRoles
//   delete  DELETE /api/v1/roles/{role}    -> client.deleteRole
//
// Note: the generator emits `postApiRoles` (not `postRoles`) because the
// raw HTTP-verb-prefixed name `postRoles` collided with another method.
// `RoleList.roles` is `Array<unknown>`; we cast each entry to a
// structural Role shape because the server returns a stable record.
type Role = {
  name: string
  description?: string
  permissions?: string[]
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

export const RolesPage: React.FC = () => {
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const {
    data,
    error: loadErr,
    refetch,
  } = useApiResource(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async (_signal) => {
      const r = await client.getRoles({})
      return ((r.roles ?? []) as Role[]) ?? []
    },
    []
  )
  const roles = data ?? []
  const err = actionErr ?? loadErr

  const onDelete = async (role: string): Promise<void> => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Delete role ' + role + '?')) return
    try {
      await client.deleteRole({ role })
      setActionErr(null)
      refetch()
    } catch (e: unknown) {
      setActionErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Wrap>
      <ToolBar>
        <h2>Roles ({roles.length})</h2>
        <NewBtn onClick={() => setShowCreate(true)}>+ New role</NewBtn>
      </ToolBar>
      {err && <Err>{err}</Err>}
      <Table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Description</th>
            <th>Permissions</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {roles.length === 0 ? (
            <tr>
              <Empty colSpan={4}>No roles.</Empty>
            </tr>
          ) : (
            roles.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td>{r.description ?? ''}</td>
                <td>{(r.permissions ?? []).join(', ')}</td>
                <td>
                  <RowBtn onClick={() => onDelete(r.name)}>Delete</RowBtn>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
      {showCreate && (
        <CreateRoleModal
          onClose={() => {
            setShowCreate(false)
            refetch()
          }}
        />
      )}
    </Wrap>
  )
}

const CreateRoleModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [permissions, setPermissions] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      // permissions field is a comma-separated string in the form;
      // split + trim + drop empties before sending.
      const perms = permissions
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
      await client.postApiRoles({ name, description, permissions: perms })
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
        <h3>New role</h3>
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
            placeholder="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <input
            placeholder="permissions (comma-separated)"
            value={permissions}
            onChange={(e) => setPermissions(e.target.value)}
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
