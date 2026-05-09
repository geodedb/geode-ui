import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { Button, Field, Input, Select, Textarea, Modal } from '../ui'
import {
  CreateProfileInput,
  UpdateProfileInput,
  ProfileView,
  Scope,
  createProfile,
  updateProfile,
} from '../../api/profiles'

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

interface FormState {
  scope: Scope
  name: string
  dsn: string
  description: string
  savedUsername: string
  isDefault: boolean
  caPem: string
  clientCertPem: string
  clientKeyPem: string
  maxOpenConns: string
  maxIdleConns: string
  connMaxLifetimeMs: string
  connMaxIdleMs: string
}

const empty: FormState = {
  scope: 'personal',
  name: '',
  dsn: '',
  description: '',
  savedUsername: '',
  isDefault: false,
  caPem: '',
  clientCertPem: '',
  clientKeyPem: '',
  maxOpenConns: '',
  maxIdleConns: '',
  connMaxLifetimeMs: '',
  connMaxIdleMs: '',
}

function numOrUndef(v: string): number | undefined {
  return v === '' ? undefined : Number(v)
}

function buildCreateInput(s: FormState): CreateProfileInput {
  let tls: CreateProfileInput['tls']
  if (s.caPem || s.clientCertPem || s.clientKeyPem) {
    tls = {
      caPem: s.caPem || undefined,
      clientCertPem: s.clientCertPem || undefined,
      clientKeyPem: s.clientKeyPem || undefined,
    }
  }
  let poolOverrides: CreateProfileInput['poolOverrides']
  if (
    s.maxOpenConns ||
    s.maxIdleConns ||
    s.connMaxLifetimeMs ||
    s.connMaxIdleMs
  ) {
    poolOverrides = {
      maxOpenConns: numOrUndef(s.maxOpenConns),
      maxIdleConns: numOrUndef(s.maxIdleConns),
      connMaxLifetimeMs: numOrUndef(s.connMaxLifetimeMs),
      connMaxIdleMs: numOrUndef(s.connMaxIdleMs),
    }
  }
  return {
    scope: s.scope,
    name: s.name,
    dsn: s.dsn,
    description: s.description || undefined,
    savedUsername: s.savedUsername || undefined,
    isDefault: s.isDefault,
    tls,
    poolOverrides,
  }
}

function buildUpdateInput(
  s: FormState,
  original: ProfileView
): UpdateProfileInput {
  const out: UpdateProfileInput = {}
  if (s.name !== original.name) {
    out.name = s.name
  }
  if (s.dsn !== (original.dsn ?? '')) {
    out.dsn = s.dsn
  }
  if (s.description !== (original.description ?? '')) {
    out.description = s.description
  }
  if (s.savedUsername !== (original.savedUsername ?? '')) {
    out.savedUsername = s.savedUsername
  }
  // is_default is ALWAYS included: the server's UpdateProfileReq has a
  // non-pointer bool that zero-initialises to false on absence, and
  // mergeProfile writes Default verbatim. Omitting the field would
  // silently un-default the profile on every PATCH that touches another
  // field. Always echoing the user's checkbox state preserves the flag.
  out.isDefault = s.isDefault

  const tlsChanged =
    s.caPem !== (original.tls?.caPem ?? '') ||
    s.clientCertPem !== (original.tls?.clientCertPem ?? '') ||
    s.clientKeyPem !== (original.tls?.clientKeyPem ?? '')
  if (tlsChanged) {
    out.tls = {
      caPem: s.caPem || undefined,
      clientCertPem: s.clientCertPem || undefined,
      clientKeyPem: s.clientKeyPem || undefined,
    }
  }

  const poChanged =
    s.maxOpenConns !== String(original.poolOverrides?.maxOpenConns ?? '') ||
    s.maxIdleConns !== String(original.poolOverrides?.maxIdleConns ?? '') ||
    s.connMaxLifetimeMs !==
      String(original.poolOverrides?.connMaxLifetimeMs ?? '') ||
    s.connMaxIdleMs !== String(original.poolOverrides?.connMaxIdleMs ?? '')
  if (poChanged) {
    out.poolOverrides = {
      maxOpenConns: numOrUndef(s.maxOpenConns),
      maxIdleConns: numOrUndef(s.maxIdleConns),
      connMaxLifetimeMs: numOrUndef(s.connMaxLifetimeMs),
      connMaxIdleMs: numOrUndef(s.connMaxIdleMs),
    }
  }
  return out
}

function fromProfile(p: ProfileView): FormState {
  return {
    scope: p.scope,
    name: p.name,
    dsn: p.dsn ?? '',
    description: p.description ?? '',
    savedUsername: p.savedUsername ?? '',
    isDefault: p.isDefault,
    caPem: p.tls?.caPem ?? '',
    clientCertPem: p.tls?.clientCertPem ?? '',
    clientKeyPem: p.tls?.clientKeyPem ?? '',
    maxOpenConns: p.poolOverrides?.maxOpenConns?.toString() ?? '',
    maxIdleConns: p.poolOverrides?.maxIdleConns?.toString() ?? '',
    connMaxLifetimeMs: p.poolOverrides?.connMaxLifetimeMs?.toString() ?? '',
    connMaxIdleMs: p.poolOverrides?.connMaxIdleMs?.toString() ?? '',
  }
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
  const [s, setS] = useState<FormState>(empty)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Populate the form from the supplied profile on edit-mode mount or
  // when the profile prop changes (parent may swap which row is being
  // edited without unmounting the modal).
  useEffect(() => {
    if (mode === 'edit' && profile) {
      setS(fromProfile(profile))
    } else if (mode === 'create') {
      setS(empty)
    }
  }, [mode, profile])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      if (mode === 'create') {
        await createProfile(buildCreateInput(s))
      } else if (profile) {
        await updateProfile(profile.id, buildUpdateInput(s, profile))
      }
      onSaved()
      onClose()
      if (mode === 'create') setS(empty)
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
            onChange={(e) => setS({ ...s, scope: e.target.value as Scope })}
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
            onChange={(e) => setS({ ...s, name: e.target.value })}
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
            onChange={(e) => setS({ ...s, dsn: e.target.value })}
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
            onChange={(e) => setS({ ...s, description: e.target.value })}
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
            onChange={(e) => setS({ ...s, savedUsername: e.target.value })}
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
            onChange={(e) => setS({ ...s, isDefault: e.target.checked })}
          />
        </Field>

        <Section>
          <SectionTitle>{t('profiles.editor.section.tls')}</SectionTitle>
          <Field
            label={t('profiles.editor.field.caPem')}
            htmlFor="profile-caPem"
          >
            <Textarea
              id="profile-caPem"
              value={s.caPem}
              onChange={(e) => setS({ ...s, caPem: e.target.value })}
            />
          </Field>
          <Field
            label={t('profiles.editor.field.clientCertPem')}
            htmlFor="profile-clientCertPem"
          >
            <Textarea
              id="profile-clientCertPem"
              value={s.clientCertPem}
              onChange={(e) => setS({ ...s, clientCertPem: e.target.value })}
            />
          </Field>
          <Field
            label={t('profiles.editor.field.clientKeyPem')}
            htmlFor="profile-clientKeyPem"
          >
            <Textarea
              id="profile-clientKeyPem"
              value={s.clientKeyPem}
              onChange={(e) => setS({ ...s, clientKeyPem: e.target.value })}
            />
          </Field>
        </Section>

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
                onChange={(e) => setS({ ...s, maxOpenConns: e.target.value })}
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
                onChange={(e) => setS({ ...s, maxIdleConns: e.target.value })}
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
                onChange={(e) => {
                  setS((p) => ({ ...p, connMaxLifetimeMs: e.target.value }))
                }}
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
                onChange={(e) => setS({ ...s, connMaxIdleMs: e.target.value })}
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
