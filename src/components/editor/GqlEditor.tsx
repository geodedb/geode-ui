import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
// Side-effect import: wires @monaco-editor/react to the webpack-bundled
// monaco instance (skips the CDN AMD loader our CSP blocks). This used
// to live at the top of src/index.tsx, which pulled all of
// monaco-editor (~several MiB) into the initial bundle. As of F10 (#54)
// the editor is React.lazy'd at the QueryPage call site, so importing
// the bootstrap *here* keeps monaco inside the lazy editor chunk
// instead of the entry chunk.
import '../../monaco-bootstrap'
import type * as MonacoEditorApi from 'monaco-editor'
import Editor, { OnMount } from '@monaco-editor/react'
import { GQL_LANGUAGE_ID, registerGqlLanguage } from './gqlLanguage'
import type { LspClientHandle, LspState } from '../../lib/lsp/client'
import { useAuth } from '../../auth/AuthProvider'
// Origin/main moved the access token off `useAuth()` into a module-level
// latch in api/connections so non-hook call sites can read it. Effect
// deps on `isAuthed` ensure we still re-run when the user signs in/out.
import { getLatestToken } from '../../api/connections'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { breakpoints } from '../../theme/tokens'
import { useLspSettings } from '../../lib/lspSettings'

// Mobile editor height is capped at 160 px so the editor + Bar + result
// region all fit within an 812 px portrait viewport without scrolling
// past the fold. Desktop default stays at 240 px to match the prior
// behavior (and the LazyFallback's min-height in QueryPage). The `md`
// breakpoint matches src/theme/tokens.ts.
const MOBILE_EDITOR_HEIGHT = 160
const DESKTOP_EDITOR_HEIGHT = 240
const MOBILE_MEDIA_QUERY = `(max-width: ${breakpoints.md - 0.02}px)`

type Props = {
  value: string
  onChange: (s: string) => void
  onRun: () => void
  height?: number
  graph?: string
  tenant?: string
}

/**
 * Imperative handle exposed via React.forwardRef. QueryPage uses it to
 * (a) ask the editor to run textDocument/formatting on demand
 * (toolbar button, ⌘⇧F) and (b) request a one-shot format that runs
 * the next time the LSP becomes ready — used when a query arrives from
 * outside the editor (schema-explorer click, deep link, history).
 */
export interface GqlEditorHandle {
  formatDocument: () => Promise<void>
  // requestFormatWhenReady queues exactly one format pass. If the LSP
  // is already open the format fires immediately; otherwise it fires
  // on the next 'open' transition. Repeated calls are idempotent —
  // they collapse to a single pending request.
  requestFormatWhenReady: () => void
}

const GqlEditorImpl: React.ForwardRefRenderFunction<GqlEditorHandle, Props> = (
  { value, onChange, onRun, height, graph, tenant },
  ref
) => {
  // When the caller doesn't override height, shrink to a mobile-friendly
  // value at <= md so the editor doesn't eat ~30% of vertical chrome on a
  // 375x812 phone. An explicit `height` prop always wins (callers that
  // want a fixed size keep it).
  const isMobile = useMediaQuery(MOBILE_MEDIA_QUERY)
  const effectiveHeight =
    height ?? (isMobile ? MOBILE_EDITOR_HEIGHT : DESKTOP_EDITOR_HEIGHT)
  const lspRef = useRef<LspClientHandle | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const editorRef = useRef<MonacoEditorApi.editor.IStandaloneCodeEditor | null>(
    null
  )
  const [lspState, setLspState] = useState<LspState>('closed')
  // `monacoReady` flips to true in handleMount; the LSP-start useEffect
  // depends on it so it re-fires once the editor's onMount has set
  // `monacoRef.current`. Pre-fix the useEffect ran a single time during
  // the initial render — BEFORE Monaco's lazy mount completes — saw
  // `monacoRef.current == null`, early-returned, and never re-fired
  // because the ref isn't a dep. That silently disabled the LSP for
  // every visit (no diagnostics squiggles, no canonical formatting),
  // regardless of upstream config. The state trigger is the canonical
  // React pattern for "wait until the imperative handle is wired".
  const [monacoReady, setMonacoReady] = useState(false)
  // Pending one-shot format. Set by requestFormatWhenReady(); cleared
  // by the open-state effect after the format dispatches.
  const formatPendingRef = useRef(false)

  const formatOpts = useLspSettings((s) => s.format)
  // Snapshot the options so the LSP connect effect only re-runs when
  // the values actually change, not on unrelated store updates.
  const formatKey = `${formatOpts.indentSize}:${formatOpts.maxLineLength}:${formatOpts.minPropertiesToFold}:${formatOpts.foldPropertyMaps}`

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

  const runFormatNow = async (): Promise<void> => {
    const ed = editorRef.current
    if (!ed) return
    const action = ed.getAction('editor.action.formatDocument')
    if (!action) return
    try {
      await action.run()
    } catch {
      // Format failure is non-fatal — the editor's content is unchanged
      // and the user can keep typing. Surface a console warning so a
      // developer can correlate against the LSP transport logs.
      // eslint-disable-next-line no-console
      console.warn('LSP formatDocument failed')
    }
  }

  useImperativeHandle(
    ref,
    () => ({
      formatDocument: runFormatNow,
      requestFormatWhenReady: () => {
        formatPendingRef.current = true
        // If the LSP is already open, fire immediately so the user
        // sees the formatted text before the next paint. Otherwise
        // the lsp-open effect picks it up the moment the transport
        // settles.
        if (lspState === 'open') {
          // Use a microtask so the editor has settled the latest
          // setValue (when called from the consumer right after
          // updating `value`).
          queueMicrotask(() => {
            if (!formatPendingRef.current) return
            formatPendingRef.current = false
            runFormatNow().catch(() => {
              /* swallow — best-effort one-shot format */
            })
          })
        }
      },
    }),
    [lspState]
  )

  const handleMount: OnMount = (editor, monaco) => {
    registerGqlLanguage(monaco)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, onRun)
    // Cmd/Ctrl+Shift+F runs the document formatter. Monaco wires this
    // for many built-in languages but the Geode 'gql' language is
    // registered dynamically, so we bind it explicitly to guarantee
    // the same shortcut works regardless of locale / platform.
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
      () => {
        runFormatNow().catch(() => {
          /* runFormatNow already swallows errors; keep the action async-safe */
        })
      }
    )
    monacoRef.current = monaco as unknown as typeof import('monaco-editor')
    editorRef.current = editor
    // Tell the LSP-start useEffect that the monaco ref is now wired
    // (see `monacoReady` declaration for the regression context).
    setMonacoReady(true)
  }

  // Re-create the LSP client whenever the auth token, graph, tenant,
  // or formatting options change. Tearing down + starting fresh is
  // simpler (and matches the monaco-languageclient lifecycle, which
  // doesn't support reusing a started client with a new transport).
  useEffect(() => {
    // Gate on both `isAuthed` and `monacoReady`. The latter is a state
    // (not a ref read) so a flip from false → true re-fires the effect
    // — see the `monacoReady` declaration comment for why the ref-only
    // version silently never started the LSP.
    if (!isAuthed || !monacoReady || !monacoRef.current) return undefined
    // Post-cookie-migration (#62 / SEC-F7), `getLatestToken()` returns
    // null on every page load — the JWT lives in the HttpOnly
    // `geode-ui-auth` cookie that JS cannot read. The pre-fix LSP
    // startup early-returned here, which silently disabled both
    // diagnostics squiggles and LSP-driven formatting for any user on
    // the canonical cookie auth path. The cookie still authenticates
    // same-origin WebSocket upgrades automatically (browsers attach it
    // to the upgrade request) and the server's /ws/lsp handler reads
    // either the cookie OR the `?access_token=` query, so passing an
    // empty string is correct: the server falls through to the
    // cookie. The legacy `geode-ui.legacy-auth=1` backout path still
    // surfaces a real token via `getLatestToken()`; in that mode the
    // bearer-subprotocol channel carries auth as before.
    const token = getLatestToken() ?? ''
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
          format: formatOpts,
          onStateChange: (s) => {
            setLspState(s)
            // eslint-disable-next-line no-console
            console.debug('[lsp] state =', s)
            // Test seam (PERF #312 pattern): expose the latest LSP
            // transport state on `window` so Playwright can wait on
            // it without scraping console output. The contract is
            // read-only; the editor is the only writer.
            if (typeof window !== 'undefined') {
              const w = window as unknown as { __geode_lsp_state?: string }
              // eslint-disable-next-line no-underscore-dangle
              w.__geode_lsp_state = s
            }
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
    // formatKey is the structural identity of formatOpts — comparing
    // the joined-string identity is what we want here so an unrelated
    // store update doesn't bounce the LSP transport. `monacoReady`
    // gates the first start until the editor's onMount has wired
    // `monacoRef.current`; without it the effect would early-return
    // on the initial render and never re-fire (the ref isn't a dep).
  }, [isAuthed, graph, tenant, formatKey, monacoReady])

  // When the LSP transitions to 'open' AND a one-shot format was
  // queued, dispatch it. Monaco's formatDocument action is a no-op
  // until at least one formatter is registered — that registration is
  // what monaco-languageclient does when the LSP advertises
  // documentFormattingProvider. So waiting for 'open' is the correct
  // gate, not "the moment the editor mounts".
  useEffect(() => {
    if (lspState !== 'open') return
    if (!formatPendingRef.current) return
    formatPendingRef.current = false
    // Run on the next tick so any in-flight setValue from the consumer
    // has settled before the formatter reads the document.
    queueMicrotask(() => {
      runFormatNow().catch(() => {
        /* swallow — best-effort one-shot format */
      })
    })
  }, [lspState])

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
      height={effectiveHeight}
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

export const GqlEditor = forwardRef<GqlEditorHandle, Props>(GqlEditorImpl)
GqlEditor.displayName = 'GqlEditor'
