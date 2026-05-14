import type { Theme } from '../../theme/types'
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
  },
  text: { primary: '#1a1a1a', secondary: '#444', onPrimary: '#fff' },
  bg: { canvas: '#ffffff', surface: '#f5f5f5' },
  border: { default: '#d0d0d0' },
  radii: { sm: '4px', md: '8px', pill: '999px' },
  font: {
    family: { body: 'Inter, sans-serif' },
    sizes: { xs: '12px', sm: '14px' },
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

  it('respects dark variant by tagging the :root with [data-wa-theme="dark"]', () => {
    const dark = { ...stubTheme, variant: 'dark' } as unknown as Theme
    const css = buildWaCssVariables(dark)
    expect(css).toMatch(/\[data-wa-theme="dark"\]\s*\{/)
  })
})
