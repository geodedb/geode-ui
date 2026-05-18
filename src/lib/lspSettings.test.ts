// Tests for the v0.5.18 LSP settings store: auto-format opt-out and
// formatting-options persistence. The store is the source of truth that
// QueryPage and GqlEditor both read, so the defaults and the
// persistence contract are load-bearing.

import { act } from '@testing-library/react'
import { useLspSettings, DEFAULT_LSP_FORMAT_OPTIONS } from './lspSettings'

describe('useLspSettings', () => {
  beforeEach(() => {
    // The store auto-creates from localStorage on first import; reset
    // to defaults between tests so cross-test state can't leak.
    window.localStorage.clear()
    act(() => {
      useLspSettings.setState({
        autoFormatEnabled: true,
        format: DEFAULT_LSP_FORMAT_OPTIONS,
      })
    })
  })

  test('autoFormatEnabled defaults to true', () => {
    expect(useLspSettings.getState().autoFormatEnabled).toBe(true)
  })

  test('format defaults match the server-side defaults (indent=2, line=100)', () => {
    expect(useLspSettings.getState().format).toEqual({
      indentSize: 2,
      maxLineLength: 100,
      minPropertiesToFold: 3,
      foldPropertyMaps: true,
    })
  })

  test('setAutoFormatEnabled flips the value', () => {
    act(() => {
      useLspSettings.getState().setAutoFormatEnabled(false)
    })
    expect(useLspSettings.getState().autoFormatEnabled).toBe(false)
  })

  test('setFormat merges partial options', () => {
    act(() => {
      useLspSettings.getState().setFormat({ indentSize: 4 })
    })
    expect(useLspSettings.getState().format).toEqual({
      indentSize: 4,
      maxLineLength: 100,
      minPropertiesToFold: 3,
      foldPropertyMaps: true,
    })
  })

  test('persists to localStorage under the versioned key', () => {
    act(() => {
      useLspSettings.getState().setAutoFormatEnabled(false)
    })
    const raw = window.localStorage.getItem('geode.lsp.settings.v1')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw as string)
    expect(parsed.state.autoFormatEnabled).toBe(false)
  })
})
