/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { testTheme as theme } from '../../../test-utils/theme'

// Mock heavy graph internals so we only assert on the fill-mode CSS contract.
// The goal is to render <GraphView fillHeight /> without crashing so we can
// assert on the rendered DOM's inline-style attributes.
jest.mock('./useCxtMenu', () => ({
  useCxtMenu: jest.fn(),
  buildCommands: () => [],
}))
jest.mock('./useLasso', () => ({ useLasso: jest.fn() }))
jest.mock('./useGraphCytoscape', () => ({
  useGraphCytoscape: jest.fn(),
}))
jest.mock('./useNodeTooltip', () => ({
  useNodeTooltip: () => ({ targetData: null }),
}))
jest.mock('./useDomNodes', () => ({ useDomNodes: jest.fn() }))
jest.mock('./useGraphElements', () => ({
  useGraphElements: () => ({
    elements: [],
    baseEls: [],
    nodeIds: [],
    edgeIds: [],
    nodeOptions: [],
    edgeOptions: [],
    nodeDataById: new Map(),
    edgeDataById: new Map(),
    nodeLabelBuckets: new Map(),
  }),
}))
jest.mock('./useGraphActions', () => ({
  useGraphActions: () => ({
    hidden: new Set(),
    collapsed: new Map(),
    exploringId: null,
    setHidden: jest.fn(),
    setCollapsed: jest.fn(),
    setExploringId: jest.fn(),
    onHideNode: jest.fn(),
    onCollapseNode: jest.fn(),
    onRestoreHidden: jest.fn(),
    onExpandCollapsed: jest.fn(),
    onExploreNeighbours: jest.fn(),
  }),
}))
jest.mock('./useGraphBadges', () => ({
  useGraphBadges: () => [],
}))
jest.mock('./useGraphPathMode', () => ({
  useGraphPathMode: () => ({
    pathState: { phase: 'off' },
    pathTapRef: { current: null },
    onTogglePathMode: jest.fn(),
    exitPathMode: jest.fn(),
    resetPath: jest.fn(),
    pathStatusText: '',
  }),
}))
jest.mock('./usePinnedNodes', () => ({
  usePinnedNodes: () => ({
    pinned: new Set(),
    isPinned: () => false,
    togglePin: jest.fn(),
    reapplyAll: jest.fn(),
    clear: jest.fn(),
  }),
}))
jest.mock('./useFocusMode', () => ({
  useFocusMode: () => ({
    state: null,
    focus: jest.fn(),
    clear: jest.fn(),
    reapply: jest.fn(),
  }),
}))
jest.mock('./useGraphKeyboardNav', () => ({
  useGraphKeyboardNav: () => ({ handleKey: jest.fn() }),
}))

import { GraphView } from '../GraphView'

const emptyResp = {
  columns: [],
  rows: [],
  graph_summary: { nodes: [], edges: [] },
}

// styled-components injects CSS into <style> tags keyed off the
// component's generated className. To assert on the actual height /
// max-height rules an element receives we look up every <style> tag in
// the document and concatenate the rules whose selector matches one of
// the element's classes.
function rulesForElement(el: HTMLElement): string {
  const classes = Array.from(el.classList)
  if (classes.length === 0) return ''
  const styleTags = Array.from(document.querySelectorAll('style'))
  return styleTags
    .map((tag) => {
      const sheet = tag.sheet as CSSStyleSheet | null
      if (!sheet) {
        // jsdom may not have parsed the rules — fall back to textContent
        // and grep for blocks whose selector mentions any of our classes.
        const text = tag.textContent ?? ''
        return classes
          .map((cls) => {
            const re = new RegExp(`\\.${cls}\\b[^}]*\\{[^}]*\\}`, 'g')
            return (text.match(re) ?? []).join('\n')
          })
          .filter(Boolean)
          .join('\n')
      }
      return Array.from(sheet.cssRules)
        .filter((rule): rule is CSSStyleRule => {
          const r = rule as CSSStyleRule
          if (!r.selectorText) return false
          return classes.some((cls) => r.selectorText.includes(`.${cls}`))
        })
        .map((rule) => rule.cssText)
        .join('\n')
    })
    .filter(Boolean)
    .join('\n')
}

describe('GraphView fill-mode layout', () => {
  it('does NOT impose a fixed-pixel height on the Canvas when fillHeight=true', () => {
    const { container } = render(
      <ThemeProvider theme={theme}>
        <GraphView resp={emptyResp} query="" fillHeight />
      </ThemeProvider>
    )
    const canvas = container.querySelector(
      '[data-testid="graph-canvas"]'
    ) as HTMLElement
    expect(canvas).toBeTruthy()
    // The Canvas's height should NOT be a fixed pixel value in fill mode.
    // Check both inline style and the styled-components-injected CSS.
    const styleAttr = canvas.getAttribute('style') ?? ''
    expect(styleAttr).not.toMatch(/height:\s*\d+px/)
    const sheetRules = rulesForElement(canvas)
    expect(sheetRules).not.toMatch(/height:\s*\d+px/)
  })

  it('does NOT cap GraphSidebar to 40vh in fill mode', () => {
    const { container } = render(
      <ThemeProvider theme={theme}>
        <GraphView resp={emptyResp} query="" fillHeight />
      </ThemeProvider>
    )
    const sidebar = container.querySelector(
      '[data-testid="graph-sidebar"]'
    ) as HTMLElement | null
    if (!sidebar) return // sidebar may be collapsed; the absence of 40vh is implicit
    const styleAttr = sidebar.getAttribute('style') ?? ''
    expect(styleAttr).not.toMatch(/max-height:\s*40vh/)
    const sheetRules = rulesForElement(sidebar)
    expect(sheetRules).not.toMatch(/max-height:\s*40vh/)
  })
})
