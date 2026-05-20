// ProfilesPage — the connection-profiles administration surface.
//
// GAP-Q10 (#104): pre-refactor this page had three full Page returns
// (loading / error / empty + the live list) and mounted the editor
// modal twice — once inside the empty branch and once inside the
// list branch. The setDefaultErr banner only ever rendered inside
// the list branch, so a setAsDefault failure on a "now-empty" view
// (e.g. the user just deleted the last profile) was invisible. This
// refactor collapses the four branches into one render path:
//
//   - The header + Create button render unconditionally.
//   - Loading / error / empty are inline content WITHIN the table
//     area (not separate page returns).
//   - <ProfileEditorModal> is mounted ONCE at top level. The (mode,
//     target) tuple is driven by a reducer-shaped `editorState`
//     ({mode: 'create' | 'edit' | 'closed', target?: ProfileView}),
//     which removes the prior triple of (editorOpen, editorMode,
//     editorProfile) booleans/enums and the implicit invariant that
//     editorMode === 'edit' implies editorProfile !== undefined.
//
// Behaviour preserved:
//   - PSR-G09 (#86): isAdmin still sourced from useAuth().isAdmin
//     (JWT roles claim).
//   - PSR-G05 (#82): setDefaultErr banner still renders on
//     setAsDefault failure (and now does so even when the profile
//     list is empty after the failed dance).
//   - All existing per-row CRUD-button visibility (admin OR DSN
//     visible) and the two-PATCH default-promotion dance are
//     unchanged.

import React, { useCallback, useEffect, useReducer, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { DefaultTheme } from 'styled-components'

import { Button, TableScroll } from '@geodedb/ui-core'
import { listProfiles, updateProfile, ProfileView } from '../api/profiles'
import { ProfileEditorModal } from '../components/profiles/ProfileEditorModal'
import { DeleteProfileModal } from '../components/profiles/DeleteProfileModal'
import { useAuth } from '../auth/AuthProvider'

// Page outer shell — Bootstrap-migrated to a plain <section>. The
// 1024 px content width clamp has no Bootstrap utility equivalent
// (max-width utilities only go to .mw-100), so it stays inline; the
// rest is plain `w-100 mx-auto p-4` (4 = 1.5 rem = 24 px = the prior
// theme.spacing.lg token). docs/BOOTSTRAP_MIGRATION.md.
// Header — Bootstrap-migrated to a plain <div className=...>. Pure
// layout (flex row, baseline alignment, space-between, mb-3 spacing
// matches the prior theme.spacing.md = 16px token). docs/BOOTSTRAP_MIGRATION.md.
//
// Title KEPT: theme.font.family.display ("Sora, ...") has no Bootstrap
// utility, and theme.font.sizes.xxl = 24 px is a pixel size not in the
// `fs-*` rem-based scale (the closest fs-3 = 1.75 rem at the default
// 16 px base = 28 px). Pre-existing semantics + size are load-bearing
// for the page heading.
const Title = styled.h1`
  font-family: ${({ theme }) => theme.font.family.display};
  font-size: ${({ theme }) => theme.font.sizes.xxl};
  margin: 0;
`
// Status / ErrorText / Description / Page outer container collapsed
// into utility classes; see call site for the resulting className.
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

// editorState is the reducer-shaped tuple that replaces the prior
// (editorOpen, editorMode, editorProfile) triple. The `target?` is
// only present when mode === 'edit'; collapsing the three pieces of
// state into one discriminated value removes the implicit invariant
// the prior code carried (editorMode === 'edit' implies
// editorProfile !== undefined).
type EditorState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; target: ProfileView }

type EditorAction =
  | { type: 'open-create' }
  | { type: 'open-edit'; target: ProfileView }
  | { type: 'close' }

function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'open-create':
      return { mode: 'create' }
    case 'open-edit':
      return { mode: 'edit', target: action.target }
    case 'close':
      return { mode: 'closed' }
    default:
      return state
  }
}

export const ProfilesPage: React.FC = () => {
  const { t } = useTranslation()
  // PSR-G09 (#86): admin status comes from the JWT roles claim
  // (surfaced through AuthProvider.isAdmin) rather than the previous
  // `profiles?.some(p => p.scope === 'system' && !!p.dsn)` heuristic.
  // The heuristic conflated DSN visibility (a server-side redaction
  // marker) with the admin role (which actually authorises CRUD).
  const { isAdmin } = useAuth()
  const [profiles, setProfiles] = useState<ProfileView[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // PSR-G05 (#82): non-blocking failure surface for the multi-step
  // setAsDefault dance. Distinct from `err` (which gates the table
  // body) because a partial setAsDefault failure leaves the table
  // contents valid; the user just needs to know the click had no
  // effect (or only a partial effect) and they should retry.
  const [setDefaultErr, setSetDefaultErr] = useState<string | null>(null)

  const [editorState, dispatchEditor] = useReducer(editorReducer, {
    mode: 'closed',
  })
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

  const openCreate = useCallback(
    () => dispatchEditor({ type: 'open-create' }),
    []
  )
  const openEdit = useCallback(
    (p: ProfileView) => dispatchEditor({ type: 'open-edit', target: p }),
    []
  )
  const closeEditor = useCallback(() => dispatchEditor({ type: 'close' }), [])

  // PSR-G05 (#82): both PATCH calls in the dance can fail. Pre-fix the
  // whole function returned a rejected promise that the caller
  // swallowed (`setAsDefault(p).catch(() => undefined)`), so a
  // 403/network-blip vanished into the void. We catch in-line and
  // surface the failure via the `setDefaultErr` banner so the user
  // can retry.
  const setAsDefault = async (target: ProfileView): Promise<void> => {
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

  // Inline body region (loading / error / empty / table) — replaces
  // the four pre-refactor full-Page returns. The header + Create
  // button + setDefaultErr banner + editor modal all render
  // unconditionally above/below this so a setAsDefault failure on a
  // newly-empty view still surfaces.
  const renderBody = (): React.ReactNode => {
    if (profiles === null) {
      return (
        <p className="m-0 mt-4 text-body-secondary">{t('profiles.loading')}</p>
      )
    }
    if (err) {
      return <p className="m-0 mt-4 text-danger">{t('profiles.error')}</p>
    }
    if (profiles.length === 0) {
      return (
        <p className="m-0 mt-4 text-body-secondary">{t('profiles.empty')}</p>
      )
    }
    // TableScroll wrapper keeps the table on its own horizontal scroll
    // axis at narrow viewports — without it the page itself horizontally
    // scrolls (caught by 25-ui-health.spec.ts: /profiles mobile leaked
    // ~43px past the viewport pre-fix because the table's natural width
    // exceeded 390px).
    return (
      <TableScroll>
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
                      <Badge $kind="default">
                        {t('profiles.flag.default')}
                      </Badge>
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
      </TableScroll>
    )
  }

  // Editor mount-once: derive the modal's open/mode/profile props
  // from the reducer-shaped editorState. This collapses the prior
  // double-mount (one inside the empty branch, one inside the list
  // branch) and removes the implicit "if mode==='edit' then
  // editorProfile is set" invariant.
  const editorMode: 'create' | 'edit' =
    editorState.mode === 'edit' ? 'edit' : 'create'
  const editorTarget: ProfileView | undefined =
    editorState.mode === 'edit' ? editorState.target : undefined

  return (
    <section className="w-100 mx-auto p-4" style={{ maxWidth: '1024px' }}>
      <div className="d-flex align-items-baseline justify-content-between mb-3">
        <div>
          <Title>{t('profiles.title')}</Title>
          <p
            className="m-0 mt-1 text-body-secondary"
            style={{ fontSize: '13px' }}
          >
            {t('profiles.description')}
          </p>
        </div>
        <Button onClick={openCreate}>{t('profiles.actions.create')}</Button>
      </div>
      {setDefaultErr && (
        <p
          className="m-0 mt-4 text-danger"
          role="alert"
          data-testid="profiles-set-default-error"
        >
          {setDefaultErr}
        </p>
      )}
      {renderBody()}
      <ProfileEditorModal
        mode={editorMode}
        open={editorState.mode !== 'closed'}
        onClose={closeEditor}
        onSaved={() => {
          refresh().catch(() => undefined)
        }}
        isAdmin={isAdmin}
        profile={editorTarget}
        existingNames={(profiles ?? []).map((p) => p.name)}
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
    </section>
  )
}
