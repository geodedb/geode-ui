// Theme contract.
//
// Shape modeled after @devnw/components ExtendedTheme so future component
// migrations can reuse that ecosystem's helpers. Existing flat tokens
// (`colors.primary`, `colors.background`, `colors.surface`, `colors.text`,
// `colors.textSecondary`, `colors.border`, `spacing.{xs,sm,md,lg,xl}`)
// are preserved verbatim so the ~97 `styled.*` call sites compile
// unchanged; new groups (`text.*`, `bg.*`, `font.*`, `breakpoints`, …)
// layer on top and are adopted incrementally.

export type ThemeVariant = 'light' | 'dark'

export interface ColorScale {
  50: string
  100: string
  200: string
  300: string
  400: string
  500: string
  600: string
  700: string
  800: string
  900: string
}

export interface Theme {
  variant: ThemeVariant

  // Flat surface/text aliases retained for the existing call sites.
  colors: {
    primary: string
    background: string
    surface: string
    text: string
    textSecondary: string
    border: string

    secondary: string
    tertiary: string
    success: string
    warning: string
    danger: string
    info: string

    primaryScale: ColorScale
    neutralScale: ColorScale
  }

  // Semantic text + background tokens (preferred for new code).
  text: {
    primary: string
    secondary: string
    muted: string
    inverse: string
    link: string
    onPrimary: string
    onDanger: string
    danger: string
    success: string
  }
  bg: {
    canvas: string
    surface: string
    subtle: string
    inverse: string
    overlay: string
    /**
     * Cytoscape graph canvas — distinct from `bg.canvas` because the
     * graph rendering needs a near-black background in dark mode for
     * contrast with edge labels, but a pure-white background in light
     * mode to keep node fills crisp.
     */
    graphCanvas: string
  }

  border: {
    subtle: string
    default: string
    strong: string
    focus: string
  }

  font: {
    family: {
      display: string
      body: string
      mono: string
    }
    sizes: {
      xxs: string
      xs: string
      sm: string
      md: string
      lg: string
      xl: string
      xxl: string
      display: string
    }
    weights: {
      normal: number
      medium: number
      semibold: number
      bold: number
      extrabold: number
    }
    lineHeights: {
      tight: number
      snug: number
      normal: number
      relaxed: number
    }
  }

  spacing: {
    xxs: string
    xs: string
    sm: string
    md: string
    lg: string
    xl: string
    xxl: string
  }

  // Pixel-valued breakpoints — used by the bp() helper to emit
  // `@media (max-width: ${theme.breakpoints.md}px)` etc.
  breakpoints: {
    xs: number
    sm: number
    md: number
    lg: number
    xl: number
    xxl: number
  }

  radii: {
    sm: string
    md: string
    lg: string
    xl: string
    xxl: string
    pill: string
    circle: string
  }

  shadows: {
    sm: string
    md: string
    lg: string
    xl: string
    focus: string
    danger: string
  }

  transitions: {
    fast: string
    normal: string
    slow: string
    easing: string
  }

  zIndex: {
    base: number
    dropdown: number
    sticky: number
    overlay: number
    modal: number
    popover: number
    toast: number
    tooltip: number
  }

  // Minimum interactive height/width (px). Drives Button/Input/Select
  // primitives so the app meets WCAG 2.5.5 (Target Size, AA) on touch
  // devices and Electron windows running on touch-screen hardware.
  touchTargets: {
    min: number
    comfortable: number
    large: number
  }
}
