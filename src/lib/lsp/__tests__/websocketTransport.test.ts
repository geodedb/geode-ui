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

import { createWebSocketTransport } from '../websocketTransport'

type Listener = (arg?: any) => void

class MockWebSocket {
  url: string

  readyState = 1

  onopen: Listener | null = null

  onmessage: Listener | null = null

  onclose: Listener | null = null

  onerror: Listener | null = null

  listeners: Record<string, Listener[]> = {}

  send = jest.fn()

  close = jest.fn()

  constructor(url: string) {
    this.url = url
    setTimeout(() => {
      this.onopen?.({})
      // eslint-disable-next-line semi-style -- prettier emits the leading-semicolon protector
      ;(this.listeners.open || []).forEach((cb) => cb({}))
    }, 0)
  }

  addEventListener(type: string, cb: Listener): void {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type]!.push(cb)
  }

  removeEventListener(type: string, cb: Listener): void {
    const list = this.listeners[type]
    if (!list) return
    this.listeners[type] = list.filter((c) => c !== cb)
  }
}

let originalWS: any

beforeEach(() => {
  originalWS = (globalThis as any).WebSocket
  // eslint-disable-next-line semi-style -- prettier emits the leading-semicolon protector
  ;(globalThis as any).WebSocket = MockWebSocket
})

afterEach(() => {
  // eslint-disable-next-line no-extra-semi -- prettier emits the leading-semicolon protector
  ;(globalThis as any).WebSocket = originalWS
})

describe('createWebSocketTransport', () => {
  test('opens WebSocket with access_token in query string', async () => {
    const t = await createWebSocketTransport({
      url: 'ws://test/ws/lsp',
      accessToken: 'TKN',
    })
    expect(t.socket.url).toContain('access_token=TKN')
    t.dispose()
  })

  test('dispose closes the underlying socket', async () => {
    const t = await createWebSocketTransport({
      url: 'ws://test/ws/lsp',
      accessToken: 'TKN',
    })
    const sock = t.socket as unknown as MockWebSocket
    t.dispose()
    expect(sock.close).toHaveBeenCalled()
  })

  test('rejects when WebSocket errors before open', async () => {
    class ErrWS {
      url: string

      readyState = 0

      onopen: Listener | null = null

      onerror: Listener | null = null

      onclose: Listener | null = null

      onmessage: Listener | null = null

      send = jest.fn()

      close = jest.fn()

      addEventListener = jest.fn()

      removeEventListener = jest.fn()

      constructor(url: string) {
        this.url = url
        setTimeout(() => {
          this.onerror?.({ message: 'fail' })
        }, 0)
      }
    }
    // eslint-disable-next-line no-extra-semi -- prettier emits the leading-semicolon protector
    ;(globalThis as any).WebSocket = ErrWS
    await expect(
      createWebSocketTransport({ url: 'ws://test/ws/lsp', accessToken: 'X' })
    ).rejects.toBeDefined()
  })
})
