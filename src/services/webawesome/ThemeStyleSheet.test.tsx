import React from 'react'
import { render, cleanup } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../test-utils/theme'
import { ThemeStyleSheet } from './ThemeStyleSheet'

afterEach(cleanup)

describe('ThemeStyleSheet', () => {
  it('injects a <style data-wa-theme-sheet> element with the bridge output', () => {
    render(
      <ThemeProvider theme={theme}>
        <ThemeStyleSheet />
      </ThemeProvider>
    )
    const styleEl = document.querySelector('style[data-wa-theme-sheet]')
    expect(styleEl).not.toBeNull()
    expect(styleEl?.textContent ?? '').toMatch(/--wa-color-brand-fill-loud:/)
  })

  it('removes the style element on unmount', () => {
    const { unmount } = render(
      <ThemeProvider theme={theme}>
        <ThemeStyleSheet />
      </ThemeProvider>
    )
    expect(document.querySelector('style[data-wa-theme-sheet]')).not.toBeNull()
    unmount()
    expect(document.querySelector('style[data-wa-theme-sheet]')).toBeNull()
  })

  it('updates the style element content when the theme variant changes', () => {
    // testTheme defaults to variant 'dark'; pin to 'light' first so we
    // can observe the selector flipping when we rerender with 'dark'.
    const light = { ...theme, variant: 'light' as const }
    const { rerender } = render(
      <ThemeProvider theme={light}>
        <ThemeStyleSheet />
      </ThemeProvider>
    )
    const initialText =
      document.querySelector('style[data-wa-theme-sheet]')?.textContent ?? ''
    expect(initialText).toMatch(/^:root\s*\{/m)

    const dark = { ...theme, variant: 'dark' as const }
    rerender(
      <ThemeProvider theme={dark}>
        <ThemeStyleSheet />
      </ThemeProvider>
    )
    const next =
      document.querySelector('style[data-wa-theme-sheet]')?.textContent ?? ''
    expect(next).toMatch(/\[data-wa-theme="dark"\]\s*\{/)
  })
})
