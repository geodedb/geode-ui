// P-NEW-7: simple in-memory LRU cache for the Electron `geode://`
// asset handler. The protocol mounts a per-asset fs.readFile on every
// request; on a hard reload the renderer fetches HTML + main.js +
// vendors.js + main.css + 6 woff2 fonts + 2 logo SVGs sequentially,
// each round-tripping to disk. Caching the bytes in main-process
// memory turns those into O(1) lookups after the first miss.
//
// Pure data-structure — no fs / electron / Node-API dependency — so
// it tests cleanly under jsdom (see __tests__/electron-cache.test.ts).

export interface AssetCacheOptions {
  /**
   * Maximum number of entries kept in memory. Capped to bound total
   * footprint when a release ships many small chunks.
   */
  capacity: number
  /**
   * Maximum cumulative size of cached bytes. A second guard so a
   * large vendor chunk doesn't crowd out everything else.
   */
  maxBytes: number
}

interface Entry {
  key: string
  bytes: Uint8Array
  size: number
}

// Plain Map preserves insertion order, which we (ab)use to track
// recency: every `get` re-inserts the hit at the back, so the front
// of the iteration is the LRU tail.
export class AssetCache {
  private readonly entries = new Map<string, Entry>()

  private bytesUsed = 0

  constructor(private readonly opts: AssetCacheOptions) {
    if (opts.capacity <= 0) throw new Error('capacity must be > 0')
    if (opts.maxBytes <= 0) throw new Error('maxBytes must be > 0')
  }

  get(key: string): Uint8Array | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    // Move-to-back: re-insert so this entry becomes the most recently
    // used and survives the next eviction round.
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.bytes
  }

  set(key: string, bytes: Uint8Array): void {
    // Reject oversize entries outright — caching them would force the
    // cache to evict everything else on the very next set() call.
    if (bytes.byteLength > this.opts.maxBytes) return
    const existing = this.entries.get(key)
    if (existing) {
      this.bytesUsed -= existing.size
      this.entries.delete(key)
    }
    this.entries.set(key, { key, bytes, size: bytes.byteLength })
    this.bytesUsed += bytes.byteLength
    this.evict()
  }

  has(key: string): boolean {
    return this.entries.has(key)
  }

  size(): number {
    return this.entries.size
  }

  bytes(): number {
    return this.bytesUsed
  }

  clear(): void {
    this.entries.clear()
    this.bytesUsed = 0
  }

  private evict(): void {
    while (
      (this.entries.size > this.opts.capacity ||
        this.bytesUsed > this.opts.maxBytes) &&
      this.entries.size > 0
    ) {
      const oldestKey = this.entries.keys().next().value
      if (oldestKey === undefined) break
      const oldest = this.entries.get(oldestKey)
      if (!oldest) break
      this.bytesUsed -= oldest.size
      this.entries.delete(oldestKey)
    }
  }
}

// Default sizing: 64 entries × 32 MiB total is plenty for the SPA's
// asset set (HTML + ~10 chunks + fonts + icons) and small enough to
// stay well under the Electron main-process memory budget. Tunable
// via env vars if a large release ever needs more headroom.
export function defaultCacheOptions(): AssetCacheOptions {
  const capacity = Number(
    process.env.GEODE_ELECTRON_CACHE_CAPACITY ?? 64
  )
  const maxBytes = Number(
    process.env.GEODE_ELECTRON_CACHE_MAX_BYTES ?? 32 * 1024 * 1024
  )
  return {
    capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : 64,
    maxBytes:
      Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : 32 * 1024 * 1024,
  }
}
