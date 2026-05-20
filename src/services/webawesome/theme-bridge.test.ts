import type { Theme } from '@geodedb/ui-core/theme'
import { buildWaCssVariables } from './theme-bridge'

// A minimal Theme stub matching the shape of theme/types.ts. The
// bridge only reads a subset of fields — the test pins those.
const stubTheme = {
  variant: 'light',
  colors: {
    primary: '#5b34c7',
    neutralScale: { 500: '#666666', 900: '#1a1a1a' },
    success: '#1d7f74',
    warning: '#d4a300',
    danger: '#b03030',
    info: '#2255aa',
  },
  text: {
    primary: '#1a1a1a',
    secondary: '#444',
    muted: '#777',
    onPrimary: '#fff',
  },
  bg: { canvas: '#ffffff', surface: '#f5f5f5', subtle: '#fafafa' },
  border: { default: '#d0d0d0', subtle: '#e5e5e5', focus: '#5b34c7' },
  radii: { sm: '4px', md: '8px', lg: '12px', pill: '999px' },
  font: {
    family: { body: 'Inter, sans-serif', mono: 'JetBrains Mono, monospace' },
    sizes: { xs: '12px', sm: '14px', md: '16px' },
  },
} as unknown as Theme

describe('buildWaCssVariables', () => {
  it('emits a :root block with --wa-color-* variables sourced from theme.colors', () => {
    const css = buildWaCssVariables(stubTheme)
    expect(css).toMatch(/:root\s*\{/)
    expect(css).toContain('--wa-color-brand-fill-loud: #5b34c7;')
    expect(css).toContain('--wa-color-success-fill-loud: #1d7f74;')
    expect(css).toContain('--wa-color-warning-fill-loud: #d4a300;')
    expect(css).toContain('--wa-color-danger-fill-loud: #b03030;')
  })

  it('emits surface + text + neutral mappings', () => {
    const css = buildWaCssVariables(stubTheme)
    expect(css).toContain('--wa-color-surface-default: #ffffff;')
    expect(css).toContain('--wa-color-surface-raised: #f5f5f5;')
    expect(css).toContain('--wa-color-text-normal: #1a1a1a;')
    expect(css).toContain('--wa-color-text-quiet: #444;')
    expect(css).toContain('--wa-border-color-normal: #d0d0d0;')
  })

  it('emits border-radius mappings', () => {
    const css = buildWaCssVariables(stubTheme)
    expect(css).toContain('--wa-border-radius-s: 4px;')
    expect(css).toContain('--wa-border-radius-m: 8px;')
    expect(css).toContain('--wa-border-radius-pill: 999px;')
  })

  it('emits font-family + size mappings', () => {
    const css = buildWaCssVariables(stubTheme)
    expect(css).toContain('--wa-font-family-body: Inter, sans-serif;')
    expect(css).toContain('--wa-font-size-xs: 12px;')
    expect(css).toContain('--wa-font-size-s: 14px;')
  })

  it('emits Bootstrap 5.3 --bs-* bridge variables sourced from theme', () => {
    const css = buildWaCssVariables(stubTheme)
    // Palette
    expect(css).toContain('--bs-primary: #5b34c7;')
    expect(css).toContain('--bs-primary-rgb: 91, 52, 199;')
    expect(css).toContain('--bs-success: #1d7f74;')
    expect(css).toContain('--bs-warning: #d4a300;')
    expect(css).toContain('--bs-danger: #b03030;')
    expect(css).toContain('--bs-info: #2255aa;')
    // Surfaces / text
    expect(css).toContain('--bs-body-bg: #ffffff;')
    expect(css).toContain('--bs-body-color: #1a1a1a;')
    expect(css).toContain('--bs-tertiary-bg: #fafafa;')
    expect(css).toContain('--bs-tertiary-color: #777;')
    // Borders + radii
    expect(css).toContain('--bs-border-color: #d0d0d0;')
    expect(css).toContain('--bs-border-radius: 8px;')
    expect(css).toContain('--bs-border-radius-sm: 4px;')
    expect(css).toContain('--bs-border-radius-lg: 12px;')
    // Focus ring (drives .btn:focus-visible outline in bootstrap-bridge.css)
    expect(css).toContain('--bs-focus-ring-color: #5b34c7;')
    // Typography
    expect(css).toContain('--bs-font-sans-serif: Inter, sans-serif;')
    expect(css).toContain('--bs-font-monospace: JetBrains Mono, monospace;')
    expect(css).toContain('--bs-body-font-size: 16px;')
  })

  it('writes variant overrides to :root for both light and dark', () => {
    // The bridge always targets :root because ThemeStyleSheet re-mounts
    // the stylesheet on every variant flip — so :root carries the
    // current variant's values. A previous version scoped dark to
    // [data-wa-theme="dark"], which never matched in production
    // because ThemeContext sets data-theme="dark" instead, leaving
    // WA's light-mode defaults active in dark mode.
    const dark = { ...stubTheme, variant: 'dark' } as unknown as Theme
    const cssDark = buildWaCssVariables(dark)
    const cssLight = buildWaCssVariables(stubTheme)
    expect(cssDark).toMatch(/:root\s*\{/)
    expect(cssLight).toMatch(/:root\s*\{/)
    expect(cssDark).not.toMatch(/\[data-wa-theme/)
  })
})
