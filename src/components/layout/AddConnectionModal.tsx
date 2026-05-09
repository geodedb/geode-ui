import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../auth/AuthProvider'
import { fetchPublicProfiles, PublicProfile } from '../../api/auth'
import { listProfiles, ProfileView } from '../../api/profiles'
import { Button, Field, Input, Modal } from '../ui'

export interface Props {
  open: boolean
  onClose: () => void
}

export const AddConnectionModal: React.FC<Props> = ({ open, onClose }) => {
  const { t } = useTranslation()
  const { connectMore } = useAuth()
  const [profiles, setProfiles] = useState<PublicProfile[] | null>(null)
  const [profile, setProfile] = useState('default')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [authedProfiles, setAuthedProfiles] = useState<ProfileView[]>([])

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    fetchPublicProfiles()
      .then((list) => {
        if (cancelled) return
        setProfiles(list)
        const first = list[0]
        if (first) setProfile(first.name)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    listProfiles()
      .then((list) => {
        if (!cancelled) setAuthedProfiles(list)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    const found = authedProfiles.find((p) => p.name === profile)
    if (found?.savedUsername) {
      setUsername(found.savedUsername)
    }
  }, [profile, authedProfiles])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      await connectMore(username, password, profile)
      onClose()
      setUsername('')
      setPassword('')
    } catch (e2: unknown) {
      setErr(e2 instanceof Error ? e2.message : t('auth.loginFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('connection.addAnother')}>
      <form onSubmit={submit}>
        {profiles && profiles.length > 0 ? (
          <Field label={t('auth.profile')} htmlFor="add-profile">
            <select
              id="add-profile"
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
            >
              {profiles.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.description ? `${p.name} — ${p.description}` : p.name}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label={t('auth.profile')} htmlFor="add-profile">
            <Input
              id="add-profile"
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
            />
          </Field>
        )}
        <Field label={t('auth.username')} htmlFor="add-username" required>
          <Input
            id="add-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </Field>
        <Field label={t('auth.password')} htmlFor="add-password" required>
          <Input
            id="add-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        <Button type="submit" loading={busy} fullWidth>
          {t('auth.signInButton')}
        </Button>
        {err && <p role="alert">{err}</p>}
      </form>
    </Modal>
  )
}
