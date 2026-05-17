import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import type { User } from '@api'
import { client } from '../../api/client'
import {
  isWireFeatureMissingError,
  wireFeatureMissingDescription,
} from '../../api/capabilities'
import { generatePassword } from '../../lib/passwordGenerator'
import {
  PolicyViolation,
  validatePassword as validateClientPolicy,
} from '../../lib/passwordPolicy'
import {
  Button,
  ConfirmModal,
  DataTable,
  EmptyCell,
  Field,
  Input,
  Modal,
  TableScroll,
} from '../ui'
import { AdminPageShell, ErrorBanner } from './AdminPageShell'
import { useAdminListPage } from './useAdminListPage'

// UsersPage drives the /admin/users tab. The Geode B4 endpoints back
// every action:
//
//   list    GET    /api/v1/users           -> client.getUsers
//   create  POST   /api/v1/users           -> client.postUsers
//   delete  DELETE /api/v1/users/{name}    -> client.deleteUsername
//   disable POST   /api/v1/users/{name}/disable -> client.disable
//   enable  POST   /api/v1/users/{name}/enable  -> client.enable
//
// GAP-Q8 (#38): `UserList.users` is now the typed `User[]` in the
// genapi-emitted spec (the server projects the runtime-discovered
// `SHOW USERS` columns onto the typed struct), so this page imports
// `User` from `@api` instead of re-declaring a structural shadow and
// casting `Array<unknown>`.

const RowActions = styled.div`
  display: inline-flex;
  gap: ${({ theme }) => theme.spacing.xs};
`

export const UsersPage: React.FC = () => {
  const { t } = useTranslation()
  // QUALITY-18 (#270): list scaffold (state, capabilities probe, list
  // fetch, delete handler) lives in useAdminListPage. UsersPage adds
  // two extra handlers (onDisable / onEnable) that don't fit the
  // generic shape; they stay inline below.
  const page = useAdminListPage<User>({
    resource: 'users',
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    fetcher: async (_signal): Promise<User[]> => {
      const r = await client.getUsers({})
      return r.users ?? []
    },
    deleter: (username) =>
      client.deleteUsername({ username }).then(() => undefined),
  })
  const users = page.rows
  const [extraErr, setExtraErr] = useState<string | null>(null)
  const err = page.err ?? extraErr
  const { refetch } = page

  const onDisable = useCallback(
    async (username: string): Promise<void> => {
      try {
        await client.disable({ username })
        setExtraErr(null)
        refetch()
      } catch (e: unknown) {
        setExtraErr(e instanceof Error ? e.message : String(e))
      }
    },
    [refetch]
  )

  const onEnable = useCallback(
    async (username: string): Promise<void> => {
      try {
        await client.enable({ username })
        setExtraErr(null)
        refetch()
      } catch (e: unknown) {
        setExtraErr(e instanceof Error ? e.message : String(e))
      }
    },
    [refetch]
  )

  return (
    <AdminPageShell
      title={t('users.title', { count: users.length })}
      unsupportedNote={t('users.unsupportedNote')}
      unsupportedTooltip={t('users.unsupportedTooltip')}
      newButtonLabel={t('users.newButton')}
      gateCreate={page.gateCreate}
      onCreate={page.openCreate}
      err={err}
      testIds={{
        unsupportedNote: 'admin-users-unsupported',
        newButton: 'admin-new-user-btn',
      }}
    >
      <TableScroll>
        <DataTable>
          <thead>
            <tr>
              <th>{t('users.columnUsername')}</th>
              <th>{t('users.columnEmail')}</th>
              <th>{t('users.columnRoles')}</th>
              <th>{t('users.columnStatus')}</th>
              <th>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <EmptyCell colSpan={5}>{t('users.empty')}</EmptyCell>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.username}>
                  <td>{u.username}</td>
                  <td>{u.email}</td>
                  <td>{(u.roles ?? []).join(', ')}</td>
                  <td>
                    {u.disabled
                      ? t('users.statusDisabled')
                      : t('users.statusActive')}
                  </td>
                  <td>
                    <RowActions>
                      {u.disabled ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onEnable(u.username)}
                        >
                          {t('common.enable')}
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onDisable(u.username)}
                        >
                          {t('common.disable')}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => page.openConfirm(u.username)}
                      >
                        {t('common.delete')}
                      </Button>
                    </RowActions>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>
      </TableScroll>
      {page.showCreate && <CreateUserModal onClose={page.closeCreate} />}
      <ConfirmModal
        open={page.confirmDelete !== null}
        title={t('users.deleteTitle', { name: page.confirmDelete ?? '' })}
        body={t('common.cannotBeUndone')}
        destructive
        loading={page.deleting}
        confirmLabel={t('users.deleteConfirm')}
        onConfirm={page.onDelete}
        onClose={page.closeConfirm}
      />
    </AdminPageShell>
  )
}

// PasswordRow lays the password input + Generate button on one row
// so the operator can hit "Generate" and immediately see the proposed
// password in the field. Visually it looks like a single control.
const PasswordRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.xs};
  align-items: stretch;

  & > :first-child {
    flex: 1 1 auto;
    min-width: 0;
  }
`

const CreateUserModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Live client-side policy validation. The Submit button is disabled
  // whenever the password is non-empty AND violates a rule. An empty
  // password is allowed through so the operator can create a user
  // without an initial password (the server still accepts that on
  // builds where it's enabled); the empty-vs-invalid distinction is
  // intentional so the hint doesn't scream at the user before they've
  // typed anything.
  //
  // Direct-literal `t('users.password*')` calls are intentional (vs a
  // table-driven helper) so the verify:translations pre-commit hook
  // sees every key referenced. Each branch maps a single
  // PolicyViolation to the matching i18n message.
  const policy = validateClientPolicy(password, username)
  const showPolicyErrors = password.length > 0 && !policy.valid
  const policyMessageFor = (v: PolicyViolation): string => {
    switch (v) {
      case 'tooShort':
        return t('users.passwordTooShort')
      case 'weakPattern':
        return t('users.passwordWeakPattern')
      case 'containsUsername':
        return t('users.passwordContainsUsername')
      default:
        return t('users.passwordHintRequirements')
    }
  }
  const policyErrorText = showPolicyErrors
    ? policy.errors.map((e) => policyMessageFor(e)).join(' · ')
    : null

  const onGenerate = (): void => {
    // The generator never produces a password that contains the
    // username substring (when the username is set) and is guaranteed
    // to pass every client-side rule. Default length (20) is well
    // above the 12-char floor and trivially passes the
    // weakPattern/all-digits gates.
    try {
      setPassword(generatePassword({ username: username || undefined }))
      setErr(null)
    } catch (genErr: unknown) {
      // Almost impossible in browser/jsdom — only fires when
      // window.crypto.getRandomValues is unavailable, in which case
      // the operator must type the password by hand.
      setErr(genErr instanceof Error ? genErr.message : String(genErr))
    }
  }

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (showPolicyErrors) {
      setErr(policyErrorText ?? t('users.passwordHintRequirements'))
      return
    }
    setBusy(true)
    setErr(null)
    try {
      await client.postUsers({ username, email, password })
      onClose()
    } catch (e2: unknown) {
      if (isWireFeatureMissingError(e2)) {
        setErr(
          wireFeatureMissingDescription(e2) ?? t('users.wireFeatureMissing')
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
      <Button
        form="create-user-form"
        type="submit"
        loading={busy}
        disabled={showPolicyErrors}
      >
        {t('common.create')}
      </Button>
    </>
  )

  return (
    <Modal
      open
      onClose={onClose}
      title={t('users.createTitle')}
      footer={modalFooter}
    >
      <form
        id="create-user-form"
        onSubmit={submit}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <Field label={t('users.fieldUsername')} htmlFor="cu-username" required>
          <Input
            id="cu-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoFocus
          />
        </Field>
        <Field label={t('users.fieldEmail')} htmlFor="cu-email" required>
          <Input
            id="cu-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Field
          label={t('users.fieldPassword')}
          htmlFor="cu-password"
          hint={t('users.passwordHintRequirements')}
          error={policyErrorText ?? undefined}
        >
          <PasswordRow>
            <Input
              id="cu-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              aria-invalid={showPolicyErrors || undefined}
              data-testid="cu-password"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onGenerate}
              data-testid="cu-password-generate"
            >
              {t('users.generatePassword')}
            </Button>
          </PasswordRow>
        </Field>
        {err && <ErrorBanner role="alert">{err}</ErrorBanner>}
      </form>
    </Modal>
  )
}
