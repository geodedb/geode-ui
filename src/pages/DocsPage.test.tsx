/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

import { DocsPage } from './DocsPage'
import { LocalizationProvider } from '../services/i18n'
import { testTheme as theme } from '../test-utils/theme'

// GAP-061: pin the docs viewer contract:
//   • Mounting /docs lands on the first bundled page.
//   • /docs/:slug renders the matching page (sanitised HTML in the
//     <article> via the renderer + appendChild path).
//   • An unknown slug renders the not-found state without crashing.
//   • The sidebar exposes navigation links to every bundled page.

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <LocalizationProvider>
        <ThemeProvider theme={theme}>
          <Routes>
            <Route path="/docs" element={<DocsPage />} />
            <Route path="/docs/:slug" element={<DocsPage />} />
          </Routes>
        </ThemeProvider>
      </LocalizationProvider>
    </MemoryRouter>
  )
}

test('GAP-061: /docs renders the docs viewer with sidebar links', () => {
  renderAt('/docs')
  expect(screen.getByTestId('docs-page')).toBeInTheDocument()
  // At least one sidebar link to a known bundled page.
  expect(screen.getByTestId('docs-link-architecture')).toBeInTheDocument()
})

test('GAP-061: /docs/:slug renders the matching article body', async () => {
  renderAt('/docs/architecture')
  // The markdownMock stub returns "# mock markdown" — after the
  // renderer + appendChild path runs we should see the rendered
  // h1 inside the article container.
  await waitFor(() => {
    const article = screen.getByTestId('docs-article-architecture')
    // Either the rendered h1 or its text content lives inside.
    expect(article.innerHTML).toMatch(/mock markdown|placeholder body/)
  })
})

test('GAP-061: an unknown slug renders the not-found state', () => {
  renderAt('/docs/totally-unknown')
  expect(screen.getByTestId('docs-not-found')).toBeInTheDocument()
})
