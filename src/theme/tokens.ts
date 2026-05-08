// Variant-independent design tokens.
//
// Spacing, breakpoints, radii, fonts, shadows, transitions, z-index, and
// touch-target sizes do not change between light and dark mode — they
// live here once and both theme files compose with them. Values are
// drawn from geodedb.com's Hugo design system (assets/scss/_design-system.scss
// and _site-vars.scss) and cross-checked against @devnw/components.

export const spacing = {
  xxs: '2px',
  xs: '4px',
  sm: '8px',
  md: '16px',
  lg: '24px',
  xl: '32px',
  xxl: '48px',
} as const

// Pixel values match the Bootstrap-derived scale used by both
// @devnw/components/src/theme/types.ts:68 and the brand site's responsive
// breakpoints. Consumers should compare against these in `@media` rules
// via the bp() helper.
export const breakpoints = {
  xs: 0,
  sm: 576,
  md: 768,
  lg: 992,
  xl: 1200,
  xxl: 1400,
} as const

export const radii = {
  sm: '4px',
  md: '6px',
  lg: '8px',
  xl: '12px',
  xxl: '16px',
  pill: '9999px',
  circle: '50%',
} as const

// Brand display face is Sora; body inherits the system stack so we don't
// pay a font-load round-trip for chrome text. IBM Plex Mono is used by
// the brand site for code blocks and our Monaco editor (see Phase 4 —
// monaco-bootstrap will adopt this stack).
export const font = {
  family: {
    display:
      '"Sora", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    body: '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    mono: '"IBM Plex Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Monaco, "Courier New", monospace',
  },
  sizes: {
    xxs: '11px',
    xs: '12px',
    sm: '13px',
    md: '14px',
    lg: '16px',
    xl: '20px',
    xxl: '24px',
    display: '32px',
  },
  weights: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    extrabold: 800,
  },
  lineHeights: {
    tight: 1.2,
    snug: 1.35,
    normal: 1.5,
    relaxed: 1.65,
  },
} as const

export const transitions = {
  fast: '150ms',
  normal: '250ms',
  slow: '350ms',
  easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const

export const zIndex = {
  base: 0,
  dropdown: 100,
  sticky: 200,
  overlay: 1000,
  modal: 1100,
  popover: 1200,
  toast: 1300,
  tooltip: 1400,
} as const

// 44 / 48 / 56 mirror the SpyderTheme touch-target scale from
// @devnw/components/src/theme/SpyderTheme.ts:145. Buttons and inputs
// enforce min via the UI primitives in Phase 2.
export const touchTargets = {
  min: 44,
  comfortable: 48,
  large: 56,
} as const

// Brand purple ramp — sourced from geodedb.com's _design-system.scss
// extended scale (--color-primary-50…900). Used for hover states,
// selected states, and gradient fills.
export const primaryScale = {
  50: '#f7f2ff',
  100: '#f3ecff',
  200: '#e6d9ff',
  300: '#cca8fb',
  400: '#b17bf6',
  500: '#9a5be5',
  600: '#853bd5',
  700: '#601ca0',
  800: '#4a1481',
  900: '#35046b',
} as const

// Cool neutral ramp — used for borders and surfaces in light mode and
// for text strata in dark mode. Slightly warm-tinted to harmonize with
// the purple primary.
export const neutralScale = {
  50: '#f7f5fa',
  100: '#eeeaf2',
  200: '#dcd5e3',
  300: '#bdb2c8',
  400: '#96929b',
  500: '#7a7285',
  600: '#5b536a',
  700: '#3d3548',
  800: '#2a1f3a',
  900: '#120b1c',
} as const
