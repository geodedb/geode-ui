// formatLastContact renders the `last_contact_ms` field from
// SHOW CLUSTER STATUS in operator-friendly units. The server emits
// `last_contact_ms` as the delta between "now" (on the server) and
// the last successful contact with that peer; self-rows always emit
// 0 (we are talking to ourselves). Negative values can occur if the
// server clock jumped backward between probes — clamp to 0 so the
// table never shows a confusing negative duration.
export function formatLastContact(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  if (ms < 60 * 60_000) return `${(ms / 60_000).toFixed(1)} m`
  return `${(ms / (60 * 60_000)).toFixed(1)} h`
}

// lastContactFreshness classifies a peer's freshness into one of four
// states used by the table's row coloring:
//   - 'self'   → render no chip; this is us.
//   - 'fresh'  → contacted within the last 2 s (typical heartbeat).
//   - 'stale'  → contacted between 2 s and 30 s ago (transient blip).
//   - 'lost'   → no contact for >= 30 s; likely partitioned or down.
// Thresholds chosen to align with the operator-facing semantics:
// "fresh" should cover the normal AppendEntries cadence (~100 ms);
// "lost" should match the leader-election timeout window after which
// most operators consider a peer down. The middle "stale" band gives
// a yellow-flag affordance without crying wolf at every burst.
export type Freshness = 'self' | 'fresh' | 'stale' | 'lost'

export function lastContactFreshness(ms: number): Freshness {
  if (!Number.isFinite(ms) || ms <= 0) return 'self'
  if (ms < 2000) return 'fresh'
  if (ms < 30_000) return 'stale'
  return 'lost'
}
