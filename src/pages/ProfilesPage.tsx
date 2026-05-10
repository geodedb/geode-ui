import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { DefaultTheme } from 'styled-components'

import { listProfiles, updateProfile, ProfileView } from '../api/profiles'
import { Button } from '../components/ui'
import { ProfileEditorModal } from '../components/profiles/ProfileEditorModal'
import { DeleteProfileModal } from '../components/profiles/DeleteProfileModal'
import { useAuth } from '../auth/AuthProvider'

const Page = styled.section`
  max-width: 1024px;
  margin: 0 auto;
  padding: ${({ theme }) => theme.spacing.lg};
`
const Header = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: ${({ theme }) => theme.spacing.md};
`
const Title = styled.h1`
  font-family: ${({ theme }) => theme.font.family.display};
  font-size: ${({ theme }) => theme.font.sizes.xxl};
  margin: 0;
`
const Description = styled.p`
  color: ${({ theme }) => theme.text.secondary};
  font-size: ${({ theme }) => theme.font.sizes.sm};
  margin: 4px 0 0 0;
`
const Status = styled.p`
  color: ${({ theme }) => theme.text.secondary};
  margin-top: ${({ theme }) => theme.spacing.lg};
`
const ErrorText = styled.p`
  color: ${({ theme }) => theme.text.danger};
  margin-top: ${({ theme }) => theme.spacing.lg};
`
const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  th,
  td {
    text-align: left;
    padding: ${({ theme }) => theme.spacing.sm};
    border-bottom: 1px solid ${({ theme }) => theme.border.default};
  }
  th {
    font-weight: 600;
    color: ${({ theme }) => theme.text.secondary};
  }
`

type BadgeKind = 'system' | 'personal' | 'default'
type BadgeProps = { theme: DefaultTheme; $kind: BadgeKind }

function badgeBg(props: BadgeProps): string {
  return props.$kind === 'default'
    ? props.theme.colors.primary
    : props.theme.bg.subtle
}

function badgeFg(props: BadgeProps): string {
  return props.$kind === 'default'
    ? props.theme.text.inverse
    : props.theme.text.primary
}

const Badge = styled.span<{ $kind: BadgeKind }>`
  display: inline-block;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: ${({ theme }) => theme.font.sizes.xs};
  background: ${badgeBg};
  color: ${badgeFg};
`

function scopeLabel(scope: string, t: (k: string) => string): string {
  if (scope === 'personal') return t('profiles.scope.personal')
  return t('profiles.scope.system')
}

export const ProfilesPage: React.FC = () => {
  const { t } = useTranslation()
  // PSR-G09 (#86): admin status now comes from the JWT roles claim
  // (surfaced through AuthProvider.isAdmin) rather than the previous
  // `profiles?.some(p => p.scope === 'system' && !!p.dsn)` heuristic.
  // The heuristic conflated two unrelated signals: DSN visibility
  // (which the server uses as a redaction marker for non-admin
  // viewers) and the admin role (which actually authorises CRUD).
  // A user with no admin role but who happened to be looking at a
  // system profile with a leaked DSN would have seen Edit/Delete
  // buttons that the server would reject; conversely an admin
  // looking at a profile-list where every system profile had its DSN
  // redacted (because the server scrubbed them) would see none of
  // the buttons they were actually authorised to use.
  const { isAdmin } = useAuth()
  const [profiles, setProfiles] = useState<ProfileView[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // PSR-G05 (#82): non-blocking failure surface for the multi-step
  // setAsDefault dance. We can't fold this into `err` (which gates the
  // whole-page error UI) because a partial setAsDefault failure leaves
  // the table contents valid; the user just needs to know that one or
  // both PATCH calls didn't land and they should retry.
  const [setDefaultErr, setSetDefaultErr] = useState<string | null>(null)

  const [editorOpen, setEditorOpen] = useState(false)
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create')
  const [editorProfile, setEditorProfile] = useState<ProfileView | undefined>(
    undefined
  )
  const [deleteTarget, setDeleteTarget] = useState<ProfileView | null>(null)

  const refresh = useCallback(async () => {
    setErr(null)
    try {
      const list = await listProfiles()
      setProfiles(list)
    } catch (e: unknown) {
      setProfiles([])
      setErr(e instanceof Error ? e.message : t('profiles.error'))
    }
  }, [t])

  useEffect(() => {
    refresh().catch(() => undefined)
  }, [refresh])

  const openCreate = () => {
    setEditorMode('create')
    setEditorProfile(undefined)
    setEditorOpen(true)
  }

  const openEdit = (p: ProfileView) => {
    setEditorMode('edit')
    setEditorProfile(p)
    setEditorOpen(true)
  }

  // PSR-G05 (#82): both PATCH calls in the dance can fail. Pre-fix the
  // whole function returned a rejected promise that the caller swallowed
  // (`setAsDefault(p).catch(() => undefined)` in the click handler), so a
  // 403/network-blip vanished into the void and the user had no idea
  // their click had no effect. Now we catch in-line and surface the
  // failure via the `setDefaultErr` banner so the user can retry.
  const setAsDefault = async (target: ProfileView) => {
    setSetDefaultErr(null)
    const peers = (profiles ?? []).filter(
      (p) =>
        p.scope === target.scope &&
        (p.ownerUserId ?? '') === (target.ownerUserId ?? '') &&
        p.isDefault &&
        p.id !== target.id
    )
    try {
      await peers.reduce(
        (chain, peer) =>
          chain.then(() => updateProfile(peer.id, { isDefault: false })),
        Promise.resolve() as Promise<unknown>
      )
      await updateProfile(target.id, { isDefault: true })
      await refresh()
    } catch (e: unknown) {
      // Refresh anyway so the table reflects whatever partial state
      // landed on the server. A failure here is non-fatal for the
      // overall page, so we deliberately don't escalate to `err`.
      await refresh().catch(() => undefined)
      setSetDefaultErr(
        e instanceof Error ? e.message : t('profiles.setDefaultError')
      )
    }
  }

  if (profiles === null) {
    return (
      <Page>
        <Header>
          <Title>{t('profiles.title')}</Title>
        </Header>
        <Status>{t('profiles.loading')}</Status>
      </Page>
    )
  }
  if (err) {
    return (
      <Page>
        <Header>
          <Title>{t('profiles.title')}</Title>
        </Header>
        <ErrorText>{t('profiles.error')}</ErrorText>
      </Page>
    )
  }
  if (profiles.length === 0) {
    return (
      <Page>
        <Header>
          <div>
            <Title>{t('profiles.title')}</Title>
            <Description>{t('profiles.description')}</Description>
          </div>
          <Button onClick={openCreate}>{t('profiles.actions.create')}</Button>
        </Header>
        <Status>{t('profiles.empty')}</Status>
        <ProfileEditorModal
          mode={editorMode}
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
          onSaved={() => {
            refresh().catch(() => undefined)
          }}
          isAdmin={isAdmin}
          profile={editorProfile}
        />
      </Page>
    )
  }

  return (
    <Page>
      <Header>
        <div>
          <Title>{t('profiles.title')}</Title>
          <Description>{t('profiles.description')}</Description>
        </div>
        <Button onClick={openCreate}>{t('profiles.actions.create')}</Button>
      </Header>
      {setDefaultErr && (
        <ErrorText role="alert" data-testid="profiles-set-default-error">
          {setDefaultErr}
        </ErrorText>
      )}
      <Table>
        <thead>
          <tr>
            <th>{t('profiles.column.name')}</th>
            <th>{t('profiles.column.scope')}</th>
            <th>{t('profiles.column.description')}</th>
            <th>{t('profiles.column.owner')}</th>
            <th>{t('common.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((p) => (
            <tr key={p.id}>
              <td>
                <strong>{p.name}</strong>
                {p.isDefault ? (
                  <>
                    {' '}
                    <Badge $kind="default">{t('profiles.flag.default')}</Badge>
                  </>
                ) : null}
              </td>
              <td>
                <Badge $kind={p.scope}>{scopeLabel(p.scope, t)}</Badge>
              </td>
              <td>{p.description ?? ''}</td>
              <td>{p.ownerUserId ?? ''}</td>
              <td>
                {/*
                  PSR-G09 (#86): per-row CRUD visibility now combines two
                  signals correctly. (1) isAdmin from JWT roles — an
                  admin can edit/delete any profile, including system
                  profiles whose DSN the server scrubbed for redaction
                  reasons (admins still authoritatively see them via the
                  edit modal which re-fetches); (2) `!!p.dsn` — for
                  non-admins this is the server's "you own this" signal
                  (the server emits the DSN only when the viewer is the
                  profile owner). Pre-fix the gate was `!!p.dsn` alone
                  which meant an admin viewing a redacted system row
                  would see no buttons.
                */}
                {(isAdmin || !!p.dsn) && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openEdit(p)}
                    >
                      {t('profiles.actions.edit')}
                    </Button>{' '}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeleteTarget(p)}
                    >
                      {t('profiles.actions.delete')}
                    </Button>{' '}
                    {!p.isDefault && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setAsDefault(p).catch(() => undefined)
                        }}
                      >
                        {t('profiles.actions.setDefault')}
                      </Button>
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <ProfileEditorModal
        mode={editorMode}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          refresh().catch(() => undefined)
        }}
        isAdmin={isAdmin}
        profile={editorProfile}
      />
      {deleteTarget && (
        <DeleteProfileModal
          open
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            refresh().catch(() => undefined)
          }}
          profile={deleteTarget}
        />
      )}
    </Page>
  )
}
