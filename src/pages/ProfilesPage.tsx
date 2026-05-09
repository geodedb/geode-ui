import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { DefaultTheme } from 'styled-components'

import { listProfiles, ProfileView } from '../api/profiles'

const Page = styled.section`
  max-width: 1024px;
  margin: 0 auto;
  padding: ${({ theme }) => theme.spacing.lg};
`
const Header = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: ${({ theme }) => theme.spacing.md};
`
const Title = styled.h1`
  font-family: ${({ theme }) => theme.font.family.display};
  font-size: ${({ theme }) => theme.font.sizes.xxl};
  margin: 0;
`
const Description = styled.p`
  color: ${({ theme }) => theme.text.secondary};
  font-size: ${({ theme }) => theme.font.sizes.sm};
  margin: 4px 0 0 0;
`
const Status = styled.p`
  color: ${({ theme }) => theme.text.secondary};
  margin-top: ${({ theme }) => theme.spacing.lg};
`
const ErrorText = styled.p`
  color: ${({ theme }) => theme.text.danger};
  margin-top: ${({ theme }) => theme.spacing.lg};
`
const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  th,
  td {
    text-align: left;
    padding: ${({ theme }) => theme.spacing.sm};
    border-bottom: 1px solid ${({ theme }) => theme.border.default};
  }
  th {
    font-weight: 600;
    color: ${({ theme }) => theme.text.secondary};
  }
`

type BadgeKind = 'system' | 'personal' | 'default'
type BadgeProps = { theme: DefaultTheme; $kind: BadgeKind }

function badgeBg(props: BadgeProps): string {
  return props.$kind === 'default'
    ? props.theme.colors.primary
    : props.theme.bg.subtle
}

function badgeFg(props: BadgeProps): string {
  return props.$kind === 'default'
    ? props.theme.text.inverse
    : props.theme.text.primary
}

const Badge = styled.span<{ $kind: BadgeKind }>`
  display: inline-block;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: ${({ theme }) => theme.font.sizes.xs};
  background: ${badgeBg};
  color: ${badgeFg};
`

function scopeLabel(scope: string, t: (k: string) => string): string {
  if (scope === 'personal') return t('profiles.scope.personal')
  return t('profiles.scope.system')
}

export const ProfilesPage: React.FC = () => {
  const { t } = useTranslation()
  const [profiles, setProfiles] = useState<ProfileView[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setErr(null)
    try {
      const list = await listProfiles()
      setProfiles(list)
    } catch (e: unknown) {
      setProfiles([])
      setErr(e instanceof Error ? e.message : t('profiles.error'))
    }
  }, [t])

  useEffect(() => {
    refresh().catch(() => undefined)
  }, [refresh])

  if (profiles === null) {
    return (
      <Page>
        <Header>
          <Title>{t('profiles.title')}</Title>
        </Header>
        <Status>{t('profiles.loading')}</Status>
      </Page>
    )
  }
  if (err) {
    return (
      <Page>
        <Header>
          <Title>{t('profiles.title')}</Title>
        </Header>
        <ErrorText>{t('profiles.error')}</ErrorText>
      </Page>
    )
  }
  if (profiles.length === 0) {
    return (
      <Page>
        <Header>
          <div>
            <Title>{t('profiles.title')}</Title>
            <Description>{t('profiles.description')}</Description>
          </div>
        </Header>
        <Status>{t('profiles.empty')}</Status>
      </Page>
    )
  }

  return (
    <Page>
      <Header>
        <div>
          <Title>{t('profiles.title')}</Title>
          <Description>{t('profiles.description')}</Description>
        </div>
      </Header>
      <Table>
        <thead>
          <tr>
            <th>{t('profiles.column.name')}</th>
            <th>{t('profiles.column.scope')}</th>
            <th>{t('profiles.column.description')}</th>
            <th>{t('profiles.column.owner')}</th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((p) => (
            <tr key={p.id}>
              <td>
                <strong>{p.name}</strong>
                {p.isDefault ? (
                  <>
                    {' '}
                    <Badge $kind="default">{t('profiles.flag.default')}</Badge>
                  </>
                ) : null}
              </td>
              <td>
                <Badge $kind={p.scope}>{scopeLabel(p.scope, t)}</Badge>
              </td>
              <td>{p.description ?? ''}</td>
              <td>{p.ownerUserId ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Page>
  )
}
