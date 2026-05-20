import { formatAuditTimestamp } from './formatAuditTimestamp'

describe('formatAuditTimestamp', () => {
  test('formats a valid ISO timestamp via Intl.DateTimeFormat', () => {
    const out = formatAuditTimestamp('2025-01-01T00:00:00Z')
    // The exact string depends on env locale; assert the year is
    // present and the raw ISO is NOT — proves Intl ran.
    expect(out).toMatch(/2024|2025/)
    expect(out).not.toContain('T00:00:00Z')
  })

  test('returns the raw input when timestamp is undefined', () => {
    expect(formatAuditTimestamp(undefined)).toBe('')
  })

  test('returns the raw input when timestamp is empty', () => {
    expect(formatAuditTimestamp('')).toBe('')
  })

  test('returns the raw input on unparseable values', () => {
    expect(formatAuditTimestamp('not-a-date')).toBe('not-a-date')
  })

  test('honours an explicit locale override', () => {
    const out = formatAuditTimestamp('2025-01-15T12:30:00Z', {
      locale: 'en-GB',
      timeZone: 'UTC',
    })
    // en-GB renders day before month and uses 24h time.
    expect(out).toContain('15')
    expect(out).toContain('12:30')
  })

  test('respects an explicit timeZone override', () => {
    const ny = formatAuditTimestamp('2025-01-15T17:00:00Z', {
      locale: 'en-US',
      timeZone: 'America/New_York',
    })
    const tokyo = formatAuditTimestamp('2025-01-15T17:00:00Z', {
      locale: 'en-US',
      timeZone: 'Asia/Tokyo',
    })
    expect(ny).not.toBe(tokyo)
  })
})
