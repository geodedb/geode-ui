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
import styled from 'styled-components'

import { Button, Field, Input, Select, Modal } from '../ui'
import {
  ProfileView,
  Scope,
  createProfile,
  updateProfile,
} from '../../api/profiles'
import { useProfileForm } from './useProfileForm'
import { TLSFieldset } from './TLSFieldset'

const Section = styled.section`
  margin-top: ${({ theme }) => theme.spacing.md};
  border-top: 1px solid ${({ theme }) => theme.border.default};
  padding-top: ${({ theme }) => theme.spacing.md};
`
const SectionTitle = styled.h3`
  font-size: ${({ theme }) => theme.font.sizes.sm};
  margin: 0 0 ${({ theme }) => theme.spacing.sm};
`
const Row = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${({ theme }) => theme.spacing.sm};
`
const ButtonRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  justify-content: flex-end;
  margin-top: ${({ theme }) => theme.spacing.lg};
`
const ErrText = styled.p`
  color: ${({ theme }) => theme.text.danger};
  font-size: ${({ theme }) => theme.font.sizes.sm};
`
export interface Props {
  mode: 'create' | 'edit'
  open: boolean
  onClose: () => void
  onSaved: () => void
  isAdmin: boolean
  profile?: ProfileView
}

export const ProfileEditorModal: React.FC<Props> = ({
  mode,
  open,
  onClose,
  onSaved,
  isAdmin,
  profile,
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

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
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
      setErr(
        e2 instanceof Error ? e2.message : t('profiles.editor.error.failed')
      )
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
          />
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

        <Section>
          <SectionTitle>{t('profiles.editor.section.pool')}</SectionTitle>
          <Row>
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
          </Row>
        </Section>

        <ButtonRow>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('profiles.editor.actions.cancel')}
          </Button>
          <Button type="submit" loading={busy}>
            {t('profiles.editor.actions.save')}
          </Button>
        </ButtonRow>
        {err ? <ErrText role="alert">{err}</ErrText> : null}
      </form>
    </Modal>
  )
}
