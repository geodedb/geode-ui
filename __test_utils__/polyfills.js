// Polyfills for test environment
if (typeof globalThis.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util')
  globalThis.TextEncoder = TextEncoder
  globalThis.TextDecoder = TextDecoder
}

// jsdom does not provide fetch; the generated client snapshots a reference at
// construction time, so provide a stub so module-load-time client creation
// doesn't blow up. Tests that exercise network calls should mock as needed.
if (typeof globalThis.fetch === 'undefined') {
  globalThis.fetch = () =>
    Promise.reject(
      new Error('fetch is not implemented in the test environment')
    )
}

// __E2E_ENABLED__ is a webpack DefinePlugin constant injected at build
// time (see webpack.common.js). Jest doesn't run webpack, so we install
// the production default here: `false`. Tests that want to exercise the
// backdoor path can override globalThis.__E2E_ENABLED__ inside a
// describe-scoped beforeEach/afterEach pair.
//
// SECURITY: pinning the default to `false` mirrors the production
// build; without it, `if (__E2E_ENABLED__)` would throw ReferenceError
// in jsdom and silently mask coverage gaps around the gating block.
if (typeof globalThis.__E2E_ENABLED__ === 'undefined') {
  globalThis.__E2E_ENABLED__ = false
}

// react-window v2 uses ResizeObserver to track its container size.
// jsdom doesn't ship one, so install a no-op stub. The component
// falls back to defaultHeight/defaultWidth when no observed size is
// reported, which is what we want in unit tests.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// Web Awesome's <wa-tab-group> instantiates an IntersectionObserver at
// module load to detect when the scrolling tab strip's leading/trailing
// chevrons should appear. jsdom doesn't ship one — install a no-op stub
// so the component class can construct in unit tests.
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class IntersectionObserver {
    constructor() {}
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }
}

// Web Awesome's form-associated elements (<wa-button>, <wa-input>) call
// `this.attachInternals()` in their constructor and then read
// `.validity`, `.willValidate`, `.labels`, `.form` from the returned
// ElementInternals during Lit's reactive update. jsdom doesn't ship
// attachInternals (https://github.com/jsdom/jsdom/issues/3463), so WA's
// constructor swallows the failure but leaves `this.internals` undefined
// — every subsequent getter then crashes with "Cannot read properties
// of undefined". Install a no-op stub on HTMLElement.prototype so the
// element-internals contract is at least syntactically satisfied. Tests
// that exercise real form validation will need richer stubs.
if (
  typeof HTMLElement !== 'undefined' &&
  typeof HTMLElement.prototype.attachInternals !== 'function'
) {
  HTMLElement.prototype.attachInternals = function attachInternals() {
    return {
      validity: {
        valid: true,
        badInput: false,
        customError: false,
        patternMismatch: false,
        rangeOverflow: false,
        rangeUnderflow: false,
        stepMismatch: false,
        tooLong: false,
        tooShort: false,
        typeMismatch: false,
        valueMissing: false,
      },
      validationMessage: '',
      willValidate: false,
      labels: [],
      form: null,
      states: new Set(),
      checkValidity() {
        return true
      },
      reportValidity() {
        return true
      },
      setValidity() {},
      setFormValue() {},
      ariaLabel: null,
      ariaPressed: null,
      role: null,
    }
  }
}

// jsdom ships HTMLDialogElement but stubs `.showModal()` / `.show()` /
// `.close()` as missing. Web Awesome's <wa-dialog> calls `showModal()`
// on its internal native <dialog> as soon as `open` flips true, which
// crashes the constructor in unit tests. Install no-op shims so the
// component lifecycle completes; tests that need real modal semantics
// (focus trap, top-layer stacking) belong in Playwright, not jsdom.
if (
  typeof globalThis.HTMLDialogElement !== 'undefined' &&
  typeof globalThis.HTMLDialogElement.prototype.showModal !== 'function'
) {
  globalThis.HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '')
    this.open = true
  }
  globalThis.HTMLDialogElement.prototype.show = function show() {
    this.setAttribute('open', '')
    this.open = true
  }
  globalThis.HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open')
    this.open = false
  }
}
