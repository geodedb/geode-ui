import React, { useState } from 'react'
import styled from 'styled-components'

import { client } from '../../api/client'
import type { Theme } from '../../theme'
import { Button, Field, Inline, Input, Select, Stack } from '../ui'

interface ToneArgs {
  theme: Theme
  $tone: 'ok' | 'err'
}

function bannerBorder({ $tone, theme }: ToneArgs): string {
  return $tone === 'err' ? theme.colors.danger : theme.colors.success
}

function bannerColor({ $tone, theme }: ToneArgs): string {
  return $tone === 'err' ? theme.text.danger : theme.text.success
}

// GrantsPanel drives the /admin/grants tab. The Geode B6 endpoints back
// every action:
//
//   apply  POST /api/v1/grants         -> client.grants
//   revoke POST /api/v1/grants/revoke  -> client.revoke
//
// There is no SHOW-GRANTS endpoint in the API spec, so this panel is a
// pure form -- it emits new grants but does not list existing ones.
const Heading = styled.h2`
  font-family: ${({ theme }) => theme.font.family.display};
  font-size: ${({ theme }) => theme.font.sizes.xl};
  font-weight: ${({ theme }) => theme.font.weights.semibold};
  color: ${({ theme }) => theme.text.primary};
  margin: 0;
`

const FormWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
  max-width: 480px;
`

const Banner = styled.div<{ $tone: 'ok' | 'err' }>`
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.bg.subtle};
  border-left: 3px solid ${bannerBorder};
  color: ${bannerColor};
  border-radius: ${({ theme }) => theme.radii.md};
  font-size: ${({ theme }) => theme.font.sizes.sm};
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
    <Stack $gap="md">
      <Heading>Grants</Heading>
      <FormWrap>
        <Field
          label="Permission"
          htmlFor="gp-permission"
          required
          hint="The action being granted (e.g. read, write, admin)."
        >
          <Input
            id="gp-permission"
            value={permission}
            onChange={(e) => setPermission(e.target.value)}
            required
          />
        </Field>
        <Field
          label="Resource"
          htmlFor="gp-resource"
          hint="The resource the grant applies to (e.g. graph:default)."
        >
          <Input
            id="gp-resource"
            value={resource}
            onChange={(e) => setResource(e.target.value)}
          />
        </Field>
        <Field label="Grantee" htmlFor="gp-grantee" required>
          <Input
            id="gp-grantee"
            placeholder="username or role name"
            value={grantee}
            onChange={(e) => setGrantee(e.target.value)}
            required
          />
        </Field>
        <Field label="Grantee kind" htmlFor="gp-grantee-kind">
          <Select
            id="gp-grantee-kind"
            value={granteeKind}
            onChange={(e) => setGranteeKind(e.target.value as 'user' | 'role')}
          >
            <option value="user">user</option>
            <option value="role">role</option>
          </Select>
        </Field>
        <Inline $gap="sm">
          <Button onClick={() => send('apply')} loading={busy}>
            Apply
          </Button>
          <Button
            variant="danger"
            onClick={() => send('revoke')}
            loading={busy}
          >
            Revoke
          </Button>
        </Inline>
      </FormWrap>
      {err && (
        <Banner $tone="err" role="alert">
          {err}
        </Banner>
      )}
      {okMsg && (
        <Banner $tone="ok" role="status">
          {okMsg}
        </Banner>
      )}
    </Stack>
  )
}
