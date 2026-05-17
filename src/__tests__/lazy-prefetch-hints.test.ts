import * as fs from 'fs'
import * as path from 'path'

// PERF #256: the Monaco-backed editor and Cytoscape-backed graph view
// are React.lazy'd at their respective call sites so webpack emits
// them as separate async chunks. Without a prefetch hint the browser
// only requests the chunk when the user navigates to the route — a
// noticeable cold-start tax (Monaco is ~MiB-scale; Cytoscape ~hundreds
// of KiB). This test pins the magic-comment contract so a refactor of
// the dynamic import (e.g. switch to `loadable-components` or a
// regression that drops the comment formatting webpack requires) does
// not silently lose the optimisation.
//
// The check is on the source files because webpack consumes the
// `/* webpackPrefetch: true */` magic comment at build time — it does
// not survive into a runtime artefact we could probe.

const here = path.dirname(__filename)
const repoRoot = path.resolve(here, '..', '..')

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8')
}

describe('PERF #256 webpackPrefetch hints', () => {
  it('GqlEditor lazy import in QueryPage carries webpackPrefetch + named chunk', () => {
    const src = readSrc('src/pages/QueryPage.tsx')
    // The named chunk must match the build output so DevTools shows a
    // human-readable name in the Network panel.
    expect(src).toContain('webpackChunkName: "gql-editor"')
    expect(src).toMatch(/webpackPrefetch:\s*true/)
  })

  it('GraphView lazy import in ResultPanel carries webpackPrefetch + named chunk', () => {
    const src = readSrc('src/components/results/ResultPanel.tsx')
    expect(src).toContain('webpackChunkName: "graph-view"')
    expect(src).toMatch(/webpackPrefetch:\s*true/)
  })
})
