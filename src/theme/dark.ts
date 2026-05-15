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

// Dark theme — geodedb.com brand mapped to UI surfaces.
//
// The brand site's dark mode (data-bs-theme=dark) anchors on #35046b for
// the canvas, but a database admin app spends long sessions on this
// surface; pure brand-purple at 100% saturation fatigues the eye and
// fights syntax highlighting in the Monaco editor. We darken to
// #1c0f2e for the canvas (still recognizably brand-purple, far more
// readable) and use #2a1f3a (neutralScale[800]) for raised surfaces.
//
// Source palette references:
//   ../geodedb.com/assets/scss/_site-vars.scss:14-24
//   ../geodedb.com/assets/scss/_ui-components.scss:533-637
export const darkTheme: Theme = {
  variant: 'dark',

  colors: {
    primary: primaryScale[400],
    background: '#1c0f2e',
    surface: '#2a1f3a',
    text: '#f5efff',
    textSecondary: '#cca8fb',
    border: '#3d3548',

    secondary: neutralScale[400],
    tertiary: primaryScale[300],
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#f87171',
    info: primaryScale[400],

    primaryScale,
    neutralScale,
  },

  text: {
    primary: '#f5efff',
    secondary: '#cca8fb',
    muted: neutralScale[400],
    inverse: '#2a1f3a',
    link: primaryScale[300],
    onPrimary: '#1c0f2e',
    onDanger: '#ffffff',
    danger: '#fca5a5',
    success: '#6ee7b7',
  },

  bg: {
    canvas: '#1c0f2e',
    surface: '#2a1f3a',
    subtle: '#241634',
    inverse: '#f7f2ff',
    overlay: 'rgba(0, 0, 0, 0.55)',
    graphCanvas: '#13091e',
  },

  border: {
    subtle: '#2f2444',
    default: '#3d3548',
    strong: '#5b536a',
    focus: primaryScale[400],
  },

  font,
  spacing,
  breakpoints,
  radii,

  shadows: {
    sm: '0 1px 2px rgba(0, 0, 0, 0.4)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.5), 0 2px 4px -1px rgba(0, 0, 0, 0.3)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.55), 0 4px 6px -2px rgba(0, 0, 0, 0.3)',
    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.6), 0 10px 10px -5px rgba(0, 0, 0, 0.3)',
    focus: `0 0 0 3px ${primaryScale[700]}`,
    danger: '0 0 0 3px rgba(248, 113, 113, 0.35)',
  },

  transitions,
  zIndex,
  touchTargets,
}
