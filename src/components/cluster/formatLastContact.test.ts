import { formatLastContact, lastContactFreshness } from './formatLastContact'

describe('formatLastContact', () => {
  test('returns em-dash for 0 (self / never)', () => {
    expect(formatLastContact(0)).toBe('—')
  })

  test('renders ms granularity below 1 second', () => {
    expect(formatLastContact(1)).toBe('1 ms')
    expect(formatLastContact(999)).toBe('999 ms')
  })

  test('renders seconds with one decimal below 60 s', () => {
    expect(formatLastContact(1000)).toBe('1.0 s')
    expect(formatLastContact(1500)).toBe('1.5 s')
    expect(formatLastContact(59_900)).toBe('59.9 s')
  })

  test('renders minutes below 60 m', () => {
    expect(formatLastContact(60_000)).toBe('1.0 m')
    expect(formatLastContact(90_000)).toBe('1.5 m')
    expect(formatLastContact(59 * 60_000)).toBe('59.0 m')
  })

  test('renders hours at and above 60 m', () => {
    expect(formatLastContact(60 * 60_000)).toBe('1.0 h')
    expect(formatLastContact(2 * 60 * 60_000)).toBe('2.0 h')
  })

  test('treats negative input as 0 (clock skew safety)', () => {
    expect(formatLastContact(-5)).toBe('—')
  })
})

describe('lastContactFreshness', () => {
  test('"self" for 0', () => {
    expect(lastContactFreshness(0)).toBe('self')
  })
  test('"fresh" under 2 seconds', () => {
    expect(lastContactFreshness(1)).toBe('fresh')
    expect(lastContactFreshness(1999)).toBe('fresh')
  })
  test('"stale" between 2 s and 30 s', () => {
    expect(lastContactFreshness(2000)).toBe('stale')
    expect(lastContactFreshness(29_999)).toBe('stale')
  })
  test('"lost" at or above 30 s', () => {
    expect(lastContactFreshness(30_000)).toBe('lost')
    expect(lastContactFreshness(120_000)).toBe('lost')
  })
})
