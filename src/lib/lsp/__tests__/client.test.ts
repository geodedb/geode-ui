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

class MockWebSocket {
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
    setTimeout(() => {
      this.onopen?.({})
    }, 0)
  }
}

let originalWS: any

beforeEach(() => {
  originalWS = (globalThis as any).WebSocket
  // eslint-disable-next-line semi-style -- prettier emits the leading-semicolon protector
  ;(globalThis as any).WebSocket = MockWebSocket
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
})
