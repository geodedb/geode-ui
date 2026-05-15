// PSR-G06 (#83) — surfaced when the SPA bootstrap throws before React
// has a chance to mount. Pre-fix the catch block in src/index.tsx
// silently swallowed the failure and the user stared at a blank page
// with an empty console; nothing in the DOM nor in the devtools made
// it possible to file a useful bug report.
//
// This component renders a self-contained, framework-free error panel:
// no theme provider, no i18n, no router. The bootstrap may have failed
// for any number of reasons (CSS bundle blocked by ad-blocker, missing
// `#root` element, asset 404, polyfill exception), so we deliberately
// keep dependencies to React + plain inline styles. The panel:
//
//   1. Says, in plain English, that the application failed to start.
//   2. Suggests the most-common operator remediation (reload + check
//      dev console).
//   3. Renders the captured Error.message + stack inside a
//      <details> so a non-technical user can ignore it and a developer
//      can copy/paste it into a bug report without opening devtools.
//
// The `console.error` path lives in src/index.tsx (alongside the
// render call) so the failure is also visible to anything monitoring
// the console — Sentry, Playwright, electron-log forwarders.

import React from 'react'

export interface FatalBootstrapErrorProps {
  error: unknown
}

const PANEL_STYLE: React.CSSProperties = {
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif',
  maxWidth: '720px',
  margin: '64px auto',
  padding: '24px 28px',
  border: '1px solid #ddd',
  borderRadius: '6px',
  background: '#fff',
  color: '#222',
  lineHeight: 1.5,
}

const HEADING_STYLE: React.CSSProperties = {
  fontSize: '20px',
  margin: '0 0 12px',
  color: '#a00',
}

const BODY_STYLE: React.CSSProperties = {
  margin: '0 0 16px',
}

const DETAILS_STYLE: React.CSSProperties = {
  fontSize: '13px',
  color: '#444',
}

const PRE_STYLE: React.CSSProperties = {
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  background: '#f6f6f6',
  border: '1px solid #e3e3e3',
  borderRadius: '4px',
  padding: '8px 10px',
  marginTop: '8px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: '12px',
}

function formatError(error: unknown): { message: string; stack: string } {
  if (error instanceof Error) {
    return {
      message: error.message || 'Unknown error',
      stack: error.stack ?? '(no stack)',
    }
  }
  // Defensive: a thrown non-Error (string, number, plain object) still
  // needs a printable representation. JSON.stringify swallows circular
  // references; fall back to String() in that case.
  try {
    return { message: String(error), stack: JSON.stringify(error, null, 2) }
  } catch {
    return { message: String(error), stack: '(unserialisable)' }
  }
}

export const FatalBootstrapError: React.FC<FatalBootstrapErrorProps> = ({
  error,
}) => {
  const { message, stack } = formatError(error)
  return (
    <section
      role="alert"
      data-testid="fatal-bootstrap-error"
      aria-labelledby="fatal-bootstrap-heading"
      style={PANEL_STYLE}
    >
      <h1 id="fatal-bootstrap-heading" style={HEADING_STYLE}>
        Geode failed to start
      </h1>
      <p style={BODY_STYLE}>
        The application could not initialise. Try reloading the page; if the
        problem persists, copy the diagnostic details below and file a bug
        report.
      </p>
      <details style={DETAILS_STYLE}>
        <summary>Diagnostic details</summary>
        <p>
          <strong>Error:</strong> {message}
        </p>
        <pre style={PRE_STYLE} data-testid="fatal-bootstrap-stack">
          {stack}
        </pre>
      </details>
    </section>
  )
}
