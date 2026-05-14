// Deterministic graph fixture generator for benchmarks and stress
// tests. Uses a tiny xorshift32 PRNG (no dependency on Math.random or
// crypto) so the same (n, seed) always produces the same output across
// runs and machines.

const LABEL_BUCKETS = [
  'Person',
  'Movie',
  'Company',
  'Place',
  'Topic',
  'Tag',
] as const

// xorshift32 — a small, fast, well-known PRNG suitable for fixture
// generation (NOT cryptographically secure, intentionally so).
function makeRand(seed: number): () => number {
  let x = seed | 0 || 1
  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    // Return a float in [0, 1).
    return ((x >>> 0) % 1_000_000) / 1_000_000
  }
}

export type SeededNode = {
  id: string
  label: string
  properties: Record<string, string | number>
}

export type SeededEdge = {
  id: string
  source: string
  target: string
  type: string
}

// Generate a deterministic graph of `n` nodes with an average degree of
// ~3 (each node gets up to 3 outgoing edges to random other nodes,
// deduped). Each node is assigned a label from LABEL_BUCKETS by hash so
// label coloring is exercised at every scale.
export function seededGraph(
  n: number,
  seed = 42
): { nodes: SeededNode[]; edges: SeededEdge[] } {
  if (n < 0 || !Number.isFinite(n)) return { nodes: [], edges: [] }
  const rand = makeRand(seed)
  const nodes: SeededNode[] = []
  for (let i = 0; i < n; i += 1) {
    const label = LABEL_BUCKETS[i % LABEL_BUCKETS.length]!
    nodes.push({
      id: `n${i}`,
      label,
      properties: { name: `${label} ${i}`, index: i },
    })
  }
  const seen = new Set<string>()
  const edges: SeededEdge[] = []
  for (let i = 0; i < n; i += 1) {
    // 1–3 outgoing edges per node (random count, random targets).
    const k = 1 + Math.floor(rand() * 3)
    for (let j = 0; j < k; j += 1) {
      const tgt = Math.floor(rand() * n)
      // Skip self-loops and duplicate (source,target) pairs.
      if (tgt !== i) {
        const key = `${i}->${tgt}`
        if (!seen.has(key)) {
          seen.add(key)
          edges.push({
            id: key,
            source: `n${i}`,
            target: `n${tgt}`,
            type: 'EDGE',
          })
        }
      }
    }
  }
  return { nodes, edges }
}
