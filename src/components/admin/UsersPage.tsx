import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import type { User } from '@api'
import { client } from '../../api/client'
import {
  isWireFeatureMissingError,
  wireFeatureMissingDescription,
} from '../../api/capabilities'
import { useApiResource } from '../../hooks/useApiResource'
import { useCapabilities } from '../../hooks/useCapabilities'
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
// GAP-Q8 (#38): `UserList.users` is now the typed `User[]` in the
// genapi-emitted spec (the server projects the runtime-discovered
// `SHOW USERS` columns onto the typed struct), so this page imports
// `User` from `@api` instead of re-declaring a structural shadow and
// casting `Array<unknown>`.

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

const UnsupportedNote = styled.span`
  font-size: ${({ theme }) => theme.font.sizes.sm};
  color: ${({ theme }) => theme.text.secondary};
`

export const UsersPage: React.FC = () => {
  const { t } = useTranslation()
  const { adminWritable, loaded: capsLoaded } = useCapabilities()
  // Render the CTA enabled until the /capabilities probe confirms the
  // connected Geode build lacks the wire DDL — only then disable it and
  // surface the inline note, so the button never flashes disabled-then-
  // enabled on a build that does support it.
  const gateCreate = capsLoaded && !adminWritable.users
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
    async (_signal): Promise<User[]> => {
      const r = await client.getUsers({})
      return r.users ?? []
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
        <h2>{t('users.title', { count: users.length })}</h2>
        {gateCreate && (
          <UnsupportedNote data-testid="admin-users-unsupported">
            {t('users.unsupportedNote')}
          </UnsupportedNote>
        )}
        <Button
          data-testid="admin-new-user-btn"
          onClick={() => setShowCreate(true)}
          disabled={gateCreate}
          title={gateCreate ? t('users.unsupportedTooltip') : undefined}
        >
          {t('users.newButton')}
        </Button>
      </ToolBar>
      {err && <ErrorBanner role="alert">{err}</ErrorBanner>}
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
                        onClick={() => setConfirmDelete(u.username)}
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
        title={t('users.deleteTitle', { name: confirmDelete ?? '' })}
        body={t('common.cannotBeUndone')}
        destructive
        loading={deleting}
        confirmLabel={t('users.deleteConfirm')}
        onConfirm={onDelete}
        onClose={() => setConfirmDelete(null)}
      />
    </Stack>
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
