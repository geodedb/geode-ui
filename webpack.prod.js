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
    // 'error' instead of 'warning' so a regression beyond the budget
    // fails the production build outright — surfaces in CI's
    // webpack-build job before merge.
    hints: 'error',
    maxAssetSize: 1024 * 1024, // 1 MiB
    maxEntrypointSize: 1.5 * 1024 * 1024, // 1.5 MiB
    assetFilter(assetFilename) {
      // Skip source maps, font assets, and the monaco editor workers
      // (the workers are independently loaded; counting them against
      // the entrypoint budget double-counts the cost). Same exclusion
      // shape as the Phase-1 audit recommended.
      if (/\.map$/.test(assetFilename)) return false
      if (/\.(woff2?|ttf|eot|otf|png|jpg|jpeg|gif|svg|ico)$/.test(assetFilename))
        return false
      if (/worker\.js$/.test(assetFilename)) return false
      return true
    },
  },
})
