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
  const { token } = useAuth()

  const handleMount: OnMount = async (editor, monaco) => {
    registerGqlLanguage(monaco)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, onRun)

    if (!token) return
    try {
      const proto =
        typeof window !== 'undefined' && window.location.protocol === 'https:'
          ? 'wss'
          : 'ws'
      const host =
        typeof window !== 'undefined' ? window.location.host : 'localhost'
      // Lazy import keeps monaco-languageclient (ESM-only) out of the
      // top-level dependency graph so jest's CJS transformer doesn't choke
      // on it in tests that render parents of <GqlEditor/>.
      const { startLspClient } = await import('../../lib/lsp/client')
      lspRef.current = await startLspClient({
        monaco: monaco as unknown as typeof import('monaco-editor'),
        url: `${proto}://${host}/ws/lsp`,
        accessToken: token,
        graph: graph || 'default',
        tenant,
      })
    } catch (e) {
      // Editor still works without LSP — surface a console warning.
      // eslint-disable-next-line no-console
      console.warn('LSP client failed to start', e)
    }
  }

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
