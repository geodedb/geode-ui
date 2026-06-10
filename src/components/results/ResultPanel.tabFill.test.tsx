/// <reference types="@testing-library/jest-dom" />
//
// Reproduction test for Bug A — the graph canvas isn't reliably filling
// the vertical space below the tab strip. Root cause (per triage):
// styled-components emits flex/min-height rules against the light-DOM
// `wa-tab-panel` host, but Web Awesome's shadow-DOM `::part(base)` does
// NOT receive `flex: 1 1 0; min-height: 0`, so the active panel's
// shadow wrapper computes as `flex: 0 1 auto` and the inner content
// (Cytoscape Canvas) only claims its intrinsic height.
//
// The fix must add a `wa-tab-panel::part(base)` rule with the same
// flex/min-height/height semantics so the chain propagates into the
// shadow tree.
//
// We assert against the styled-components-generated CSS string because
// jsdom cannot evaluate `::part()` selectors against custom-element
// shadow roots. The CSS text is the contract; the visual outcome is
// covered by the Playwright canvas-height smoke in the e2e suite.

import React from 'react'
import { render } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { MemoryRouter } from 'react-router-dom'
import { LocalizationProvider } from '../../services/i18n'
import { testTheme as theme } from '../../test-utils/theme'

jest.mock('../../monaco-bootstrap', () => ({}))
jest.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: () => null,
}))

import { ResultPanel } from './ResultPanel'

function renderPanel(): void {
  render(
    <MemoryRouter>
      <LocalizationProvider>
        <ThemeProvider theme={theme}>
          <ResultPanel
            resp={{ columns: [], rows: [], rowCount: 0, elapsedMs: 0 }}
            query=""
            tab="table"
            onTabChange={() => {}}
            expand
          />
        </ThemeProvider>
      </LocalizationProvider>
    </MemoryRouter>
  )
}

function collectStyleText(): string {
  return Array.from(document.head.querySelectorAll('style'))
    .map((s) => s.textContent ?? '')
    .join('\n')
}

describe('Bug A — ResultPanel propagates flex chain into wa-tab-panel shadow', () => {
  it('emits a wa-tab-panel::part(base) rule with flex:1 1 0 and min-height:0', () => {
    renderPanel()
    const css = collectStyleText()
    // The light-DOM rules already exist (and are kept). The fix adds a
    // shadow-DOM ::part(base) rule so the chain reaches the inner
    // wrapper that hosts the active panel content.
    expect(css).toMatch(/wa-tab-panel::part\(base\)/)
    // The ::part(base) block must carry flex-grow + min-height:0 so
    // the active panel's content (Canvas) gets to claim the remaining
    // vertical space.
    const partRule = css.match(/wa-tab-panel::part\(base\)[^}]*\}/)
    expect(partRule).not.toBeNull()
    if (partRule) {
      expect(partRule[0]).toMatch(/flex:\s*1\s+1\s+0/)
      expect(partRule[0]).toMatch(/min-height:\s*0/)
      // The shadow wrapper must also be a flex column so its child
      // (the panel content) inherits the same fill semantics.
      expect(partRule[0]).toMatch(/display:\s*flex/)
      expect(partRule[0]).toMatch(/flex-direction:\s*column/)
    }
  })
})
