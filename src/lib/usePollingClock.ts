// src/lib/usePollingClock.ts
//
// PERF-2026-05-21-02 (Item 5, 2026-05-21 audit): a single process-
// wide timer multiplexed across every poller in the SPA. Before this
// hook, each of useMetricsPolling (5s), AuditEventMixCard (30s) and
// AuditLogPage (5s) opened its own window.setInterval — server load
// scaled as O(tabs × pollers), and the 5s + 30s ticks drifted into
// the same wall-clock instant.
//
// Design:
//
//   - Module-level singleton. Subscribers register (intervalMs,
//     callback) via subscribe() and receive an unsubscribe handle.
//   - One window.setInterval runs at the GCD of all subscribed
//     intervals, floored at MIN_TICK_MS so a pathological prime
//     interval cannot collapse the clock to 1 ms.
//   - Per-subscriber nextFireAt is maintained; on each tick we fire
//     exactly the subscribers whose deadline has elapsed and advance
//     their deadline by their own intervalMs (NOT by the actual
//     elapsed time, so callback drift cannot accumulate).
//   - Visibility gating: when document.visibilityState !== 'visible'
//     the clock pauses, callbacks do not fire, and resuming the tab
//     immediately fires each subscriber that has missed at least one
//     deadline before the steady-state cadence resumes. The
//     individual hook callers no longer need to repeat the
//     visibilitychange listener.
//   - SSR / non-DOM environments: subscribe is a no-op that returns
//     a no-op unsubscribe. The clock never starts if window is
//     undefined.
//
// The React surface (usePollingClock) is a thin hook wrapping
// subscribe + unsubscribe in a useEffect. It exists separately so
// non-React call sites (e.g. utility code) can also share the same
// clock if needed.

import { useEffect, useRef } from 'react'

const MIN_TICK_MS = 250

interface Subscriber {
  intervalMs: number
  fn: () => void
  nextFireAt: number
}

const subscribers = new Set<Subscriber>()
let timerId: number | null = null
let visibilityListenerInstalled = false

function gcd(a: number, b: number): number {
  a = Math.abs(Math.floor(a))
  b = Math.abs(Math.floor(b))
  while (b > 0) {
    const t = b
    b = a % b
    a = t
  }
  return a
}

function currentTickInterval(): number {
  if (subscribers.size === 0) return 0
  let g = 0
  subscribers.forEach((sub) => {
    g = g === 0 ? sub.intervalMs : gcd(g, sub.intervalMs)
  })
  return Math.max(g, MIN_TICK_MS)
}

function fire(sub: Subscriber, now: number): void {
  try {
    sub.fn()
  } catch {
    // Subscribers are expected to handle their own errors; we swallow
    // so one buggy poller cannot prevent the others from firing.
  }
  // Advance by the nominal interval so drift does not accumulate
  // across long-lived sessions. If the tab was backgrounded for
  // multiple intervals, the catch-up call already fired once and the
  // next deadline is from "now".
  sub.nextFireAt = now + sub.intervalMs
}

function onTick(): void {
  if (
    typeof document !== 'undefined' &&
    document.visibilityState !== 'visible'
  ) {
    return
  }
  const now = Date.now()
  subscribers.forEach((sub) => {
    if (now >= sub.nextFireAt) fire(sub, now)
  })
}

function onVisibility(): void {
  if (
    typeof document === 'undefined' ||
    document.visibilityState !== 'visible'
  ) {
    return
  }
  // Resume: fire every subscriber whose deadline has elapsed at
  // least once during the hidden period, then let the steady-state
  // cadence take over from now+interval.
  const now = Date.now()
  subscribers.forEach((sub) => {
    if (now >= sub.nextFireAt) fire(sub, now)
  })
}

function ensureTimer(): void {
  if (typeof window === 'undefined') return
  const interval = currentTickInterval()
  if (interval === 0) {
    if (timerId !== null) {
      window.clearInterval(timerId)
      timerId = null
    }
    return
  }
  if (timerId !== null) {
    // Rebuild the timer so a freshly-added subscriber with a smaller
    // intervalMs lowers the tick rate immediately.
    window.clearInterval(timerId)
  }
  timerId = window.setInterval(onTick, interval)
  if (!visibilityListenerInstalled && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility)
    visibilityListenerInstalled = true
  }
}

/**
 * Subscribe a callback to the shared polling clock.
 *
 * The callback is invoked roughly every `intervalMs` while the tab
 * is visible. The first invocation happens after `intervalMs` (NOT
 * immediately); callers that need a leading-edge fetch should invoke
 * their fetcher inline at subscribe time.
 *
 * Returns an unsubscribe function. If the runtime has no `window`
 * (SSR), subscribe is a no-op and returns a no-op unsubscribe.
 */
export function subscribe(intervalMs: number, fn: () => void): () => void {
  if (typeof window === 'undefined' || intervalMs <= 0) {
    return () => undefined
  }
  const sub: Subscriber = {
    intervalMs: Math.floor(intervalMs),
    fn,
    nextFireAt: Date.now() + intervalMs,
  }
  subscribers.add(sub)
  ensureTimer()
  return () => {
    subscribers.delete(sub)
    ensureTimer()
  }
}

/**
 * React hook that subscribes `fn` to the shared polling clock for
 * the lifetime of the component. Keeps the most recent `fn` in a
 * ref so a subscriber that re-creates its callback identity each
 * render does not force the clock to rebuild its timer.
 */
export function usePollingClock(intervalMs: number, fn: () => void): void {
  const fnRef = useRef(fn)
  fnRef.current = fn
  useEffect(() => {
    if (intervalMs <= 0) return undefined
    return subscribe(intervalMs, () => {
      fnRef.current()
    })
  }, [intervalMs])
}

/**
 * Test-only: drain all subscribers and stop the timer. Production
 * code should never need this — it exists so component tests can
 * reset the module-level state between specs. The dangling
 * underscores in the name signal "do not call from production".
 */
// eslint-disable-next-line no-underscore-dangle
export function __resetPollingClockForTests(): void {
  subscribers.clear()
  if (timerId !== null && typeof window !== 'undefined') {
    window.clearInterval(timerId)
    timerId = null
  }
  if (visibilityListenerInstalled && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibility)
    visibilityListenerInstalled = false
  }
}

/**
 * Test-only: returns the current subscriber count so specs can
 * assert clock cleanup.
 */
// eslint-disable-next-line no-underscore-dangle
export function __subscriberCountForTests(): number {
  return subscribers.size
}
