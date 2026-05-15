// Public surface for the theme module.

export type { Theme, ThemeVariant, ColorScale } from './types'
export {
  spacing,
  breakpoints,
  radii,
  font,
  transitions,
  zIndex,
  touchTargets,
  primaryScale,
  neutralScale,
} from './tokens'
export { lightTheme } from './light'
export { darkTheme } from './dark'
export {
  ThemeProvider,
  useThemePreference,
  useThemeActions,
} from './ThemeContext'
export { above, below, between, bp } from './breakpoints'
export type { Breakpoint, ResponsiveCss } from './breakpoints'

// Backwards-compatible default export — historical imports of `theme`
// from `App.tsx` still resolve. New code should consume `useThemePreference()`
// or import lightTheme/darkTheme directly.
export { darkTheme as theme } from './dark'
