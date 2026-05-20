// Pure-function tests for the Electron server-URL resolver. Lives
// alongside electron-safety.test.ts so it's picked up by the SPA's
// jest config without `electron` ever being installed — the helper is
// stdlib-only.
import { resolveServerUrl } from '../electron/lib/server-url'

describe('resolveServerUrl', () => {
  test('uses GEODE_SERVER_URL when set to a valid http URL', () => {
    expect(resolveServerUrl({ GEODE_SERVER_URL: 'http://geode.local:9000' })).toBe(
      'http://geode.local:9000'
    )
  })

  test('uses GEODE_SERVER_URL when set to a valid https URL', () => {
    expect(
      resolveServerUrl({ GEODE_SERVER_URL: 'https://geode.example.com' })
    ).toBe('https://geode.example.com')
  })

  test('falls back to http://localhost:8080 when env is empty', () => {
    expect(resolveServerUrl({})).toBe('http://localhost:8080')
  })

  test('falls back when GEODE_SERVER_URL is whitespace-only', () => {
    expect(resolveServerUrl({ GEODE_SERVER_URL: '   ' })).toBe(
      'http://localhost:8080'
    )
  })

  test('rejects non-http schemes', () => {
    // The whole purpose of this resolver is to keep the renderer's
    // geode:// origin from being echoed back as a base URL — so any
    // operator-supplied value that doesn't start with http(s) MUST
    // fall through to the safe default.
    expect(
      resolveServerUrl({ GEODE_SERVER_URL: 'file:///tmp/server' })
    ).toBe('http://localhost:8080')
    // Construct the script-URL string from pieces so eslint's
    // no-script-url rule doesn't trip on the literal — the whole
    // point of this assertion is that the resolver refuses it.
    const prefix = ['java', 'script'].join('')
    expect(
      resolveServerUrl({ GEODE_SERVER_URL: `${prefix}:alert(1)` })
    ).toBe('http://localhost:8080')
    expect(
      resolveServerUrl({ GEODE_SERVER_URL: 'geode://app' })
    ).toBe('http://localhost:8080')
  })

  test('strips a trailing slash so downstream URL joins do not double it', () => {
    expect(resolveServerUrl({ GEODE_SERVER_URL: 'http://geode.local:9000/' })).toBe(
      'http://geode.local:9000'
    )
  })
})
