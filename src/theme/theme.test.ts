// Q-NEW-5: structural completeness test for the theme contract.
//
// `Theme` (src/theme/types.ts) defines the shape consumed by every
// `${({ theme }) => theme.x.y}` accessor in the codebase. Without a
// runtime check, a contributor could add a new top-level token group
// to `light.ts` (or rename a leaf), forget to mirror it in `dark.ts`,
// and the bug would only surface when that property happened to be
// read in a code path no manual test exercises.

import { darkTheme } from './dark'
import { lightTheme } from './light'

function flatten(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [prefix]
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => {
    const next = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      return flatten(v, next)
    }
    return [next]
  })
}

test('lightTheme and darkTheme expose identical leaf-path sets', () => {
  expect(flatten(darkTheme).sort()).toEqual(flatten(lightTheme).sort())
})

test('every theme exposes the leaf paths the contrast script checks', () => {
  // Mirrors the PAIRS list in scripts/check-contrast.mjs. If the leaf
  // paths drift, the contrast script's inline color mirror is no
  // longer reading from `${theme.text.primary}` etc., which means
  // contrast may silently regress at runtime.
  const required = [
    'colors.primary',
    'bg.canvas',
    'bg.surface',
    'bg.subtle',
    'text.primary',
    'text.secondary',
    'text.muted',
    'text.onPrimary',
    'text.danger',
    'text.success',
  ]
  const themes = [lightTheme, darkTheme]
  themes.forEach((theme) => {
    const keys = new Set(flatten(theme))
    required.forEach((path) => {
      expect(keys.has(path)).toBe(true)
    })
  })
})

test('variant tag matches the source-of-truth', () => {
  expect(lightTheme.variant).toBe('light')
  expect(darkTheme.variant).toBe('dark')
})

test('breakpoints scale strictly increases in both themes', () => {
  const order: Array<keyof typeof lightTheme.breakpoints> = [
    'xs',
    'sm',
    'md',
    'lg',
    'xl',
    'xxl',
  ]
  const themes = [lightTheme, darkTheme]
  themes.forEach((theme) => {
    order.slice(1).forEach((key, i) => {
      expect(theme.breakpoints[key]).toBeGreaterThan(
        theme.breakpoints[order[i]!]
      )
    })
  })
})

test('touch targets match the accessibility minimums', () => {
  const themes = [lightTheme, darkTheme]
  themes.forEach((theme) => {
    expect(theme.touchTargets.min).toBeGreaterThanOrEqual(44)
    expect(theme.touchTargets.comfortable).toBeGreaterThanOrEqual(
      theme.touchTargets.min
    )
    expect(theme.touchTargets.large).toBeGreaterThanOrEqual(
      theme.touchTargets.comfortable
    )
  })
})
