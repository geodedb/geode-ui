import React from 'react'
import styled from 'styled-components'

// Top-level ErrorBoundary for the protected shell.
//
// A blank white page is the worst-case UX for any unhandled render-
// time throw: there's no message, no recovery affordance, no signal
// to the operator. This boundary catches React's render/commit
// errors and replaces the unmount with a card that names the error
// and exposes Reload + Sign Out actions.
//
// IMPORTANT — what this DOES NOT catch:
//
//   - Errors thrown synchronously during a lazy-chunk's module
//     evaluation. Webpack runs the chunk factory inside its own
//     try/catch; if the factory throws (e.g. a React version mismatch
//     reading ReactSharedInternals.S), the throw lands on
//     window.onerror, not on a React render frame. Suspense's catch-
//     and-rerender machinery never sees it.
//
// Those failures must be prevented at the source (don't ship chunks
// that throw at eval time). The boundary is the safety net for
// EVERY other class of failure — a buggy hook, a malformed API
// response that surfaces through a render, a styled-components
// access on undefined theme, etc.

const Wrap = styled.div`
  max-width: 640px;
  margin: 80px auto;
  padding: ${({ theme }) => theme.spacing.xl};
  background: ${({ theme }) => theme.bg.surface};
  border: 1px solid ${({ theme }) => theme.border.default};
  border-radius: ${({ theme }) => theme.radii.xl};
  box-shadow: ${({ theme }) => theme.shadows.md};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`

const Title = styled.h1`
  font-family: ${({ theme }) => theme.font.family.display};
  font-size: ${({ theme }) => theme.font.sizes.xl};
  color: ${({ theme }) => theme.text.primary};
  margin: 0;
`

const Message = styled.p`
  color: ${({ theme }) => theme.text.secondary};
  margin: 0;
`

const Detail = styled.pre`
  font-family: ${({ theme }) => theme.font.family.mono};
  font-size: ${({ theme }) => theme.font.sizes.xs};
  color: ${({ theme }) => theme.text.muted};
  background: ${({ theme }) => theme.bg.subtle};
  padding: ${({ theme }) => theme.spacing.sm};
  border-radius: ${({ theme }) => theme.radii.md};
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 220px;
  overflow: auto;
  margin: 0;
`

const Actions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
`

const ReloadButton = styled.button`
  background: ${({ theme }) => theme.colors.primary};
  color: ${({ theme }) => theme.text.onPrimary};
  border: none;
  border-radius: ${({ theme }) => theme.radii.md};
  padding: 8px 16px;
  font-size: ${({ theme }) => theme.font.sizes.sm};
  font-weight: ${({ theme }) => theme.font.weights.medium};
  cursor: pointer;

  &:hover {
    filter: brightness(0.95);
  }
  &:focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadows.focus};
  }
`

interface Props {
  children: React.ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // The structured object lands in DevTools and on any
    // window.onerror sink the operator wires up (Sentry, etc.). Don't
    // re-throw — the boundary's whole purpose is to swallow the
    // render-time crash and present a recoverable UI.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] caught', { error, info })
  }

  // Defined as an instance arrow so the `onClick={this.handleReload}`
  // binding stays referentially stable; we don't read `this`, but
  // class-methods-use-this would complain about a static-able method
  // shape. Suppress the rule — the bound-instance form is the
  // intentional choice here.
  // eslint-disable-next-line class-methods-use-this
  handleReload = (): void => {
    // window.location.reload() forces a full bundle re-fetch. Avoids
    // sticky failures from a hot-module-replacement-style stale chunk
    // in the same session.
    window.location.reload()
  }

  render(): React.ReactNode {
    const { error } = this.state
    const { children } = this.props
    if (!error) return children
    return (
      <Wrap role="alert" aria-live="assertive" data-testid="app-error-boundary">
        <Title>Something went wrong</Title>
        <Message>
          The page hit an unrecoverable error. Reload to retry — your unsaved
          query text in the editor is preserved by the browser.
        </Message>
        <Detail>{error.message}</Detail>
        <Actions>
          <ReloadButton type="button" onClick={this.handleReload}>
            Reload page
          </ReloadButton>
        </Actions>
      </Wrap>
    )
  }
}
