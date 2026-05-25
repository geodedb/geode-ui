import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { DefaultTheme } from 'styled-components'
import { Icon } from '@geodedb/ui-core'

// Themed window controls — minimize / toggle-maximize / close.
// Renders on Linux + Windows (frameless windows) and is suppressed on
// macOS where native traffic lights are kept via titleBarStyle:
// 'hiddenInset'. The component is also suppressed in the browser
// build (no window.geode bridge) so the same Top nav works for both
// Electron and web.

const Bar = styled.div`
  display: flex;
  align-items: stretch;
  gap: 0;
  /* Buttons must be clickable even though the parent Top nav is the
     Electron drag region. */
  -webkit-app-region: no-drag;
  margin-left: ${({ theme }) => theme.spacing.sm};
  flex-shrink: 0;
`

type CtrlBtnProps = { theme: DefaultTheme; $danger?: boolean }

function hoverBg({ theme, $danger }: CtrlBtnProps): string {
  return $danger ? theme.colors.danger : theme.bg.subtle
}

function hoverColor({ theme, $danger }: CtrlBtnProps): string {
  return $danger ? theme.text.onPrimary : theme.text.primary
}

const ControlButton = styled.button<{ $danger?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 32px;
  padding: 0;
  border: none;
  background: transparent;
  color: ${({ theme }) => theme.text.secondary};
  cursor: pointer;
  border-radius: ${({ theme }) => theme.radii.sm};
  transition:
    background 120ms ease,
    color 120ms ease;

  &:hover,
  &:focus-visible {
    background: ${hoverBg};
    color: ${hoverColor};
  }

  &:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
  }
`

function getBridge(): typeof window.geode | undefined {
  if (typeof window === 'undefined') return undefined
  return window.geode
}

export const WindowControls: React.FC = () => {
  const { t } = useTranslation()
  const bridge = getBridge()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!bridge || bridge.platform === 'darwin') return undefined
    bridge
      .windowIsMaximized()
      .then(setMaximized)
      .catch(() => undefined)
    // Wrap the state-setter in a microtask so that calling the handler
    // from outside React (e.g. the Electron main-process event) does not
    // trigger a synchronous state update that React's act() gate would
    // flag as "not wrapped in act".
    const unsubscribe = bridge.onWindowMaximizedChange((maximized) => {
      Promise.resolve()
        .then(() => setMaximized(maximized))
        .catch(() => undefined)
    })
    return unsubscribe
  }, [bridge])

  const onMinimize = useCallback(() => {
    bridge?.windowMinimize().catch(() => undefined)
  }, [bridge])

  const onToggleMax = useCallback(() => {
    bridge?.windowToggleMaximize().catch(() => undefined)
  }, [bridge])

  const onClose = useCallback(() => {
    bridge?.windowClose().catch(() => undefined)
  }, [bridge])

  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Set via DOM API so that jsdom reflects it in element.style and
    // React's style prop validator doesn't warn about the hyphenated
    // vendor-prefixed property name.
    if (barRef.current) {
      barRef.current.style.setProperty('-webkit-app-region', 'no-drag')
    }
  })

  if (!bridge) return null
  if (bridge.platform === 'darwin') return null

  const maximizeLabel = maximized
    ? t('windowControls.restore')
    : t('windowControls.maximize')
  const maximizeIcon = maximized ? 'clone' : 'square'

  return (
    <Bar ref={barRef}>
      <ControlButton
        type="button"
        aria-label={t('windowControls.minimize')}
        onClick={onMinimize}
        data-testid="window-control-minimize"
      >
        <Icon name="window-minimize" variant="solid" />
      </ControlButton>
      <ControlButton
        type="button"
        aria-label={maximizeLabel}
        onClick={onToggleMax}
        data-testid="window-control-maximize"
      >
        <Icon name={maximizeIcon} variant="regular" />
      </ControlButton>
      <ControlButton
        type="button"
        $danger
        aria-label={t('windowControls.close')}
        onClick={onClose}
        data-testid="window-control-close"
      >
        <Icon name="xmark" variant="solid" />
      </ControlButton>
    </Bar>
  )
}
