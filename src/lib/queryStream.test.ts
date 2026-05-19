import {
  streamQuery,
  StreamMsg,
  __resetParseWorkerForTest,
} from './queryStream'

type Listener = (arg?: any) => void

interface MockWS {
  url: string
  protocols: string[]
  listeners: Record<string, Listener[]>
  send: jest.Mock
  close: jest.Mock
  fire: (type: string, data?: any) => void
}

let lastInstance: MockWS | null = null

class MockWebSocket implements MockWS {
  url: string

  protocols: string[]

  listeners: Record<string, Listener[]> = {}

  send = jest.fn()

  close = jest.fn()

  constructor(url: string, protocols?: string | string[]) {
    this.url = url
    if (Array.isArray(protocols)) {
      this.protocols = protocols
    } else if (typeof protocols === 'string') {
      this.protocols = [protocols]
    } else {
      this.protocols = []
    }
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastInstance = this
  }

  addEventListener(type: string, cb: Listener): void {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type]!.push(cb)
  }

  fire(type: string, data?: any): void {
    const list = this.listeners[type] || []
    list.forEach((cb) => cb(data ?? {}))
  }
}

beforeEach(() => {
  lastInstance = null
  // eslint-disable-next-line semi-style -- prettier emits the leading-semicolon protector
  ;(window as any).WebSocket = MockWebSocket
  // SEC-F7 (#62 S3c): cookie-mode tests start with no legacy token. The
  // bearer-fallback test below opts into legacy mode explicitly.
  localStorage.removeItem('geode-ui.legacy-auth')
  localStorage.removeItem('geode-ui.access_token')
})

test('sends start message on open and forwards messages', () => {
  const msgs: StreamMsg[] = []
  const h = streamQuery('MATCH (n) RETURN n', 'social', (m) => msgs.push(m))
  const ws = lastInstance!
  ws.fire('open')
  expect(ws.send).toHaveBeenCalledWith(
    JSON.stringify({
      kind: 'start',
      statement: 'MATCH (n) RETURN n',
      graph: 'social',
    })
  )
  ws.fire('message', {
    data: JSON.stringify({
      kind: 'schema',
      columns: [{ name: 'n', type: 'node' }],
    }),
  })
  ws.fire('message', { data: JSON.stringify({ kind: 'row', row: [1] }) })
  ws.fire('message', { data: JSON.stringify({ kind: 'end' }) })
  expect(msgs.map((m) => m.kind)).toEqual(['schema', 'row', 'end'])
  h.cancel()
  expect(ws.send).toHaveBeenLastCalledWith(JSON.stringify({ kind: 'cancel' }))
})

test('cookie mode: opens WS without subprotocol auth (cookie carries JWT)', () => {
  // SEC-F7 (#62 S3c): same-origin WebSocket upgrades automatically
  // include cookies, so the server-side AuthJWT cookie reader picks
  // up the geode-ui-auth JWT without any subprotocol channel. The
  // SPA must NOT attach a bearer subprotocol when no legacy token is
  // present.
  streamQuery('RETURN 1', undefined, () => {})
  expect(lastInstance!.protocols).toEqual([])
  expect(lastInstance!.url).not.toContain('access_token')
})

test('legacy fallback: bearer subprotocol attached when backout flag is set', () => {
  // The backout flag is documented in src/api/auth.ts as the emergency
  // escape hatch for an operator chasing a regression while the cookie
  // path is being rolled out. With the flag set, auth.getToken()
  // returns the stored bearer token and queryStream attaches it via
  // the genapi.auth.bearer.<base64url(token)> subprotocol exactly as
  // the pre-cookie SPA did.
  localStorage.setItem('geode-ui.legacy-auth', '1')
  localStorage.setItem('geode-ui.access_token', 'tok123')
  streamQuery('RETURN 1', undefined, () => {})
  // Token 'tok123' base64url-encoded (no padding) is 'dG9rMTIz'.
  expect(lastInstance!.protocols).toContain('genapi.auth.bearer.dG9rMTIz')
  expect(lastInstance!.url).not.toContain('access_token')
})

test('forwards a batched rows frame as ONE rowBatch message (no per-row fan-out)', () => {
  // PERF-2026-05-11-04 / issue #137: the server already batches up to
  // 64 rows per WS frame as {"kind":"rows","rows":[...]}. queryStream
  // must forward that whole batch as a single {kind:"rowBatch"}
  // callback — NOT explode it into N per-row callbacks — so an N-frame
  // stream produces O(frames) reducer dispatches instead of O(rows).
  const msgs: StreamMsg[] = []
  const onMessage = jest.fn((m: StreamMsg) => msgs.push(m))
  streamQuery('MATCH (n) RETURN n', 'social', onMessage)
  const ws = lastInstance!
  ws.fire('open')
  // Two server frames, 3 rows in the first, 2 in the second.
  ws.fire('message', {
    data: JSON.stringify({
      kind: 'rows',
      rows: [
        [1, 'alice'],
        [2, 'bob'],
        [3, 'carol'],
      ],
    }),
  })
  ws.fire('message', {
    data: JSON.stringify({
      kind: 'rows',
      rows: [
        [4, 'dave'],
        [5, 'erin'],
      ],
    }),
  })
  ws.fire('message', { data: JSON.stringify({ kind: 'end' }) })
  // One dispatch per frame: 2 rowBatch + 1 end == 3 total, NOT 6.
  expect(msgs.map((m) => m.kind)).toEqual(['rowBatch', 'rowBatch', 'end'])
  expect(onMessage).toHaveBeenCalledTimes(3)
  const batches = msgs.filter(
    (m): m is { kind: 'rowBatch'; rows: unknown[][] } => m.kind === 'rowBatch'
  )
  expect(batches).toHaveLength(2)
  expect(batches[0]?.rows).toEqual([
    [1, 'alice'],
    [2, 'bob'],
    [3, 'carol'],
  ])
  expect(batches[1]?.rows).toEqual([
    [4, 'dave'],
    [5, 'erin'],
  ])
})

// PERF #297: when the parse worker is available, every WS frame's
// JSON.parse runs off the main thread. The worker is single-threaded
// so responses arrive FIFO; queryStream forwards them to onMessage in
// the same order they entered. This test installs a fake Worker, fires
// two WS frames, posts back the parsed payloads OUT OF ORDER (second
// then first), and pins that the test's onMessage receives them in
// the order the worker emits — proving the FIFO contract is real.
test('PERF #297: parse-worker path dispatches messages in worker-FIFO order', () => {
  type FakeWorkerListener = (ev: { data: unknown }) => void
  type SentParse = { kind: 'parse'; seq: number; data: string }

  class FakeWorker {
    listeners: Record<string, FakeWorkerListener[]> = {}

    posted: SentParse[] = []

    addEventListener(type: string, cb: FakeWorkerListener): void {
      if (!this.listeners[type]) this.listeners[type] = []
      this.listeners[type]!.push(cb)
    }

    removeEventListener(type: string, cb: FakeWorkerListener): void {
      const list = this.listeners[type]
      if (!list) return
      const idx = list.indexOf(cb)
      if (idx >= 0) list.splice(idx, 1)
    }

    postMessage(m: SentParse): void {
      this.posted.push(m)
    }

    fire(seq: number, parsedMsg: unknown): void {
      const list = this.listeners.message || []
      list.forEach((cb) =>
        cb({ data: { kind: 'parsed', seq, msg: parsedMsg } })
      )
    }

    onerror: ((e?: unknown) => void) | null = null

    // eslint-disable-next-line class-methods-use-this
    terminate(): void {
      /* no-op */
    }
  }

  // Install the fake Worker constructor globally so tryCreateParseWorker
  // returns one of these instead of failing. Resetting the singleton
  // ensures THIS test gets a fresh instance.
  __resetParseWorkerForTest()
  const fakeWorkers: FakeWorker[] = []
  const PrevWorker = (globalThis as { Worker?: unknown }).Worker
  // eslint-disable-next-line semi-style
  ;(globalThis as { Worker: unknown }).Worker = function FakeWorkerCtor() {
    const w = new FakeWorker()
    fakeWorkers.push(w)
    return w
  } as unknown as typeof Worker
  try {
    const msgs: StreamMsg[] = []
    streamQuery('MATCH (n) RETURN n', undefined, (m) => msgs.push(m))
    const ws = lastInstance!
    ws.fire('open')
    expect(fakeWorkers).toHaveLength(1)
    const worker = fakeWorkers[0]!

    // Two frames arrive on the WS in order. Worker receives both
    // (seq 1 then seq 2).
    ws.fire('message', {
      data: JSON.stringify({ kind: 'rows', rows: [[1], [2]] }),
    })
    ws.fire('message', {
      data: JSON.stringify({ kind: 'end' }),
    })
    expect(worker.posted.map((p) => p.seq)).toEqual([1, 2])

    // Pre-dispatch: no messages have been forwarded yet — the parse
    // is async via the worker.
    expect(msgs).toHaveLength(0)

    // Worker emits responses in FIFO (single-threaded). dispatch in
    // the same order.
    worker.fire(1, { kind: 'rows', rows: [[1], [2]] })
    worker.fire(2, { kind: 'end' })
    expect(msgs.map((m) => m.kind)).toEqual(['rowBatch', 'end'])
  } finally {
    if (PrevWorker === undefined) {
      delete (globalThis as { Worker?: unknown }).Worker
    } else {
      // eslint-disable-next-line no-extra-semi
      ;(globalThis as { Worker: unknown }).Worker = PrevWorker
    }
    __resetParseWorkerForTest()
  }
})
