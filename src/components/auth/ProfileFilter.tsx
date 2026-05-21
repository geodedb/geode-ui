import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import type { PublicProfile } from '../../api/auth'

// ProfileFilter — filterable scrollable list of public profiles for
// the LoginPage. Replaces the prior list-of-N-wa-buttons rendering so
// a large profile catalogue (dozens of entries) stays usable inside
// the 380px form card.
//
// Purely presentational: takes the profile list + current selection
// from the parent (LoginPage) and emits selection changes via
// onChange. Has no network calls and does not own the public-profiles
// fetch — that stays with usePublicProfilesWithStoredPasswords on the
// LoginPage so AddConnectionModal can share the same hook.
//
// A11y: rendered as a single ARIA listbox with each row aria-
// selected. Keyboard navigation defers to native scrolling +
// focus-on-click; arrow-key navigation can be added later if real
// usage shows the click-to-select pattern is insufficient.

export interface ProfileFilterProps {
  profiles: ReadonlyArray<PublicProfile>
  value: string
  onChange: (name: string) => void
}

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 14rem;
  overflow-y: auto;
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.md};
  background: ${({ theme }) => theme.bg.surface};
`

const Row = styled.li<{ $selected: boolean }>`
  padding: ${({ theme }) => theme.spacing.sm};
  cursor: pointer;
  background: ${({ $selected, theme }) => {
    return $selected ? theme.bg.subtle : 'transparent'
  }};
  border-bottom: 1px solid ${({ theme }) => theme.border.subtle};
  &:last-child {
    border-bottom: none;
  }
  &:hover {
    background: ${({ theme }) => theme.bg.subtle};
  }
`

const RowName = styled.div`
  font-weight: ${({ theme }) => theme.font.weights.semibold};
  color: ${({ theme }) => theme.text.primary};
`

const RowDescription = styled.div`
  font-size: ${({ theme }) => theme.font.sizes.sm};
  color: ${({ theme }) => theme.text.secondary};
  overflow-wrap: anywhere;
`

const Empty = styled.p`
  margin: 0;
  padding: ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.text.secondary};
  text-align: center;
`

export const ProfileFilter: React.FC<ProfileFilterProps> = ({
  profiles,
  value,
  onChange,
}) => {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return profiles
    return profiles.filter((p) => {
      if (p.name.toLowerCase().includes(needle)) return true
      if (p.description && p.description.toLowerCase().includes(needle)) {
        return true
      }
      return false
    })
  }, [profiles, filter])

  return (
    <div className="d-flex flex-column gap-2">
      <input
        type="text"
        className="form-control form-control-sm"
        placeholder={t('auth.profileFilterPlaceholder')}
        aria-label={t('auth.profileFilterAria')}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        data-testid="profile-filter-input"
      />
      {visible.length === 0 ? (
        <Empty role="status" data-testid="profile-filter-empty">
          {t('auth.profileFilterEmpty')}
        </Empty>
      ) : (
        <List role="listbox" aria-label={t('auth.profileList')}>
          {visible.map((p) => (
            <Row
              key={p.name}
              role="option"
              aria-selected={p.name === value}
              $selected={p.name === value}
              onClick={() => onChange(p.name)}
              data-testid={`profile-filter-row-${p.name}`}
            >
              <RowName>{p.name}</RowName>
              {p.description ? (
                <RowDescription>{p.description}</RowDescription>
              ) : null}
            </Row>
          ))}
        </List>
      )}
    </div>
  )
}
