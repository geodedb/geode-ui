import type { Theme } from '../../theme/types'

// Map our styled-components theme tokens to Web Awesome's CSS custom
// properties. WA's components read these from CSS custom properties
// inheriting through the shadow boundary (`var(...)`).
//
// The bridge writes to `:root` for BOTH variants. ThemeStyleSheet
// re-runs its useEffect on every theme change and re-mounts the
// stylesheet, so :root always carries the current variant's values.
//
// Earlier this file scoped the dark-mode block to
// `[data-wa-theme="dark"]`, on the assumption that WA itself used
// that attribute for its dark-theme selector — it doesn't (WA's
// own selectors are `.wa-dark` / `.wa-light` class-based). Our
// ThemeContext sets `data-theme="dark"` on the documentElement
// instead, so the bridge's `[data-wa-theme="dark"]` selector never
// matched anything and the dark overrides never landed: WA's
// `:root` light-mode defaults kept winning, which painted every
// <label>, wa-button label, wa-input label etc. in WA's
// light-mode dark gray (#1b1d26) on top of our dark surfaces.
// Caught by e2e/specs/27-contrast.spec.ts.
export function buildWaCssVariables(theme: Theme): string {
  const selector = ':root'
  const lines = [
    // Brand / status fills.
    //
    // Two strengths exist in WA's vocabulary: "loud" (vivid bg + light
    // text — used by wa-button appearance="accent") and "normal" (soft
    // tinted bg + dark accented text — used by wa-button
    // appearance="filled"). Our design language treats both as a
    // single "brand-coloured action" surface, so map them to the same
    // theme.colors.* fill. Without this, appearance="filled" picks
    // up WA's default brand-30 dark blue text on brand-90 lavender
    // bg — caught by 27-contrast.spec.ts (login profile button).
    `--wa-color-brand-fill-loud: ${theme.colors.primary};`,
    `--wa-color-brand-fill-normal: ${theme.colors.primary};`,
    `--wa-color-success-fill-loud: ${theme.colors.success};`,
    `--wa-color-success-fill-normal: ${theme.colors.success};`,
    `--wa-color-warning-fill-loud: ${theme.colors.warning};`,
    `--wa-color-warning-fill-normal: ${theme.colors.warning};`,
    `--wa-color-danger-fill-loud: ${theme.colors.danger};`,
    `--wa-color-danger-fill-normal: ${theme.colors.danger};`,
    // Surfaces.
    `--wa-color-surface-default: ${theme.bg.canvas};`,
    `--wa-color-surface-raised: ${theme.bg.surface};`,
    // Text.
    `--wa-color-text-normal: ${theme.text.primary};`,
    `--wa-color-text-quiet: ${theme.text.secondary};`,
    // On-loud tokens: WA picks per-variant `--wa-color-X-on-loud`
    // tokens for text rendered on top of `--wa-color-X-fill-loud`
    // surfaces (filled buttons, danger banners). Default values pick
    // a fixed gray from the WA palette regardless of theme variant —
    // which leaves a dark-blue "default" label on top of a dark
    // brand-purple button in dark mode (caught by 27-contrast.spec).
    // Force each on-loud token to the theme-appropriate inverse text
    // so the contrast contract holds at both variants.
    `--wa-color-on-loud: ${theme.text.onPrimary};`,
    `--wa-color-brand-on-loud: ${theme.text.onPrimary};`,
    `--wa-color-brand-on-normal: ${theme.text.onPrimary};`,
    `--wa-color-success-on-loud: ${theme.text.inverse};`,
    `--wa-color-success-on-normal: ${theme.text.inverse};`,
    `--wa-color-warning-on-loud: ${theme.text.inverse};`,
    `--wa-color-warning-on-normal: ${theme.text.inverse};`,
    `--wa-color-danger-on-loud: ${theme.text.onDanger};`,
    `--wa-color-danger-on-normal: ${theme.text.onDanger};`,
    `--wa-color-neutral-on-loud: ${theme.text.onPrimary};`,
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
    // Bootstrap 5.3 bridge. Bootstrap reads its palette, typography,
    // and spacing from `--bs-*` custom properties; overriding the
    // load-bearing ones with our theme tokens keeps the two frameworks
    // visually coherent.
    `--bs-body-bg: ${theme.bg.canvas};`,
    `--bs-body-bg-rgb: ${hexToRgbTriplet(theme.bg.canvas)};`,
    `--bs-body-color: ${theme.text.primary};`,
    `--bs-body-color-rgb: ${hexToRgbTriplet(theme.text.primary)};`,
    `--bs-secondary-bg: ${theme.bg.surface};`,
    `--bs-secondary-bg-rgb: ${hexToRgbTriplet(theme.bg.surface)};`,
    `--bs-secondary-color: ${theme.text.secondary};`,
    `--bs-secondary-color-rgb: ${hexToRgbTriplet(theme.text.secondary)};`,
    `--bs-tertiary-bg: ${theme.bg.subtle};`,
    `--bs-tertiary-bg-rgb: ${hexToRgbTriplet(theme.bg.subtle)};`,
    `--bs-tertiary-color: ${theme.text.muted};`,
    `--bs-tertiary-color-rgb: ${hexToRgbTriplet(theme.text.muted)};`,
    `--bs-emphasis-color: ${theme.text.primary};`,
    `--bs-emphasis-color-rgb: ${hexToRgbTriplet(theme.text.primary)};`,
    /* Light/dark named tokens (Bootstrap utility classes .bg-light,
       .bg-dark, .text-light, .text-dark). Also need RGB triplets so
       the utility-class color-with-opacity math works under our
       active theme. */
    `--bs-light-rgb: ${hexToRgbTriplet(theme.bg.surface)};`,
    `--bs-dark-rgb: ${hexToRgbTriplet(theme.text.primary)};`,
    `--bs-border-color: ${theme.border.default};`,
    `--bs-border-color-translucent: ${theme.border.subtle};`,
    `--bs-border-radius: ${theme.radii.md};`,
    `--bs-border-radius-sm: ${theme.radii.sm};`,
    `--bs-border-radius-lg: ${theme.radii.lg};`,
    `--bs-link-color: ${theme.colors.primary};`,
    `--bs-link-hover-color: ${theme.colors.primary};`,
    `--bs-primary: ${theme.colors.primary};`,
    `--bs-primary-rgb: ${hexToRgbTriplet(theme.colors.primary)};`,
    `--bs-primary-bg-subtle: ${theme.bg.subtle};`,
    `--bs-success: ${theme.colors.success};`,
    `--bs-success-rgb: ${hexToRgbTriplet(theme.colors.success)};`,
    `--bs-warning: ${theme.colors.warning};`,
    `--bs-warning-rgb: ${hexToRgbTriplet(theme.colors.warning)};`,
    `--bs-danger: ${theme.colors.danger};`,
    `--bs-danger-rgb: ${hexToRgbTriplet(theme.colors.danger)};`,
    `--bs-info: ${theme.colors.info};`,
    `--bs-info-rgb: ${hexToRgbTriplet(theme.colors.info)};`,
    `--bs-focus-ring-color: ${theme.border.focus};`,
    `--bs-light: ${theme.bg.surface};`,
    `--bs-dark: ${theme.text.primary};`,
    `--bs-font-sans-serif: ${theme.font.family.body};`,
    `--bs-font-monospace: ${theme.font.family.mono};`,
    `--bs-body-font-family: ${theme.font.family.body};`,
    `--bs-body-font-size: ${theme.font.sizes.md};`,
  ]
  return `${selector} {\n  ${lines.join('\n  ')}\n}\n`
}

/**
 * Convert a #rrggbb hex color to a Bootstrap-style "R, G, B" triplet
 * used by `--bs-*-rgb` variables (which feed rgba(...) opacity math
 * for focus rings and tint backgrounds). Returns "0, 0, 0" when the
 * input isn't a recognisable hex string, so a misconfigured theme
 * value degrades to a safe black instead of throwing during the
 * bridge build.
 */
function hexToRgbTriplet(hex: string | undefined): string {
  if (typeof hex !== 'string') return '0, 0, 0'
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return '0, 0, 0'
  const value = parseInt(m[1] as string, 16)
  const r = (value >> 16) & 0xff
  const g = (value >> 8) & 0xff
  const b = value & 0xff
  return `${r}, ${g}, ${b}`
}
