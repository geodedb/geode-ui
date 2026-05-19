import { renderHook, waitFor } from '@testing-library/react'
import type { Theme } from '@/theme/types'
import { useCxtMenu, buildCommands } from './useCxtMenu'

// PERF #316: useCxtMenu now lazy-imports cytoscape-cxtmenu when the
// hook fires with enabled=true (or the default). The cy.cxtmenu()
// factory call therefore lands after a microtask; tests await via
// waitFor before asserting on the call shape.

// The hook only reads three theme tokens for cosmetic options; a
// minimal stub keeps the suite free of theme-module imports and lets
// the assertions stay focused on commands + lifecycle.
const stubTheme = {
  bg: { inverse: 'STUB_INVERSE_BG' },
  colors: { primary: 'STUB_PRIMARY' },
  text: { inverse: 'STUB_INVERSE_TEXT' },
} as unknown as Theme

describe('buildCommands', () => {
  it('emits one command per visible action with i18n labels and handlers', () => {
    const handlers = {
      onZoomTo: jest.fn(),
      onExpand: jest.fn(),
      onHide: jest.fn(),
      onCollapse: jest.fn(),
      onFocus: jest.fn(),
      onPin: jest.fn(),
      onCopyId: jest.fn(),
    }
    const t = (k: string) => k
    const cmds = buildCommands({ handlers, t })
    expect(cmds.map((c) => c.id)).toEqual([
      'zoomTo',
      'expand',
      'hide',
      'collapse',
      'focus',
      'pin',
      'copyId',
    ])
    expect(cmds[0]!.content).toBe('graph.menuZoomTo')
    expect(cmds[1]!.content).toBe('graph.menuExpand')
    expect(cmds[2]!.content).toBe('graph.actionHide')
    const fakeNode = { id: () => 'n7' }
    cmds[0]!.select(fakeNode as never)
    expect(handlers.onZoomTo).toHaveBeenCalledWith('n7')
    cmds[5]!.select(fakeNode as never)
    expect(handlers.onPin).toHaveBeenCalledWith('n7')
  })
})

type CxtFakeCore = {
  cxtmenu: jest.Mock
}

function makeCxtCy(): CxtFakeCore {
  const destroy = jest.fn()
  return {
    cxtmenu: jest.fn(() => ({ destroy })) as unknown as jest.Mock,
  }
}

describe('useCxtMenu', () => {
  it('mounts cxtmenu against the live core with selector node and the built commands', async () => {
    const cy = makeCxtCy()
    const cyRef = { current: cy as never }
    const handlers = {
      onZoomTo: jest.fn(),
      onExpand: jest.fn(),
      onHide: jest.fn(),
      onCollapse: jest.fn(),
      onFocus: jest.fn(),
      onPin: jest.fn(),
      onCopyId: jest.fn(),
    }
    renderHook(() =>
      useCxtMenu({
        cyRef: cyRef as never,
        handlers,
        t: (k) => k,
        theme: stubTheme,
        sig: 's1',
      })
    )
    await waitFor(() => expect(cy.cxtmenu).toHaveBeenCalledTimes(1))
    const opts = cy.cxtmenu.mock.calls[0][0] as {
      selector?: string
      openMenuEvents?: string
      commands?: { id: string }[]
    }
    expect(opts.selector).toBe('node')
    expect(opts.openMenuEvents).toContain('cxttap')
    expect(opts.openMenuEvents).toContain('taphold')
    expect(opts.commands?.map((c) => c.id)).toEqual([
      'zoomTo',
      'expand',
      'hide',
      'collapse',
      'focus',
      'pin',
      'copyId',
    ])
  })

  it('tears down + re-mounts when sig changes (cy core rebuilt)', async () => {
    const cy = makeCxtCy()
    const cyRef = { current: cy as never }
    const handlers = {
      onZoomTo: jest.fn(),
      onExpand: jest.fn(),
      onHide: jest.fn(),
      onCollapse: jest.fn(),
      onFocus: jest.fn(),
      onPin: jest.fn(),
      onCopyId: jest.fn(),
    }
    const { rerender } = renderHook(
      ({ sig }: { sig: string }) =>
        useCxtMenu({
          cyRef: cyRef as never,
          handlers,
          t: (k) => k,
          theme: stubTheme,
          sig,
        }),
      { initialProps: { sig: 's1' } }
    )
    await waitFor(() => expect(cy.cxtmenu).toHaveBeenCalledTimes(1))
    rerender({ sig: 's2' })
    await waitFor(() => expect(cy.cxtmenu).toHaveBeenCalledTimes(2))
  })

  it('uses inverse-theme tokens for fillColor + itemColor (legibility on light theme)', async () => {
    const cy = makeCxtCy()
    const cyRef = { current: cy as never }
    const inverseStubTheme = {
      bg: { inverse: '#1c0f2e' },
      text: { inverse: '#f7f2ff' },
      colors: { primary: '#5b34c7' },
    }
    const handlers = {
      onZoomTo: jest.fn(),
      onExpand: jest.fn(),
      onHide: jest.fn(),
      onCollapse: jest.fn(),
      onFocus: jest.fn(),
      onPin: jest.fn(),
      onCopyId: jest.fn(),
    }
    renderHook(() =>
      useCxtMenu({
        cyRef: cyRef as never,
        handlers,
        t: (k) => k,
        sig: 's1',
        theme: inverseStubTheme as never,
      })
    )
    await waitFor(() => expect(cy.cxtmenu).toHaveBeenCalledTimes(1))
    const opts = cy.cxtmenu.mock.calls[0]?.[0] as {
      fillColor: string
      itemColor: string
      activeFillColor: string
    }
    expect(opts.fillColor).toBe('#1c0f2e')
    expect(opts.itemColor).toBe('#f7f2ff')
    expect(opts.activeFillColor).toBe('#5b34c7')
  })
})
