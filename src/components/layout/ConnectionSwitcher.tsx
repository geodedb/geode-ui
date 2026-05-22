import React, { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { Icon } from '@geodedb/ui-core'
import { useConnections, useActiveConnection } from '../../api/connections'
import { useAuth } from '../../auth/AuthProvider'
import { Dropdown, DropdownItem } from '../../services/webawesome/components'
import { usePublicProfilesWithStoredPasswords } from '../../lib/usePublicProfilesWithStoredPasswords'

const SwitcherWrap = styled.div`
  position: relative;
`

// Inline style for the row layout inside each <wa-dropdown-item>.
// The dropdown-item's slot is its label, so we wrap the profile
// name + the inline "×" disconnect affordance in a flex span so
// the × sits to the right of the name.
const rowInnerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  width: '100%',
}

const disconnectStyle: React.CSSProperties = {
  cursor: 'pointer',
  padding: '2px 6px',
  fontSize: '0.85em',
  userSelect: 'none',
  lineHeight: 1,
}

export interface Props {
  // onAddRequested is fired in two situations:
  //   1) no profile name — the "+ Add another connection" item, which
  //      opens AddConnectionModal in its default discovery flow.
  //   2) profile name argument — the operator clicked a CONFIGURED
  //      profile they aren't connected to yet, so the modal opens
  //      pre-selected to that profile and the operator only has to
  //      enter credentials. Wired into AddConnectionModal's
  //      `initialProfile` prop by the parent Shell.
  onAddRequested: (initialProfile?: string) => void
}

// Sentinel value used on the "Add another connection" dropdown item.
// The wa-select handler routes any item with this value to the
// onAddRequested callback (no initialProfile) rather than
// switchActive(connectionId).
const ADD_ITEM_VALUE = '__add__'

// Prefix used on the `value` of "configured-but-not-active" profile
// rows so the wa-select handler can tell them apart from
// connection-id rows. Connection ids are server-issued opaque
// strings; the prefix gives us a stable, parseable disambiguator
// without changing the connection-id wire format.
const PROFILE_ITEM_PREFIX = '__profile__:'

// React-synthetic-event `stopPropagation` only stops React's
// synthetic delegation chain — the native click event continues to
// bubble to <wa-dropdown>'s shadow-DOM @click handler, which then
// fires wa-select for whichever wa-dropdown-item is the ancestor.
// The wa-select dispatch in turn closes the dropdown and races with
// our disconnect against the same connection id, so the menu shuts
// before the e2e suite can observe the post-disconnect row count.
//
// Returning a callback ref handler that attaches a CAPTURE-phase
// native click listener fixes both problems: it runs BEFORE
// wa-dropdown's bubble-phase handler and can call
// stopImmediatePropagation to prevent wa-select entirely.
function bindCaptureClick(
  handler: (e: Event) => void
): (node: HTMLElement | null) => void {
  return (node) => {
    if (!node) return
    node.addEventListener(
      'click',
      (e) => {
        e.stopImmediatePropagation()
        handler(e)
      },
      true
    )
  }
}

export const ConnectionSwitcher: React.FC<Props> = ({ onAddRequested }) => {
  const { t } = useTranslation()
  const { connections, activeId, loading } = useConnections()
  const active = useActiveConnection()
  const { disconnect, switchActive } = useAuth()

  // Public-profiles fetch — the same shared hook LoginPage and
  // AddConnectionModal use. Surfaces every CONFIGURED profile name so
  // the dropdown lists profiles the operator hasn't connected to yet
  // (2026-05-22 bug report: only the active connection + "Add
  // another connection" were visible). The hook caches the fetch and
  // owns its own cancellation seam.
  const { profilesState } = usePublicProfilesWithStoredPasswords()
  const publicProfiles = profilesState.profiles

  // Build the merged row list:
  //   - one entry per active connection (with disconnect ×)
  //   - one entry per configured-but-inactive profile (click → open
  //     AddConnectionModal pre-selected)
  // Dedupe is keyed on profile name: a configured profile that's
  // already in `connections` is rendered ONLY as the connection-id
  // row so the active state + disconnect affordance survive.
  const rows = useMemo(() => {
    const activeRows = [...connections.values()].map((c) => ({
      kind: 'active' as const,
      key: c.connectionId,
      profileName: c.profileName,
      connectionId: c.connectionId,
    }))
    const activeNames = new Set(activeRows.map((r) => r.profileName))
    const inactiveRows = (publicProfiles ?? [])
      .filter((p) => !activeNames.has(p.name))
      .map((p) => ({
        kind: 'inactive' as const,
        key: `profile-${p.name}`,
        profileName: p.name,
      }))
    return [...activeRows, ...inactiveRows]
  }, [connections, publicProfiles])

  // <wa-dropdown-item>'s Lit `updated()` lifecycle forcibly sets
  // role="menuitem" + clears aria-checked on first commit (it only
  // honours role="menuitemradio" for type="checkbox"). The seed item
  // survives because subsequent React renders reconcile the role
  // attribute back; a newly-mounted item commits exactly once and
  // loses to WA's microtask, so it stays role="menuitem" with no
  // aria-checked. That broke 17-add-connection.spec ("two rows for
  // default") and 18-connection-switcher.spec ("disconnect removes
  // the row"). React's `useEffect` runs in a macrotask AFTER both
  // React's commit and WA's update microtask, so re-asserting the
  // role attribute here wins deterministically.
  const rowsContainerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = rowsContainerRef.current
    if (!root) return
    root
      .querySelectorAll<HTMLElement>('wa-dropdown-item[data-connection-row]')
      .forEach((el) => {
        el.setAttribute('role', 'menuitemradio')
        const isActive = el.dataset.connectionRowActive === 'true'
        el.setAttribute('aria-checked', isActive ? 'true' : 'false')
      })
  }, [connections, activeId])

  // PSR-F16 (#113): the lazy-hydrate path mounts with an empty
  // connection map; show a non-interactive placeholder while the
  // secure-store decrypt round-trip is in flight rather than the
  // "connect" affordance (which would race the hydrated state).
  if (loading) {
    return (
      <SwitcherWrap>
        <wa-button
          appearance="outlined"
          size="s"
          role="button"
          data-testid="connection-trigger"
          aria-busy="true"
          aria-label={t('connection.noActive')}
          disabled
        >
          {t('connection.noActive')}
        </wa-button>
      </SwitcherWrap>
    )
  }

  if (connections.size === 0) {
    return (
      <SwitcherWrap>
        <wa-button
          appearance="outlined"
          size="s"
          role="button"
          data-testid="connection-trigger"
          onClick={() => onAddRequested()}
          aria-label={t('connection.connect')}
        >
          {t('connection.noActive')}
        </wa-button>
      </SwitcherWrap>
    )
  }

  return (
    <SwitcherWrap ref={rowsContainerRef}>
      <Dropdown
        onWaSelect={(e: Event) => {
          // The @lit/react wrapper assigns `value` as a JS property on
          // the wa-dropdown-item element (since `value` is on the
          // WaDropdownItem prototype), so `getAttribute('value')`
          // returns null. Read the property — fall back to the
          // attribute for safety (e.g. an item authored with a
          // bare `value="..."` attribute string).
          const item = (e as CustomEvent<{ item: HTMLElement }>).detail?.item
          const value =
            (item as unknown as { value?: string })?.value ??
            item?.getAttribute('value') ??
            ''
          if (value === ADD_ITEM_VALUE) {
            onAddRequested()
          } else if (value.startsWith(PROFILE_ITEM_PREFIX)) {
            // Configured-but-inactive profile picked. Open the modal
            // pre-selected to that profile name so the operator only
            // has to type credentials.
            onAddRequested(value.slice(PROFILE_ITEM_PREFIX.length))
          } else if (value) {
            switchActive(value)
          }
        }}
      >
        <wa-button
          slot="trigger"
          appearance="outlined"
          size="s"
          role="button"
          data-testid="connection-trigger"
          aria-haspopup="menu"
        >
          {active?.profileName ?? t('connection.noActive')}
        </wa-button>
        {rows.map((row) => {
          return row.kind === 'active' ? (
            <DropdownItem
              key={row.key}
              value={row.connectionId}
              // Preserve the existing test-id surface so e2e + unit
              // tests can find rows by connection id. Role + aria-checked
              // are also set here for React's initial commit (which
              // wins for the seed item that re-reconciles), but the
              // useEffect above is the authoritative writer: WA's
              // <wa-dropdown-item> lifecycle overwrites both attributes
              // on first commit, so a freshly-mounted row would
              // otherwise render as role="menuitem" without
              // aria-checked. The data-connection-row + data-* attrs
              // give the effect a stable target.
              role="menuitemradio"
              aria-checked={row.connectionId === activeId}
              aria-label={row.profileName}
              data-testid={`connection-row-${row.connectionId}`}
              data-connection-row=""
              data-connection-row-active={
                row.connectionId === activeId ? 'true' : 'false'
              }
            >
              <span style={rowInnerStyle}>
                <span>{row.profileName}</span>
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`${t('connection.disconnect')}: ${row.profileName}`}
                  data-testid={`connection-disconnect-${row.connectionId}`}
                  ref={bindCaptureClick(() => disconnect(row.connectionId))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation()
                      e.preventDefault()
                      disconnect(row.connectionId)
                    }
                  }}
                  style={disconnectStyle}
                >
                  <Icon
                    name="xmark"
                    label={`${t('connection.disconnect')}: ${row.profileName}`}
                  />
                </span>
              </span>
            </DropdownItem>
          ) : (
            // Inactive (configured-but-not-connected) profile row.
            // wa-select dispatches with value=PROFILE_ITEM_PREFIX+name;
            // the dropdown's handler routes that to onAddRequested
            // with the profile name so AddConnectionModal opens
            // pre-selected. No disconnect × — there's nothing to
            // disconnect from a profile we aren't connected to.
            <DropdownItem
              key={row.key}
              value={`${PROFILE_ITEM_PREFIX}${row.profileName}`}
              role="menuitem"
              aria-label={`${t('connection.connect')}: ${row.profileName}`}
              data-testid={`connection-row-profile-${row.profileName}`}
            >
              <span style={rowInnerStyle}>
                <span>{row.profileName}</span>
                <Icon name="plug" />
              </span>
            </DropdownItem>
          )
        })}
        <DropdownItem
          value={ADD_ITEM_VALUE}
          role="menuitem"
          data-testid="connection-add"
        >
          <Icon name="plus" /> {t('connection.addAnother')}
        </DropdownItem>
      </Dropdown>
    </SwitcherWrap>
  )
}
