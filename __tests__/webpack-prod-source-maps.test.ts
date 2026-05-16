/**
 * PERF #235: production source maps were embedded into the SPA bundle
 * and captured by Go's //go:embed all:dist directive, bloating the
 * release binary by 48.78 MiB and providing no runtime benefit. The
 * fix gates webpack's `devtool` on the EMBEDDED_BUILD env var so the
 * release/Docker build path emits zero *.map files while dev builds
 * keep source maps for devtools debugging.
 *
 * This test isolates webpack.prod.js (which executes top-level on
 * require) by re-running the module under each env-var setting and
 * checking the resolved `devtool` field. We must purge the require
 * cache between toggles because webpack.prod.js reads
 * process.env.EMBEDDED_BUILD at module-load time.
 */
function loadWebpackProd(env: 'embedded' | 'dev'): { devtool: unknown } {
  // jest.resetModules clears the entire require cache for this test,
  // including transitively required webpack-merge / webpack.common.js
  // — without it, the prior call's evaluated module graph would feed
  // the second call a stale devtool. Webpack.prod.js reads the env
  // var only at module-load time.
  jest.resetModules()
  if (env === 'embedded') {
    process.env.EMBEDDED_BUILD = '1'
  } else {
    delete process.env.EMBEDDED_BUILD
  }
  // The require() chain pulls in webpack-merge + webpack.common.js;
  // we only inspect the merged top-level field that's relevant.
  // String-literal require is statically-resolvable so the bundler
  // rules pass; the global-require disable below is required because
  // the call sits inside a function (not module top-level).
  // eslint-disable-next-line global-require
  return require('../webpack.prod.js')
}

describe('webpack.prod.js source-map gating (PERF #235)', () => {
  const originalEmbedded = process.env.EMBEDDED_BUILD

  afterAll(() => {
    if (originalEmbedded === undefined) {
      delete process.env.EMBEDDED_BUILD
    } else {
      process.env.EMBEDDED_BUILD = originalEmbedded
    }
    jest.resetModules()
  })

  it('disables devtool when EMBEDDED_BUILD=1 (release/Docker path)', () => {
    const cfg = loadWebpackProd('embedded')
    // devtool: false is the documented webpack opt-out for source-map
    // emission. Anything truthy (including the string 'source-map')
    // would re-introduce the 48.78 MiB bloat the gap was filed to
    // eliminate.
    expect(cfg.devtool).toBe(false)
  })

  it('keeps source-map devtool for dev/local production builds', () => {
    const cfg = loadWebpackProd('dev')
    // Without EMBEDDED_BUILD set, the engineer's local `npm run build`
    // should still produce maps so devtools resolves stack traces to
    // original sources.
    expect(cfg.devtool).toBe('source-map')
  })
})
