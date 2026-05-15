import { scaleTier, allowedFeatures } from './scaleTier'

describe('scaleTier', () => {
  it.each([
    [0, 'small'],
    [1999, 'small'],
    [2000, 'mid'],
    [4999, 'mid'],
    [5000, 'large'],
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

    it('keeps "large" until n drops below 4900', () => {
      expect(scaleTier(4950, 'large')).toBe('large')
      expect(scaleTier(4900, 'large')).toBe('mid')
    })

    it('keeps "mid" until n rises to 5000', () => {
      expect(scaleTier(4999, 'mid')).toBe('mid')
      expect(scaleTier(5000, 'mid')).toBe('large')
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
