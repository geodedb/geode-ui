import { useCallback, useEffect, useRef, useState } from 'react'

// useApiResource centralizes the `useEffect → fetch → setState` pattern
// that previously lived inline in 7+ admin/ops pages. It owns:
//
//   1. An AbortController per effect run, aborted on cleanup.
//   2. Mounted/aborted guards so setState calls after unmount or abort
//      are no-ops (avoiding the React "set state on unmounted component"
//      warning).
//   3. AbortError filtering -- a cancelled request is silent, never
//      surfaces an error to the UI.
//   4. A stable `refetch` action that opens a fresh controller without
//      depending on `deps` changing.
//
// The fetcher callback receives the AbortSignal so callers can wire it
// through to the underlying transport when the transport accepts one
// (e.g. `fetch(url, { signal })`). Today the genapi-emitted client does
// not expose a per-call signal (its `fetchImpl` is captured at construction);
// the hook still provides correct stale-resolve semantics by gating
// every setState on the controller's signal. When genapi grows
// signal-passthrough, callers can adopt it without changing the hook.

export type Status = 'idle' | 'loading' | 'success' | 'error'

export type UseApiResourceResult<T> = {
  data: T | null
  status: Status
  error: string | null
  refetch: () => void
}

export function useApiResource<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: ReadonlyArray<unknown>
): UseApiResourceResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)

  // mountedRef guards setState after unmount; effect-cleanup flips it
  // to false. controllerRef exposes the active controller to refetch().
  const mountedRef = useRef(true)
  const controllerRef = useRef<AbortController | null>(null)
  // Keep the latest fetcher in a ref so refetch()'s identity does not
  // depend on fetcher identity (callers commonly pass an inline arrow
  // and we don't want refetch to thrash).
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  // run kicks off a fresh request using a brand-new controller. It
  // aborts any prior in-flight controller before starting so two
  // concurrent runs from this hook never coexist.
  const run = useCallback((): void => {
    if (controllerRef.current) {
      controllerRef.current.abort()
    }
    const controller = new AbortController()
    controllerRef.current = controller
    const signal = controller.signal

    setStatus('loading')
    setError(null)

    fetcherRef.current(signal).then(
      (value) => {
        // Stale-resolve guard: ignore if this controller was aborted
        // (deps changed, refetch fired again, or component unmounted).
        if (signal.aborted || !mountedRef.current) return
        setData(value)
        setStatus('success')
      },
      (err: unknown) => {
        if (signal.aborted || !mountedRef.current) return
        // Treat AbortError as silent regardless of how the abort
        // surfaces (DOMException with name='AbortError', or a plain
        // Error whose name was set by the test harness).
        const isAbort =
          (err instanceof Error && err.name === 'AbortError') ||
          (typeof DOMException !== 'undefined' &&
            err instanceof DOMException &&
            err.name === 'AbortError')
        if (isAbort) return
        const message =
          err instanceof Error ? err.message : String(err ?? 'unknown error')
        setError(message)
        setStatus('error')
      }
    )
  }, [])

  // Effect: run on mount and whenever deps change; abort on cleanup.
  // The deps array is forwarded verbatim from the caller because the
  // hook can't know which inputs are meaningful upstream.
  useEffect(() => {
    mountedRef.current = true
    run()
    return () => {
      mountedRef.current = false
      if (controllerRef.current) {
        controllerRef.current.abort()
        controllerRef.current = null
      }
    }
  }, deps)

  // refetch is stable across renders thanks to useCallback([]). It
  // simply re-runs the fetcher with a new controller; it does not
  // depend on `deps` to change.
  const refetch = useCallback((): void => {
    run()
  }, [run])

  return { data, status, error, refetch }
}
