import type { Theme } from '../../theme/types'

// Map our styled-components theme tokens to Web Awesome's CSS custom
// properties. WA reads these from `:root` (light) or
// `[data-wa-theme="dark"]` (dark); components inside the shadow DOM
// inherit them via `var(...)`. Reference: Web Awesome 3.7 theming docs
// (CSS custom property naming follows `--wa-color-*`, `--wa-font-*`,
// `--wa-border-radius-*`, etc.).
export function buildWaCssVariables(theme: Theme): string {
  const variant = theme.variant
  const selector = variant === 'dark' ? '[data-wa-theme="dark"]' : ':root'
  const lines = [
    // Brand / status fills.
    `--wa-color-brand-fill-loud: ${theme.colors.primary};`,
    `--wa-color-success-fill-loud: ${theme.colors.success};`,
    `--wa-color-warning-fill-loud: ${theme.colors.warning};`,
    `--wa-color-danger-fill-loud: ${theme.colors.danger};`,
    // Surfaces.
    `--wa-color-surface-default: ${theme.bg.canvas};`,
    `--wa-color-surface-raised: ${theme.bg.surface};`,
    // Text.
    `--wa-color-text-normal: ${theme.text.primary};`,
    `--wa-color-text-quiet: ${theme.text.secondary};`,
    `--wa-color-on-loud: ${theme.text.onPrimary};`,
    // Border.
    `--wa-border-color-normal: ${theme.border.default};`,
    // Radii.
    `--wa-border-radius-s: ${theme.radii.sm};`,
    `--wa-border-radius-m: ${theme.radii.md};`,
    `--wa-border-radius-pill: ${theme.radii.pill};`,
    // Typography.
    `--wa-font-family-body: ${theme.font.family.body};`,
    `--wa-font-size-xs: ${theme.font.sizes.xs};`,
    `--wa-font-size-s: ${theme.font.sizes.sm};`,
  ]
  return `${selector} {\n  ${lines.join('\n  ')}\n}\n`
}
