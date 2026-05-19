export type NodeId = string
export type Position = { x: number; y: number }
export type PosMap = Map<NodeId, Position>

export interface GetResult {
  hit: 'full' | 'miss'
  positions?: PosMap
}

export interface PartialMatch {
  matched: NodeId[]
  missing: NodeId[]
  positions: PosMap
}

export interface CacheStats {
  hits: number
  misses: number
  hitRate: number // hits / (hits + misses), 0 when no lookups
}

export interface LayoutCache {
  get(sig: string): GetResult
  set(sig: string, positions: PosMap): void
  partialMatch(sig: string, currentIds: NodeId[]): PartialMatch
  // PERF #312: read-only counters used by the dev bench harness to
  // verify the cache-warm-rerun gate (cacheHitRate ≈ 1 on the second
  // pass at the same (renderer, n)). Counts both `get()` and
  // `partialMatch()` against the cache and is process-lifetime
  // cumulative; the bench compares per-combo deltas via the snapshot
  // it reads off `window.__geode_bench`.
  getStats(): CacheStats
}

// Bounded LRU. Map preserves insertion order; we re-insert on hit to
// refresh the LRU position and delete the first key on overflow.
export function createLayoutCache(capacity = 8): LayoutCache {
  const store = new Map<string, PosMap>()
  let hits = 0
  let misses = 0

  function bump(sig: string, positions: PosMap): void {
    store.delete(sig)
    store.set(sig, positions)
    while (store.size > capacity) {
      const first = store.keys().next().value as string | undefined
      if (first === undefined) break
      store.delete(first)
    }
  }

  return {
    get(sig) {
      const positions = store.get(sig)
      if (!positions) {
        misses += 1
        return { hit: 'miss' }
      }
      hits += 1
      bump(sig, positions)
      return { hit: 'full', positions: new Map(positions) }
    },
    set(sig, positions) {
      bump(sig, new Map(positions))
    },
    partialMatch(sig, currentIds) {
      const cached = store.get(sig)
      if (!cached) {
        misses += 1
        return {
          matched: [],
          missing: currentIds.slice(),
          positions: new Map(),
        }
      }
      hits += 1
      const matched: NodeId[] = []
      const missing: NodeId[] = []
      const positions: PosMap = new Map()
      currentIds.forEach((id) => {
        const p = cached.get(id)
        if (p) {
          matched.push(id)
          positions.set(id, p)
        } else {
          missing.push(id)
        }
      })
      return { matched, missing, positions }
    },
    getStats() {
      const total = hits + misses
      return {
        hits,
        misses,
        hitRate: total === 0 ? 0 : hits / total,
      }
    },
  }
}

// Module-level singleton used by the dispatcher. Tests can build their
// own via createLayoutCache(...).
export const layoutCache: LayoutCache = createLayoutCache(8)
