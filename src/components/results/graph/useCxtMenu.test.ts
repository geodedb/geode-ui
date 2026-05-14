import { renderHook } from '@testing-library/react'
import type { Theme } from '@/theme/types'
import { useCxtMenu, buildCommands } from './useCxtMenu'

// The hook only reads three theme tokens for cosmetic options; a
// minimal stub keeps the suite free of theme-module imports and lets
// the assertions stay focused on commands + lifecycle.
const stubTheme = {
  bg: { overlay: 'STUB_OVERLAY' },
  colors: { primary: 'STUB_PRIMARY' },
  text: { onPrimary: 'STUB_ON_PRIMARY' },
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
  it('mounts cxtmenu against the live core with selector node and the built commands', () => {
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
    expect(cy.cxtmenu).toHaveBeenCalledTimes(1)
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

  it('tears down + re-mounts when sig changes (cy core rebuilt)', () => {
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
    expect(cy.cxtmenu).toHaveBeenCalledTimes(1)
    rerender({ sig: 's2' })
    expect(cy.cxtmenu).toHaveBeenCalledTimes(2)
  })
})
