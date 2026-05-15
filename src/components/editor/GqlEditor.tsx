import React, { useEffect, useRef } from 'react'
import Editor, { OnMount } from '@monaco-editor/react'
import { GQL_LANGUAGE_ID, registerGqlLanguage } from './gqlLanguage'
import type { LspClientHandle } from '../../lib/lsp/client'
import { useAuth } from '../../auth/AuthProvider'

type Props = {
  value: string
  onChange: (s: string) => void
  onRun: () => void
  height?: number
  graph?: string
  tenant?: string
}

export const GqlEditor: React.FC<Props> = ({
  value,
  onChange,
  onRun,
  height = 240,
  graph,
  tenant,
}) => {
  const lspRef = useRef<LspClientHandle | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const { token } = useAuth()

  const handleMount: OnMount = (editor, monaco) => {
    registerGqlLanguage(monaco)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, onRun)
    monacoRef.current = monaco as unknown as typeof import('monaco-editor')
  }

  // Re-create the LSP client whenever the auth token, graph, or tenant
  // changes. Tearing down + starting fresh is simpler (and matches the
  // monaco-languageclient lifecycle, which doesn't support reusing a
  // started client with a new transport).
  useEffect(() => {
    if (!token || !monacoRef.current) return undefined
    let cancelled = false
    // eslint-disable-next-line semi-style -- prettier emits the leading-semicolon protector
    ;(async () => {
      // Tear down any previous client first.
      const prev = lspRef.current
      lspRef.current = null
      if (prev) {
        try {
          await prev.dispose()
        } catch {
          /* ignore */
        }
      }
      if (cancelled) return
      try {
        const proto =
          typeof window !== 'undefined' && window.location.protocol === 'https:'
            ? 'wss'
            : 'ws'
        const host =
          typeof window !== 'undefined' ? window.location.host : 'localhost'
        // Lazy import keeps monaco-languageclient (ESM-only) out of the
        // top-level dependency graph so jest's CJS transformer doesn't
        // choke on it in tests that render parents of <GqlEditor/>.
        const { startLspClient } = await import('../../lib/lsp/client')
        if (cancelled) return
        const handle = await startLspClient({
          monaco: monacoRef.current!,
          url: `${proto}://${host}/ws/lsp`,
          accessToken: token,
          graph: graph || 'default',
          tenant,
          onStateChange: (s) => {
            // eslint-disable-next-line no-console
            console.debug('[lsp] state =', s)
          },
        })
        if (cancelled) {
          handle.dispose().catch(() => {
            /* ignore */
          })
          return
        }
        lspRef.current = handle
      } catch (e) {
        // Editor still works without LSP — surface a console warning.
        // eslint-disable-next-line no-console
        console.warn('LSP client failed to start', e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, graph, tenant])

  useEffect(
    () => () => {
      const handle = lspRef.current
      lspRef.current = null
      // Fire-and-forget; dispose() is async but unmount can't await.
      handle?.dispose().catch(() => {
        /* ignore */
      })
    },
    []
  )

  return (
    <Editor
      height={height}
      language={GQL_LANGUAGE_ID}
      theme="vs-dark"
      value={value}
      onChange={(v) => onChange(v ?? '')}
      onMount={handleMount}
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        scrollBeyondLastLine: false,
      }}
    />
  )
}
