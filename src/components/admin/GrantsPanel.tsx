import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { client } from '../../api/client'
import {
  isWireFeatureMissingError,
  wireFeatureMissingDescription,
} from '../../api/capabilities'
import { useCapabilities } from '../../hooks/useCapabilities'
import {
  RBAC_GRANTEE_KINDS,
  RBAC_RESOURCES,
  permissionSuggestions,
  type RbacGranteeKind,
} from '../../lib/rbacVocab'
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

const UnsupportedNote = styled.p`
  font-size: ${({ theme }) => theme.font.sizes.sm};
  color: ${({ theme }) => theme.text.secondary};
  margin: 0;
`

export const GrantsPanel: React.FC = () => {
  const { t } = useTranslation()
  const { adminWritable, loaded: capsLoaded } = useCapabilities()
  // Render Apply/Revoke enabled until the /capabilities probe confirms
  // the connected Geode build rejects GRANT/REVOKE over the wire.
  const gateWrite = capsLoaded && !adminWritable.grants
  const [permission, setPermission] = useState('')
  const [resource, setResource] = useState('')
  const [grantee, setGrantee] = useState('')
  const [granteeKind, setGranteeKind] = useState<RbacGranteeKind>('user')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const permSuggestions = React.useMemo(() => permissionSuggestions(), [])

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
        setOkMsg(t('grants.applied'))
      } else {
        await client.revoke(req)
        setOkMsg(t('grants.revoked'))
      }
    } catch (e: unknown) {
      if (isWireFeatureMissingError(e)) {
        setErr(
          wireFeatureMissingDescription(e) ?? t('grants.wireFeatureMissing')
        )
      } else {
        setErr(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack $gap="md">
      <Heading>{t('grants.title')}</Heading>
      <FormWrap>
        <Field
          label={t('grants.fieldPermission')}
          htmlFor="gp-permission"
          required
          hint={t('grants.permissionHint')}
        >
          <Input
            id="gp-permission"
            data-testid="grant-permission-input"
            list="grant-permission-suggestions"
            placeholder={t('grants.permissionPlaceholder')}
            value={permission}
            onChange={(e) => setPermission(e.target.value)}
            required
          />
          <datalist id="grant-permission-suggestions">
            {permSuggestions.map((s) => (
              <option key={s} value={s} label={s} />
            ))}
          </datalist>
        </Field>
        <Field
          label={t('grants.fieldResource')}
          htmlFor="gp-resource"
          hint={t('grants.resourceHint')}
        >
          <Input
            id="gp-resource"
            data-testid="grant-resource-input"
            list="grant-resource-suggestions"
            placeholder={t('grants.resourcePlaceholder')}
            value={resource}
            onChange={(e) => setResource(e.target.value)}
          />
          <datalist id="grant-resource-suggestions">
            {RBAC_RESOURCES.map((r) => (
              <option key={r} value={r} label={r} />
            ))}
          </datalist>
        </Field>
        <Field label={t('grants.fieldGrantee')} htmlFor="gp-grantee" required>
          <Input
            id="gp-grantee"
            placeholder={t('grants.granteePlaceholder')}
            value={grantee}
            onChange={(e) => setGrantee(e.target.value)}
            required
          />
        </Field>
        <Field label={t('grants.fieldGranteeKind')} htmlFor="gp-grantee-kind">
          <Select
            id="gp-grantee-kind"
            data-testid="grant-grantee-kind-select"
            value={granteeKind}
            onChange={(e) => setGranteeKind(e.target.value as RbacGranteeKind)}
          >
            {RBAC_GRANTEE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k === 'user'
                  ? t('grants.granteeKindUser')
                  : t('grants.granteeKindRole')}
              </option>
            ))}
          </Select>
        </Field>
        {gateWrite && (
          <UnsupportedNote data-testid="admin-grants-unsupported">
            {t('grants.unsupportedNote')}
          </UnsupportedNote>
        )}
        <Inline $gap="sm">
          <Button
            data-testid="admin-grants-apply-btn"
            onClick={() => send('apply')}
            loading={busy}
            disabled={gateWrite}
            title={gateWrite ? t('grants.unsupportedTooltip') : undefined}
          >
            {t('common.apply')}
          </Button>
          <Button
            data-testid="admin-grants-revoke-btn"
            variant="danger"
            onClick={() => send('revoke')}
            loading={busy}
            disabled={gateWrite}
            title={gateWrite ? t('grants.unsupportedTooltip') : undefined}
          >
            {t('common.revoke')}
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
