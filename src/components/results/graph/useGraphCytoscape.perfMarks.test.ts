/* eslint-disable no-underscore-dangle -- internal __-prefixed test seam */
import { perfMarks } from '../../../lib/perfMarks'

describe('useGraphCytoscape — perfMarks wiring (contract)', () => {
  it('exports a build helper that wraps perfMarks around the rebuild', () => {
    const startSpy = jest.spyOn(perfMarks, 'start')
    const endSpy = jest.spyOn(perfMarks, 'end')
    // eslint-disable-next-line global-require
    const mod = require('./useGraphCytoscape') as {
      __buildForTest?: () => void
    }
    expect(typeof mod.__buildForTest).toBe('function')
    mod.__buildForTest?.()
    expect(startSpy).toHaveBeenCalledWith('graph:rebuild')
    expect(endSpy).toHaveBeenCalledWith('graph:rebuild')
    startSpy.mockRestore()
    endSpy.mockRestore()
  })
})
/* eslint-enable no-underscore-dangle */
