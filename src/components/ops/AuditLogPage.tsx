import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import {
  DataTable,
  DedupedDatalist,
  EmptyCell,
  Field,
  Input,
  Stack,
  TableScroll,
  useUniqueValues,
} from '@geodedb/ui-core'
import { client } from '../../api/client'
import { useApiResource } from '../../hooks/useApiResource'
import { formatAuditTimestamp } from '../../lib/intl/formatAuditTimestamp'
import { usePollingClock } from '../../lib/usePollingClock'
import { AuditFieldList } from './AuditFieldList'
import { AuditRowJsonToggle } from './AuditRowJsonToggle'

// PERF-2026-05-17-05 (issue 243): 300 ms after the operator stops
// typing in any filter input the page refetches the filtered audit
// list. Previously every keystroke triggered a new fetch + a full
// 10k-entry ring round-trip; a 5-char burst meant 5 redundant fetches
// totalling ~12 MiB of payload. The debounce holds the network at one
// fetch per pause; the matching server-side limit cap (parseAuditLimit
// in handlers_audit.go, default 200) keeps each fetch small.
const AUDIT_FILTER_DEBOUNCE_MS = 300

// AuditLogPage drives the /admin/audit tab. The Geode B11 endpoint backs
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
  event?: string
  fields?: Record<string, unknown>
}

type Filters = {
  since: string
  event: string
  user: string
}

// Heading: display font (Sora) + 20px xl size + semibold weight stay
// in styled-components — Bootstrap's fs-* scale doesn't have an exact
// match and `theme.font.family.display` is the brand display face.
const Heading = styled.h2`
  font-family: ${({ theme }) => theme.font.family.display};
  font-size: ${({ theme }) => theme.font.sizes.xl};
  font-weight: ${({ theme }) => theme.font.weights.semibold};
  color: ${({ theme }) => theme.text.primary};
  margin: 0;
`

// FilterBar uses an auto-fit grid with a 180px minmax that no Bootstrap
// utility can express (Bootstrap's grid is fixed 12-column). Keep.
const FilterBar = styled.form`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: ${({ theme }) => theme.spacing.md};
  align-items: end;
`

// pickFieldFromFields reads a value from the nested `fields` map by
// walking a list of candidate key names. The real wire shape from
// emitAudit() in internal/server/audit.go puts "user" inside fields,
// not at the top level of the entry — the prior pickField read e.user
// which was always undefined in production.
const pickFieldFromFields = (e: AuditEntry, names: string[]): string => {
  if (!e.fields) return ''
  const found = names
    .map((n) => e.fields?.[n])
    .find((v) => typeof v === 'string' && v.length > 0) as string | undefined
  return found ?? ''
}

// AUDIT_USER_KEYS lists every field name an emitAudit() call in the
// Geode server uses for the actor identifier, in the order we want to
// surface them. The server isn't consistent (history: SEC #300 added
// `sub` for JWT-driven events, the profile CRUD handlers use `actor`
// for cross-tenant operations, and most other handlers use `user`).
// Until the upstream emit calls are normalised, the UI resolves
// across all three so the User column never blanks out for events
// whose payload IS attributed but under a different key.
//
// Source map (internal/server):
//   - handlers_query.go, handlers_tx.go, handlers_grants.go,
//     handlers_roles.go, handlers_policies.go, handlers_migrations.go,
//     handlers_backups.go            → "user"
//   - handlers_auth.go (auth_role_resolved, refresh, etc.)     → "sub"
//   - handlers_profiles_crud.go (profile_created/_updated/_deleted) → "actor"
const AUDIT_USER_KEYS = ['user', 'username', 'sub', 'actor'] as const

// SYSTEM_ACTOR is the sentinel rendered when an audit entry truly has
// no human actor attached. The middleware emitter for
// `access_token_query` runs BEFORE any auth context is set, so the
// payload carries `path` + `user_agent` but no user — "system" makes
// the row attributable at a glance instead of looking like a UI bug.
const SYSTEM_ACTOR = 'system'

function resolveAuditUser(e: AuditEntry): string {
  return (
    pickFieldFromFields(e, AUDIT_USER_KEYS as unknown as string[]) ||
    SYSTEM_ACTOR
  )
}

export const AuditLogPage: React.FC = () => {
  const { t } = useTranslation()
  const [filters, setFilters] = useState<Filters>({
    since: '',
    event: '',
    user: '',
  })
  // PERF #243: debouncedFilters lags filters by AUDIT_FILTER_DEBOUNCE_MS.
  // useApiResource's deps include debouncedFilters (not filters) so a
  // typing burst collapses to a single refetch when the operator pauses.
  const [debouncedFilters, setDebouncedFilters] = useState<Filters>(filters)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (debounceTimerRef.current != null) {
      clearTimeout(debounceTimerRef.current)
    }
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      setDebouncedFilters(filters)
    }, AUDIT_FILTER_DEBOUNCE_MS)
    return () => {
      if (debounceTimerRef.current != null) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [filters])

  // useApiResource fetches once on mount and on every DEBOUNCED filter
  // change, owning the AbortController + stale-resolve guard. We layer
  // a setInterval on top to drive 5-second polling via refetch(), and
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
        since: debouncedFilters.since,
        event: debouncedFilters.event,
        user: debouncedFilters.user,
      })) as { entries?: unknown[] }
      return (r.entries ?? []) as AuditEntry[]
    },
    [debouncedFilters.since, debouncedFilters.event, debouncedFilters.user]
  )
  const entries = data ?? []

  const eventOptions = useUniqueValues(entries, (e) => e.event)
  // Drive the user-filter datalist off the same resolver the User
  // column uses so a search for "system" actually narrows the table
  // to system-emitted events, and "carol" matches the sub on a JWT
  // event. Otherwise the filter would propose only the "user"-keyed
  // names and the operator couldn't find their own system rows.
  const userOptions = useUniqueValues(entries, (e) => resolveAuditUser(e))
  const sinceOptions = useUniqueValues(entries, (e) => e.timestamp)

  // PERF-2026-05-21-02 (Item 5, 2026-05-21 audit): replaced the
  // per-page window.setInterval + visibilitychange listener pair
  // with the shared usePollingClock hub. The hub already gates on
  // document.visibilityState and fires a catch-up tick on resume,
  // so the visibility plumbing here collapses to a single line.
  usePollingClock(5000, refetch)

  const rows = useMemo(
    () =>
      entries.map((e, i) => ({
        key: i,
        ts: formatAuditTimestamp(e.timestamp),
        user: resolveAuditUser(e),
        event: e.event ?? '',
        fields: e.fields,
        raw: e,
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
            list="al-since-list"
            placeholder={t('audit.sincePlaceholder')}
            value={filters.since}
            onChange={onSinceChange}
          />
          <DedupedDatalist id="al-since-list" values={sinceOptions} />
        </Field>
        <Field label={t('audit.fieldEvent')} htmlFor="al-event">
          <Input
            id="al-event"
            list="al-event-list"
            placeholder={t('audit.eventPlaceholder')}
            value={filters.event}
            onChange={onEventChange}
          />
          <DedupedDatalist id="al-event-list" values={eventOptions} />
        </Field>
        <Field label={t('audit.fieldUser')} htmlFor="al-user">
          <Input
            id="al-user"
            list="al-user-list"
            placeholder={t('audit.userPlaceholder')}
            value={filters.user}
            onChange={onUserChange}
          />
          <DedupedDatalist id="al-user-list" values={userOptions} />
        </Field>
      </FilterBar>
      {err && (
        <div
          className="bg-body-tertiary text-danger rounded px-3 py-2 small"
          style={{ borderLeft: '3px solid var(--bs-danger)' }}
          role="alert"
        >
          {err}
        </div>
      )}
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
                    <AuditFieldList fields={r.fields} />
                    <AuditRowJsonToggle entry={r.raw} />
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
