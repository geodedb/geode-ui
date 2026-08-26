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

// jsdom 26 (jest-environment-jsdom v30) DOES ship attachInternals, so
// the stub above no longer installs — but its ElementInternals is still
// partial: setValidity/setFormValue/checkValidity/reportValidity are
// missing, and WA's form-associated elements crash with
// "this.internals.setValidity is not a function". Backfill just the
// missing members on the real prototype.
if (typeof globalThis.ElementInternals !== 'undefined') {
  const proto = globalThis.ElementInternals.prototype
  if (!Object.getOwnPropertyDescriptor(proto, 'validity')) {
    Object.defineProperty(proto, 'validity', {
      configurable: true,
      get() {
        return {
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
        }
      },
    })
  }
  if (!Object.getOwnPropertyDescriptor(proto, 'validationMessage')) {
    Object.defineProperty(proto, 'validationMessage', {
      configurable: true,
      get() {
        return ''
      },
    })
  }
  if (!Object.getOwnPropertyDescriptor(proto, 'willValidate')) {
    Object.defineProperty(proto, 'willValidate', {
      configurable: true,
      get() {
        return false
      },
    })
  }
  if (typeof proto.setValidity !== 'function') {
    proto.setValidity = function setValidity() {}
  }
  if (typeof proto.setFormValue !== 'function') {
    proto.setFormValue = function setFormValue() {}
  }
  if (typeof proto.checkValidity !== 'function') {
    proto.checkValidity = function checkValidity() {
      return true
    }
  }
  if (typeof proto.reportValidity !== 'function') {
    proto.reportValidity = function reportValidity() {
      return true
    }
  }
}

// jsdom's Performance implementation (as of jest-environment-jsdom v29 /
// jsdom v20) ships `performance.now()` and the navigation-timing fields,
// but omits the W3C UserTiming entries (`mark`, `measure`, `clearMarks`,
// `clearMeasures`, `getEntriesByName`, `getEntriesByType`). The runtime
// browser ships them, so production code can rely on them; tests need a
// shim. Delegate to Node's `perf_hooks.performance`, which implements the
// full UserTiming Level 3 surface. Pin via `Object.defineProperty` so
// individual tests can still reassign (e.g. to simulate `mark` throwing).
if (
  typeof globalThis.performance !== 'undefined' &&
  typeof globalThis.performance.mark !== 'function'
) {
  const nodePerf = require('perf_hooks').performance
  for (const fn of [
    'mark',
    'measure',
    'clearMarks',
    'clearMeasures',
    'getEntriesByName',
    'getEntriesByType',
    'getEntries',
  ]) {
    if (typeof nodePerf[fn] === 'function') {
      Object.defineProperty(globalThis.performance, fn, {
        value: nodePerf[fn].bind(nodePerf),
        writable: true,
        configurable: true,
      })
    }
  }
}

// jsdom 20 also omits `PerformanceObserver`. Production code paths that
// observe UserTiming entries (see src/lib/perfMarks.ts) need it. Delegate
// to Node's `perf_hooks.PerformanceObserver`, which observes measures
// created on the same Node `perf_hooks.performance` instance that the
// UserTiming polyfill above already binds to `globalThis.performance`.
if (typeof globalThis.PerformanceObserver === 'undefined') {
  const { PerformanceObserver: NodePerformanceObserver } = require('perf_hooks')
  globalThis.PerformanceObserver = NodePerformanceObserver
}

// jsdom's CSS property store only recognises W3C-standardised properties.
// Electron's -webkit-app-region (which opts button surfaces out of the
// frameless-window drag region) is a non-standard Chromium extension that
// jsdom silently drops when set via setProperty or inline style. Patch the
// CSSStyleDeclaration prototype so tests can assert
// `element.style.getPropertyValue('-webkit-app-region')`.
//
// This patch is intentionally permanent for the Jest worker lifetime
// (no afterAll teardown): no test in the suite exercises absence of
// the property as a signal, and a per-test restore would force every
// test in the worker to re-apply the patch. If a future test needs to
// assert the unpatched jsdom behavior, expose a `restoreCss()` helper
// from this file and call it inside that test's `beforeEach`.
if (typeof globalThis.CSSStyleDeclaration !== 'undefined') {
  const cssProto = globalThis.CSSStyleDeclaration.prototype
  if (typeof cssProto._origSetProperty === 'undefined') {
    cssProto._origSetProperty = cssProto.setProperty
    cssProto._origGetPropertyValue = cssProto.getPropertyValue
    cssProto.setProperty = function patchedSetProperty(prop, value, priority) {
      if (prop === '-webkit-app-region') {
        this._webkitAppRegionValue = value
        return
      }
      return cssProto._origSetProperty.call(this, prop, value, priority)
    }
    cssProto.getPropertyValue = function patchedGetPropertyValue(prop) {
      if (prop === '-webkit-app-region') {
        return this._webkitAppRegionValue || ''
      }
      return cssProto._origGetPropertyValue.call(this, prop)
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
