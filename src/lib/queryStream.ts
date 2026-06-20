import { getLatestToken } from '../api/connections'
import { getQueryStreamWorkerUrl } from './queryStreamWorkerUrl'
import { camelCaseStreamFrame } from './wireCase'

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

// PERF #297: shared parse-worker for the WS row-stream pipeline. The
// worker JSON.parses incoming WS frames off the main thread so a
// 100k-row stream doesn't blow ~50-150 ms of cumulative parse time
// onto the editor/results paint budget. One singleton across all
// active streamQuery() calls — the worker is stateless (each
// `parse` request carries its own seq + data), so concurrent calls
// don't interfere.
//
// Fallback: when Worker is unavailable (jsdom in some configs), CSP
// rejects the inline-blob URL, the worker module fails to compile,
// etc. — `workerDisabledForSession` flips to true and every
// streamQuery() call thereafter parses inline on the main thread.
// Matches the layoutWorker pattern in src/components/results/graph/
// useLayoutWorker.ts.
let parseWorkerSingleton: Worker | null = null
let parseWorkerDisabledForSession = false

function tryCreateParseWorker(): Worker | null {
  if (parseWorkerDisabledForSession) return null
  if (parseWorkerSingleton) return parseWorkerSingleton
  if (typeof Worker === 'undefined') {
    parseWorkerDisabledForSession = true
    return null
  }
  try {
    parseWorkerSingleton = new Worker(getQueryStreamWorkerUrl(), {
      type: 'module',
    })
    parseWorkerSingleton.onerror = (): void => {
      try {
        parseWorkerSingleton?.terminate()
      } catch {
        /* ignore */
      }
      parseWorkerSingleton = null
      parseWorkerDisabledForSession = true
    }
    return parseWorkerSingleton
  } catch {
    parseWorkerDisabledForSession = true
    return null
  }
}

// Internal test seam — same shape as useLayoutWorker.__resetWorkerForTest.
// eslint-disable-next-line no-underscore-dangle
export function __resetParseWorkerForTest(): void {
  try {
    parseWorkerSingleton?.terminate()
  } catch {
    /* ignore */
  }
  parseWorkerSingleton = null
  parseWorkerDisabledForSession = false
}

export type StreamMsg =
  | { kind: 'schema'; columns: { name: string; type: string }[] }
  | { kind: 'row'; row: unknown[] }
  // PERF-2026-05-11-04 (#137): the server already batches up to
  // wsRowBatchSize (64) rows into a single WS frame. queryStream now
  // forwards that whole batch as ONE 'rowBatch' message instead of
  // exploding it into N per-row callbacks — the reducer appends the
  // array in a single reduction (one rowsVersion bump per frame), so an
  // N-frame stream produces O(frames) dispatches, not O(rows).
  | { kind: 'rowBatch'; rows: unknown[][] }
  | { kind: 'summary'; row_count: number; elapsed_ms: number }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'end' }

// WireMsg is the shape received over the WebSocket. The server batches
// up to wsRowBatchSize rows into a single {"kind":"rows", rows:[...]}
// frame for throughput; queryStream maps that frame onto a single
// {kind:"rowBatch", rows:[...]} callback so the whole batch flows
// through one reducer dispatch.
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
  // browser session without any extra effort from the SPA.
  //
  // APP-07 (2026-05-24 appsec): the legacy localStorage-backed bearer
  // backout was retired. The subprotocol fallback is now driven from
  // the in-memory connection latch (`getLatestToken` from
  // src/api/connections.tsx), which mirrors the same `Authorization`
  // header the fetch wrapper attaches in cookie-mode. The bearer never
  // touches JS-readable storage.
  const token = getLatestToken()
  // Always offer the reserved, non-secret sentinel subprotocol. The
  // generated WS clients (gen/pkg/wsx: SubprotocolSentinel = "genapi.ws.v1")
  // always offer it so the server can echo a Sec-WebSocket-Protocol value
  // on the 101 handshake. Strict browsers FAIL the handshake when they
  // offer subprotocols but the server selects none — and the server
  // deliberately never echoes the genapi.auth.* bearer marker (doing so
  // would reflect the token; SEC-0011), so without the sentinel this
  // hand-rolled /ws/query client's handshake fails outright. The bearer
  // marker (when we hold an in-memory token) is consumed server-side from
  // the request header regardless of what gets echoed.
  const protocols: string[] = ['genapi.ws.v1']
  if (token) {
    const encoded = base64UrlEncode(token)
    protocols.push(`genapi.auth.bearer.${encoded}`)
  }
  const ws = new WebSocket(url.toString(), protocols)

  let resolveDone: () => void = () => {}
  const done = new Promise<void>((r) => {
    resolveDone = r
  })

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ kind: 'start', statement, graph }))
  })

  // PERF #297: forward parsed messages through the standard
  // rows→rowBatch mapping. Hoisted so both the worker-path response
  // handler and the main-thread fallback share the same dispatch.
  const dispatch = (wire: WireMsg): void => {
    if (wire.kind === 'rows') {
      onMessage({ kind: 'rowBatch', rows: wire.rows })
      return
    }
    onMessage(wire)
  }

  // PERF #297: per-stream sequence counter + parsed-response listener
  // bound while this stream is live. The shared worker is FIFO so
  // responses arrive in the same order requests were posted; we only
  // need to filter by `seq` so concurrent streamQuery() invocations
  // don't cross-talk.
  const parseWorker = tryCreateParseWorker()
  let nextSeq = 1
  const inflight = new Map<number, true>()
  const onWorkerMessage = (ev: MessageEvent): void => {
    const data = ev.data as
      | { kind: 'parsed'; seq: number; msg: unknown }
      | { kind: 'error'; seq: number; message: string }
      | null
    if (!data || (data.kind !== 'parsed' && data.kind !== 'error')) return
    if (!inflight.has(data.seq)) return
    inflight.delete(data.seq)
    if (data.kind === 'parsed') {
      try {
        dispatch(data.msg as WireMsg)
      } catch {
        /* malformed shape — same swallow as the pre-fix parse path */
      }
    }
    // `error` envelopes are swallowed silently to match the pre-fix
    // behaviour. Future telemetry can hook this branch without
    // changing the WS contract.
  }
  if (parseWorker) {
    parseWorker.addEventListener('message', onWorkerMessage)
  }

  ws.addEventListener('message', (ev: MessageEvent) => {
    if (parseWorker) {
      const seq = nextSeq
      nextSeq += 1
      inflight.set(seq, true)
      try {
        parseWorker.postMessage({ kind: 'parse', seq, data: ev.data })
        return
      } catch {
        // Worker dropped mid-stream (e.g. terminated by tab throttling
        // policies). Fall through to inline parse so we don't lose
        // the frame.
        inflight.delete(seq)
      }
    }
    // Fallback: synchronous main-thread parse. Same shape as the
    // pre-fix code path. camelCaseStreamFrame mirrors the worker-path
    // snake_case -> camelCase row normalisation so the no-worker fallback
    // produces identical data (genapi 0.11.1 parity with the sync client).
    try {
      dispatch(camelCaseStreamFrame(JSON.parse(ev.data)) as WireMsg)
    } catch {
      /* swallow */
    }
  })
  ws.addEventListener('close', () => {
    if (parseWorker) {
      parseWorker.removeEventListener('message', onWorkerMessage)
    }
    inflight.clear()
    resolveDone()
  })
  ws.addEventListener('error', () => {
    if (parseWorker) {
      parseWorker.removeEventListener('message', onWorkerMessage)
    }
    inflight.clear()
    resolveDone()
  })

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
