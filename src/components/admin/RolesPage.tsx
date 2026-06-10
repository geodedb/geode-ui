import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import {
  Button,
  ConfirmModal,
  DataTable,
  EmptyCell,
  Field,
  Icon,
  Input,
  Modal,
  TableScroll,
} from '@geodedb/ui-core'
import { client } from '../../api/client'
import {
  isWireFeatureMissingError,
  wireFeatureMissingDescription,
} from '../../api/capabilities'
import { permissionSuggestions } from '../../lib/rbacVocab'
import { AdminPageShell, ErrorBanner } from './AdminPageShell'
import { useAdminListPage } from './useAdminListPage'

// Inlined chip/tag input for the role Permissions field — small enough
// not to warrant a shared primitive. Backed by a native <datalist> so
// the browser autocompletes from `permissionSuggestions()`; free text is
// still accepted (Geode persists the string verbatim).
//
// Chip migrates to Bootstrap utilities: d-inline-flex align-items-center
// gap-1, bg-body-tertiary text-body border rounded small. The asymmetric
// padding (2px top/bottom, 8px left, 4px right) doesn't map onto
// Bootstrap's p-{n} scale so it stays inline.
//
// ChipRemove keeps a styled-component for the `:hover:not(:disabled)`
// nested selector that swaps the icon color to theme.text.danger.
const ChipRemove = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  color: ${({ theme }) => theme.text.muted};
  cursor: pointer;
  border-radius: ${({ theme }) => theme.radii.sm};
  font-size: ${({ theme }) => theme.font.sizes.sm};
  line-height: 1;

  &:hover:not(:disabled) {
    color: ${({ theme }) => theme.text.danger};
  }
`

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

export const RolesPage: React.FC = () => {
  const { t } = useTranslation()
  // QUALITY-18 (#270): scaffold lives in useAdminListPage. See
  // PoliciesPage for the design rationale.
  const page = useAdminListPage<Role>({
    resource: 'roles',
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    fetcher: async (_signal) => {
      const r = await client.getRoles({})
      return ((r.roles ?? []) as Role[]) ?? []
    },
    deleter: (role) => client.deleteRole({ role }).then(() => undefined),
  })
  const roles = page.rows

  return (
    <AdminPageShell
      title={t('roles.title', { count: roles.length })}
      unsupportedNote={t('roles.unsupportedNote')}
      unsupportedTooltip={t('roles.unsupportedTooltip')}
      newButtonLabel={t('roles.newButton')}
      gateCreate={page.gateCreate}
      onCreate={page.openCreate}
      err={page.err}
      testIds={{
        unsupportedNote: 'admin-roles-unsupported',
        newButton: 'admin-new-role-btn',
      }}
    >
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
                      onClick={() => page.openConfirm(r.name)}
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
      {page.showCreate && <CreateRoleModal onClose={page.closeCreate} />}
      <ConfirmModal
        open={page.confirmDelete !== null}
        title={t('roles.deleteTitle', { name: page.confirmDelete ?? '' })}
        body={t('common.cannotBeUndone')}
        destructive
        loading={page.deleting}
        confirmLabel={t('roles.deleteConfirm')}
        cancelLabel={t('common.cancel')}
        onConfirm={page.onDelete}
        onClose={page.closeConfirm}
      />
    </AdminPageShell>
  )
}

const CreateRoleModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [permissions, setPermissions] = useState<string[]>([])
  const [permDraft, setPermDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const suggestions = React.useMemo(() => permissionSuggestions(), [])

  const addChip = (raw: string): void => {
    const v = raw.trim()
    if (v.length === 0) return
    setPermissions((prev) => (prev.includes(v) ? prev : [...prev, v]))
    setPermDraft('')
  }

  const removeChip = (v: string): void => {
    setPermissions((prev) => prev.filter((p) => p !== v))
  }

  const onPermKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addChip(permDraft)
    } else if (e.key === 'Backspace' && permDraft.length === 0) {
      setPermissions((prev) => prev.slice(0, -1))
    }
  }

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      // Fold any in-progress draft into the chip set before sending so a
      // value typed but not yet committed isn't silently dropped.
      const draft = permDraft.trim()
      const perms =
        draft.length > 0 && !permissions.includes(draft)
          ? [...permissions, draft]
          : permissions
      await client.postAPIRoles({ name, description, permissions: perms })
      onClose()
    } catch (e2: unknown) {
      if (isWireFeatureMissingError(e2)) {
        setErr(
          wireFeatureMissingDescription(e2) ?? t('roles.wireFeatureMissing')
        )
      } else {
        setErr(e2 instanceof Error ? e2.message : String(e2))
      }
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
      closeLabel={t('common.closeDialog')}
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
          htmlFor="role-permissions-input"
          hint={t('roles.permissionsHint')}
        >
          {permissions.length > 0 && (
            <ul
              className="list-unstyled m-0 p-0 d-flex flex-wrap"
              style={{ gap: '6px', marginBottom: '6px' }}
            >
              {permissions.map((p) => (
                <li
                  key={p}
                  className="d-inline-flex align-items-center gap-1 bg-body-tertiary text-body border rounded small"
                  style={{ padding: '2px 4px 2px 8px' }}
                >
                  <span>{p}</span>
                  <ChipRemove
                    type="button"
                    aria-label={t('roles.removePermission', { permission: p })}
                    onClick={() => removeChip(p)}
                  >
                    <Icon
                      name="xmark"
                      label={t('roles.removePermission', { permission: p })}
                    />
                  </ChipRemove>
                </li>
              ))}
            </ul>
          )}
          <Input
            id="role-permissions-input"
            data-testid="role-permissions-input"
            list="role-permission-suggestions"
            value={permDraft}
            placeholder={t('roles.permissionsPlaceholder')}
            onChange={(e) => setPermDraft(e.target.value)}
            onKeyDown={onPermKeyDown}
            onBlur={() => addChip(permDraft)}
          />
          <datalist id="role-permission-suggestions">
            {suggestions.map((s) => (
              <option key={s} value={s} label={s} />
            ))}
          </datalist>
        </Field>
        {err && <ErrorBanner role="alert">{err}</ErrorBanner>}
      </form>
    </Modal>
  )
}
