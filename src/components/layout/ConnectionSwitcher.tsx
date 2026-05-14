import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import type { Theme } from '../../theme'
import { useConnections, useActiveConnection } from '../../api/connections'
import { useAuth } from '../../auth/AuthProvider'

const SwitcherWrap = styled.div`
  position: relative;
`

// The switcher trigger sits on the LEFT side of the header (right after
// the brand logo, before the desktop nav). Anchoring the menu's left
// edge to the trigger's left edge keeps it on-screen across viewports;
// the previous right-anchor meant the menu extended leftward off the
// viewport on every screen size (overflow-left ~17 px desktop, ~33 px
// mobile). max-height + overflow-y keeps the menu scrollable when the
// user has many connections instead of stretching past the viewport
// bottom. max-width caps a pathologically long profile name from
// pushing the menu past the right edge in narrow viewports.
const Menu = styled.ul`
  position: absolute;
  left: 0;
  top: 100%;
  margin: 4px 0 0 0;
  padding: ${({ theme }) => theme.spacing.xs};
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.md};
  list-style: none;
  min-width: 220px;
  max-width: min(320px, calc(100vw - 16px));
  max-height: calc(100vh - 80px);
  overflow-y: auto;
  box-shadow: ${({ theme }) => theme.shadows.md};
  z-index: 50;
`

type RowBgProps = { theme: Theme; $active?: boolean }
function rowBg({ theme, $active }: RowBgProps) {
  return $active ? theme.bg.subtle : 'transparent'
}

const Row = styled.li<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xs};
  padding: 6px 8px;
  border-radius: ${({ theme }) => theme.radii.sm};
  cursor: pointer;
  background: ${rowBg};
  &:hover {
    background: ${({ theme }) => theme.bg.subtle};
  }
`

const Disconnect = styled.button`
  margin-left: auto;
  background: transparent;
  border: 0;
  cursor: pointer;
  font-size: 0.85em;
  color: ${({ theme }) => theme.text.secondary};
  &:hover {
    color: ${({ theme }) => theme.text.danger};
  }
`

const AddRow = styled.li`
  padding: 6px 8px;
  border-top: 1px solid ${({ theme }) => theme.border.default};
  margin-top: 4px;
  cursor: pointer;
  &:hover {
    background: ${({ theme }) => theme.bg.subtle};
  }
`

export interface Props {
  onAddRequested: () => void
}

export const ConnectionSwitcher: React.FC<Props> = ({ onAddRequested }) => {
  const { t } = useTranslation()
  const { connections, activeId, loading } = useConnections()
  const active = useActiveConnection()
  const { disconnect, switchActive } = useAuth()
  const [open, setOpen] = useState(false)

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
      <wa-button
        appearance="outlined"
        size="s"
        role="button"
        data-testid="connection-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open ? 'true' : 'false'}
      >
        {active?.profileName ?? t('connection.noActive')}
      </wa-button>
      {open && (
        <Menu role="menu">
          {[...connections.values()].map((c) => (
            <Row
              key={c.connectionId}
              role="menuitemradio"
              aria-checked={c.connectionId === activeId}
              aria-label={c.profileName}
              $active={c.connectionId === activeId}
              onClick={() => {
                switchActive(c.connectionId)
                setOpen(false)
              }}
            >
              <span>{c.profileName}</span>
              <Disconnect
                type="button"
                aria-label={`${t('connection.disconnect')}: ${c.profileName}`}
                onClick={(e) => {
                  e.stopPropagation()
                  disconnect(c.connectionId)
                }}
              >
                ×
              </Disconnect>
            </Row>
          ))}
          <AddRow
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onAddRequested()
            }}
          >
            {`+ ${t('connection.addAnother')}`}
          </AddRow>
        </Menu>
      )}
    </SwitcherWrap>
  )
}
