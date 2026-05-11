/// <reference types="@testing-library/jest-dom" />
import fs from 'fs'
import path from 'path'
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { LocalizationProvider } from '../services/i18n'
import { testTheme as theme } from '../test-utils/theme'

// F10 (#54) — Monaco + Cytoscape lazy code-split.
//
// QueryPage now imports the Monaco-backed GqlEditor and the
// Cytoscape-backed GraphView via React.lazy(() => import(...)) behind
// <Suspense> boundaries. These tests pin two things:
//   1. The editor renders behind a Suspense boundary — the
//      "Loading editor…" fallback shows synchronously on first render,
//      then the lazily-imported editor mounts.
//   2. The monaco-bootstrap side-effect (which wires the bundled
//      monaco instance) rides inside the lazy GqlEditor module, not the
//      entry chunk — so it must NOT be a static import of QueryPage.
//
// We mock the heavy leaf modules (@monaco-editor/react, cytoscape) and
// the monaco-bootstrap side-effect so jest doesn't have to load the
// real (multi-MiB) Monaco bundle. The lazy boundary itself is exercised
// for real: React.lazy resolves the dynamic import to the (mocked)
// editor component asynchronously, which is what makes the Suspense
// fallback observable.
jest.mock('../monaco-bootstrap', () => ({}))
jest.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: (props: { value?: string }) => (
    <div data-testid="monaco-editor-stub">{props.value}</div>
  ),
}))
jest.mock('cytoscape', () => ({
  __esModule: true,
  default: () => ({
    on: jest.fn(),
    destroy: jest.fn(),
    add: jest.fn(),
    remove: jest.fn(),
    batch: (fn: () => void) => fn(),
    elements: () => ({ remove: jest.fn() }),
    layout: () => ({ run: jest.fn() }),
    nodes: () => ({ forEach: jest.fn() }),
    edges: () => ({ forEach: jest.fn() }),
    $id: () => ({ select: jest.fn() }),
  }),
}))
// The generated client's constructor snapshots fetch at construction
// time; the polyfill provides a rejecting stub, which is fine here —
// no test in this file issues a query.

import { QueryPage } from './QueryPage'

function renderPage(): void {
  render(
    <LocalizationProvider>
      <ThemeProvider theme={theme}>
        <QueryPage />
      </ThemeProvider>
    </LocalizationProvider>
  )
}

describe('F10: QueryPage lazy-loads Monaco behind a Suspense boundary', () => {
  test('shows the editor loading fallback, then mounts the lazy editor', async () => {
    renderPage()

    // First synchronous render: the lazy chunk has not resolved yet, so
    // the Suspense fallback is on screen.
    expect(screen.getByRole('status')).toHaveTextContent(/loading editor/i)
    expect(screen.queryByTestId('monaco-editor-stub')).not.toBeInTheDocument()

    // React.lazy resolves the dynamic import on a microtask; the real
    // (mocked) editor then replaces the fallback.
    await waitFor(() =>
      expect(screen.getByTestId('monaco-editor-stub')).toBeInTheDocument()
    )
    // The default statement flows through to the editor value.
    expect(screen.getByTestId('monaco-editor-stub')).toHaveTextContent(
      'MATCH (n) RETURN n LIMIT 25'
    )
  })
})

describe('F10: monaco-bootstrap is not a static import of QueryPage', () => {
  test('QueryPage module does not eagerly pull in monaco-bootstrap', () => {
    // The contract: monaco-editor / @monaco-editor/react are reachable
    // from QueryPage ONLY through the lazy import(). The QueryPage
    // source must not contain a top-level static import of the editor /
    // graph modules (those were replaced by React.lazy()).
    const src = fs.readFileSync(path.join(__dirname, 'QueryPage.tsx'), 'utf8')
    expect(src).not.toMatch(
      /^\s*import\s+\{\s*GqlEditor\s*\}\s+from\s+'\.\.\/components\/editor\/GqlEditor'/m
    )
    expect(src).not.toMatch(
      /^\s*import\s+\{\s*GraphView\s*\}\s+from\s+'\.\.\/components\/results\/GraphView'/m
    )
    // Both are React.lazy'd via a dynamic import().
    expect(src).toMatch(
      /React\.lazy\([\s\S]*import\(['"]\.\.\/components\/editor\/GqlEditor['"]\)/
    )
    expect(src).toMatch(
      /React\.lazy\([\s\S]*import\(['"]\.\.\/components\/results\/GraphView['"]\)/
    )
  })
})

describe('F10: src/index.tsx no longer eagerly imports monaco-bootstrap', () => {
  test('the entry module does not statically import monaco-bootstrap', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'index.tsx'), 'utf8')
    expect(src).not.toMatch(/^\s*import\s+'\.\/monaco-bootstrap'/m)
  })
})
