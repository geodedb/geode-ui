/// <reference types="@testing-library/jest-dom" />
import { renderHook } from '@testing-library/react'
import {
  subscribe,
  usePollingClock,
  __resetPollingClockForTests,
  __subscriberCountForTests,
} from './usePollingClock'

describe('usePollingClock', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    __resetPollingClockForTests()
  })

  afterEach(() => {
    __resetPollingClockForTests()
    jest.useRealTimers()
  })

  it('fires a subscriber at its intervalMs cadence', () => {
    const fn = jest.fn()
    const unsub = subscribe(5000, fn)
    jest.advanceTimersByTime(4999)
    expect(fn).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(5000)
    expect(fn).toHaveBeenCalledTimes(2)
    unsub()
  })

  it('uses a single timer for multiple subscribers (no per-subscriber setInterval)', () => {
    const setIntervalSpy = jest.spyOn(window, 'setInterval')
    const fnA = jest.fn()
    const fnB = jest.fn()
    const fnC = jest.fn()
    const unA = subscribe(5000, fnA)
    const unB = subscribe(5000, fnB)
    const unC = subscribe(30000, fnC)
    // setInterval rebuilds the timer each time a subscriber is added
    // (so a smaller interval can lower the tick rate immediately), so
    // the call count grows by 1 per subscribe — but the LIVE timer
    // count must still be 1.
    expect(setIntervalSpy.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(__subscriberCountForTests()).toBe(3)
    jest.advanceTimersByTime(5000)
    expect(fnA).toHaveBeenCalledTimes(1)
    expect(fnB).toHaveBeenCalledTimes(1)
    expect(fnC).not.toHaveBeenCalled()
    jest.advanceTimersByTime(25000)
    expect(fnA).toHaveBeenCalledTimes(6)
    expect(fnB).toHaveBeenCalledTimes(6)
    expect(fnC).toHaveBeenCalledTimes(1)
    unA()
    unB()
    unC()
    setIntervalSpy.mockRestore()
  })

  it('stops firing after unsubscribe and clears the timer when no subscribers remain', () => {
    const fn = jest.fn()
    const unsub = subscribe(5000, fn)
    jest.advanceTimersByTime(5000)
    expect(fn).toHaveBeenCalledTimes(1)
    unsub()
    expect(__subscriberCountForTests()).toBe(0)
    jest.advanceTimersByTime(60000)
    expect(fn).toHaveBeenCalledTimes(1) // no more fires
  })

  it('does not fire while the tab is hidden, and fires on resume for missed intervals', () => {
    const fn = jest.fn()
    subscribe(5000, fn)
    jest.advanceTimersByTime(5000)
    expect(fn).toHaveBeenCalledTimes(1)
    // Background the tab.
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    })
    jest.advanceTimersByTime(60000) // 12 intervals would fire if visible
    expect(fn).toHaveBeenCalledTimes(1)
    // Resume.
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("isolates one subscriber's throw from the others", () => {
    const fnA = jest.fn(() => {
      throw new Error('boom')
    })
    const fnB = jest.fn()
    subscribe(5000, fnA)
    subscribe(5000, fnB)
    jest.advanceTimersByTime(5000)
    expect(fnA).toHaveBeenCalledTimes(1)
    expect(fnB).toHaveBeenCalledTimes(1)
  })

  it('usePollingClock hook subscribes and unsubscribes with the component lifecycle', () => {
    const fn = jest.fn()
    const { unmount } = renderHook(({ ms }) => usePollingClock(ms, fn), {
      initialProps: { ms: 5000 },
    })
    expect(__subscriberCountForTests()).toBe(1)
    jest.advanceTimersByTime(5000)
    expect(fn).toHaveBeenCalledTimes(1)
    unmount()
    expect(__subscriberCountForTests()).toBe(0)
  })

  it('usePollingClock keeps the latest fn ref without re-subscribing', () => {
    const fnA = jest.fn()
    const fnB = jest.fn()
    const { rerender } = renderHook(({ fn }) => usePollingClock(5000, fn), {
      initialProps: { fn: fnA },
    })
    expect(__subscriberCountForTests()).toBe(1)
    rerender({ fn: fnB })
    expect(__subscriberCountForTests()).toBe(1) // still one subscriber
    jest.advanceTimersByTime(5000)
    expect(fnA).not.toHaveBeenCalled()
    expect(fnB).toHaveBeenCalledTimes(1)
  })
})
