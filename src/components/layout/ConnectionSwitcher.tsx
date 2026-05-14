import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { useConnections, useActiveConnection } from '../../api/connections'
import { useAuth } from '../../auth/AuthProvider'
import { Dropdown, DropdownItem } from '../../services/webawesome/components'

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
  onAddRequested: () => void
}

// Sentinel value used on the "Add another connection" dropdown item.
// The wa-select handler routes any item with this value to the
// onAddRequested callback rather than switchActive(connectionId).
const ADD_ITEM_VALUE = '__add__'

export const ConnectionSwitcher: React.FC<Props> = ({ onAddRequested }) => {
  const { t } = useTranslation()
  const { connections, activeId, loading } = useConnections()
  const active = useActiveConnection()
  const { disconnect, switchActive } = useAuth()

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
          onClick={onAddRequested}
          aria-label={t('connection.connect')}
        >
          {t('connection.noActive')}
        </wa-button>
      </SwitcherWrap>
    )
  }

  return (
    <SwitcherWrap>
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
        {[...connections.values()].map((c) => (
          <DropdownItem
            key={c.connectionId}
            value={c.connectionId}
            // Preserve the existing test-id surface so e2e + unit
            // tests can find rows by connection id. Also expose the
            // aria-label so getByRole('menuitemradio', {name}) keeps
            // working — wa-dropdown-item renders as role="menuitem"
            // by default; tests query by text/testid instead.
            role="menuitemradio"
            aria-checked={c.connectionId === activeId}
            aria-label={c.profileName}
            data-testid={`connection-row-${c.connectionId}`}
          >
            <span style={rowInnerStyle}>
              <span>{c.profileName}</span>
              <span
                role="button"
                tabIndex={0}
                aria-label={`${t('connection.disconnect')}: ${c.profileName}`}
                data-testid={`connection-disconnect-${c.connectionId}`}
                onClick={(e) => {
                  // Prevent the dropdown's selection logic from
                  // firing wa-select (which would race the
                  // disconnect with a switchActive on the same
                  // connection id).
                  e.stopPropagation()
                  disconnect(c.connectionId)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation()
                    e.preventDefault()
                    disconnect(c.connectionId)
                  }
                }}
                style={disconnectStyle}
              >
                ×
              </span>
            </span>
          </DropdownItem>
        ))}
        <DropdownItem
          value={ADD_ITEM_VALUE}
          role="menuitem"
          data-testid="connection-add"
        >
          {`+ ${t('connection.addAnother')}`}
        </DropdownItem>
      </Dropdown>
    </SwitcherWrap>
  )
}
