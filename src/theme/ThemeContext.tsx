import React from 'react'
import { ThemeProvider as ScThemeProvider } from 'styled-components'

import { darkTheme } from './dark'
import { lightTheme } from './light'
import type { Theme, ThemeVariant } from './types'

const STORAGE_KEY = 'geode.ui.theme'

interface ThemeState {
  variant: ThemeVariant | 'system'
  resolved: ThemeVariant
  theme: Theme
}

interface ThemeActions {
  setVariant: (next: ThemeVariant | 'system') => void
}

// P-NEW-4: split the preference context into "state" vs "actions".
// The previous single-context value rebuilt its identity on every
// flip, forcing every consumer (theme switcher button, Logo, future
// `useResolvedTheme` callers) to re-render. The actions context's
// value is a single useMemo over a stable setter — so a component
// that only needs to *trigger* a flip (e.g. a settings switch) never
// re-renders when the theme actually flips. Components that need the
// current state (Logo, etc.) read the state context and accept the
// re-render.
const ThemeStateContext = React.createContext<ThemeState | null>(null)
const ThemeActionsContext = React.createContext<ThemeActions | null>(null)

function readStored(): ThemeVariant | 'system' {
  if (typeof window === 'undefined') return 'system'
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  } catch {
    // SecurityError in sandboxed contexts (some Electron configs); fall
    // back to system.
  }
  return 'system'
}

function persist(next: ThemeVariant | 'system') {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Ignore — preference falls back to system on next load.
  }
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

// ThemeProvider — owns the user's variant choice plus a live subscription
// to `prefers-color-scheme` so the app tracks the OS in `system` mode
// without a reload. Works under Electron (matchMedia is available in
// Chromium renderers) and degrades cleanly under SSR / unit tests where
// window is undefined.
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [variant, setVariantState] = React.useState<ThemeVariant | 'system'>(
    () => readStored()
  )
  const [systemDark, setSystemDark] = React.useState<boolean>(() =>
    systemPrefersDark()
  )

  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  // Setter is wrapped once and stays referentially stable for the
  // lifetime of the provider — that's what lets the actions context
  // skip re-renders entirely when the theme flips.
  const setVariant = React.useCallback((next: ThemeVariant | 'system') => {
    persist(next)
    setVariantState(next)
  }, [])

  let resolved: ThemeVariant
  if (variant === 'system') {
    resolved = systemDark ? 'dark' : 'light'
  } else {
    resolved = variant
  }
  const theme = resolved === 'dark' ? darkTheme : lightTheme

  // Sync the resolved variant onto <html data-theme=…> so non-styled
  // surfaces (Monaco, Cytoscape, third-party widgets) can react via
  // attribute selectors. Mirrors the geodedb.com `data-bs-theme`
  // convention.
  React.useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.setAttribute('data-theme', resolved)
  }, [resolved])

  const stateValue = React.useMemo<ThemeState>(
    () => ({ variant, resolved, theme }),
    [variant, resolved, theme]
  )
  const actionsValue = React.useMemo<ThemeActions>(
    () => ({ setVariant }),
    [setVariant]
  )

  return (
    <ThemeActionsContext.Provider value={actionsValue}>
      <ThemeStateContext.Provider value={stateValue}>
        <ScThemeProvider theme={theme}>{children}</ScThemeProvider>
      </ThemeStateContext.Provider>
    </ThemeActionsContext.Provider>
  )
}

// useThemePreference returns the same shape as before so existing
// call sites (Logo, etc.) keep working. New code that only needs the
// setter should use useThemeActions() directly to skip re-renders on
// theme flips.
export function useThemePreference(): ThemeState & ThemeActions {
  const state = React.useContext(ThemeStateContext)
  const actions = React.useContext(ThemeActionsContext)
  if (!state || !actions) {
    throw new Error('useThemePreference must be used inside <ThemeProvider>')
  }
  return { ...state, ...actions }
}

// useThemeActions returns just the setter — its identity is stable
// across theme flips, so a button that only needs to trigger a flip
// doesn't re-render when the flip occurs.
export function useThemeActions(): ThemeActions {
  const ctx = React.useContext(ThemeActionsContext)
  if (!ctx) {
    throw new Error('useThemeActions must be used inside <ThemeProvider>')
  }
  return ctx
}
