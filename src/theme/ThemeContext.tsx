import React from 'react'
import { ThemeProvider as ScThemeProvider } from 'styled-components'

import { darkTheme } from './dark'
import { lightTheme } from './light'
import type { Theme, ThemeVariant } from './types'

const STORAGE_KEY = 'geode.ui.theme'

interface ThemePreference {
  variant: ThemeVariant | 'system'
  setVariant: (next: ThemeVariant | 'system') => void
  resolved: ThemeVariant
  theme: Theme
}

const ThemePreferenceContext = React.createContext<ThemePreference | null>(null)

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

  const value = React.useMemo<ThemePreference>(
    () => ({ variant, setVariant, resolved, theme }),
    [variant, setVariant, resolved, theme]
  )

  return (
    <ThemePreferenceContext.Provider value={value}>
      <ScThemeProvider theme={theme}>{children}</ScThemeProvider>
    </ThemePreferenceContext.Provider>
  )
}

export function useThemePreference(): ThemePreference {
  const ctx = React.useContext(ThemePreferenceContext)
  if (!ctx) {
    throw new Error('useThemePreference must be used inside <ThemeProvider>')
  }
  return ctx
}
