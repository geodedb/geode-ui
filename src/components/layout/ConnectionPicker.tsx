import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { client } from '../../api/client'
import { auth } from '../../api/auth'

// ConnectionPicker is the upstream-Geode connection-profile selector
// rendered in the app shell.
//
// Server-side, the JWT's `profile` claim is the source of truth for
// upstream routing (set at /api/v1/auth/login). The picker persists the
// user's choice in localStorage so the UI remembers it across reloads,
// but switching profiles in the dropdown does NOT re-route active
// queries — the user must re-login (and pass the new profile to /login)
// for the server to honor the change. A future task may add a
// /api/v1/auth/switch-profile endpoint that re-issues a JWT with the
// new claim so this picker can take effect without a password prompt.
// `min-width: 0` + `max-width` lets the picker shrink under header
// pressure (long brand text, narrow viewport) instead of forcing the
// whole row past the viewport edge. `text-overflow: ellipsis` on the
// rendered option ellipsises a 64-char profile name to fit.
const Select = styled.select`
  padding: 4px 8px;
  background: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.text};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  font-size: 0.9em;
  min-width: 0;
  max-width: 240px;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  flex-shrink: 1;
`

interface ProfileEntry {
  name?: unknown
}

export const ConnectionPicker: React.FC = () => {
  const { t } = useTranslation()
  const [names, setNames] = useState<string[]>([auth.getProfile()])
  const [active, setActive] = useState<string>(auth.getProfile())
  const [err, setErr] = useState<string | null>(null)

  // The picker fetches the profile list once on mount. The result
  // overrides the localStorage-seeded singleton list so the dropdown
  // shows every server-registered profile, not just the cached one.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const r = await client.profiles({})
        if (cancelled) return
        const fromServer = (r?.profiles ?? [])
          .map((p: Record<string, unknown>) => {
            const entry = p as ProfileEntry
            return typeof entry.name === 'string' ? entry.name : ''
          })
          .filter((n: string) => n.length > 0)
        const first = fromServer[0]
        if (first === undefined) return
        setNames(fromServer)
        // Read the persisted profile fresh — the auth provider may have
        // updated it after this effect was scheduled.
        const persisted = auth.getProfile()
        if (!fromServer.includes(persisted)) {
          setActive(first)
          auth.setProfile(first)
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setErr(
            e instanceof Error ? e.message : t('errors.failedLoadProfiles')
          )
        }
      }
    }
    load().catch(() => {
      /* errors are surfaced via setErr inside load(); .catch only
         swallows the unhandled-rejection warning that the lint rule
         flags. */
    })
    return () => {
      cancelled = true
    }
  }, [])

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setActive(e.target.value)
    auth.setProfile(e.target.value)
  }

  return (
    <Select
      value={active}
      onChange={onChange}
      title={err ? `${t('common.error')}: ${err}` : t('connection.profile')}
      aria-label={t('connection.profile')}
    >
      {names.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </Select>
  )
}
