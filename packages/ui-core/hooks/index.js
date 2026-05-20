// ESLint node-resolver shim. Real consumers use the "exports" field at runtime.
// This file exists so eslint-import-resolver-node can resolve @geodedb/ui-core/hooks
// without requiring eslint-import-resolver-typescript or exports-aware tooling.
module.exports = require('../dist/hooks/index.cjs')
