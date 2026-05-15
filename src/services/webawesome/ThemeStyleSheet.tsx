import { useEffect } from 'react'
import { useTheme } from 'styled-components'
import { buildWaCssVariables } from './theme-bridge'

// Mount once in the app shell. Generates a <style> tag in <head>
// containing Web Awesome's CSS custom-property mappings, derived
// from the live styled-components theme. Updates on theme change
// (e.g. light ↔ dark variant flip).
//
// Returns null — this is a side-effect-only component.
export const ThemeStyleSheet = (): null => {
  const theme = useTheme()
  useEffect(() => {
    const styleEl = document.createElement('style')
    styleEl.setAttribute('data-wa-theme-sheet', '')
    styleEl.textContent = buildWaCssVariables(theme)
    document.head.appendChild(styleEl)
    return () => {
      styleEl.remove()
    }
  }, [theme])
  return null
}
