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
    // colors.textSecondary mirrors text.secondary so consumers that
    // grab from `colors.*` (legacy admin/ops tab styling) and from
    // `text.*` agree. See text.secondary note about the WCAG bump.
    textSecondary: neutralScale[600],
    border: neutralScale[200],

    secondary: neutralScale[600],
    tertiary: primaryScale[400],
    // Status fills double as <wa-button variant=…> backgrounds with
    // white text on top. #10b981 (success) + #f59e0b (warning) pair
    // white at 2.5:1 and 1.9:1 — below WCAG AA. Use shade 700 so
    // white-on-fill clears 4.5:1. text.success / text.warning (for
    // inline body text on surfaces) keep their lighter brand-aligned
    // tints. Caught by 27-contrast.spec.ts.
    success: '#047857',
    warning: '#b45309',
    danger: '#b91c1c',
    info: primaryScale[500],

    primaryScale,
    neutralScale,
  },

  text: {
    primary: '#2a1f3a',
    // text.secondary + text.muted need to clear 4.5:1 against bg.canvas
    // (#f7f2ff) and bg.subtle (#f3ecff) for any body text rendered on
    // those surfaces — table headers, helper paragraphs, audit-log
    // code cells. Prior values neutralScale[500]/[400] sat at
    // 4.18/3.05 on canvas (caught by 27-contrast.spec). Bump
    // secondary to neutralScale[600] (#5b536a → ~7:1) and muted to
    // a custom #6a6275 between scale 500 and 600 so visual hierarchy
    // (secondary darker than muted) is preserved while both pass AA.
    secondary: neutralScale[600],
    muted: '#6a6275',
    inverse: '#ffffff',
    link: primaryScale[700],
    onPrimary: '#ffffff',
    onDanger: '#ffffff',
    onSuccess: '#ffffff',
    danger: '#b91c1c',
    success: '#047857',
  },

  bg: {
    canvas: '#f7f2ff',
    surface: '#ffffff',
    subtle: '#f3ecff',
    inverse: '#1c0f2e',
    overlay: 'rgba(26, 15, 46, 0.45)',
    graphCanvas: '#ffffff',
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
