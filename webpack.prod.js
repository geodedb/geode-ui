const { merge } = require('webpack-merge')
const common = require('./webpack.common.js')

// Bundle-size budget — re-tightened by F10 (#54) once Monaco and
// Cytoscape became React.lazy'd async chunks at the QueryPage call
// site (src/pages/QueryPage.tsx). With those two libraries split out:
//   • main.js (entry)          — small React/router/i18n shell
//   • vendors.js (sync vendor) — no longer carries monaco/cytoscape
//   • <hash>.js (async chunks) — the lazy editor + graph chunks; these
//     are loaded on demand by the Suspense boundaries, so they are
//     intentionally excluded from the entrypoint budget (counting them
//     against the entry double-counts cost that the split removed).
//   • *.worker.js (monaco)     — independently loaded by the editor
//     chunk via MonacoEnvironment.getWorker; also excluded.
//
// `hints: 'error'` makes a regression past the cap fail `npm run build`
// (and therefore CI), rather than emitting a warning that scrolls off.
// Caps: 1 MiB per (non-excluded) asset, 1.5 MiB per entrypoint. If a
// future change pushes the sync bundle back over 1 MiB — e.g. a heavy
// dependency added to the critical path, or a regression that re-pulls
// monaco/cytoscape into the entry — the build fails and the offending
// asset is named in the error.
module.exports = merge(common, {
  mode: 'production',
  devtool: 'source-map',
  performance: {
    hints: 'error',
    maxAssetSize: 1024 * 1024, // 1 MiB
    maxEntrypointSize: 1536 * 1024, // 1.5 MiB
    assetFilter(assetFilename) {
      // Source maps — never shipped to clients on the hot path.
      if (/\.map$/.test(assetFilename)) return false
      // Fonts / images / icons — loaded independently, not part of the
      // JS entrypoint accounting.
      if (
        /\.(woff2?|ttf|eot|otf|png|jpg|jpeg|gif|svg|ico)$/.test(assetFilename)
      )
        return false
      // Monaco editor workers — independently loaded by the (already
      // lazy) editor chunk; counting them double-counts.
      if (/worker\.js$/.test(assetFilename)) return false
      // Async code-split chunks emitted by React.lazy() — webpack names
      // these `<id>.<contenthash>.js` (no `main`/`vendors` prefix). The
      // Monaco + Cytoscape chunks land here; they are fetched on demand
      // behind a Suspense boundary, not part of the initial download,
      // so they don't count against the budget. The entry (`main.js`)
      // and sync vendor (`vendors.js`) chunks are still gated.
      if (
        /\.js$/.test(assetFilename) &&
        !/^(main|vendors)\./.test(assetFilename)
      )
        return false
      return true
    },
  },
})
