import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { Field } from '@geodedb/ui-core'
import { onboardProfile, type OnboardResponse } from '../../api/auth'

// OnboardProfileForm — pre-authenticated profile creation. Lives on
// the LoginPage either as the first-run landing view (zero profiles
// configured) or behind an explicit Add-profile toggle.
//
// The form POSTs to /api/v1/profiles/onboard which validates the
// supplied admin credentials against the supplied DSN, persists a
// system-scope profile, and mints a JWT. onSuccess fires with the
// OnboardResponse so the parent (LoginPage) can roll straight into
// an authenticated session (the server already wrote the auth
// cookie on success; the parent typically just calls nav('/')).
//
// Plain HTML form controls (Bootstrap `.form-control` + `.btn`) are
// deliberately chosen over Web Awesome's `<wa-input>` / `<wa-button>`
// here so Jest + Testing Library can drive the form via standard
// `fireEvent.change` / `fireEvent.click` without the shadow-DOM
// bridging the existing LoginPage's wa-input pattern requires. The
// surface treatment (Form, Title styled-components) still tracks
// theme tokens, so the visual is consistent with the LoginPage card.

const Form = styled.form`
  max-width: 380px;
  margin: 60px auto;
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.xl};
  box-shadow: ${({ theme }) => theme.shadows.md};
`

const Title = styled.h1`
  font-family: ${({ theme }) => theme.font.family.display};
  font-size: ${({ theme }) => theme.font.sizes.xxl};
  font-weight: ${({ theme }) => theme.font.weights.semibold};
  color: ${({ theme }) => theme.text.primary};
  margin: 0 0 ${({ theme }) => theme.spacing.sm};
`

export interface OnboardProfileFormProps {
  onSuccess: (resp: OnboardResponse) => void
  onCancel: () => void
}

export const OnboardProfileForm: React.FC<OnboardProfileFormProps> = ({
  onSuccess,
  onCancel,
}) => {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [dsn, setDsn] = useState('')
  const [description, setDescription] = useState('')
  const [adminUsername, setAdminUsername] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const required = (s: string): boolean => s.trim().length > 0
  const canSubmit =
    required(name) &&
    required(dsn) &&
    required(adminUsername) &&
    required(adminPassword)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setErr(null)
    try {
      const resp = await onboardProfile({
        name: name.trim(),
        dsn: dsn.trim(),
        description: description.trim() || undefined,
        admin_username: adminUsername.trim(),
        admin_password: adminPassword,
      })
      onSuccess(resp)
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t('auth.onboardError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Form onSubmit={submit} className="p-4 d-flex flex-column gap-3">
      <Title>{t('auth.onboardTitle')}</Title>
      <p className="m-0 text-body-secondary small">
        {t('auth.onboardSubtitle')}
      </p>

      <Field label={t('auth.onboardName')} htmlFor="onboard-name" required>
        <input
          id="onboard-name"
          data-testid="onboard-name"
          className="form-control"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={64}
          required
        />
      </Field>

      <Field label={t('auth.onboardDsn')} htmlFor="onboard-dsn" required>
        <input
          id="onboard-dsn"
          data-testid="onboard-dsn"
          className="form-control"
          value={dsn}
          onChange={(e) => setDsn(e.target.value)}
          placeholder="quic://host:3141"
          maxLength={1024}
          required
        />
      </Field>

      <Field label={t('auth.onboardDescription')} htmlFor="onboard-description">
        <input
          id="onboard-description"
          data-testid="onboard-description"
          className="form-control"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={256}
        />
      </Field>

      <Field
        label={t('auth.onboardAdminUsername')}
        htmlFor="onboard-admin-username"
        required
      >
        <input
          id="onboard-admin-username"
          data-testid="onboard-admin-username"
          className="form-control"
          value={adminUsername}
          onChange={(e) => setAdminUsername(e.target.value)}
          autoComplete="username"
          required
        />
      </Field>

      <Field
        label={t('auth.onboardAdminPassword')}
        htmlFor="onboard-admin-password"
        required
      >
        <input
          id="onboard-admin-password"
          data-testid="onboard-admin-password"
          className="form-control"
          type="password"
          value={adminPassword}
          onChange={(e) => setAdminPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </Field>

      <div className="d-flex gap-2 justify-content-end mt-2">
        <button
          type="button"
          className="btn btn-outline-secondary"
          data-testid="onboard-cancel"
          onClick={onCancel}
        >
          {t('auth.onboardCancel')}
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          data-testid="onboard-submit"
          disabled={!canSubmit || busy}
        >
          {busy ? t('auth.onboardSubmitting') : t('auth.onboardSubmit')}
        </button>
      </div>

      {err && (
        <p role="alert" className="text-danger small m-0">
          {err}
        </p>
      )}
    </Form>
  )
}
