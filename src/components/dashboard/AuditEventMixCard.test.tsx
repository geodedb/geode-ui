/// <reference types="@testing-library/jest-dom" />
//
// Tests for the audit-mix donut grouping logic. The component itself
// also has a render path but the donut renders a Recharts SVG that
// jsdom can't reliably measure (ResponsiveContainer falls back to a
// 0-width / 0-height shell in headless environments); we test the
// grouping helper directly, which is the part most likely to drift
// when the upstream emits new event types.

import { computeMix } from './AuditEventMixCard'

describe('computeMix', () => {
  it('groups access_token_query and auth_role_resolved into the "system" bucket', () => {
    // These two event types are emitted by middleware before any
    // user actor is in scope; the plan's open-question #4 calls out
    // that they would otherwise dominate the donut at the expense of
    // real activity. The "system" rollup keeps every real event
    // type visible at a glance.
    const slices = computeMix([
      { event: 'access_token_query' },
      { event: 'access_token_query' },
      { event: 'auth_role_resolved' },
      { event: 'login_success' },
    ])
    const system = slices.find((s) => s.name === 'system')
    expect(system?.value).toBe(3)
    expect(slices.find((s) => s.name === 'login_success')?.value).toBe(1)
    // No raw `access_token_query` / `auth_role_resolved` slice
    // remains — the rollup is the only place those should appear.
    expect(slices.find((s) => s.name === 'access_token_query')).toBeUndefined()
    expect(slices.find((s) => s.name === 'auth_role_resolved')).toBeUndefined()
  })

  it('sorts slices by count descending', () => {
    const slices = computeMix([
      { event: 'a' },
      { event: 'b' },
      { event: 'b' },
      { event: 'c' },
      { event: 'c' },
      { event: 'c' },
    ])
    expect(slices.map((s) => s.name)).toEqual(['c', 'b', 'a'])
  })

  it('rolls the tail into "other" when distinct types exceed MAX_SLICES', () => {
    // Build 10 distinct event types with 1 entry each. With
    // MAX_SLICES=7 the top 6 keep their own slices and the bottom 4
    // collapse into an "other" slice with value 4. The slice order
    // is sorted-by-value-desc; since every input has value=1 the
    // exact head order is implementation-defined — we only assert
    // that the rollup carries the right cardinality.
    const entries = Array.from({ length: 10 }, (_, i) => ({
      event: `evt_${String.fromCharCode(97 + i)}`,
    }))
    const slices = computeMix(entries)
    expect(slices.length).toBe(7)
    const other = slices.find((s) => s.name === 'other')
    expect(other?.value).toBe(4)
  })

  it('treats missing event field as the "unknown" bucket', () => {
    const slices = computeMix([{}, { event: 'login_success' }, {}])
    expect(slices.find((s) => s.name === 'unknown')?.value).toBe(2)
    expect(slices.find((s) => s.name === 'login_success')?.value).toBe(1)
  })

  it('returns an empty array for empty input', () => {
    expect(computeMix([])).toEqual([])
  })
})
