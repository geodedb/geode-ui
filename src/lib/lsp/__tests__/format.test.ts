// Reproduction tests for the v0.5.18 LSP formatting wiring.
//
// startLspClient must forward an optional `format` object verbatim
// inside initializationOptions so the server (parsed at
// src/cli/lsp/server.zig:600-628) picks up indentSize, maxLineLength,
// minPropertiesToFold, and foldPropertyMaps. Omitting `format` MUST
// NOT add the key — older servers ignore unknown keys but we still
// keep the wire minimal.

jest.mock('vscode-ws-jsonrpc', () => {
  class FakeReader {
    dispose = jest.fn()
  }
  class FakeWriter {
    dispose = jest.fn()
  }
  return {
    __esModule: true,
    toSocket: jest.fn((ws: unknown) => ({ ws })),
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

// See client.test.ts for the rationale — the production client now
// lazy-imports this subpath to bootstrap @codingame/monaco-vscode-api
// before constructing a MonacoLanguageClient (otherwise v8 throws
// "Default api is not ready yet"). Stub so the dynamic-import in
// ensureVscodeServicesInitialized() resolves to a no-op under jest.
jest.mock(
  'monaco-languageclient/vscode/services',
  () => ({
    __esModule: true,
    initServices: jest.fn().mockResolvedValue(undefined),
  }),
  { virtual: true }
)

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

type Listener = (arg?: unknown) => void

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
    setTimeout(() => this.onopen?.({}), 0)
  }
}

let originalWS: unknown

beforeEach(() => {
  originalWS = (globalThis as unknown as { WebSocket: unknown }).WebSocket
  // eslint-disable-next-line semi-style -- prettier emits the leading-semicolon protector
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket
  // eslint-disable-next-line semi-style -- prettier emits the leading-semicolon protector
  ;(MonacoLanguageClient as unknown as jest.Mock).mockClear()
})

afterEach(() => {
  // eslint-disable-next-line no-extra-semi -- prettier emits the leading-semicolon protector
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = originalWS
})

describe('startLspClient v0.5.18 format options', () => {
  test('forwards format options under initializationOptions.format', async () => {
    const handle = await startLspClient({
      monaco: {} as never,
      url: 'ws://test/ws/lsp',
      accessToken: 'TKN',
      graph: 'demo',
      format: {
        indentSize: 4,
        maxLineLength: 120,
        minPropertiesToFold: 2,
        foldPropertyMaps: false,
      },
    })
    const ctor = MonacoLanguageClient as unknown as jest.Mock
    const cfg = ctor.mock.calls[0]![0]
    expect(cfg.clientOptions.initializationOptions.format).toEqual({
      indentSize: 4,
      maxLineLength: 120,
      minPropertiesToFold: 2,
      foldPropertyMaps: false,
    })
    // The pre-existing geode key remains beside the new format key.
    expect(cfg.clientOptions.initializationOptions.geode.authToken).toBe('TKN')
    await handle.dispose()
  })

  test('omits the format key when no format is supplied', async () => {
    const handle = await startLspClient({
      monaco: {} as never,
      url: 'ws://test/ws/lsp',
      accessToken: 'TKN',
      graph: 'demo',
    })
    const ctor = MonacoLanguageClient as unknown as jest.Mock
    const cfg = ctor.mock.calls[0]![0]
    expect(cfg.clientOptions.initializationOptions.format).toBeUndefined()
    await handle.dispose()
  })
})
