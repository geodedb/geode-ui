// Build-time globals injected by webpack DefinePlugin.
//
// `__E2E_ENABLED__` is `true` only when the SPA is built with
// `GEODE_E2E_BUILD=true` in the environment (the e2e Dockerfile does
// this; the release Dockerfiles deliberately do not). When the
// constant is `true`, src/index.tsx honours the
// `__GEODE_E2E_INITIAL_CONNECTIONS__` window-global that Playwright
// seeds via `addInitScript`, allowing test fixtures to bypass the auth
// flow without touching a real cookie.
//
// In production builds the constant is the literal `false`, and the
// surrounding block is dead-code-eliminated by webpack/Terser, so the
// E2E backdoor cannot be reached even by a renderer compromise.
//
// SECURITY: closes GAP-S2 (#115) — pre-fix, src/index.tsx honored the
// backdoor unconditionally and shipped in the production bundle.
//
// The leading-double-underscore name is a webpack DefinePlugin
// convention; eslint's no-underscore-dangle is opted out per-callsite.
// eslint-disable-next-line no-underscore-dangle
declare const __E2E_ENABLED__: boolean
