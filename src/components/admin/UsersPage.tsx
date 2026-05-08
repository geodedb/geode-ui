import React, { useState } from 'react'
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

export const UsersPage: React.FC = () => {
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // useApiResource owns the AbortController + mounted/aborted guards.
  // The fetcher receives a signal which is forwarded to the typed
  // client; the genapi-emitted client doesn't yet expose a per-call
  // signal, so the hook still gates state updates correctly even if
  // the underlying fetch isn't aborted. The signal is passed for when
  // genapi grows passthrough in a future MR (see #29 commit body).
  const {
    data,
    error: loadErr,
    refetch,
  } = useApiResource(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async (_signal) => {
      const r = await client.getUsers({})
      return ((r.users ?? []) as User[]) ?? []
    },
    []
  )
  const users = data ?? []
  const err = actionErr ?? loadErr

  const onDelete = async (): Promise<void> => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await client.deleteUsername({ username: confirmDelete })
      setActionErr(null)
      setConfirmDelete(null)
      refetch()
    } catch (e: unknown) {
      setActionErr(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleting(false)
    }
  }

  const onDisable = async (username: string): Promise<void> => {
    try {
      await client.disable({ username })
      setActionErr(null)
      refetch()
    } catch (e: unknown) {
      setActionErr(e instanceof Error ? e.message : String(e))
    }
  }

  const onEnable = async (username: string): Promise<void> => {
    try {
      await client.enable({ username })
      setActionErr(null)
      refetch()
    } catch (e: unknown) {
      setActionErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Stack $gap="md">
      <ToolBar>
        <h2>Users ({users.length})</h2>
        <Button onClick={() => setShowCreate(true)}>+ New user</Button>
      </ToolBar>
      {err && <ErrorBanner role="alert">{err}</ErrorBanner>}
      <TableScroll>
        <DataTable>
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
                <EmptyCell colSpan={5}>No users.</EmptyCell>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.username}>
                  <td>{u.username}</td>
                  <td>{u.email}</td>
                  <td>{(u.roles ?? []).join(', ')}</td>
                  <td>{u.disabled ? 'disabled' : 'active'}</td>
                  <td>
                    <RowActions>
                      {u.disabled ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onEnable(u.username)}
                        >
                          Enable
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onDisable(u.username)}
                        >
                          Disable
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDelete(u.username)}
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
        <CreateUserModal
          onClose={() => {
            setShowCreate(false)
            refetch()
          }}
        />
      )}
      <ConfirmModal
        open={confirmDelete !== null}
        title={`Delete user "${confirmDelete}"?`}
        body="This action cannot be undone."
        destructive
        loading={deleting}
        confirmLabel="Delete"
        onConfirm={onDelete}
        onClose={() => setConfirmDelete(null)}
      />
    </Stack>
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

  const modalFooter = (
    <>
      <Button variant="ghost" onClick={onClose} disabled={busy}>
        Cancel
      </Button>
      <Button form="create-user-form" type="submit" loading={busy}>
        Create
      </Button>
    </>
  )

  return (
    <Modal open onClose={onClose} title="New user" footer={modalFooter}>
      <form
        id="create-user-form"
        onSubmit={submit}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <Field label="Username" htmlFor="cu-username" required>
          <Input
            id="cu-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoFocus
          />
        </Field>
        <Field label="Email" htmlFor="cu-email" required>
          <Input
            id="cu-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Field
          label="Password"
          htmlFor="cu-password"
          hint="The user can change this on first login."
        >
          <Input
            id="cu-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        {err && <ErrorBanner role="alert">{err}</ErrorBanner>}
      </form>
    </Modal>
  )
}
