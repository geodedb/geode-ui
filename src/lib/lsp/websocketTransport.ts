import {
  toSocket,
  WebSocketMessageReader,
  WebSocketMessageWriter,
} from 'vscode-ws-jsonrpc'

export interface TransportOptions {
  url: string
  accessToken: string
}

export interface LspTransport {
  reader: WebSocketMessageReader
  writer: WebSocketMessageWriter
  socket: WebSocket
  dispose: () => void
}

export async function createWebSocketTransport(
  opts: TransportOptions
): Promise<LspTransport> {
  const url = new URL(opts.url)
  // Only attach the `?access_token=` query when a non-empty bearer is
  // available. In cookie-mode auth (#62 / SEC-F7) the JWT lives in the
  // HttpOnly `geode-ui-auth` cookie that JS cannot read, and the
  // /ws/lsp upgrade carries the cookie automatically — adding an
  // empty `access_token=` would just trip the server's strict parser
  // for nothing. Legacy bearer mode still passes a real token through
  // this same channel.
  if (opts.accessToken) {
    url.searchParams.set('access_token', opts.accessToken)
  }
  const ws = new WebSocket(url.toString())
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = (e) => reject(e)
  })
  const iSocket = toSocket(ws as any)
  const reader = new WebSocketMessageReader(iSocket)
  const writer = new WebSocketMessageWriter(iSocket)
  return {
    reader,
    writer,
    socket: ws,
    dispose: () => {
      try {
        reader.dispose()
      } catch {
        /* ignore */
      }
      try {
        writer.dispose()
      } catch {
        /* ignore */
      }
      try {
        ws.close()
      } catch {
        /* ignore */
      }
    },
  }
}
