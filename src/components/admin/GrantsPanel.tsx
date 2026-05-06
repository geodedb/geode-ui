import React, { useState } from 'react'
import styled from 'styled-components'
import { client } from '../../api/client'

// GrantsPanel drives the /admin/grants tab. The Geode B6 endpoints back
// every action:
//
//   apply  POST /api/v1/grants         -> client.grants
//   revoke POST /api/v1/grants/revoke  -> client.revoke
//
// There is no SHOW-GRANTS endpoint in the API spec, so this panel is a
// pure form -- it emits new grants but does not list existing ones.
const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 480px;
`

const Heading = styled.h2`
  font-size: 1.1rem;
  color: ${({ theme }) => theme.colors.text};
`

const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 0.85rem;

  input,
  select {
    padding: 6px 8px;
    background: ${({ theme }) => theme.colors.background};
    color: ${({ theme }) => theme.colors.text};
    border: 1px solid ${({ theme }) => theme.colors.border};
    border-radius: 4px;
    font-family: inherit;
  }
`

const Row = styled.div`
  display: flex;
  gap: 12px;
`

const Btn = styled.button<{ $tone?: 'apply' | 'revoke' }>`
  padding: 8px 16px;
  background: ${({ $tone, theme }) => {
    return $tone === 'revoke' ? '#7f1d1d' : theme.colors.primary
  }};
  color: #fff;
  border: 0;
  border-radius: 4px;
  cursor: pointer;

  &:disabled {
    opacity: 0.6;
    cursor: wait;
  }
`

const Banner = styled.p<{ $tone: 'ok' | 'err' }>`
  color: ${({ $tone }) => ($tone === 'err' ? '#ef4444' : '#10b981')};
  margin-top: 8px;
`

export const GrantsPanel: React.FC = () => {
  const [permission, setPermission] = useState('')
  const [resource, setResource] = useState('')
  const [grantee, setGrantee] = useState('')
  const [granteeKind, setGranteeKind] = useState<'user' | 'role'>('user')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  const send = async (mode: 'apply' | 'revoke'): Promise<void> => {
    setBusy(true)
    setErr(null)
    setOkMsg(null)
    try {
      const req = {
        permission,
        resource,
        grantee,
        grantee_kind: granteeKind,
      }
      if (mode === 'apply') {
        await client.grants(req)
        setOkMsg('Grant applied.')
      } else {
        await client.revoke(req)
        setOkMsg('Grant revoked.')
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Wrap>
      <Heading>Grants</Heading>
      <Field>
        Permission
        <input
          placeholder="e.g. read, write, admin"
          value={permission}
          onChange={(e) => setPermission(e.target.value)}
          required
        />
      </Field>
      <Field>
        Resource
        <input
          placeholder="e.g. graph:default"
          value={resource}
          onChange={(e) => setResource(e.target.value)}
        />
      </Field>
      <Field>
        Grantee
        <input
          placeholder="username or role name"
          value={grantee}
          onChange={(e) => setGrantee(e.target.value)}
          required
        />
      </Field>
      <Field>
        Grantee kind
        <select
          value={granteeKind}
          onChange={(e) => setGranteeKind(e.target.value as 'user' | 'role')}
        >
          <option value="user">user</option>
          <option value="role">role</option>
        </select>
      </Field>
      <Row>
        <Btn $tone="apply" disabled={busy} onClick={() => send('apply')}>
          {busy ? '...' : 'Apply'}
        </Btn>
        <Btn $tone="revoke" disabled={busy} onClick={() => send('revoke')}>
          {busy ? '...' : 'Revoke'}
        </Btn>
      </Row>
      {err && <Banner $tone="err">{err}</Banner>}
      {okMsg && <Banner $tone="ok">{okMsg}</Banner>}
    </Wrap>
  )
}
