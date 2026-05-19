/* eslint-disable no-use-before-define, func-names -- self-referential static + anonymous CSP-throw stub */
import { runLayoutOnWorker, __resetWorkerForTest } from './useLayoutWorker'

class FakeWorker {
  static lastInstance: FakeWorker | null = null

  onmessage: ((ev: MessageEvent) => void) | null = null

  onerror: ((ev: ErrorEvent) => void) | null = null

  posted: unknown[] = []

  terminated = false

  listeners: Array<(ev: MessageEvent) => void> = []

  constructor() {
    FakeWorker.lastInstance = this
  }

  postMessage(msg: unknown): void {
    this.posted.push(msg)
  }

  terminate(): void {
    this.terminated = true
  }

  addEventListener(_type: string, listener: (ev: MessageEvent) => void): void {
    this.listeners.push(listener)
  }

  removeEventListener(
    _type: string,
    listener: (ev: MessageEvent) => void
  ): void {
    this.listeners = this.listeners.filter((l) => l !== listener)
  }

  fakeMessage(data: unknown): void {
    this.listeners.forEach((l) => l(new MessageEvent('message', { data })))
  }
}

type WorkerSlot = { Worker?: typeof Worker }

describe('runLayoutOnWorker', () => {
  let origWorker: typeof Worker | undefined
  beforeEach(() => {
    __resetWorkerForTest()
    const slot = global as unknown as WorkerSlot
    origWorker = slot.Worker
    slot.Worker = FakeWorker as unknown as typeof Worker
  })

  afterEach(() => {
    const slot = global as unknown as WorkerSlot
    if (origWorker !== undefined) {
      slot.Worker = origWorker
    } else {
      delete slot.Worker
    }
  })

  it('posts a run message with a fresh runId', () => {
    const onDone = jest.fn()
    runLayoutOnWorker({
      nodes: [{ id: 'a' }, { id: 'b' }],
      edges: [{ id: 'e1', source: 'a', target: 'b' }],
      opts: {},
      onTick: jest.fn(),
      onDone,
      onFallback: jest.fn(),
    })
    const posted = FakeWorker.lastInstance?.posted[0] as {
      kind: string
      runId: number
    }
    expect(posted.kind).toBe('run')
    expect(typeof posted.runId).toBe('number')
  })

  it('calls onDone with the final positions map (Float32Array protocol)', () => {
    // PERF #291: the worker now posts positions as a Float32Array
    // (length = 2 * nodes.length, packed [x, y, x, y, …]) in the
    // SAME order as the input nodes. The main thread closes over
    // args.nodes to recover the id-by-index mapping.
    const onDone = jest.fn()
    runLayoutOnWorker({
      nodes: [{ id: 'a' }, { id: 'b' }],
      edges: [],
      opts: {},
      onTick: jest.fn(),
      onDone,
      onFallback: jest.fn(),
    })
    const posted = FakeWorker.lastInstance?.posted[0] as { runId: number }
    FakeWorker.lastInstance?.fakeMessage({
      kind: 'done',
      runId: posted.runId,
      positions: new Float32Array([10, 20, 30, 40]),
    })
    expect(onDone).toHaveBeenCalledTimes(1)
    const pos = onDone.mock.calls[0][0] as Map<string, { x: number; y: number }>
    expect(pos.get('a')).toEqual({ x: 10, y: 20 })
    expect(pos.get('b')).toEqual({ x: 30, y: 40 })
  })

  it('accepts the legacy Record<id, [x,y]> shape (mid-deploy chunk skew resilience)', () => {
    // PERF #291: if a stale worker bundle ships during a deploy lap
    // and posts the pre-fix Record shape, the main thread must still
    // build a valid PosMap. Mainline is Float32Array (test above);
    // this pin keeps the legacy decoder reachable.
    const onDone = jest.fn()
    runLayoutOnWorker({
      nodes: [{ id: 'a' }],
      edges: [],
      opts: {},
      onTick: jest.fn(),
      onDone,
      onFallback: jest.fn(),
    })
    const posted = FakeWorker.lastInstance?.posted[0] as { runId: number }
    FakeWorker.lastInstance?.fakeMessage({
      kind: 'done',
      runId: posted.runId,
      positions: { a: [10, 20] },
    })
    expect(onDone).toHaveBeenCalledTimes(1)
    const pos = onDone.mock.calls[0][0] as Map<string, { x: number; y: number }>
    expect(pos.get('a')).toEqual({ x: 10, y: 20 })
  })

  it('drops stale runId results', () => {
    const onDone = jest.fn()
    runLayoutOnWorker({
      nodes: [{ id: 'a' }],
      edges: [],
      opts: {},
      onTick: jest.fn(),
      onDone,
      onFallback: jest.fn(),
    })
    FakeWorker.lastInstance?.fakeMessage({
      kind: 'done',
      runId: 999999,
      positions: new Float32Array([1, 2]),
    })
    expect(onDone).not.toHaveBeenCalled()
  })

  it('falls back to onFallback when Worker constructor throws', () => {
    const slot = global as unknown as WorkerSlot
    const throwingCtor = function (): never {
      throw new Error('CSP')
    } as unknown as typeof Worker
    slot.Worker = throwingCtor
    __resetWorkerForTest()
    const onFallback = jest.fn()
    runLayoutOnWorker({
      nodes: [{ id: 'a' }],
      edges: [],
      opts: {},
      onTick: jest.fn(),
      onDone: jest.fn(),
      onFallback,
    })
    expect(onFallback).toHaveBeenCalledWith('worker-construct-failed')
  })

  it('terminates and falls back when no message arrives within timeout', () => {
    jest.useFakeTimers()
    const onFallback = jest.fn()
    runLayoutOnWorker({
      nodes: [{ id: 'a' }],
      edges: [],
      opts: {},
      onTick: jest.fn(),
      onDone: jest.fn(),
      onFallback,
      timeoutMs: 100,
    })
    jest.advanceTimersByTime(101)
    expect(onFallback).toHaveBeenCalledWith('worker-timeout')
    expect(FakeWorker.lastInstance?.terminated).toBe(true)
    jest.useRealTimers()
  })
})
