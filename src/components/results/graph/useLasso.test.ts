import { renderHook } from '@testing-library/react'
import { useLasso } from './useLasso'

type LassoFakeCore = {
  lassoSelectionEnabled: jest.Mock<unknown, [boolean]>
  // Bug 6: useLasso now toggles user panning + box selection alongside
  // lasso so click-drag draws the lasso polygon without requiring a
  // modifier key. Mock both so the hook can call them safely.
  userPanningEnabled: jest.Mock<unknown, [boolean]>
  boxSelectionEnabled: jest.Mock<unknown, [boolean]>
}

function makeCy(): LassoFakeCore {
  return {
    lassoSelectionEnabled: jest.fn(),
    userPanningEnabled: jest.fn(),
    boxSelectionEnabled: jest.fn(),
  }
}

describe('useLasso', () => {
  it('enables lasso when the prop flips to true', () => {
    const cy = makeCy()
    const cyRef = { current: cy as never }
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useLasso({ cyRef: cyRef as never, enabled, sig: 's1' }),
      { initialProps: { enabled: false } }
    )
    expect(cy.lassoSelectionEnabled).toHaveBeenLastCalledWith(false)
    rerender({ enabled: true })
    expect(cy.lassoSelectionEnabled).toHaveBeenLastCalledWith(true)
  })

  it('re-applies on sig change', () => {
    const cy = makeCy()
    const cyRef = { current: cy as never }
    const { rerender } = renderHook(
      ({ sig }: { sig: string }) =>
        useLasso({ cyRef: cyRef as never, enabled: true, sig }),
      { initialProps: { sig: 's1' } }
    )
    expect(cy.lassoSelectionEnabled).toHaveBeenCalledTimes(1)
    rerender({ sig: 's2' })
    expect(cy.lassoSelectionEnabled).toHaveBeenCalledTimes(2)
  })

  it('disables panning + enables box selection while lasso is active (Bug 6)', () => {
    const cy = makeCy()
    const cyRef = { current: cy as never }
    renderHook(() =>
      useLasso({ cyRef: cyRef as never, enabled: true, sig: 's1' })
    )
    expect(cy.userPanningEnabled).toHaveBeenLastCalledWith(false)
    expect(cy.boxSelectionEnabled).toHaveBeenLastCalledWith(true)
    expect(cy.lassoSelectionEnabled).toHaveBeenLastCalledWith(true)
  })

  it('restores caller-chosen panning + box selection when lasso turns off', () => {
    const cy = makeCy()
    const cyRef = { current: cy as never }
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useLasso({
          cyRef: cyRef as never,
          enabled,
          // Caller is in 'box' selection mode.
          restorePanningWhenDisabled: false,
          restoreBoxSelectionWhenDisabled: true,
          sig: 's1',
        }),
      { initialProps: { enabled: true } }
    )
    rerender({ enabled: false })
    expect(cy.lassoSelectionEnabled).toHaveBeenLastCalledWith(false)
    expect(cy.userPanningEnabled).toHaveBeenLastCalledWith(false)
    expect(cy.boxSelectionEnabled).toHaveBeenLastCalledWith(true)
  })
})
