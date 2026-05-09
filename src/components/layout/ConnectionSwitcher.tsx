import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import type { Theme } from '../../theme'
import { useConnections, useActiveConnection } from '../../api/connections'
import { useAuth } from '../../auth/AuthProvider'

const SwitcherWrap = styled.div`
  position: relative;
`

const Trigger = styled.button`
  background: ${({ theme }) => theme.bg.surface};
  color: ${({ theme }) => theme.text.primary};
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: 4px 10px;
  font-size: 0.9em;
  cursor: pointer;
  &:hover {
    background: ${({ theme }) => theme.bg.subtle};
  }
`

const Menu = styled.ul`
  position: absolute;
  right: 0;
  top: 100%;
  margin: 4px 0 0 0;
  padding: ${({ theme }) => theme.spacing.xs};
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.md};
  list-style: none;
  min-width: 220px;
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
  const { connections, activeId, setActive } = useConnections()
  const active = useActiveConnection()
  const { disconnect } = useAuth()
  const [open, setOpen] = useState(false)

  if (connections.size === 0) {
    return (
      <SwitcherWrap>
        <Trigger
          type="button"
          onClick={onAddRequested}
          aria-label={t('connection.connect')}
        >
          {t('connection.noActive')}
        </Trigger>
      </SwitcherWrap>
    )
  }

  return (
    <SwitcherWrap>
      <Trigger
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {active?.profileName ?? t('connection.noActive')}
      </Trigger>
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
                setActive(c.connectionId)
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
