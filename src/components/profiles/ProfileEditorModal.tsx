// ProfileEditorModal — create/edit form for connection profiles.
//
// GAP-Q05 (#95): the prior 470-LOC monolith carried a 13-field
// FormState, four mirroring helpers, and three near-identical PEM
// browse handlers. The form-state plumbing now lives in
// `useProfileForm.ts`; the TLS textareas + Browse buttons live in
// `TLSFieldset.tsx`. This file is a thin presentational wrapper
// over a `Modal` and a flat list of `<Field>`s — the modal body
// itself is now under 150 LOC of JSX.

import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Field, Input, Select, Modal } from '@geodedb/ui-core'
import {
  ProfileView,
  Scope,
  createProfile,
  updateProfile,
} from '../../api/profiles'
import { isConflictError } from '../../api/capabilities'
import { useProfileForm } from './useProfileForm'
import { TLSFieldset } from './TLSFieldset'

// Section, SectionTitle, Row, and ErrText migrated to Bootstrap utility
// classes per BOOTSTRAP_MIGRATION.md:
//
//   - Section -> `mt-3 pt-3 border-top` (theme.spacing.md=16px → mt-3/pt-3,
//     `border-top` reads --bs-border-color from theme.border.default).
//   - SectionTitle -> `h3 small mb-2 mt-0` (theme.font.sizes.sm=13px →
//     `.small` ≈ 0.875em, theme.spacing.sm=8px → mb-2).
//   - Row -> two-column CSS grid; Bootstrap has no `grid-cols-2` utility
//     so the column template stays inline. gap-2 maps to theme.spacing.sm.
//   - ErrText -> `text-danger small m-0`.
// ButtonRow was already inline (`d-flex gap-2 justify-content-end mt-4`).
export interface Props {
  mode: 'create' | 'edit'
  open: boolean
  onClose: () => void
  onSaved: () => void
  isAdmin: boolean
  profile?: ProfileView
  // Names of every other profile currently on the server. Used for the
  // client-side uniqueness check that fires before the POST/PATCH is
  // submitted. The comparison is case-insensitive and the edit-mode
  // current name is automatically excluded so a no-rename PATCH does
  // not collide with itself. Optional so legacy callers (tests) can
  // omit it and fall back to the server's 409 response.
  existingNames?: ReadonlyArray<string>
}

// nameIsDuplicate is the shared client-side check that backs both the
// live "Save" gate and the same predicate that ProfilesPage runs when
// the editor mounts. Case-insensitive, NFKC-normalised, trims leading
// and trailing whitespace before comparing.
export function nameIsDuplicate(
  candidate: string,
  existing: ReadonlyArray<string>,
  currentName?: string
): boolean {
  const norm = (s: string): string => s.normalize('NFKC').trim().toLowerCase()
  const c = norm(candidate)
  if (c === '') return false
  if (currentName && norm(currentName) === c) return false
  return existing.some((n) => norm(n) === c)
}

export const ProfileEditorModal: React.FC<Props> = ({
  mode,
  open,
  onClose,
  onSaved,
  isAdmin,
  profile,
  existingNames,
}) => {
  const { t } = useTranslation()
  // useProfileForm hydrates from `profile` on edit-mode and re-syncs
  // whenever the prop reference changes (the parent may swap which
  // row is being edited without unmounting). Pass `undefined` for
  // create-mode so the form starts empty and `reset()` returns to
  // empty after a successful submit.
  const form = useProfileForm(mode === 'edit' ? profile : undefined)
  const { state: s, setField, buildCreateInput, buildUpdateInput, reset } = form
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Client-side duplicate check. The Save button is disabled and the
  // inline hint surfaces while this is true; the same predicate guards
  // the submit() short-circuit below so a programmatic submit cannot
  // bypass the gate. Falls back to "no collision" when the caller did
  // not pass existingNames (legacy callers + tests).
  const duplicateName = nameIsDuplicate(
    s.name,
    existingNames ?? [],
    mode === 'edit' ? profile?.name : undefined
  )
  const nameErrorMessage = duplicateName
    ? t('profiles.editor.error.nameTaken')
    : null

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (duplicateName) {
      setErr(t('profiles.editor.error.nameTaken'))
      return
    }
    setBusy(true)
    setErr(null)
    try {
      if (mode === 'create') {
        await createProfile(buildCreateInput())
      } else if (profile) {
        await updateProfile(profile.id, buildUpdateInput(profile))
      }
      onSaved()
      onClose()
      if (mode === 'create') reset()
    } catch (e2: unknown) {
      // Map the server's 409 -> friendly "name already exists" message
      // instead of bleeding the raw transport blob to the user. Server
      // returns ErrCodeConflict for both POST + PATCH name collisions
      // (see internal/server/handlers_profiles.go storeErrorToHTTP).
      if (isConflictError(e2)) {
        setErr(t('profiles.editor.error.nameTaken'))
      } else {
        setErr(
          e2 instanceof Error ? e2.message : t('profiles.editor.error.failed')
        )
      }
    } finally {
      setBusy(false)
    }
  }

  const title =
    mode === 'edit'
      ? t('profiles.editor.edit.title')
      : t('profiles.editor.create.title')

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form onSubmit={submit}>
        <Field label={t('profiles.editor.field.scope')} htmlFor="profile-scope">
          <Select
            id="profile-scope"
            value={s.scope}
            disabled={mode === 'edit'}
            onChange={(e) => setField('scope', e.target.value as Scope)}
          >
            <option value="personal">{t('profiles.scope.personal')}</option>
            {isAdmin ? (
              <option value="system">{t('profiles.scope.system')}</option>
            ) : null}
          </Select>
        </Field>
        <Field
          label={t('profiles.editor.field.name')}
          htmlFor="profile-name"
          required
        >
          <Input
            id="profile-name"
            value={s.name}
            onChange={(e) => setField('name', e.target.value)}
            required
            maxLength={64}
            aria-invalid={duplicateName || undefined}
            aria-describedby={
              nameErrorMessage ? 'profile-name-error' : undefined
            }
          />
          {nameErrorMessage ? (
            <p
              id="profile-name-error"
              role="alert"
              data-testid="profile-name-error"
              className="text-danger small m-0"
            >
              {nameErrorMessage}
            </p>
          ) : null}
        </Field>
        <Field
          label={t('profiles.editor.field.dsn')}
          htmlFor="profile-dsn"
          required
        >
          <Input
            id="profile-dsn"
            value={s.dsn}
            onChange={(e) => setField('dsn', e.target.value)}
            required
            maxLength={1024}
          />
        </Field>
        <Field
          label={t('profiles.editor.field.description')}
          htmlFor="profile-description"
        >
          <Input
            id="profile-description"
            value={s.description}
            onChange={(e) => setField('description', e.target.value)}
            maxLength={256}
          />
        </Field>
        <Field
          label={t('profiles.editor.field.savedUsername')}
          htmlFor="profile-savedUsername"
        >
          <Input
            id="profile-savedUsername"
            value={s.savedUsername}
            onChange={(e) => setField('savedUsername', e.target.value)}
            maxLength={128}
          />
        </Field>
        <Field
          label={t('profiles.editor.field.isDefault')}
          htmlFor="profile-isDefault"
        >
          <input
            id="profile-isDefault"
            type="checkbox"
            checked={s.isDefault}
            onChange={(e) => setField('isDefault', e.target.checked)}
          />
        </Field>

        <TLSFieldset state={s} setField={setField} />

        <section className="mt-3 pt-3 border-top">
          <h3 className="small mb-2 mt-0">
            {t('profiles.editor.section.pool')}
          </h3>
          <div
            className="d-grid gap-2"
            style={{ gridTemplateColumns: '1fr 1fr' }}
          >
            <Field
              label={t('profiles.editor.field.maxOpenConns')}
              htmlFor="profile-maxOpenConns"
            >
              <Input
                id="profile-maxOpenConns"
                type="number"
                value={s.maxOpenConns}
                onChange={(e) => setField('maxOpenConns', e.target.value)}
                min={0}
              />
            </Field>
            <Field
              label={t('profiles.editor.field.maxIdleConns')}
              htmlFor="profile-maxIdleConns"
            >
              <Input
                id="profile-maxIdleConns"
                type="number"
                value={s.maxIdleConns}
                onChange={(e) => setField('maxIdleConns', e.target.value)}
                min={0}
              />
            </Field>
            <Field
              label={t('profiles.editor.field.connMaxLifetimeMs')}
              htmlFor="profile-connMaxLifetimeMs"
            >
              <Input
                id="profile-connMaxLifetimeMs"
                type="number"
                value={s.connMaxLifetimeMs}
                onChange={(e) => setField('connMaxLifetimeMs', e.target.value)}
                min={0}
              />
            </Field>
            <Field
              label={t('profiles.editor.field.connMaxIdleMs')}
              htmlFor="profile-connMaxIdleMs"
            >
              <Input
                id="profile-connMaxIdleMs"
                type="number"
                value={s.connMaxIdleMs}
                onChange={(e) => setField('connMaxIdleMs', e.target.value)}
                min={0}
              />
            </Field>
          </div>
        </section>

        <div className="d-flex gap-2 justify-content-end mt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('profiles.editor.actions.cancel')}
          </Button>
          <Button type="submit" loading={busy} disabled={duplicateName}>
            {t('profiles.editor.actions.save')}
          </Button>
        </div>
        {err ? (
          <p role="alert" className="text-danger small m-0">
            {err}
          </p>
        ) : null}
      </form>
    </Modal>
  )
}
