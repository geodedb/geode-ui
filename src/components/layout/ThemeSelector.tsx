import React from 'react'
import { useTranslation } from 'react-i18next'

import type { ThemeVariant } from '@geodedb/ui-core/theme'

import { useThemePreference } from '../../theme'
import { BootstrapDropdown } from '../../services/bootstrap/Dropdown'
import { Icon } from '../ui'

// ThemeSelector exposes the Light / Dark / System variant choice in
// the Shell top nav. Reads + writes the ThemeContext preference,
// which persists to localStorage under `geode.ui.theme` and live-syncs
// `<html data-theme>` + `<html data-bs-theme>` for Bootstrap and
// downstream consumers.
//
// Trigger label mirrors the active selection — uses a sun/moon icon
// instead of text so the control stays compact in the responsive nav.

type Choice = ThemeVariant | 'system'

// Variant → Font Awesome icon slug. The Icon wrapper renders an <i>
// with the matching FA class, which paints consistently across themes
// and platforms without the unicode-glyph clipping issues that the
// earlier emoji-presentation characters suffered at btn-sm padding.
const ICONS: Record<Choice, string> = {
  light: 'sun',
  dark: 'moon',
  system: 'display',
}

export const ThemeSelector: React.FC = () => {
  const { t } = useTranslation()
  // useThemePreference throws when no ThemeProvider is mounted. The
  // Shell unit tests render the nav without one, so we catch the
  // missing provider and render nothing instead of crashing the
  // surrounding subtree.
  let variant: Choice = 'system'
  let setVariant: (v: Choice) => void = () => {}
  try {
    const prefs = useThemePreference()
    variant = prefs.variant
    setVariant = prefs.setVariant
  } catch {
    return null
  }

  const items = [
    {
      value: 'light' as const,
      label: (
        <>
          <Icon name={ICONS.light} /> {t('theme.light')}
        </>
      ),
    },
    {
      value: 'dark' as const,
      label: (
        <>
          <Icon name={ICONS.dark} /> {t('theme.dark')}
        </>
      ),
    },
    {
      value: 'system' as const,
      label: (
        <>
          <Icon name={ICONS.system} /> {t('theme.system')}
        </>
      ),
    },
  ]

  // Show the current variant's icon as the trigger label. Keeps the
  // trigger one-character wide so the top nav doesn't push the
  // ConnectionSwitcher off-screen.
  // Extract the JSX into a const so the airbnb/prettier dispute over
  // wrapping multi-line JSX in parens inside a JSX prop doesn't fire.
  // Box the icon at a fixed line-height + minimum width so the
  // dropdown-toggle's btn-sm padding can't clip the glyph (Bug:
  // earlier the trigger showed only a sliver of the icon). The
  // inline-block + center alignment also keeps the icon visually
  // centered when the trigger shows the chevron caret.
  const triggerLabel = (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        minWidth: '1.25em',
        textAlign: 'center',
        lineHeight: 1,
        fontSize: '1em',
      }}
    >
      <Icon name={ICONS[variant]} />
    </span>
  )

  return (
    <BootstrapDropdown<Choice>
      items={items}
      value={variant}
      onChange={(next) => setVariant(next)}
      ariaLabel={t('theme.selectorLabel')}
      triggerLabel={triggerLabel}
      size="sm"
      triggerProps={{ 'data-testid': 'theme-selector' }}
    />
  )
}
