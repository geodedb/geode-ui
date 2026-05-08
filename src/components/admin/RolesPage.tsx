import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
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

export const RolesPage: React.FC = () => {
  const { t } = useTranslation()
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
      const r = await client.getRoles({})
      return ((r.roles ?? []) as Role[]) ?? []
    },
    []
  )
  const roles = data ?? []
  const err = actionErr ?? loadErr

  const onDelete = async (): Promise<void> => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await client.deleteRole({ role: confirmDelete })
      setActionErr(null)
      setConfirmDelete(null)
      refetch()
    } catch (e: unknown) {
      setActionErr(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Stack $gap="md">
      <ToolBar>
        <h2>{t('roles.title', { count: roles.length })}</h2>
        <Button onClick={() => setShowCreate(true)}>
          {t('roles.newButton')}
        </Button>
      </ToolBar>
      {err && <ErrorBanner role="alert">{err}</ErrorBanner>}
      <TableScroll>
        <DataTable>
          <thead>
            <tr>
              <th>{t('roles.columnName')}</th>
              <th>{t('roles.columnDescription')}</th>
              <th>{t('roles.columnPermissions')}</th>
              <th>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {roles.length === 0 ? (
              <tr>
                <EmptyCell colSpan={4}>{t('roles.empty')}</EmptyCell>
              </tr>
            ) : (
              roles.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td>{r.description ?? ''}</td>
                  <td>{(r.permissions ?? []).join(', ')}</td>
                  <td>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmDelete(r.name)}
                    >
                      {t('common.delete')}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>
      </TableScroll>
      {showCreate && (
        <CreateRoleModal
          onClose={() => {
            setShowCreate(false)
            refetch()
          }}
        />
      )}
      <ConfirmModal
        open={confirmDelete !== null}
        title={t('roles.deleteTitle', { name: confirmDelete ?? '' })}
        body={t('common.cannotBeUndone')}
        destructive
        loading={deleting}
        confirmLabel={t('roles.deleteConfirm')}
        onConfirm={onDelete}
        onClose={() => setConfirmDelete(null)}
      />
    </Stack>
  )
}

const CreateRoleModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation()
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

  const modalFooter = (
    <>
      <Button variant="ghost" onClick={onClose} disabled={busy}>
        {t('common.cancel')}
      </Button>
      <Button form="create-role-form" type="submit" loading={busy}>
        {t('common.create')}
      </Button>
    </>
  )

  return (
    <Modal
      open
      onClose={onClose}
      title={t('roles.createTitle')}
      footer={modalFooter}
    >
      <form
        id="create-role-form"
        onSubmit={submit}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <Field label={t('roles.fieldName')} htmlFor="cr-name" required>
          <Input
            id="cr-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </Field>
        <Field label={t('roles.fieldDescription')} htmlFor="cr-description">
          <Input
            id="cr-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field
          label={t('roles.fieldPermissions')}
          htmlFor="cr-permissions"
          hint={t('roles.permissionsHint')}
        >
          <Input
            id="cr-permissions"
            value={permissions}
            onChange={(e) => setPermissions(e.target.value)}
          />
        </Field>
        {err && <ErrorBanner role="alert">{err}</ErrorBanner>}
      </form>
    </Modal>
  )
}
