// Reproduces the "A listener indicated an asynchronous response..."
// browser-extension chatter that pollutes the operator's console. The
// pattern: a content script (LastPass, Translate, React DevTools, …)
// returns `true` from chrome.runtime.onMessage to keep the message
// channel open for an async response, then the channel closes before
// the response arrives. Chrome surfaces this as an `unhandledrejection`
// event WITHOUT a source frame — Sentry can't ignore it by URL, and
// our own error UI logs it as if it were an app crash.
//
// The filter installed by installExtensionNoiseFilter() listens for
// unhandledrejection with the specific message and calls
// preventDefault(), which both
//   (a) prevents the browser's default console.error,
//   (b) prevents window.onerror / Sentry / any other handler from
//       seeing it.
// We do NOT silence ALL unhandled rejections — just the exact phrasing
// Chrome uses for this extension-induced case. App code that throws a
// genuine unhandled rejection still surfaces.

import {
  installExtensionNoiseFilter,
  resetExtensionNoiseFilterForTest,
} from './extensionNoiseFilter'

const EXTENSION_MESSAGE =
  'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received'

function fireRejection(reason: unknown): {
  defaulted: boolean
  event: PromiseRejectionEvent
} {
  // jsdom doesn't fully model PromiseRejectionEvent; build a minimal
  // shape that the filter reads (`reason`, `preventDefault`).
  let prevented = false
  const event = {
    reason,
    preventDefault: (): void => {
      prevented = true
    },
  } as unknown as PromiseRejectionEvent
  const handlers = window.eventListenersForTest?.unhandledrejection ?? []
  handlers.forEach((h) => h(event))
  // window.dispatchEvent path: if anything else is wired (it shouldn't
  // be in the test), let it run too — but the filter is what we assert.
  window.dispatchEvent(
    Object.assign(new Event('unhandledrejection'), { reason })
  )
  return { defaulted: !prevented, event }
}

// jsdom doesn't expose installed listeners. Stub the addEventListener
// path so the test can replay events directly into our filter without
// going through the real event loop.
declare global {
  interface Window {
    eventListenersForTest?: {
      unhandledrejection: ((e: PromiseRejectionEvent) => void)[]
    }
  }
}

const realAdd = window.addEventListener
beforeEach(() => {
  resetExtensionNoiseFilterForTest()
  window.eventListenersForTest = { unhandledrejection: [] }
  // Stub mirrors the WindowEventHandlers shape but accepts the union
  // of valid keys + any string (no jsdom typings expose a clean
  // signature for the WorkerEventMap path that's also valid here).
  window.addEventListener = ((type: string, listener: EventListener): void => {
    if (type === 'unhandledrejection') {
      window.eventListenersForTest?.unhandledrejection.push(
        listener as (e: PromiseRejectionEvent) => void
      )
      return
    }
    const passthrough = realAdd as unknown as (
      t: string,
      l: EventListener
    ) => void
    passthrough.call(window, type, listener)
  }) as typeof window.addEventListener
})

afterEach(() => {
  window.addEventListener = realAdd
  window.eventListenersForTest = undefined
})

describe('installExtensionNoiseFilter', () => {
  it('preventDefault()s the extension orphan-response message verbatim', () => {
    installExtensionNoiseFilter()
    const { defaulted } = fireRejection(new Error(EXTENSION_MESSAGE))
    expect(defaulted).toBe(false)
  })

  it('preventDefault()s when reason is a bare string, not an Error', () => {
    installExtensionNoiseFilter()
    const { defaulted } = fireRejection(EXTENSION_MESSAGE)
    expect(defaulted).toBe(false)
  })

  it('lets unrelated rejections through (no preventDefault)', () => {
    installExtensionNoiseFilter()
    const { defaulted } = fireRejection(new Error('genuine app crash'))
    expect(defaulted).toBe(true)
  })

  it('matches the message regardless of leading or trailing whitespace', () => {
    installExtensionNoiseFilter()
    const { defaulted } = fireRejection(new Error(`   ${EXTENSION_MESSAGE}   `))
    expect(defaulted).toBe(false)
  })

  it('is idempotent — calling install twice does not double-filter', () => {
    installExtensionNoiseFilter()
    installExtensionNoiseFilter()
    expect(window.eventListenersForTest?.unhandledrejection.length).toBe(1)
  })
})
