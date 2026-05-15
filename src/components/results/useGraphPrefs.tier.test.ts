import { act, renderHook } from '@testing-library/react'
import { useGraphPrefs } from './useGraphPrefs'

describe('useGraphPrefs — tier + effective selectors', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('defaults: tier=small, useWorkerLayout=true', () => {
    const { result } = renderHook(() => ({
      tier: useGraphPrefs((s) => s.tier),
      useWorkerLayout: useGraphPrefs((s) => s.useWorkerLayout),
    }))
    expect(result.current.tier).toBe('small')
    expect(result.current.useWorkerLayout).toBe(true)
  })

  it('setTier mutates the store', () => {
    const { result } = renderHook(() => useGraphPrefs((s) => s))
    act(() => result.current.setTier('large'))
    expect(useGraphPrefs.getState().tier).toBe('large')
  })

  it('effectiveDomNodes = user pref AND tier-allow', () => {
    const { result } = renderHook(() => useGraphPrefs((s) => s))
    act(() => {
      result.current.setDomNodes(true)
      result.current.setTier('small')
    })
    expect(useGraphPrefs.getState().effectiveDomNodes()).toBe(true)
    act(() => result.current.setTier('mid'))
    expect(useGraphPrefs.getState().effectiveDomNodes()).toBe(false)
  })

  it('effectiveCxtMenu / Tooltips / Badges flip off only in "large"', () => {
    const { result } = renderHook(() => useGraphPrefs((s) => s))
    act(() => result.current.setTier('mid'))
    const mid = useGraphPrefs.getState()
    expect(mid.effectiveCxtMenu()).toBe(true)
    expect(mid.effectiveTooltips()).toBe(true)
    expect(mid.effectiveBadges()).toBe(true)
    act(() => result.current.setTier('large'))
    const lg = useGraphPrefs.getState()
    expect(lg.effectiveCxtMenu()).toBe(false)
    expect(lg.effectiveTooltips()).toBe(false)
    expect(lg.effectiveBadges()).toBe(false)
  })
})
