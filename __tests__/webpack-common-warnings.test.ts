/**
 * Q rank 18 / #232: production webpack used to emit two postcss-calc
 * "Lexical error" warnings on the Web Awesome CSS surface and silenced
 * them globally via `stats: { warnings: false }`. The silencing also
 * hid any future legitimate warning (asset budget breaches, ESM-CJS
 * interop bailouts, etc.). The fix:
 *
 *   - webpack.common.js disables postcss-calc in the CssMinimizerPlugin
 *     options so the build emits zero unexpected warnings.
 *   - webpack.common.js sets `stats: { warnings: true }` so any new
 *     warning surfaces in build output.
 *
 * This test guards both halves: the stats block must NOT silence
 * warnings, and the minimizer config must include the calc:false
 * cssnano preset option.
 */
interface MinimizerOptions {
  preset?: [string, Record<string, unknown>?]
}
// CssMinimizerPlugin's internal shape: the user-supplied
// `minimizerOptions: { preset: [...] }` arg lands at
// `instance.options.minimizer.options.preset`. We assert against the
// nested location because that is the contract the cssnano runner
// reads at minify time.
interface MinimizerInstance {
  options?: {
    minimizer?: { options?: MinimizerOptions }
  }
}
interface OptimizationConfig {
  minimizer?: (string | MinimizerInstance)[]
}
interface WebpackCommonConfig {
  stats?: { warnings?: boolean }
  optimization?: OptimizationConfig
}

function loadWebpackCommon(): WebpackCommonConfig {
  jest.resetModules()
  // eslint-disable-next-line global-require
  return require('../webpack.common.js')
}

describe('webpack.common.js build warnings (Q rank 18 / #232)', () => {
  it('keeps build warnings visible (stats.warnings !== false)', () => {
    const cfg = loadWebpackCommon()
    // Either the stats block omits warnings (webpack default = true)
    // or it explicitly enables them. The pre-fix value was false; the
    // post-fix value is true. Anything but `false` keeps warnings
    // surfaced.
    expect(cfg.stats?.warnings).not.toBe(false)
  })

  it('disables postcss-calc in CssMinimizerPlugin (no Web Awesome warnings)', () => {
    const cfg = loadWebpackCommon()
    const minimizers = cfg.optimization?.minimizer ?? []
    // The minimizer array contains the special '...' marker plus the
    // CssMinimizerPlugin instance; locate the plugin by inspecting
    // its options shape (a string '...' has no options).
    const cssMin = minimizers.find(
      (m): m is MinimizerInstance =>
        typeof m === 'object' &&
        m !== null &&
        Boolean(m.options?.minimizer?.options)
    )
    expect(cssMin).toBeDefined()
    const preset = cssMin?.options?.minimizer?.options?.preset
    expect(Array.isArray(preset)).toBe(true)
    if (!Array.isArray(preset)) return
    expect(preset[0]).toBe('default')
    // The preset's second element must explicitly disable calc — that
    // is the keystone of the gap closure (without it, postcss-calc
    // chokes on color-mix(in oklab, ...) and re-emits the warnings).
    expect(preset[1]?.calc).toBe(false)
  })
})
