import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import { useAuth } from '../auth/AuthProvider'
import { Button, Field, Input } from '../components/ui'

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

const ErrText = styled.p`
  color: ${({ theme }) => theme.text.danger};
  font-size: ${({ theme }) => theme.font.sizes.sm};
`

export const LoginPage: React.FC = () => {
  const { signIn } = useAuth()
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [profile, setProfile] = useState('default')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      await signIn(username, password, profile)
      nav('/', { replace: true })
    } catch (e2: unknown) {
      setErr(e2 instanceof Error ? e2.message : 'login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Form onSubmit={submit}>
      <Title>Sign in</Title>
      <Field label="Profile" htmlFor="login-profile">
        <Input
          id="login-profile"
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
        />
      </Field>
      <Field label="Username" htmlFor="login-username" required>
        <Input
          id="login-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
        />
      </Field>
      <Field label="Password" htmlFor="login-password" required>
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
        Sign in
      </Button>
      {err && <ErrText role="alert">{err}</ErrText>}
    </Form>
  )
}
