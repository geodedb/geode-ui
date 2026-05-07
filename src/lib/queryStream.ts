import { auth } from '../api/auth'

// base64UrlEncode produces an unpadded base64url encoding of the given UTF-8
// string. Matches encoding/base64.RawURLEncoding on the server side so the
// `genapi.auth.bearer.<encoded>` subprotocol round-trips cleanly.
function base64UrlEncode(value: string): string {
  // Convert UTF-8 string -> base64 via TextEncoder + binary string trick.
  const bytes = new TextEncoder().encode(value)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i] as number)
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export type StreamMsg =
  | { kind: 'schema'; columns: { name: string; type: string }[] }
  | { kind: 'row'; row: unknown[] }
  | { kind: 'summary'; row_count: number; elapsed_ms: number }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'end' }

// WireMsg is the shape received over the WebSocket. The server batches
// up to wsRowBatchSize rows into a single {"kind":"rows", rows:[...]}
// frame for throughput; queryStream demultiplexes those back into
// individual {kind:"row"} callbacks so existing consumers (QueryPage,
// queryStream.test.ts) keep their per-row handler contract.
type WireMsg = StreamMsg | { kind: 'rows'; rows: unknown[][] }

export type StreamHandle = {
  cancel: () => void
  done: Promise<void>
}

export function streamQuery(
  statement: string,
  graph: string | undefined,
  onMessage: (m: StreamMsg) => void
): StreamHandle {
  const url = new URL('/ws/query', window.location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  // SEC-F7 (#62 S3c): same-origin WebSocket connections automatically
  // include cookies on the upgrade request, so the server-side AuthJWT
  // (which now reads the geode-ui-auth cookie) authenticates the
  // browser session without any extra effort from the SPA. We retain
  // the genapi.auth.bearer.<base64url(token)> subprotocol as a
  // fallback for the legacy backout flag — when an operator has set
  // localStorage['geode-ui.legacy-auth']='1', auth.getToken() returns
  // the stored JWT and we attach it via the subprotocol channel just
  // like the pre-cookie SPA did.
  const token = auth.getToken()
  const protocols: string[] = []
  if (token) {
    const encoded = base64UrlEncode(token)
    protocols.push(`genapi.auth.bearer.${encoded}`)
  }
  const ws =
    protocols.length > 0
      ? new WebSocket(url.toString(), protocols)
      : new WebSocket(url.toString())

  let resolveDone: () => void = () => {}
  const done = new Promise<void>((r) => {
    resolveDone = r
  })

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ kind: 'start', statement, graph }))
  })
  ws.addEventListener('message', (ev: MessageEvent) => {
    try {
      const wire = JSON.parse(ev.data) as WireMsg
      if (wire.kind === 'rows') {
        // Demultiplex a batched-rows frame into individual row
        // callbacks so consumers keep the per-row contract.
        wire.rows.forEach((row) => onMessage({ kind: 'row', row }))
        return
      }
      onMessage(wire)
    } catch {
      /* swallow */
    }
  })
  ws.addEventListener('close', () => resolveDone())
  ws.addEventListener('error', () => resolveDone())

  return {
    cancel: () => {
      try {
        ws.send(JSON.stringify({ kind: 'cancel' }))
      } catch {
        /* ignore */
      }
      ws.close()
    },
    done,
  }
}
