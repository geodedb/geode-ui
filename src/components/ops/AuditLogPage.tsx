import React, { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import { client } from '../../api/client'
import { useApiResource } from '../../hooks/useApiResource'

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

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const FilterBar = styled.div`
  display: flex;
  gap: 12px;
  align-items: flex-end;
  flex-wrap: wrap;
`

const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 0.85rem;

  input {
    padding: 6px 8px;
    background: ${({ theme }) => theme.colors.background};
    color: ${({ theme }) => theme.colors.text};
    border: 1px solid ${({ theme }) => theme.colors.border};
    border-radius: 4px;
    font-family: inherit;
    min-width: 180px;
  }
`

const Heading = styled.h2`
  font-size: 1.1rem;
  color: ${({ theme }) => theme.colors.text};
`

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  color: ${({ theme }) => theme.colors.text};

  th,
  td {
    padding: 8px;
    text-align: left;
    border-bottom: 1px solid ${({ theme }) => theme.colors.border};
    vertical-align: top;
  }

  th {
    background: ${({ theme }) => theme.colors.surface};
    font-weight: 600;
  }
`

const Err = styled.p`
  color: #ef4444;
  margin-top: 8px;
`

const Empty = styled.td`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-style: italic;
  text-align: center;
`

const Snippet = styled.code`
  display: block;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.8rem;
  color: ${({ theme }) => theme.colors.textSecondary};
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
    <Wrap>
      <Heading>Audit log ({entries.length})</Heading>
      <FilterBar>
        <Field>
          Since
          <input
            placeholder="2025-01-01T00:00:00Z"
            value={filters.since}
            onChange={onSinceChange}
          />
        </Field>
        <Field>
          Event
          <input
            placeholder="event name"
            value={filters.event}
            onChange={onEventChange}
          />
        </Field>
        <Field>
          User
          <input
            placeholder="username"
            value={filters.user}
            onChange={onUserChange}
          />
        </Field>
      </FilterBar>
      {err && <Err>{err}</Err>}
      <Table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>User</th>
            <th>Event</th>
            <th>Fields</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <Empty colSpan={4}>No audit entries.</Empty>
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
      </Table>
    </Wrap>
  )
}
