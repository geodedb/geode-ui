import { MonacoLanguageClient } from 'monaco-languageclient'
// `vscode-languageclient`'s package `main` is the node-only entry; the
// CloseAction / ErrorAction enums live in the common subpath, which is
// browser-safe.
import {
  CloseAction,
  ErrorAction,
} from 'vscode-languageclient/lib/common/client.js'
import { createWebSocketTransport, LspTransport } from './websocketTransport'

export interface StartOptions {
  monaco: typeof import('monaco-editor')
  url: string
  accessToken: string
  graph: string
  tenant?: string
}

export interface LspClientHandle {
  dispose: () => Promise<void>
}

export async function startLspClient(
  opts: StartOptions
): Promise<LspClientHandle> {
  const transport: LspTransport = await createWebSocketTransport({
    url: opts.url,
    accessToken: opts.accessToken,
  })

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

  await client.start()
  return {
    dispose: async () => {
      try {
        await client.stop()
      } catch {
        /* ignore */
      }
      transport.dispose()
    },
  }
}
