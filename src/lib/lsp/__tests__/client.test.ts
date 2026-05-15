jest.mock('vscode-ws-jsonrpc', () => {
  class FakeReader {
    dispose = jest.fn()
  }
  class FakeWriter {
    dispose = jest.fn()
  }
  return {
    __esModule: true,
    toSocket: jest.fn((ws: any) => ({ ws })),
    WebSocketMessageReader: FakeReader,
    WebSocketMessageWriter: FakeWriter,
  }
})

jest.mock('monaco-languageclient', () => ({
  __esModule: true,
  MonacoLanguageClient: jest.fn().mockImplementation((cfg) => ({
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    _cfg: cfg,
  })),
}))

// Stub the deep import we use for CloseAction / ErrorAction so jest doesn't try
// to resolve the node-only main of vscode-languageclient.
jest.mock(
  'vscode-languageclient/lib/common/client.js',
  () => ({
    __esModule: true,
    ErrorAction: { Continue: 1, Shutdown: 2 },
    CloseAction: { DoNotRestart: 1, Restart: 2 },
  }),
  { virtual: true }
)

import { MonacoLanguageClient } from 'monaco-languageclient'
import { startLspClient } from '../client'

type Listener = (arg?: any) => void

interface MockWs {
  url: string
  readyState: number
  onopen: Listener | null
  onmessage: Listener | null
  onclose: Listener | null
  onerror: Listener | null
  send: jest.Mock
  close: jest.Mock
  addEventListener: jest.Mock
  removeEventListener: jest.Mock
}

let originalWS: any
let latestWs: MockWs | null = null
let constructedWs: MockWs[] = []

function trackWs(ws: MockWs): void {
  latestWs = ws
  constructedWs.push(ws)
}

class MockWebSocket implements MockWs {
  url: string

  readyState = 1

  onopen: Listener | null = null

  onmessage: Listener | null = null

  onclose: Listener | null = null

  onerror: Listener | null = null

  send = jest.fn()

  close = jest.fn()

  addEventListener = jest.fn()

  removeEventListener = jest.fn()

  constructor(url: string) {
    this.url = url
    // Track the most recently constructed socket so tests can force
    // onclose / onerror from outside.
    trackWs(this)
    setTimeout(() => this.onopen?.({}), 0)
  }
}

beforeEach(() => {
  originalWS = (globalThis as any).WebSocket
  // eslint-disable-next-line semi-style -- prettier emits the leading-semicolon protector
  ;(globalThis as any).WebSocket = MockWebSocket
  latestWs = null
  constructedWs = []
  // eslint-disable-next-line semi-style -- prettier emits the leading-semicolon protector
  ;(MonacoLanguageClient as unknown as jest.Mock).mockClear()
})

afterEach(() => {
  // eslint-disable-next-line no-extra-semi -- prettier emits the leading-semicolon protector
  ;(globalThis as any).WebSocket = originalWS
})

describe('startLspClient', () => {
  test('passes geode.authToken in initializationOptions', async () => {
    const handle = await startLspClient({
      monaco: {} as any,
      url: 'ws://test/ws/lsp',
      accessToken: 'TKN',
      graph: 'demo',
      tenant: 'tA',
    })
    const mockCtor = MonacoLanguageClient as unknown as jest.Mock
    expect(mockCtor).toHaveBeenCalledTimes(1)
    const cfg = mockCtor.mock.calls[0]![0]
    expect(cfg.clientOptions.initializationOptions.geode).toEqual({
      authToken: 'TKN',
      graph: 'demo',
      tenant: 'tA',
    })
    await handle.dispose()
  })

  test('dispose stops the client and tears down the transport', async () => {
    const handle = await startLspClient({
      monaco: {} as any,
      url: 'ws://test/ws/lsp',
      accessToken: 'TKN',
      graph: 'demo',
    })
    const mockCtor = MonacoLanguageClient as unknown as jest.Mock
    const instance = mockCtor.mock.results[0]!.value
    await handle.dispose()
    expect(instance.stop).toHaveBeenCalled()
  })

  test('reconnects on transport close', async () => {
    const states: string[] = []
    const handle = await startLspClient({
      monaco: {} as any,
      url: 'ws://test/ws/lsp',
      accessToken: 'TKN',
      graph: 'demo',
      onStateChange: (s) => states.push(s),
    })
    const mockCtor = MonacoLanguageClient as unknown as jest.Mock
    expect(mockCtor).toHaveBeenCalledTimes(1)
    expect(states).toContain('connecting')
    expect(states).toContain('open')

    // Force a close on the active socket — schedules reconnect after 500ms.
    expect(latestWs).not.toBeNull()
    latestWs!.onclose?.()
    // Wait for the first backoff window (500ms) plus a margin for the new
    // socket's setTimeout(onopen, 0) and start() microtask.
    await new Promise((r) => {
      setTimeout(r, 700)
    })

    expect(states).toContain('closed')
    // Second 'connecting' from the retry path.
    expect(
      states.filter((s) => s === 'connecting').length
    ).toBeGreaterThanOrEqual(2)
    expect(mockCtor).toHaveBeenCalledTimes(2)
    await handle.dispose()
  })

  test('emits failed after maxRetries exhausted', async () => {
    const states: string[] = []
    // Make every WebSocket immediately fail to "open" so each connect
    // attempt counts as a closed/failed transport. We replace the WebSocket
    // class entirely instead of subclassing so the base constructor's
    // setTimeout(onopen) never fires.
    class FailingWs {
      url: string

      readyState = 3

      onopen: Listener | null = null

      onmessage: Listener | null = null

      onclose: Listener | null = null

      onerror: Listener | null = null

      send = jest.fn()

      close = jest.fn()

      addEventListener = jest.fn()

      removeEventListener = jest.fn()

      constructor(url: string) {
        this.url = url
        trackWs(this)
        setTimeout(() => this.onerror?.({ type: 'error' }), 0)
      }
    }
    // eslint-disable-next-line no-extra-semi -- prettier emits the leading-semicolon protector
    ;(globalThis as any).WebSocket = FailingWs

    const handle = await startLspClient({
      monaco: {} as any,
      url: 'ws://test/ws/lsp',
      accessToken: 'TKN',
      graph: 'demo',
      maxRetries: 2,
      onStateChange: (s) => states.push(s),
    })
    // Wait long enough for both retries (500 + 1500) plus margin.
    await new Promise((r) => {
      setTimeout(r, 2400)
    })
    expect(states).toContain('failed')
    // No further attempts after 'failed' — record the count snapshot.
    const failedAt = states.indexOf('failed')
    const afterFailed = states.slice(failedAt + 1)
    expect(afterFailed.filter((s) => s === 'connecting').length).toBe(0)
    await handle.dispose()
  })

  test('dispose during backoff prevents further reconnect attempts', async () => {
    const states: string[] = []
    const handle = await startLspClient({
      monaco: {} as any,
      url: 'ws://test/ws/lsp',
      accessToken: 'TKN',
      graph: 'demo',
      onStateChange: (s) => states.push(s),
    })
    const mockCtor = MonacoLanguageClient as unknown as jest.Mock
    const ctorCallsBeforeClose = mockCtor.mock.calls.length
    // Force a close, then dispose immediately — the scheduled reconnect
    // timer should be cancelled and no new client constructed.
    latestWs!.onclose?.()
    await handle.dispose()
    // Wait past the first backoff window.
    await new Promise((r) => {
      setTimeout(r, 700)
    })
    expect(mockCtor.mock.calls.length).toBe(ctorCallsBeforeClose)
  })
})
