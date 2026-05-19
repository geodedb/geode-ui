/* eslint-disable no-underscore-dangle, global-require -- internal __-prefixed test seam + require() to re-import the module under test */
import { useGraphPrefs } from '../useGraphPrefs'
import { scaleTier } from './scaleTier'
import { __buildWithSensitivityForTest } from './useGraphCytoscape'

describe('useGraphCytoscape — wheelSensitivity forwarding', () => {
  it('forwards wheelSensitivity from prefs into cytoscape() constructor', () => {
    const calls: Array<{ wheelSensitivity?: number }> = []
    __buildWithSensitivityForTest({
      cytoscapeFactory: (opts) => {
        calls.push({ wheelSensitivity: opts.wheelSensitivity })
        return { destroy: jest.fn() } as never
      },
      sensitivity: 1.25,
    })
    expect(calls[0]?.wheelSensitivity).toBe(1.25)
  })
})

describe('useGraphCytoscape — tier writeback', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useGraphPrefs.setState({ tier: 'small' })
  })

  it('writes "mid" when counts.nodes >= 2000', () => {
    const mod = require('./useGraphCytoscape') as {
      __writeTierForTest?: (n: number) => void
    }
    mod.__writeTierForTest?.(2500)
    expect(useGraphPrefs.getState().tier).toBe('mid')
  })

  it('writes "large" when counts.nodes >= 5000', () => {
    const mod = require('./useGraphCytoscape') as {
      __writeTierForTest?: (n: number) => void
    }
    mod.__writeTierForTest?.(6000)
    expect(useGraphPrefs.getState().tier).toBe('large')
  })

  it('honours hysteresis when previous tier was higher', () => {
    useGraphPrefs.setState({ tier: 'mid' })
    expect(scaleTier(1950, 'mid')).toBe('mid')
  })
})
/* eslint-enable no-underscore-dangle, global-require */
