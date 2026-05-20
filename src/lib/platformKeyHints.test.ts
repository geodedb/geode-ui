import { modKeyLabel, shiftKeyLabel } from './platformKeyHints'

// GAP-047: pin platform-aware glyph selection. The hint strings funnel
// through this module so the test can replace `navigator` with a stub
// per platform and assert the label without touching globalThis.

describe('modKeyLabel', () => {
  test('returns "⌘" on macOS via userAgentData.platform', () => {
    expect(modKeyLabel({ userAgentData: { platform: 'macOS' } })).toBe('⌘')
  })

  test('returns "⌘" on legacy navigator.platform = MacIntel', () => {
    expect(modKeyLabel({ platform: 'MacIntel' })).toBe('⌘')
  })

  test('returns "Ctrl" on Windows', () => {
    expect(modKeyLabel({ userAgentData: { platform: 'Windows' } })).toBe('Ctrl')
    expect(modKeyLabel({ platform: 'Win32' })).toBe('Ctrl')
  })

  test('returns "Ctrl" on Linux', () => {
    expect(modKeyLabel({ userAgentData: { platform: 'Linux' } })).toBe('Ctrl')
    expect(modKeyLabel({ platform: 'Linux x86_64' })).toBe('Ctrl')
  })

  test('returns "Ctrl" when no platform is reported', () => {
    // Server-render / non-DOM contexts must not assume macOS.
    expect(modKeyLabel(undefined)).toBe('Ctrl')
    expect(modKeyLabel({})).toBe('Ctrl')
  })
})

describe('shiftKeyLabel', () => {
  test('returns "⇧" on macOS', () => {
    expect(shiftKeyLabel({ userAgentData: { platform: 'macOS' } })).toBe('⇧')
  })

  test('returns "Shift" on Linux / Windows', () => {
    expect(shiftKeyLabel({ platform: 'Linux x86_64' })).toBe('Shift')
    expect(shiftKeyLabel({ userAgentData: { platform: 'Windows' } })).toBe(
      'Shift'
    )
  })
})
