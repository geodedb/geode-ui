import { renderHook } from '@testing-library/react'
import { useLasso } from './useLasso'

type LassoFakeCore = {
  lassoSelectionEnabled: jest.Mock<unknown, [boolean]>
}

function makeCy(): LassoFakeCore {
  return { lassoSelectionEnabled: jest.fn() }
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
})
