import React from 'react'
import { useTranslation } from 'react-i18next'

import { useThemePreference } from '../../theme'
import type { ThemeVariant } from '../../theme/types'
import { BootstrapDropdown } from '../../services/bootstrap/Dropdown'

// ThemeSelector exposes the Light / Dark / System variant choice in
// the Shell top nav. Reads + writes the ThemeContext preference,
// which persists to localStorage under `geode.ui.theme` and live-syncs
// `<html data-theme>` + `<html data-bs-theme>` for Bootstrap and
// downstream consumers.
//
// Trigger label mirrors the active selection — uses a sun/moon icon
// instead of text so the control stays compact in the responsive nav.

type Choice = ThemeVariant | 'system'

// Use safer unicode glyphs for the variant icons. The earlier ☀/☾/◑
// triple produced visible clipping on some fonts because the cusped
// crescent and half-circle glyphs draw outside their reported em box
// at small btn-sm padding. The replacements are widely-supported
// emoji-presentation variants (variation selector U+FE0F suppresses
// the emoji-style render so they stay monochrome glyph-mode on
// systems with proper font fallback).
const ICONS: Record<Choice, string> = {
  light: '☀︎',
  dark: '🌙︎',
  system: '🖥︎',
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
    { value: 'light' as const, label: `${ICONS.light} ${t('theme.light')}` },
    { value: 'dark' as const, label: `${ICONS.dark} ${t('theme.dark')}` },
    { value: 'system' as const, label: `${ICONS.system} ${t('theme.system')}` },
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
      {ICONS[variant]}
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
