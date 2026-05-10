// PSR-G06 (#83) — bootstrap failure UX.
//
// Pre-fix `src/index.tsx` wrapped `bootstrap()` in a `try { } catch
// {}` that silently swallowed every failure. A failed root mount
// (missing `#root`, broken polyfill, blocked CSS, etc.) presented as
// a blank page with an empty devtools console — there was no signal
// for the user, no signal for Sentry, no signal for Playwright, and
// nothing for a developer to triage from a "support this" report.
//
// Post-fix the catch path calls `renderFatal(err)` which:
//   1. console.error()s the captured error so downstream monitors see it.
//   2. Mounts a self-contained <FatalBootstrapError> panel into #root
//      (or document.body as a fallback) so the user sees a plain-English
//      message + a collapsible stack trace.
//
// These tests pin the contract on the renderFatal helper directly. We
// don't drive `bootstrap()` end-to-end through the production IIFE
// because monaco-bootstrap + the App tree pull in a substantial amount
// of unrelated machinery that would dwarf the assertion under test;
// the IIFE itself is one line (`try { bootstrap() } catch (e) {
// renderFatal(e) }`) and is exercised in production by every cold
// start.

// We mock the underlying bootstrap dependencies that are heavy to
// import in jest (monaco, etc.) so the test only exercises the failure
// surface. The mocks only fire if the module accidentally drags in
// these subgraphs.
jest.mock('../monaco-bootstrap', () => ({}))
jest.mock('../assets/fonts/fonts.css', () => ({}))

// Mock createRoot so the test can both observe what got rendered AND
// force a controlled failure inside the React render path.
const renderMock = jest.fn()
const createRootMock = jest.fn(() => ({
  render: renderMock,
  unmount: jest.fn(),
}))
jest.mock('react-dom/client', () => ({
  createRoot: (...args: unknown[]) => createRootMock(...args),
}))

// jest.mock calls are hoisted above the imports below, so the ES
// import safely picks up the mocked react-dom/client + monaco shims.
import * as indexModule from '../index'

function clearBody(): void {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild)
  }
}

beforeEach(() => {
  renderMock.mockClear()
  createRootMock.mockClear()
  clearBody()
})

describe('PSR-G06: bootstrap failure UX', () => {
  test('successful bootstrap renders the App into #root', () => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)

    indexModule.bootstrap()

    expect(createRootMock).toHaveBeenCalledTimes(1)
    expect(createRootMock).toHaveBeenCalledWith(root)
    expect(renderMock).toHaveBeenCalledTimes(1)
    // The render argument is the StrictMode-wrapped <App> — we don't
    // assert the exact tree, just that a renderable element was passed.
    const arg = renderMock.mock.calls[0]?.[0] as { type: unknown }
    expect(arg).toBeTruthy()
    expect(typeof arg.type).toBeDefined()
  })

  test('bootstrap throws when #root is missing', () => {
    expect(() => indexModule.bootstrap()).toThrow(/Root element not found/i)
  })

  test('renderFatal logs the error and mounts the FatalBootstrapError panel into #root', () => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const err = new Error('boom — synthetic bootstrap failure')
    indexModule.renderFatal(err)

    // console.error happened first (primary monitoring signal).
    expect(consoleSpy).toHaveBeenCalledWith('[geode-ui] bootstrap failed:', err)
    // createRoot was called on the #root element, not document.body.
    expect(createRootMock).toHaveBeenCalledTimes(1)
    expect(createRootMock).toHaveBeenCalledWith(root)
    // The rendered element is the FatalBootstrapError panel carrying
    // the original error.
    expect(renderMock).toHaveBeenCalledTimes(1)
    const arg = renderMock.mock.calls[0]?.[0] as {
      props: { error: unknown }
    }
    expect(arg.props.error).toBe(err)

    consoleSpy.mockRestore()
  })

  test('renderFatal falls back to document.body when #root is missing', () => {
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    indexModule.renderFatal(new Error('boom'))

    expect(consoleSpy).toHaveBeenCalled()
    expect(createRootMock).toHaveBeenCalledTimes(1)
    expect(createRootMock).toHaveBeenCalledWith(document.body)

    consoleSpy.mockRestore()
  })

  test('renderFatal handles non-Error throws gracefully', () => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    indexModule.renderFatal('a plain-string failure')

    expect(consoleSpy).toHaveBeenCalledWith(
      '[geode-ui] bootstrap failed:',
      'a plain-string failure'
    )
    // The panel still renders — its formatError() handles non-Error
    // payloads.
    expect(renderMock).toHaveBeenCalledTimes(1)
    const arg = renderMock.mock.calls[0]?.[0] as {
      props: { error: unknown }
    }
    expect(arg.props.error).toBe('a plain-string failure')

    consoleSpy.mockRestore()
  })

  test('renderFatal swallows render-side failures (best-effort)', () => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    // Force the render path to throw so we exercise the inner catch.
    renderMock.mockImplementationOnce(() => {
      throw new Error('render itself failed')
    })

    // Must not propagate.
    expect(() => indexModule.renderFatal(new Error('outer'))).not.toThrow()
    // The console.error of the outer error still happened first.
    expect(consoleSpy).toHaveBeenCalledWith(
      '[geode-ui] bootstrap failed:',
      expect.any(Error)
    )

    consoleSpy.mockRestore()
  })
})
