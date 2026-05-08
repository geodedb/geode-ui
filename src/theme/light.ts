import type { Theme } from './types'
import {
  breakpoints,
  font,
  neutralScale,
  primaryScale,
  radii,
  spacing,
  touchTargets,
  transitions,
  zIndex,
} from './tokens'

// Light theme — geodedb.com brand mapped to UI surfaces.
//
// Source palette: ../geodedb.com/assets/scss/_site-vars.scss:3-24 plus the
// extended primary/neutral scales in _design-system.scss:97-129.
//
// Surface strategy: very-light lavender canvas, white surface, brand
// purple primary. Status colors (success/warning/danger) deviate from
// the brand site's all-purple semantic palette — a database admin tool
// needs traffic-light differentiation for migration / backup state.
export const lightTheme: Theme = {
  variant: 'light',

  colors: {
    primary: primaryScale[700],
    background: '#f7f2ff',
    surface: '#ffffff',
    text: '#2a1f3a',
    textSecondary: neutralScale[500],
    border: neutralScale[200],

    secondary: neutralScale[500],
    tertiary: primaryScale[400],
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#dc2626',
    info: primaryScale[500],

    primaryScale,
    neutralScale,
  },

  text: {
    primary: '#2a1f3a',
    secondary: neutralScale[500],
    muted: neutralScale[400],
    inverse: '#ffffff',
    link: primaryScale[700],
    onPrimary: '#ffffff',
    danger: '#b91c1c',
    success: '#047857',
  },

  bg: {
    canvas: '#f7f2ff',
    surface: '#ffffff',
    subtle: '#f3ecff',
    inverse: '#1c0f2e',
    overlay: 'rgba(26, 15, 46, 0.45)',
  },

  border: {
    subtle: neutralScale[100],
    default: neutralScale[200],
    strong: neutralScale[300],
    focus: primaryScale[500],
  },

  font,
  spacing,
  breakpoints,
  radii,

  shadows: {
    sm: '0 1px 2px rgba(53, 4, 107, 0.08)',
    md: '0 4px 6px -1px rgba(53, 4, 107, 0.10), 0 2px 4px -1px rgba(53, 4, 107, 0.06)',
    lg: '0 10px 15px -3px rgba(53, 4, 107, 0.10), 0 4px 6px -2px rgba(53, 4, 107, 0.05)',
    xl: '0 20px 25px -5px rgba(53, 4, 107, 0.10), 0 10px 10px -5px rgba(53, 4, 107, 0.04)',
    focus: `0 0 0 3px ${primaryScale[200]}`,
    danger: '0 0 0 3px rgba(220, 38, 38, 0.25)',
  },

  transitions,
  zIndex,
  touchTargets,
}
