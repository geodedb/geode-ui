/* eslint-disable no-underscore-dangle, no-promise-executor-return */
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

describe('perfMarks buffered upload', () => {
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    // jsdom 20 doesn't define a global `Response`. perfMarks.flush() never
    // inspects the resolved value (best-effort upload), so a plain object
    // stub suffices and avoids a ReferenceError at spy-setup time.
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ status: 204, ok: true } as unknown as Response)
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    perfMarks.__resetForTest()
  })

  it('observes new measures and buffers them', async () => {
    perfMarks.__startObserver('http://otel.local/v1/metrics')
    perfMarks.start('graph:layout')
    perfMarks.end('graph:layout')
    // PerformanceObserver delivery is asynchronous (microtask / setImmediate
    // in Node's perf_hooks). Yield to the event loop so the buffer is
    // populated before we assert.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(perfMarks.__bufferSizeForTest()).toBeGreaterThanOrEqual(1)
  })

  it('flush() posts the buffer to the configured endpoint and clears it', async () => {
    perfMarks.__startObserver('http://otel.local/v1/metrics')
    perfMarks.start('graph:layout')
    perfMarks.end('graph:layout')
    await new Promise((resolve) => setTimeout(resolve, 0))
    await perfMarks.flush()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(perfMarks.__bufferSizeForTest()).toBe(0)
  })

  it('drops oldest entries when buffer would exceed 512', () => {
    perfMarks.__startObserver('http://otel.local/v1/metrics')
    for (let i = 0; i < 600; i += 1) {
      perfMarks.__pushMeasureForTest({
        name: `m${i}`,
        startTime: i,
        duration: 1,
        entryType: 'measure',
        toJSON: () => ({}),
      } as PerformanceMeasure)
    }
    expect(perfMarks.__bufferSizeForTest()).toBe(512)
  })

  it('flush() failure is silent (fetch rejects)', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('boom'))
    perfMarks.__startObserver('http://otel.local/v1/metrics')
    perfMarks.start('graph:layout')
    perfMarks.end('graph:layout')
    await new Promise((resolve) => setTimeout(resolve, 0))
    await expect(perfMarks.flush()).resolves.toBeUndefined()
  })
})
