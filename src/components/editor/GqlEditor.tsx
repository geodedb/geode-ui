import React, { useCallback, useEffect, useRef } from 'react'
// Side-effect import: wires @monaco-editor/react to the webpack-bundled
// monaco instance (skips the CDN AMD loader our CSP blocks). This used
// to live at the top of src/index.tsx, which pulled all of
// monaco-editor (~several MiB) into the initial bundle. As of F10 (#54)
// the editor is React.lazy'd at the QueryPage call site, so importing
// the bootstrap *here* keeps monaco inside the lazy editor chunk
// instead of the entry chunk.
import '../../monaco-bootstrap'
import Editor, { OnMount } from '@monaco-editor/react'
import { GQL_LANGUAGE_ID, registerGqlLanguage } from './gqlLanguage'
import type { LspClientHandle } from '../../lib/lsp/client'
import { useAuth } from '../../auth/AuthProvider'
// Origin/main moved the access token off `useAuth()` into a module-level
// latch in api/connections so non-hook call sites can read it. Effect
// deps on `isAuthed` ensure we still re-run when the user signs in/out.
import { getLatestToken } from '../../api/connections'

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
  // @monaco-editor/react writes the `value` prop back into the model
  // whenever it differs from the model text. Under React 19 the parent's
  // setState from Monaco's input events is not always committed before
  // the next keystroke, so a render can carry an OLDER `value` than the
  // model already holds; writing it back erased the newer keystrokes
  // (fast typing, e.g. Playwright's keyboard.type, lost most of a query).
  //
  // `emitted` holds the texts the editor itself reported through
  // onChange that the parent has not fully caught up with. A `value`
  // found there is our own echo (possibly stale), so it is not handed
  // back to <Editor>; only external changes (the default statement, a
  // statement staged by the schema explorer, a ?statement= deep link)
  // are. The change handler is also kept referentially stable so the
  // library does not re-subscribe onDidChangeModelContent every render.
  const emitted = useRef<Set<string>>(new Set())
  const lastEmitted = useRef<string | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const handleChange = useCallback((v: string | undefined) => {
    const text = v ?? ''
    emitted.current.add(text)
    lastEmitted.current = text
    onChangeRef.current(text)
  }, [])
  const isEcho = emitted.current.has(value)
  useEffect(() => {
    // Caught up with the latest keystroke, or overridden by an external
    // value: either way the pending echoes are obsolete.
    if (!isEcho || value === lastEmitted.current) emitted.current.clear()
  }, [value, isEcho])
  // useAuth() throws when no AuthProvider is mounted (tests that render
  // GqlEditor in isolation, anonymous SPA boot before sign-in). The
  // editor must still render in those cases; we fall back to "not
  // authenticated" and skip LSP wiring. getLatestToken() is the
  // canonical token source inside useEffect, so the hook only feeds
  // the re-render trigger.
  let isAuthed = false
  try {
    isAuthed = useAuth().isAuthed
  } catch {
    isAuthed = false
  }

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
    if (!isAuthed || !monacoRef.current) return undefined
    const token = getLatestToken()
    if (!token) return undefined
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
  }, [isAuthed, graph, tenant])

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
      defaultValue={value}
      value={isEcho ? undefined : value}
      onChange={handleChange}
      onMount={handleMount}
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        scrollBeyondLastLine: false,
      }}
    />
  )
}
