// Filter for a specific class of `unhandledrejection` event that
// originates outside our code: Chrome's
//
//   "A listener indicated an asynchronous response by returning true,
//    but the message channel closed before a response was received"
//
// is emitted when a browser extension content script calls
// chrome.runtime.sendMessage and returns `true` from onMessage to keep
// the channel open, then the channel closes before the response
// arrives. Every operator hits this whenever any of a wide set of
// extensions is installed (LastPass, 1Password, Bitwarden, Translate,
// React DevTools, Grammarly, AdBlock, …) — it has nothing to do with
// our app code, but it surfaces in the operator's console as an
// "Uncaught (in promise) Error" and our future error-reporting layer
// would treat it as an app crash.
//
// installExtensionNoiseFilter() registers a single window-level
// listener that recognises the exact phrasing and calls
// preventDefault() to consume the event before the browser logs it.
// Idempotent — repeated calls do not stack listeners. App code that
// rejects with any other message still surfaces normally.

const EXTENSION_PATTERN =
  /A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received/i

// Sentinel so the install function can no-op on a second call (the
// React StrictMode double-mount path would otherwise install twice in
// dev, and a future per-route install would similarly stack listeners).
let installed = false

function reasonText(reason: unknown): string {
  if (reason == null) return ''
  if (typeof reason === 'string') return reason
  if (reason instanceof Error) return reason.message
  if (typeof reason === 'object' && 'message' in reason) {
    const m = (reason as { message?: unknown }).message
    return typeof m === 'string' ? m : ''
  }
  return ''
}

function handler(event: PromiseRejectionEvent): void {
  const text = reasonText(event.reason).trim()
  if (EXTENSION_PATTERN.test(text)) {
    event.preventDefault()
    // Audit-trail: surface via console.debug (not error) so a curious
    // operator can still confirm the filter is doing its job without
    // re-introducing console noise. console.debug is hidden by default
    // in Chrome's "Default levels" filter.
    // eslint-disable-next-line no-console
    console.debug('[extension-noise] suppressed unhandled rejection:', text)
  }
}

export function installExtensionNoiseFilter(): void {
  if (installed) return
  installed = true
  if (typeof window === 'undefined') return
  window.addEventListener('unhandledrejection', handler)
}

// Test-only: reset the installed sentinel so the unit test's
// per-test-case install assertion can fire idempotency twice across
// describe blocks without bleeding state. Named with the
// `resetForTest` suffix the eslint rule allows.
export function resetExtensionNoiseFilterForTest(): void {
  installed = false
}
