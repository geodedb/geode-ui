// P-NEW-7: tests for the AssetCache used by the Electron `geode://`
// asset handler.

import { AssetCache, defaultCacheOptions } from '../electron/lib/cache'

const u8 = (n: number, fill = 0): Uint8Array => {
  const a = new Uint8Array(n)
  a.fill(fill)
  return a
}

test('returns undefined on miss; stores and returns on hit', () => {
  const c = new AssetCache({ capacity: 4, maxBytes: 1024 })
  expect(c.get('a')).toBeUndefined()
  c.set('a', u8(8))
  expect(c.get('a')).toBeDefined()
  expect(c.get('a')!.byteLength).toBe(8)
})

test('evicts the oldest entry once capacity is exceeded', () => {
  const c = new AssetCache({ capacity: 2, maxBytes: 1024 })
  c.set('a', u8(1))
  c.set('b', u8(1))
  c.set('c', u8(1))
  expect(c.has('a')).toBe(false)
  expect(c.has('b')).toBe(true)
  expect(c.has('c')).toBe(true)
})

test('get() promotes the entry so it survives the next eviction', () => {
  const c = new AssetCache({ capacity: 2, maxBytes: 1024 })
  c.set('a', u8(1))
  c.set('b', u8(1))
  // Touch 'a' so it's now the most recently used.
  c.get('a')
  c.set('c', u8(1))
  // 'b' should be the eviction victim now, not 'a'.
  expect(c.has('a')).toBe(true)
  expect(c.has('b')).toBe(false)
  expect(c.has('c')).toBe(true)
})

test('evicts on byte budget regardless of entry count', () => {
  const c = new AssetCache({ capacity: 100, maxBytes: 16 })
  c.set('a', u8(8))
  c.set('b', u8(8))
  // Bytes used = 16, at the cap. Adding a third 8-byte entry should
  // evict the oldest.
  c.set('c', u8(8))
  expect(c.has('a')).toBe(false)
  expect(c.bytes()).toBe(16)
})

test('rejects oversize entries instead of cascading eviction', () => {
  const c = new AssetCache({ capacity: 100, maxBytes: 8 })
  c.set('a', u8(4))
  c.set('huge', u8(64)) // > maxBytes — must be rejected
  expect(c.has('a')).toBe(true)
  expect(c.has('huge')).toBe(false)
  expect(c.bytes()).toBe(4)
})

test('overwriting an existing key updates bytes-used', () => {
  const c = new AssetCache({ capacity: 4, maxBytes: 64 })
  c.set('a', u8(8))
  expect(c.bytes()).toBe(8)
  c.set('a', u8(16))
  expect(c.bytes()).toBe(16)
  expect(c.size()).toBe(1)
})

test('clear() empties everything', () => {
  const c = new AssetCache({ capacity: 4, maxBytes: 64 })
  c.set('a', u8(8))
  c.set('b', u8(8))
  c.clear()
  expect(c.size()).toBe(0)
  expect(c.bytes()).toBe(0)
})

test('rejects non-positive sizing', () => {
  expect(() => new AssetCache({ capacity: 0, maxBytes: 64 })).toThrow(
    /capacity/
  )
  expect(() => new AssetCache({ capacity: 4, maxBytes: 0 })).toThrow(/maxBytes/)
})

test('defaultCacheOptions returns sensible defaults and respects env', () => {
  const orig = { ...process.env }
  delete process.env.GEODE_ELECTRON_CACHE_CAPACITY
  delete process.env.GEODE_ELECTRON_CACHE_MAX_BYTES
  expect(defaultCacheOptions()).toEqual({
    capacity: 64,
    maxBytes: 32 * 1024 * 1024,
  })

  process.env.GEODE_ELECTRON_CACHE_CAPACITY = '128'
  process.env.GEODE_ELECTRON_CACHE_MAX_BYTES = '4194304'
  expect(defaultCacheOptions()).toEqual({
    capacity: 128,
    maxBytes: 4194304,
  })

  // Falls back when the env var is bogus.
  process.env.GEODE_ELECTRON_CACHE_CAPACITY = 'banana'
  expect(defaultCacheOptions().capacity).toBe(64)

  process.env = orig
})
