import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import { useAuth } from '../auth/AuthProvider'

const Form = styled.form`
  max-width: 320px;
  margin: 60px auto;
  padding: 24px;
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const Title = styled.h1`
  color: ${({ theme }) => theme.colors.text};
`

const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: ${({ theme }) => theme.colors.textSecondary};
  & input {
    padding: 6px 8px;
    background: ${({ theme }) => theme.colors.background};
    color: ${({ theme }) => theme.colors.text};
    border: 1px solid ${({ theme }) => theme.colors.border};
    border-radius: 4px;
  }
`

const Button = styled.button`
  padding: 8px 12px;
  background: ${({ theme }) => theme.colors.primary};
  color: #fff;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
  &:disabled {
    opacity: 0.6;
    cursor: wait;
  }
`

const ErrText = styled.p`
  color: #ef4444;
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
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Form onSubmit={submit}>
      <Title>Sign in</Title>
      <Field>
        Profile
        <input value={profile} onChange={(e) => setProfile(e.target.value)} />
      </Field>
      <Field>
        Username
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
      </Field>
      <Field>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </Field>
      <Button disabled={busy} type="submit">
        {busy ? '...' : 'Login'}
      </Button>
      {err && <ErrText>{err}</ErrText>}
    </Form>
  )
}
