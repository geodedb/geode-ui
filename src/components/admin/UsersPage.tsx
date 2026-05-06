import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import { client } from '../../api/client'

// UsersPage drives the /admin/users tab. The Geode B4 endpoints back
// every action:
//
//   list    GET    /api/v1/users           -> client.getUsers
//   create  POST   /api/v1/users           -> client.postUsers
//   delete  DELETE /api/v1/users/{name}    -> client.deleteUsername
//   disable POST   /api/v1/users/{name}/disable -> client.disable
//   enable  POST   /api/v1/users/{name}/enable  -> client.enable
//
// `UserList.users` is `Array<unknown>` in the genapi-emitted spec
// (the server returns an array of arbitrary records); UsersPage casts
// each entry to a structural User shape because the runtime payload is
// stable and the rendering code only touches well-known fields.
type User = {
  username: string
  email: string
  roles?: string[]
  disabled?: boolean
  mfa_enrolled?: boolean
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

export const UsersPage: React.FC = () => {
  const [users, setUsers] = useState<User[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  // Centralized refresh: the create modal calls load() on close, and
  // every row action (delete/disable/enable) calls it on success so the
  // UI reflects the new state without needing optimistic updates.
  const load = (): void => {
    client
      .getUsers({})
      .then((r) => {
        const list = (r.users ?? []) as User[]
        setUsers(list)
      })
      .catch((e: unknown) => {
        setErr(e instanceof Error ? e.message : String(e))
      })
  }

  useEffect(() => {
    load()
  }, [])

  const onDelete = async (username: string): Promise<void> => {
    // window.confirm is intentional -- this is an admin destructive
    // action and a confirmation prompt is the lowest-friction guard.
    // eslint-disable-next-line no-alert
    if (!window.confirm('Delete user ' + username + '?')) return
    try {
      await client.deleteUsername({ username })
      load()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const onDisable = async (username: string): Promise<void> => {
    try {
      await client.disable({ username })
      load()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const onEnable = async (username: string): Promise<void> => {
    try {
      await client.enable({ username })
      load()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Wrap>
      <ToolBar>
        <h2>Users ({users.length})</h2>
        <NewBtn onClick={() => setShowCreate(true)}>+ New user</NewBtn>
      </ToolBar>
      {err && <Err>{err}</Err>}
      <Table>
        <thead>
          <tr>
            <th>Username</th>
            <th>Email</th>
            <th>Roles</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.length === 0 ? (
            <tr>
              <Empty colSpan={5}>No users.</Empty>
            </tr>
          ) : (
            users.map((u) => (
              <tr key={u.username}>
                <td>{u.username}</td>
                <td>{u.email}</td>
                <td>{(u.roles ?? []).join(', ')}</td>
                <td>{u.disabled ? 'disabled' : 'active'}</td>
                <td>
                  {u.disabled ? (
                    <RowBtn onClick={() => onEnable(u.username)}>Enable</RowBtn>
                  ) : (
                    <RowBtn onClick={() => onDisable(u.username)}>Disable</RowBtn>
                  )}
                  <RowBtn onClick={() => onDelete(u.username)}>Delete</RowBtn>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
      {showCreate && (
        <CreateUserModal
          onClose={() => {
            setShowCreate(false)
            load()
          }}
        />
      )}
    </Wrap>
  )
}

const CreateUserModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      await client.postUsers({ username, email, password })
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
        <h3>New user</h3>
        <form
          onSubmit={submit}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <input
            placeholder="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <input
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            placeholder="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
