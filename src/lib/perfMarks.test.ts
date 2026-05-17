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

  it('drops oldest entries when buffer would exceed 512', async () => {
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
    // Verify it's the NEWEST 512 retained (not the oldest). A direction-flip
    // in the slice would still pass the count check but fail the contents.
    await perfMarks.flush()
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as { body: string }).body
    ) as { measures: { name: string }[] }
    expect(body.measures[0]?.name).toBe('m88')
    expect(body.measures[511]?.name).toBe('m599')
  })

  it('entries pushed during in-flight flush are preserved for the next cycle', async () => {
    let resolveFetch!: () => void
    fetchSpy.mockImplementationOnce(
      () =>
        new Promise<Response>((res) => {
          resolveFetch = () => res({ status: 204, ok: true } as Response)
        })
    )
    perfMarks.__startObserver('http://otel.local/v1/metrics')
    perfMarks.__pushMeasureForTest({
      name: 'before',
      startTime: 0,
      duration: 1,
      entryType: 'measure',
      toJSON: () => ({}),
    } as PerformanceMeasure)
    const flushP = perfMarks.flush()
    // Race window: push lands while fetch is still pending.
    perfMarks.__pushMeasureForTest({
      name: 'during',
      startTime: 1,
      duration: 1,
      entryType: 'measure',
      toJSON: () => ({}),
    } as PerformanceMeasure)
    resolveFetch()
    await flushP
    expect(perfMarks.__bufferSizeForTest()).toBe(1)
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

// PERF-N5 (#284): longtask observation extends the existing
// PerformanceObserver setup. The new behaviour lives behind two
// internal seams (`__longTaskCountForTest`, `__reportLongTaskForTest`)
// so tests do not depend on jsdom shipping longtask support and do
// not depend on console.warn (other tests routinely silence it).
describe('perfMarks longtask observer (PERF-N5 / #284)', () => {
  afterEach(() => {
    perfMarks.__resetForTest()
  })

  it('startObserver attempts to install a longtask PerformanceObserver', () => {
    // Capture every observer-construction call so we can assert one of
    // them targets `longtask`. We do not assume the install succeeds
    // (jsdom does not support longtask), only that the registration is
    // attempted. A factory + closure pattern keeps the fake as a
    // function-shaped constructor without tripping ESLint's class
    // hygiene rules.
    const observed: Array<{ type?: string; entryTypes?: string[] }> = []
    const original = global.PerformanceObserver
    const FakePerformanceObserver = function FakePerformanceObserver(
      this: { observe: (o: unknown) => void; disconnect: () => void },
      _cb: PerformanceObserverCallback
    ): void {
      // _cb is intentionally accepted but unused — we are stubbing
      // the observer's constructor signature, not its delivery loop.
      // Suppress lint by stamping a no-op tag onto `this` keyed by
      // the parameter; the operation is type-safe and free of any
      // unused-var hazards.
      const selfBag = this as Record<string, unknown>
      selfBag._unusedCb = typeof _cb
      this.observe = (o: unknown): void => {
        const opts = o as { type?: string; entryTypes?: string[] }
        observed.push(opts)
      }
      this.disconnect = (): void => {
        /* no-op */
      }
    } as unknown as typeof PerformanceObserver
    global.PerformanceObserver = FakePerformanceObserver
    try {
      perfMarks.__startObserver('http://otel.local/v1/metrics')
      // First call configures `measure`. Second call configures `longtask`.
      const longtaskCall = observed.find(
        (o) =>
          o.type === 'longtask' ||
          (o.entryTypes !== undefined && o.entryTypes.includes('longtask'))
      )
      expect(longtaskCall).toBeDefined()
      expect(perfMarks.__hasLongTaskObserverForTest()).toBe(true)
    } finally {
      global.PerformanceObserver = original
    }
  })

  it('reportLongTask increments the counter and console.warns in dev', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const before = perfMarks.__longTaskCountForTest()
    perfMarks.__reportLongTaskForTest({
      name: 'self',
      entryType: 'longtask',
      startTime: 12.3,
      duration: 123.4,
      toJSON: () => ({}),
    } as PerformanceEntry)
    expect(perfMarks.__longTaskCountForTest()).toBe(before + 1)
    // jest runs with NODE_ENV=test (not 'production'), so the gate
    // permits the dev warning. The warn is the development surface;
    // its argument list documents the dispatcher seam.
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/\[perfMarks\] longtask/)
    warnSpy.mockRestore()
  })

  it('longtask observer install failure is silent', () => {
    const original = global.PerformanceObserver
    const FlakyPerformanceObserver = function FlakyPerformanceObserver(
      this: { observe: (o: unknown) => void; disconnect: () => void },
      _cb: PerformanceObserverCallback
    ): void {
      // _cb is intentionally accepted but unused — we are stubbing
      // the observer's constructor signature, not its delivery loop.
      // Suppress lint by stamping a no-op tag onto `this` keyed by
      // the parameter; the operation is type-safe and free of any
      // unused-var hazards.
      const selfBag = this as Record<string, unknown>
      selfBag._unusedCb = typeof _cb
      this.observe = (o: unknown): void => {
        const opts = o as {
          type?: string
          entryTypes?: string[]
        }
        if (
          opts.type === 'longtask' ||
          (opts.entryTypes !== undefined &&
            opts.entryTypes.includes('longtask'))
        ) {
          throw new TypeError('longtask is not supported')
        }
      }
      this.disconnect = (): void => {
        /* no-op */
      }
    } as unknown as typeof PerformanceObserver
    global.PerformanceObserver = FlakyPerformanceObserver
    try {
      expect(() =>
        perfMarks.__startObserver('http://otel.local/v1/metrics')
      ).not.toThrow()
      expect(perfMarks.__hasLongTaskObserverForTest()).toBe(false)
    } finally {
      global.PerformanceObserver = original
    }
  })
})
