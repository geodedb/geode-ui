import { auth } from '../api/auth'

export type StreamMsg =
  | { kind: 'schema'; columns: { name: string; type: string }[] }
  | { kind: 'row'; row: unknown[] }
  | { kind: 'summary'; row_count: number; elapsed_ms: number }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'end' }

export type StreamHandle = {
  cancel: () => void
  done: Promise<void>
}

export function streamQuery(
  statement: string,
  graph: string | undefined,
  onMessage: (m: StreamMsg) => void,
): StreamHandle {
  const url = new URL('/ws/query', window.location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const token = auth.getToken()
  if (token) url.searchParams.set('access_token', token)
  const ws = new WebSocket(url.toString())

  let resolveDone: () => void = () => {}
  const done = new Promise<void>((r) => {
    resolveDone = r
  })

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ kind: 'start', statement, graph }))
  })
  ws.addEventListener('message', (ev: MessageEvent) => {
    try {
      onMessage(JSON.parse(ev.data) as StreamMsg)
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
