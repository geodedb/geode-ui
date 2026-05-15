import { perfMarks } from './perfMarks'

describe('perfMarks', () => {
  beforeEach(() => {
    performance.clearMarks()
    performance.clearMeasures()
  })

  it('start(name) calls performance.mark with "{name}:start"', () => {
    const spy = jest.spyOn(performance, 'mark')
    perfMarks.start('graph:layout')
    expect(spy).toHaveBeenCalledWith('graph:layout:start')
    spy.mockRestore()
  })

  it('end(name) measures from "{name}:start" to "{name}:end"', () => {
    perfMarks.start('graph:layout')
    const result = perfMarks.end('graph:layout')
    expect(result.measure).not.toBeNull()
    expect(result.measure?.name).toBe('graph:layout')
  })

  it('end(name) with no prior start returns { measure: null } and does not throw', () => {
    expect(() => perfMarks.end('graph:nothing')).not.toThrow()
    expect(perfMarks.end('graph:nothing').measure).toBeNull()
  })

  it('tier(t) calls performance.mark with "graph:tier:{t}"', () => {
    const spy = jest.spyOn(performance, 'mark')
    perfMarks.tier('mid')
    expect(spy).toHaveBeenCalledWith('graph:tier:mid')
    spy.mockRestore()
  })

  it('mark errors do not throw (mark API unavailable)', () => {
    const perfSeam = performance as unknown as { mark: unknown }
    const orig = performance.mark
    perfSeam.mark = (): never => {
      throw new Error('not supported')
    }
    expect(() => perfMarks.start('x')).not.toThrow()
    expect(() => perfMarks.end('x')).not.toThrow()
    perfSeam.mark = orig
  })
})
