import { MonacoLanguageClient } from 'monaco-languageclient'
// `vscode-languageclient`'s package `main` is the node-only entry; the
// CloseAction / ErrorAction enums live in the common subpath, which is
// browser-safe.
import {
  CloseAction,
  ErrorAction,
} from 'vscode-languageclient/lib/common/client.js'
import { createWebSocketTransport, LspTransport } from './websocketTransport'

export type LspState = 'connecting' | 'open' | 'closed' | 'failed'

export interface StartOptions {
  monaco: typeof import('monaco-editor')
  url: string
  accessToken: string
  graph: string
  tenant?: string
  onStateChange?: (s: LspState) => void
  /** Maximum number of reconnect attempts after a transport close. Default 3. */
  maxRetries?: number
}

export interface LspClientHandle {
  dispose: () => Promise<void>
}

// PERF #254: equal-jitter base delays. The actual scheduled delay is
// base/2 + rand*base/2 so the lower bound is half the table value and
// the upper bound is the table value itself. With N clients
// reconnecting at once (e.g. server reboot) this spreads the herd over
// a base/2-wide window instead of pinning them all to the same instant.
const RECONNECT_BACKOFF_MS = [500, 1500, 4500]

export async function startLspClient(
  opts: StartOptions
): Promise<LspClientHandle> {
  const maxRetries = opts.maxRetries ?? 3
  const emitState = (s: LspState) => {
    try {
      opts.onStateChange?.(s)
    } catch {
      /* ignore listener errors */
    }
  }

  // Mutable per-handle state. `disposed` guards both the active connection
  // and any pending reconnect timer; once true, no further attempts happen.
  let disposed = false
  let activeClient: MonacoLanguageClient | null = null
  let activeTransport: LspTransport | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let retryCount = 0

  const teardownActive = async () => {
    const client = activeClient
    const transport = activeTransport
    activeClient = null
    activeTransport = null
    if (client) {
      try {
        await client.stop()
      } catch {
        /* ignore */
      }
    }
    if (transport) {
      try {
        transport.dispose()
      } catch {
        /* ignore */
      }
    }
  }

  const scheduleReconnect = () => {
    if (disposed) return
    if (retryCount >= maxRetries) {
      emitState('failed')
      return
    }
    // PERF #254 equal-jitter: spread the retry burst over a base/2
    // window so simultaneous reconnects from many clients don't pin
    // the server with a thundering herd. base is the table value;
    // delay = base/2 + rand*base/2. Floor to ms to keep the value
    // integer for setTimeout.
    const base = RECONNECT_BACKOFF_MS[
      Math.min(retryCount, RECONNECT_BACKOFF_MS.length - 1)
    ] as number
    const half = base / 2
    const delay = Math.floor(half + Math.random() * half)
    retryCount += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (disposed) return
      connect().catch(() => {
        /* swallow — connect() handles its own backoff */
      })
    }, delay)
  }

  const connect = async (): Promise<void> => {
    if (disposed) return
    emitState('connecting')

    let transport: LspTransport
    try {
      transport = await createWebSocketTransport({
        url: opts.url,
        accessToken: opts.accessToken,
      })
    } catch {
      // Transport failed to open; treat as a closed event and back off.
      emitState('closed')
      scheduleReconnect()
      return
    }

    if (disposed) {
      try {
        transport.dispose()
      } catch {
        /* ignore */
      }
      return
    }

    // Hook onclose so an unexpected drop triggers a reconnect attempt.
    const sock = transport.socket as WebSocket & {
      onclose: ((ev?: unknown) => void) | null
    }
    const previousOnClose = sock.onclose
    sock.onclose = (ev?: unknown) => {
      try {
        previousOnClose?.(ev as never)
      } catch {
        /* ignore */
      }
      if (disposed) return
      // Only react if this is still the active transport (avoids races
      // when teardownActive() races with a natural close).
      if (transport !== activeTransport) return
      emitState('closed')
      // Tear down the now-defunct client/transport before reconnecting.
      // Don't await — teardown shouldn't block the reconnect schedule.
      teardownActive().catch(() => {
        /* ignore */
      })
      scheduleReconnect()
    }

    const client = new MonacoLanguageClient({
      name: 'Geode GQL',
      clientOptions: {
        documentSelector: ['gql'],
        errorHandler: {
          error: () => ({ action: ErrorAction.Continue }),
          closed: () => ({ action: CloseAction.DoNotRestart }),
        },
        initializationOptions: {
          geode: {
            authToken: opts.accessToken,
            graph: opts.graph,
            tenant: opts.tenant,
          },
        },
      },
      connectionProvider: {
        get: () =>
          Promise.resolve({
            reader: transport.reader,
            writer: transport.writer,
          }),
      },
    })

    activeTransport = transport
    activeClient = client

    try {
      await client.start()
    } catch {
      if (disposed) return
      emitState('closed')
      // start() failed — tear down and back off.
      activeClient = null
      activeTransport = null
      try {
        await client.stop()
      } catch {
        /* ignore */
      }
      try {
        transport.dispose()
      } catch {
        /* ignore */
      }
      scheduleReconnect()
      return
    }

    if (disposed) {
      await teardownActive()
      return
    }

    // Successful start — reset retry counter so a future drop gets a full
    // backoff budget.
    retryCount = 0
    emitState('open')
  }

  await connect()

  return {
    dispose: async () => {
      if (disposed) return
      disposed = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      await teardownActive()
    },
  }
}
