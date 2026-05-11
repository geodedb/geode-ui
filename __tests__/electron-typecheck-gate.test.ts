// Q25 / F-SUP-4 (#170, #160): the `electron-typecheck` CI job runs
// `npm run electron:tsc` (tsc --project electron/tsconfig.json), which
// only resolves once `electron` (for the `electron` module + the
// `Electron` namespace) and `@types/node` (electron/tsconfig.json
// references "types": ["node"]) are in devDependencies. The job used
// to be `allow_failure: true` precisely because those deps were
// missing. This guard pins both halves of the fix so a regression
// (someone drops the deps, or re-adds allow_failure) fails the suite
// instead of silently un-gating the Electron type-check.

import fs from 'fs'
import path from 'path'

const repoRoot = path.resolve(__dirname, '..')

describe('Q25: electron type-check is a real CI gate', () => {
  test('package.json devDependencies include electron and @types/node', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
    ) as { devDependencies?: Record<string, string> }
    const dev = pkg.devDependencies ?? {}
    expect(dev).toHaveProperty('electron')
    expect(dev).toHaveProperty('@types/node')
    expect(typeof dev.electron).toBe('string')
    expect(typeof dev['@types/node']).toBe('string')
  })

  test('electron/tsconfig.json still references the node lib types', () => {
    const tsconfig = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, 'electron', 'tsconfig.json'),
        'utf8'
      )
    ) as { compilerOptions?: { types?: string[] } }
    expect(tsconfig.compilerOptions?.types).toEqual(
      expect.arrayContaining(['node'])
    )
  })

  test('electron:tsc script runs tsc against electron/tsconfig.json', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
    ) as { scripts?: Record<string, string> }
    expect(pkg.scripts?.['electron:tsc']).toMatch(
      /tsc\s+--project\s+electron\/tsconfig\.json/
    )
  })

  test('the electron-typecheck CI job is NOT allow_failure', () => {
    const ci = fs.readFileSync(path.join(repoRoot, '.gitlab-ci.yml'), 'utf8')
    // Grab the `electron-typecheck:` job block (up to the next
    // top-level key / comment block) and assert it neither declares
    // `allow_failure: true` nor any `allow_failure:` line at all.
    const idx = ci.indexOf('\nelectron-typecheck:')
    expect(idx).toBeGreaterThan(-1)
    const rest = ci.slice(idx + 1)
    // The job block ends at the next line that starts in column 0 with
    // a non-space, non-`#` char (the next job) — comments (`#`) are
    // part of the surrounding documentation, so stop at the first
    // top-level YAML key instead.
    const lines = rest.split('\n')
    const block: string[] = [lines[0]!]
    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i]!
      if (/^[^\s#]/.test(line)) break
      block.push(line)
    }
    const jobText = block.join('\n')
    expect(jobText).toContain('npm run electron:tsc')
    expect(jobText).not.toMatch(/allow_failure\s*:\s*true/)
  })
})
