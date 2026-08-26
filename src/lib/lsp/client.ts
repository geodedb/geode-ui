import { MonacoLanguageClient } from 'monaco-languageclient'
// vscode-languageclient v10's root export is the browser-safe common
// api (lib/common/api), which re-exports the CloseAction / ErrorAction
// enums; the old ./lib/common/client.js deep path is no longer allowed
// by its exports map. TS (moduleResolution "node") resolves the bare
// specifier via the tsconfig paths mapping. (eslint's import resolver,
// like TS's node10 resolution, cannot see the exports-map-only entry.)
// eslint-disable-next-line import/no-unresolved
import { CloseAction, ErrorAction } from 'vscode-languageclient'
import { createWebSocketTransport, LspTransport } from './websocketTransport'

// monaco-languageclient v8 requires the @codingame/monaco-vscode-api
// services to be initialized before a MonacoLanguageClient instance
// can `start()`. Pre-fix this initialization was missing entirely,
// so the first attempted client.start() threw "Default api is not
// ready yet, do not forget to import 'vscode/localExtensionHost' and
// wait for services initialization" and the LSP transport silently
// died. (Diagnostics never published, formatter never registered —
// `editor.action.formatDocument` became a no-op.) See
// https://github.com/TypeFox/monaco-languageclient/blob/main/docs/
// versions-and-history.md for the v2→v8 architectural change.
//
// The minimum service set for an LSP-based language with formatting
// + diagnostics is `languages` + `model` + `environment` + `files`.
// `quickAccess` is added so the cmd-palette-style picker doesn't
// throw if a hover provider's action invokes one. Service-override
// modules are dynamically imported alongside the client startup so
// the lazy `gql-editor` chunk is the only place the @codingame
// surface is reachable from — main bundle stays unaffected.
//
// Initialization is single-flighted across the whole process via a
// module-level promise. monaco-languageclient's `start()` can be
// called many times across a session (reconnects, graph switches,
// tenant flips), but the vscode-api bootstrap is one-shot.
let servicesInitPromise: Promise<void> | null = null
function ensureVscodeServicesInitialized(): Promise<void> {
  if (servicesInitPromise) return servicesInitPromise
  servicesInitPromise = (async () => {
    // monaco-languageclient ships a `vscode/services` subpath that
    // wraps the @codingame/monaco-vscode-api bootstrap (initEnhanced
    // MonacoEnvironment, side-effect-imports `vscode/localExtensionHost`,
    // merges the always-on services, and calls the underlying
    // `initialize`). Calling `initServices({})` is the supported
    // one-liner that the error message "Default api is not ready yet,
    // do not forget to import 'vscode/localExtensionHost' and wait
    // for services initialization" prescribes. The empty
    // serviceConfig is fine for a basic LSP-formatter + diagnostics
    // client — monaco-languageclient adds its required languages +
    // model overrides internally.
    // ESLint's `import/no-unresolved` doesn't follow monaco-languageclient's
    // `exports` map for `./vscodeApiWrapper`. The subpath resolves at
    // runtime (webpack honors `exports`) and unit tests virtual-mock
    // the same string. Disable the rule via the next-line directive
    // immediately above the import (the rule is line-scoped).
    //
    // monaco-languageclient v10 replaced the `vscode/services`
    // initServices() one-liner with MonacoVscodeApiWrapper.start();
    // `$type: 'classic'` + EditorService views is the equivalent of
    // the old minimal bootstrap (the wrapper merges the always-on
    // languages/log/model/configuration services itself).
    const { MonacoVscodeApiWrapper } = await import(
      // eslint-disable-next-line import/no-unresolved
      /* webpackChunkName: "vscode-services" */ 'monaco-languageclient/vscodeApiWrapper'
    )
    const wrapper = new MonacoVscodeApiWrapper({
      $type: 'classic',
      viewsConfig: { $type: 'EditorService' },
    })
    await wrapper.start({ caller: 'geode-ui:GqlEditor' })
  })()
  // If init fails, reset the cache so the next attempt retries instead
  // of inheriting a poisoned rejected promise.
  servicesInitPromise.catch(() => {
    servicesInitPromise = null
  })
  return servicesInitPromise
}

export type LspState = 'connecting' | 'open' | 'closed' | 'failed'

/**
 * LSP formatting options as parsed by the Geode v0.5.18 server
 * (src/cli/lsp/server.zig:600-628). Keys are camelCase to match the
 * server's JSON parser. Threading these through initializationOptions
 * lets a client tune the formatter without renegotiating the
 * connection.
 */
export interface LspFormatOptions {
  indentSize?: number
  maxLineLength?: number
  minPropertiesToFold?: number
  foldPropertyMaps?: boolean
}

export interface StartOptions {
  monaco: typeof import('monaco-editor')
  url: string
  accessToken: string
  graph: string
  tenant?: string
  /**
   * Optional formatting options sent in `initializationOptions.format`.
   * Geode v0.5.18+ uses them to configure the document formatter.
   * Older servers ignore the field.
   */
  format?: LspFormatOptions
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
  // Bootstrap the @codingame/monaco-vscode-api services exactly once
  // per process before the first MonacoLanguageClient instance can
  // `start()`. See `ensureVscodeServicesInitialized` comment for why.
  // A rejected init poisons the LSP entirely; surface the error
  // through `onStateChange('failed')` rather than throwing so the
  // caller's UI can render an editor-without-LSP rather than crash.
  try {
    await ensureVscodeServicesInitialized()
  } catch {
    opts.onStateChange?.('failed')
    return {
      dispose: async () => {
        /* nothing to dispose; init never completed */
      },
    }
  }
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
          // The Geode v0.5.18 LSP server parses this `format` key
          // (server.zig:600-628). Older servers ignore unknown init
          // options, so the wire is forward- and backward-compatible.
          ...(opts.format ? { format: opts.format } : {}),
        },
      },
      // monaco-languageclient v10 replaced the lazy connectionProvider
      // with directly supplied messageTransports.
      messageTransports: {
        reader: transport.reader,
        writer: transport.writer,
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
