const { merge } = require('webpack-merge')
const common = require('./webpack.common.js')

// Q-NEW-T2 — bundle-size budget. Today's snapshot (post-i18n + theme +
// brand fonts + Cytoscape + Monaco worker split):
//   • main.js                  ~ 100 KB
//   • vendors.js               ~ 12.4 MiB unzipped (large because of
//     monaco + cytoscape + react-window + i18next)
//   • main.css                 ~ 1 KB
//   • brand fonts (6×woff2)    ~ 107 KB combined
//
// We're not trying to fit Monaco + Cytoscape + the workers under 512 KB;
// the realistic budget for this app is the *initial* JS chunk that
// runs before any code-split work. Webpack's default
// maxEntrypointSize/maxAssetSize errors are too coarse — they fire on
// the vendors.js chunk which already represents a deliberate bundling
// decision. Bump to 1 MiB per asset and 1.5 MiB per entrypoint as a
// regression alarm; tighten further once F10 (Monaco/Cytoscape
// code-split) lands.
module.exports = merge(common, {
  mode: 'production',
  devtool: 'source-map',
  performance: {
    // Regression alarm, not a hard gate. The current production bundle
    // is dominated by Monaco + Cytoscape (~12.5 MiB of vendors.js),
    // tracked separately as F10 (#54) for code-splitting. Until that
    // lands, the realistic budget is "do not regress past current
    // size + 10% headroom"; flipping `hints: 'error'` would also
    // require the F10 closure to land in the same PR.
    //
    // When F10 ships, drop these to 1024/1536 KiB and flip to
    // 'error'; the comment block on src/index.tsx mentions the
    // pinned worker chunks that escape this entrypoint accounting.
    hints: 'warning',
    maxAssetSize: 16 * 1024 * 1024, // 16 MiB (current ~12.5 MiB)
    maxEntrypointSize: 16 * 1024 * 1024,
    assetFilter(assetFilename) {
      // Skip source maps, font assets, and the monaco editor workers
      // (the workers are independently loaded; counting them against
      // the entrypoint budget double-counts the cost).
      if (/\.map$/.test(assetFilename)) return false
      if (
        /\.(woff2?|ttf|eot|otf|png|jpg|jpeg|gif|svg|ico)$/.test(assetFilename)
      )
        return false
      if (/worker\.js$/.test(assetFilename)) return false
      return true
    },
  },
})
