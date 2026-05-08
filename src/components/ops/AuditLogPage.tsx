import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { client } from '../../api/client'
import { useApiResource } from '../../hooks/useApiResource'
import { DataTable, EmptyCell, Field, Input, Stack, TableScroll } from '../ui'

// AuditLogPage drives the /ops/audit tab. The Geode B11 endpoint backs
// the table:
//
//   query GET /api/v1/audit -> client.audit({ since, event, user })
//
// The page polls every 5 seconds while mounted. Each AuditList entry
// is `unknown` -- we project well-known fields (timestamp/user/event)
// into the table and dump the remainder as a JSON snippet so users can
// inspect arbitrary metadata that the server attached.
type AuditEntry = {
  timestamp?: string
  ts?: string
  time?: string
  user?: string
  username?: string
  event?: string
  action?: string
  fields?: Record<string, unknown>
} & Record<string, unknown>

type Filters = {
  since: string
  event: string
  user: string
}

const Heading = styled.h2`
  font-family: ${({ theme }) => theme.font.family.display};
  font-size: ${({ theme }) => theme.font.sizes.xl};
  font-weight: ${({ theme }) => theme.font.weights.semibold};
  color: ${({ theme }) => theme.text.primary};
  margin: 0;
`

const FilterBar = styled.form`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: ${({ theme }) => theme.spacing.md};
  align-items: end;
`

const ErrorBanner = styled.div`
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.bg.subtle};
  border-left: 3px solid ${({ theme }) => theme.colors.danger};
  color: ${({ theme }) => theme.text.danger};
  border-radius: ${({ theme }) => theme.radii.md};
  font-size: ${({ theme }) => theme.font.sizes.sm};
`

const Snippet = styled.code`
  display: block;
  font-family: ${({ theme }) => theme.font.family.mono};
  font-size: ${({ theme }) => theme.font.sizes.xs};
  color: ${({ theme }) => theme.text.muted};
  white-space: pre-wrap;
  word-break: break-all;
  max-width: 480px;
`

// pickField walks a small set of plausible names because the server
// payload uses different capitalizations across event types.
const pickField = (e: AuditEntry, names: string[]): string => {
  const found = names.map((n) => e[n]).find((v) => typeof v === 'string') as
    | string
    | undefined
  return found ?? ''
}

// fieldsSnippet renders a compact JSON view of every key that is not a
// dedicated column so operators can see arbitrary metadata.
const fieldsSnippet = (e: AuditEntry): string => {
  const skip = new Set([
    'timestamp',
    'ts',
    'time',
    'user',
    'username',
    'event',
    'action',
  ])
  const rest = Object.keys(e)
    .filter((k) => !skip.has(k))
    .reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = e[k]
      return acc
    }, {})
  if (Object.keys(rest).length === 0) return ''
  try {
    return JSON.stringify(rest)
  } catch {
    return String(rest)
  }
}

export const AuditLogPage: React.FC = () => {
  const { t } = useTranslation()
  const [filters, setFilters] = useState<Filters>({
    since: '',
    event: '',
    user: '',
  })

  // useApiResource fetches once on mount and on every filter change,
  // owning the AbortController + stale-resolve guard. We layer a
  // setInterval on top to drive 5-second polling via refetch(), and
  // gate it on document.visibilityState so background tabs don't keep
  // hammering the server (perf finding F15, bundled here as a 1-line
  // tweak per the gap plan).
  const {
    data,
    error: err,
    refetch,
  } = useApiResource<AuditEntry[]>(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async (_signal) => {
      const r = (await client.audit({
        since: filters.since,
        event: filters.event,
        user: filters.user,
      })) as { entries?: unknown[] }
      return (r.entries ?? []) as AuditEntry[]
    },
    [filters.since, filters.event, filters.user]
  )
  const entries = data ?? []

  useEffect(() => {
    const tick = (): void => {
      // Skip refetches while the tab is hidden; the next visibility
      // change will trigger a poll on the visibility listener path.
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      ) {
        return
      }
      refetch()
    }
    const onVisibility = (): void => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible'
      ) {
        refetch()
      }
    }
    const id = window.setInterval(tick, 5000)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility)
    }
    return () => {
      window.clearInterval(id)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }
  }, [refetch])

  const rows = useMemo(
    () =>
      entries.map((e, i) => ({
        key: i,
        ts: pickField(e, ['timestamp', 'ts', 'time']),
        user: pickField(e, ['user', 'username']),
        event: pickField(e, ['event', 'action']),
        snippet: fieldsSnippet(e),
      })),
    [entries]
  )

  const onSinceChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setFilters((f) => ({ ...f, since: e.target.value }))
  }
  const onEventChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setFilters((f) => ({ ...f, event: e.target.value }))
  }
  const onUserChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setFilters((f) => ({ ...f, user: e.target.value }))
  }

  return (
    <Stack $gap="md">
      <Heading>{t('audit.title', { count: entries.length })}</Heading>
      <FilterBar>
        <Field label={t('audit.fieldSince')} htmlFor="al-since">
          <Input
            id="al-since"
            placeholder={t('audit.sincePlaceholder')}
            value={filters.since}
            onChange={onSinceChange}
          />
        </Field>
        <Field label={t('audit.fieldEvent')} htmlFor="al-event">
          <Input
            id="al-event"
            placeholder={t('audit.eventPlaceholder')}
            value={filters.event}
            onChange={onEventChange}
          />
        </Field>
        <Field label={t('audit.fieldUser')} htmlFor="al-user">
          <Input
            id="al-user"
            placeholder={t('audit.userPlaceholder')}
            value={filters.user}
            onChange={onUserChange}
          />
        </Field>
      </FilterBar>
      {err && <ErrorBanner role="alert">{err}</ErrorBanner>}
      <TableScroll>
        <DataTable>
          <thead>
            <tr>
              <th>{t('audit.columnTimestamp')}</th>
              <th>{t('audit.columnUser')}</th>
              <th>{t('audit.columnEvent')}</th>
              <th>{t('audit.columnFields')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <EmptyCell colSpan={4}>{t('audit.empty')}</EmptyCell>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.key}>
                  <td>{r.ts}</td>
                  <td>{r.user}</td>
                  <td>{r.event}</td>
                  <td>
                    <Snippet>{r.snippet}</Snippet>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>
      </TableScroll>
    </Stack>
  )
}
