/* eslint-disable indent -- Prettier wraps long template-literal
 * interpolations with 8-space continuation indent; the eslint indent
 * rule expects 4 inside this function body. The wrapped form is
 * Prettier-canonical, so we defer to Prettier here. */
import { css } from 'styled-components'
import type { CSSObject, RuleSet } from 'styled-components'

import type { Theme } from './types'

// Responsive helpers backed by `theme.breakpoints`.
//
// Usage in styled-components:
//
//   const Card = styled.div`
//     padding: ${({ theme }) => theme.spacing.lg};
//     ${below('md')`
//       padding: ${({ theme }) => theme.spacing.sm};
//     `}
//   `
//
// `below(key)` emits `@media (max-width: ${px - 0.02}px)` so the
// breakpoint sits exactly between the two scales (matches Bootstrap 5
// and the geodedb.com brand site). `above(key)` emits a min-width
// query for mobile-first layering. `between(min, max)` covers
// tablet-only ranges.

type BpKey = keyof Theme['breakpoints']

type StyleFn = (
  strings: TemplateStringsArray,
  // styled-components' Interpolation type is parameterized on the
  // execution context; using `unknown[]` here lets callers pass either
  // theme-aware functions (preferred) or plain template fragments.
  ...interpolations: unknown[]
) => RuleSet<object>

function maxPx(theme: Theme, key: BpKey): number {
  return Math.max(theme.breakpoints[key] - 0.02, 0)
}

function minPx(theme: Theme, key: BpKey): number {
  return theme.breakpoints[key]
}

export function below(key: BpKey): StyleFn {
  return (strings, ...interpolations) => css`
    @media (max-width: ${({ theme }) => maxPx(theme, key)}px) {
      ${css(strings, ...(interpolations as []))}
    }
  `
}

export function above(key: BpKey): StyleFn {
  return (strings, ...interpolations) => css`
    @media (min-width: ${({ theme }) => minPx(theme, key)}px) {
      ${css(strings, ...(interpolations as []))}
    }
  `
}

export function between(min: BpKey, max: BpKey): StyleFn {
  return (strings, ...interpolations) => css`
    @media (min-width: ${({ theme }) =>
        minPx(theme, min)}px) and (max-width: ${({ theme }) =>
        maxPx(theme, max)}px) {
      ${css(strings, ...(interpolations as []))}
    }
  `
}

// Object-form variant for places where the template-literal helper is
// awkward (third-party libraries that take raw selector strings).
export function bp(theme: Theme, key: BpKey): string {
  return `@media (max-width: ${maxPx(theme, key)}px)`
}

export type Breakpoint = BpKey
export type ResponsiveCss = CSSObject
