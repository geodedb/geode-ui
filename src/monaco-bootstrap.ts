// monaco-bootstrap — wire @monaco-editor/react to the webpack-bundled
// monaco-editor instance.
//
// Default behavior of @monaco-editor/react is to lazy-fetch monaco from
// cdn.jsdelivr.net via an AMD loader, which our CSP rejects (no CDN
// allowed in script-src). monaco-editor-webpack-plugin (configured in
// webpack.common.js) bundles monaco's core + workers into the SPA
// chunks and emits a MonacoEnvironment.getWorker that loads them from
// same-origin URLs (covered by worker-src 'self' blob:). Calling
// loader.config({ monaco }) tells the React wrapper to skip the
// network fetch and use the bundled instance.

import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'

loader.config({ monaco })
