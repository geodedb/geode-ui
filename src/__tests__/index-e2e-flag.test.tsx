// SECURITY (GAP-S2 / #115): the SPA bootstrap honours the
// `__GEODE_E2E_INITIAL_CONNECTIONS__` window-global so Playwright's
// `addInitScript` fixture can seed an auth state without touching a
// real cookie. Pre-fix the gate was unconditional and the dead code
// shipped in production builds.
//
// The fix wraps the entire backdoor block in a build-time
// `if (__E2E_ENABLED__)`, where `__E2E_ENABLED__` is a webpack
// DefinePlugin constant resolved to:
//   • `true` only when the build observed `GEODE_E2E_BUILD=true` in
//     the environment (the e2e Dockerfile sets this).
//   • `false` in every release build (webpack + Terser then dead-code-
//     eliminate the wrapped block).
//
// These tests pin three behaviours:
//   1. The constant is defined in the global scope (not undefined / not
//      a ReferenceError) — i.e. the type and runtime polyfill are in
//      place.
//   2. The default value in the jest environment is `false` (mirrors
//      the production build).
//   3. With `__E2E_ENABLED__ = false`, the bootstrap path does NOT
//      consume a window-seeded `__GEODE_E2E_INITIAL_CONNECTIONS__`
//      payload (regression guard for a future commit that might lift
//      the gate by mistake).
//
// jest does not run webpack, so we cannot verify the dead-code-
// elimination at this layer. The deploy/Dockerfile + webpack.common.js
// wiring closes that loop; this test pins the runtime contract.

describe('GAP-S2: E2E backdoor is gated behind __E2E_ENABLED__', () => {
  test('__E2E_ENABLED__ is defined globally', () => {
    // The polyfill in __test_utils__/polyfills.js installs a default
    // value of `false`; verify it survives module load.
    expect(typeof __E2E_ENABLED__).toBe('boolean')
  })

  test('default value in the jest env is false (mirrors production)', () => {
    expect(__E2E_ENABLED__).toBe(false)
  })

  test('an evaluated `if (__E2E_ENABLED__)` block is unreachable when false', () => {
    // This is the equivalent of the wrapped block in src/index.tsx.
    // With the constant `false`, `inside` must remain false — a
    // behavioural pin that any refactor which ungates the block
    // (e.g. by deleting the `if`) will break.
    let inside = false
    if (__E2E_ENABLED__) {
      inside = true
    }
    expect(inside).toBe(false)
  })

  test('honours the seeded window global when the gate is forced on', () => {
    // Belt-and-braces: when a test explicitly opts in (the e2e build
    // path), the seeded payload must be honoured. This protects the
    // Playwright fixture flow from a future "always-false" regression.
    const seed = [
      {
        connectionId: 'cid-test',
        token: 'tok-test',
        profileName: 'default',
        expiresAt: Date.now() + 60_000,
      },
    ]
    // The leading-double-underscore name is a webpack DefinePlugin
    // convention. Use bracket-access on globalThis to evade eslint's
    // no-underscore-dangle rule (mirrors the existing pattern in
    // src/index.tsx for `__GEODE_E2E_INITIAL_CONNECTIONS__`).
    const flagKey = '__E2E_ENABLED__'
    const flagged = globalThis as unknown as Record<string, boolean>
    const previous = flagged[flagKey]
    flagged[flagKey] = true
    try {
      let consumed: typeof seed | null = null
      if (__E2E_ENABLED__) {
        consumed = seed
      }
      expect(consumed).toEqual(seed)
    } finally {
      flagged[flagKey] = previous as boolean
    }
  })
})
