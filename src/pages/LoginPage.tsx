import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import { useAuth } from '../auth/AuthProvider'
import { Button, Field, Input, Logo } from '../components/ui'
import { fetchPublicProfiles, PublicProfile } from '../api/auth'

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

const profileBorderColor = ({
  theme,
  $selected,
}: {
  theme: import('../theme/types').Theme
  $selected?: boolean
}) => ($selected ? theme.colors.primary : theme.border.default)

const profileBg = ({
  theme,
  $selected,
}: {
  theme: import('../theme/types').Theme
  $selected?: boolean
}) => ($selected ? theme.bg.subtle : theme.bg.surface)

const ProfileButton = styled.button<{ $selected?: boolean }>`
  display: block;
  width: 100%;
  text-align: left;
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  border: 1px solid ${profileBorderColor};
  background: ${profileBg};
  border-radius: ${({ theme }) => theme.radii.md};
  cursor: pointer;
  &:hover {
    background: ${({ theme }) => theme.bg.subtle};
  }
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      await signIn(username, password, profile)
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
              <ProfileButton
                type="button"
                $selected={p.name === profile}
                onClick={() => setProfile(p.name)}
                aria-pressed={p.name === profile}
              >
                <strong>{p.name}</strong>
                {p.description ? (
                  <ProfileDescription>{p.description}</ProfileDescription>
                ) : null}
              </ProfileButton>
            </li>
          ))}
        </ProfileList>
      ) : (
        <Field label={t('auth.profile')} htmlFor="login-profile">
          <Input
            id="login-profile"
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
          />
        </Field>
      )}

      <Field label={t('auth.username')} htmlFor="login-username" required>
        <Input
          id="login-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
        />
      </Field>
      <Field label={t('auth.password')} htmlFor="login-password" required>
        <Input
          id="login-password"
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
      {err && <ErrText role="alert">{err}</ErrText>}
    </Form>
  )
}
