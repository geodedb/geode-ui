import React from 'react'
import styled from 'styled-components'

// Tab-scoped ErrorBoundary for the result tabs. QUAL #314.
//
// The pre-fix layout had ONE ErrorBoundary at the App shell (`src/
// components/layout/ErrorBoundary.tsx`); a render-time crash inside any
// result tab (Cytoscape extension fault, malformed view shape, a buggy
// CustomNodeTemplate, a styled-components access on an undefined theme,
// etc.) propagated up through `<ResultPanel>` and `<QueryPage>` until
// the top-level boundary caught it — which replaces the WHOLE page
// with the global "Something went wrong" card. The user lost access to
// the editor, the other (still-functional) tabs, the toolbar, history,
// every navigation control.
//
// This boundary localises the failure to the tab that produced it.
// Crash in <GraphView>? The table / json / matrix tabs stay
// interactive, the editor stays usable, the user can switch tabs and
// keep working. Same UX contract whether the crash is in a server-
// derived row payload or a third-party Cytoscape plugin.
//
// Reset behaviour: a `resetKey` prop bound to the active tab + a query
// signature lets the boundary "forget" a prior crash whenever the user
// switches tab or runs a new query. getDerivedStateFromProps watches
// the resetKey on every render and clears `error` when it changes — so
// the caller only needs to pass a stable resetKey (e.g. `${tab}|${sig}`)
// and the boundary self-heals on tab/query change without requiring a
// React `key` flip on the wrapper.

const Wrap = styled.div`
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: ${({ theme }) => theme.spacing.lg};
  gap: ${({ theme }) => theme.spacing.sm};
  text-align: center;
  color: ${({ theme }) => theme.text.secondary};
`

const Title = styled.h3`
  margin: 0;
  font-family: ${({ theme }) => theme.font.family.display};
  font-size: ${({ theme }) => theme.font.sizes.md};
  color: ${({ theme }) => theme.text.primary};
`

const Detail = styled.pre`
  margin: 0;
  font-family: ${({ theme }) => theme.font.family.mono};
  font-size: ${({ theme }) => theme.font.sizes.xs};
  color: ${({ theme }) => theme.text.muted};
  background: ${({ theme }) => theme.bg.subtle};
  padding: ${({ theme }) => theme.spacing.sm};
  border-radius: ${({ theme }) => theme.radii.md};
  max-width: 100%;
  max-height: 160px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  text-align: left;
`

interface Props {
  /** Children to render under the boundary. */
  children: React.ReactNode
  /**
   * Stable string that identifies the current tab + query signature.
   * The CALLER should also pass this as the `key` prop on the
   * boundary element so React unmounts/remounts the subtree on
   * change — that's what "resets" a prior crash. Held here so the
   * fallback UI can include a debugging hint and so tests can verify
   * the reset contract end-to-end.
   */
  resetKey: string
  /** Human-readable tab label for the fallback message ("Graph", "Table", …). */
  tabLabel: string
}

interface State {
  error: Error | null
  // Track the resetKey alongside the error so getDerivedStateFromProps
  // can detect a change without consulting any external store. Pure-
  // React reset path: when the parent passes a new resetKey, derive
  // back to a null error before the next render.
  lastResetKey: string
}

export class ResultTabErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null, lastResetKey: props.resetKey }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(
    props: Props,
    state: State
  ): Partial<State> | null {
    if (props.resetKey !== state.lastResetKey) {
      // Parent flipped the tab/query — clear any prior crash so the
      // subtree gets a fresh render. Tracking lastResetKey in state
      // avoids the "reset every render" footgun.
      return { error: null, lastResetKey: props.resetKey }
    }
    return null
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Structured log lands in DevTools + any window.onerror sink.
    // Distinct prefix from the App-level boundary so operators can
    // tell tab-scoped crashes from shell-wide crashes in their
    // monitoring stack.
    const { tabLabel, resetKey } = this.props
    // eslint-disable-next-line no-console
    console.error('[ResultTabErrorBoundary] caught', {
      tab: tabLabel,
      resetKey,
      error,
      info,
    })
  }

  render(): React.ReactNode {
    const { error } = this.state
    const { children, tabLabel } = this.props
    if (!error) return children
    return (
      <Wrap
        role="alert"
        aria-live="assertive"
        data-testid="result-tab-error-boundary"
      >
        <Title>{tabLabel} view failed to render</Title>
        <p className="m-0">
          The other result tabs and the editor still work. Switch tabs or run a
          new query to retry — the error below is for the operator console.
        </p>
        <Detail>{error.message}</Detail>
      </Wrap>
    )
  }
}
