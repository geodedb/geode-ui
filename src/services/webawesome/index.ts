// Web Awesome component registration. Importing a component module
// auto-registers its custom element via `customElements.define`. We
// use EXPLICIT imports rather than the autoloader so bundle size
// stays predictable and the dependency graph is grep-able.
//
// Add a new line here when migrating an additional component in a
// follow-up plan. Order doesn't matter — each component registers
// itself once on first import.
import '@awesome.me/webawesome/dist/components/button/button.js'
