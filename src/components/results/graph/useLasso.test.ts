import { renderHook, waitFor } from '@testing-library/react'
import { useLasso } from './useLasso'

// PERF #316: useLasso now lazy-imports cytoscape-lasso when the pref
// flips to enabled, so any test that exercises the enabled=true
// branch must `await` for the dynamic import + cytoscape.use()
// registration before asserting on the cy method calls. The
// `enabled=false` branch stays synchronous (no plugin needed to
// restore panning state).

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
  it('enables lasso when the prop flips to true', async () => {
    const cy = makeCy()
    const cyRef = { current: cy as never }
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useLasso({ cyRef: cyRef as never, enabled, sig: 's1' }),
      { initialProps: { enabled: false } }
    )
    expect(cy.lassoSelectionEnabled).toHaveBeenLastCalledWith(false)
    rerender({ enabled: true })
    await waitFor(() =>
      expect(cy.lassoSelectionEnabled).toHaveBeenLastCalledWith(true)
    )
  })

  it('re-applies on sig change', async () => {
    const cy = makeCy()
    const cyRef = { current: cy as never }
    const { rerender } = renderHook(
      ({ sig }: { sig: string }) =>
        useLasso({ cyRef: cyRef as never, enabled: true, sig }),
      { initialProps: { sig: 's1' } }
    )
    await waitFor(() =>
      expect(cy.lassoSelectionEnabled).toHaveBeenCalledTimes(1)
    )
    rerender({ sig: 's2' })
    await waitFor(() =>
      expect(cy.lassoSelectionEnabled).toHaveBeenCalledTimes(2)
    )
  })

  it('disables panning + enables box selection while lasso is active (Bug 6)', async () => {
    const cy = makeCy()
    const cyRef = { current: cy as never }
    renderHook(() =>
      useLasso({ cyRef: cyRef as never, enabled: true, sig: 's1' })
    )
    await waitFor(() => {
      expect(cy.userPanningEnabled).toHaveBeenLastCalledWith(false)
      expect(cy.boxSelectionEnabled).toHaveBeenLastCalledWith(true)
      expect(cy.lassoSelectionEnabled).toHaveBeenLastCalledWith(true)
    })
  })

  it('restores caller-chosen panning + box selection when lasso turns off', async () => {
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
    // Wait for the initial enabled=true apply to land before flipping.
    await waitFor(() =>
      expect(cy.lassoSelectionEnabled).toHaveBeenLastCalledWith(true)
    )
    rerender({ enabled: false })
    // Disable path is synchronous (no plugin load needed), but the
    // waitFor wrapper is harmless and reads more uniformly.
    await waitFor(() => {
      expect(cy.lassoSelectionEnabled).toHaveBeenLastCalledWith(false)
      expect(cy.userPanningEnabled).toHaveBeenLastCalledWith(false)
      expect(cy.boxSelectionEnabled).toHaveBeenLastCalledWith(true)
    })
  })
})
