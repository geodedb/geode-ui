import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import { useAuth } from '../auth/AuthProvider'
import { Field, Logo } from '../components/ui'
import { Input as WaInput } from '../services/webawesome/components'
import { fetchPublicProfiles, PublicProfile } from '../api/auth'
import { getStoredPassword, isElectron } from '../api/electron-bridge'

const Form = styled.form`
  max-width: 380px;
  margin: 60px auto;
  padding: ${({ theme }) => theme.spacing.lg};
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.xl};
  box-shadow: ${({ theme }) => theme.shadows.md};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`

const Title = styled.h1`
  font-family: ${({ theme }) => theme.font.family.display};
  font-size: ${({ theme }) => theme.font.sizes.xxl};
  font-weight: ${({ theme }) => theme.font.weights.semibold};
  color: ${({ theme }) => theme.text.primary};
  margin: 0 0 ${({ theme }) => theme.spacing.sm};
`

const LogoSlot = styled.div`
  display: flex;
  justify-content: center;
  margin-bottom: ${({ theme }) => theme.spacing.md};
`

const ErrText = styled.p`
  color: ${({ theme }) => theme.text.danger};
  font-size: ${({ theme }) => theme.font.sizes.sm};
`

const ProfileList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
`

const ProfileDescription = styled.div`
  font-size: ${({ theme }) => theme.font.sizes.sm};
  color: ${({ theme }) => theme.text.secondary};
`

export const LoginPage: React.FC = () => {
  const { signIn } = useAuth()
  const { t } = useTranslation()
  const nav = useNavigate()

  const [profiles, setProfiles] = useState<PublicProfile[] | null>(null)
  const [loadErr, setLoadErr] = useState<boolean>(false)
  const [profile, setProfile] = useState<string>('default')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [savePw, setSavePw] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchPublicProfiles()
      .then((list) => {
        if (cancelled) return
        setProfiles(list)
        if (list.length > 0 && list[0]) setProfile(list[0].name)
      })
      .catch(() => {
        if (cancelled) return
        setLoadErr(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!username || !profile) return undefined
    let cancelled = false
    getStoredPassword(profile, username).then((pw) => {
      if (cancelled) return
      if (pw) setPassword(pw)
    })
    return () => {
      cancelled = true
    }
  }, [profile, username])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      await signIn(username, password, profile, savePw)
      nav('/', { replace: true })
    } catch (e2: unknown) {
      setErr(e2 instanceof Error ? e2.message : t('auth.loginFailed'))
    } finally {
      setBusy(false)
    }
  }

  const showList = profiles && profiles.length > 0 && !loadErr

  return (
    <Form onSubmit={submit}>
      <LogoSlot>
        <Logo height={36} variant="on-light" />
      </LogoSlot>
      <Title>{t('auth.signIn')}</Title>

      {showList ? (
        <ProfileList aria-label={t('auth.profileList')}>
          {profiles!.map((p) => (
            <li key={p.name}>
              <wa-button
                type="button"
                appearance={p.name === profile ? 'filled' : 'outlined'}
                variant={p.name === profile ? 'brand' : 'default'}
                size="medium"
                role="button"
                data-testid={`login-profile-${p.name}`}
                aria-pressed={p.name === profile ? 'true' : 'false'}
                aria-label={p.name}
                onClick={() => setProfile(p.name)}
                style={{ width: '100%' }}
              >
                <strong>{p.name}</strong>
                {p.description ? (
                  <ProfileDescription>{p.description}</ProfileDescription>
                ) : null}
              </wa-button>
            </li>
          ))}
        </ProfileList>
      ) : (
        <Field label={t('auth.profile')} htmlFor="login-profile">
          <WaInput
            id="login-profile"
            data-testid="login-profile-input"
            value={profile}
            onInput={(e) => setProfile((e.target as HTMLInputElement).value)}
          />
        </Field>
      )}

      <Field label={t('auth.username')} htmlFor="login-username" required>
        <WaInput
          id="login-username"
          type="text"
          data-testid="login-username"
          value={username}
          onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
          autoComplete="username"
          required
        />
      </Field>
      <Field label={t('auth.password')} htmlFor="login-password" required>
        <WaInput
          id="login-password"
          type="password"
          data-testid="login-password"
          value={password}
          onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
          autoComplete="current-password"
          required
        />
      </Field>
      {isElectron() ? (
        <Field label={t('auth.savePassword')} htmlFor="login-savePw">
          <input
            id="login-savePw"
            type="checkbox"
            checked={savePw}
            onChange={(e) => setSavePw(e.target.checked)}
          />
        </Field>
      ) : null}
      <wa-button
        type="submit"
        appearance="filled"
        variant="brand"
        size="medium"
        role="button"
        data-testid="login-submit-btn"
        disabled={busy ? true : undefined}
        loading={busy ? true : undefined}
        onClick={submit}
        style={{ width: '100%' }}
      >
        {t('auth.signInButton')}
      </wa-button>
      {err && <ErrText role="alert">{err}</ErrText>}
    </Form>
  )
}
