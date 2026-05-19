import { scaleTier, allowedFeatures } from './scaleTier'

describe('scaleTier', () => {
  it.each([
    [0, 'small'],
    [1999, 'small'],
    [2000, 'mid'],
    [4999, 'mid'],
    // PERF #312: n=5000 is the bench's T19 P1 sample point and MUST
    // land in `mid` so the spec gate (p5Fps≥20) is measurable with
    // features enabled. Boundary now at n=5001.
    [5000, 'mid'],
    [5001, 'large'],
    [10000, 'large'],
  ])('tier(%d) = %s with no prev', (n, expected) => {
    expect(scaleTier(n)).toBe(expected)
  })

  describe('hysteresis (±100 nodes)', () => {
    it('keeps "mid" until n drops below 1900', () => {
      expect(scaleTier(1950, 'mid')).toBe('mid')
      expect(scaleTier(1900, 'mid')).toBe('small')
    })

    it('keeps "small" until n rises to 2000', () => {
      expect(scaleTier(1999, 'small')).toBe('small')
      expect(scaleTier(2000, 'small')).toBe('mid')
    })

    it('keeps "large" until n drops below 4901', () => {
      // PERF #312: boundary moved from MID_MAX=5000 → 5001, so the
      // hysteresis-down threshold is also shifted by one (5001-100).
      expect(scaleTier(4951, 'large')).toBe('large')
      expect(scaleTier(4901, 'large')).toBe('mid')
    })

    it('keeps "mid" until n rises to 5001', () => {
      // PERF #312: corresponding to MID_MAX=5001, n=5000 stays in mid
      // (was previously the up-transition point).
      expect(scaleTier(5000, 'mid')).toBe('mid')
      expect(scaleTier(5001, 'mid')).toBe('large')
    })
  })
})

describe('allowedFeatures', () => {
  it('small allows everything', () => {
    expect(allowedFeatures('small')).toEqual({
      domNodes: true,
      cxtmenu: true,
      tooltips: true,
      badges: true,
    })
  })

  it('mid allows everything except domNodes', () => {
    expect(allowedFeatures('mid')).toEqual({
      domNodes: false,
      cxtmenu: true,
      tooltips: true,
      badges: true,
    })
  })

  it('large disables everything', () => {
    expect(allowedFeatures('large')).toEqual({
      domNodes: false,
      cxtmenu: false,
      tooltips: false,
      badges: false,
    })
  })
})
