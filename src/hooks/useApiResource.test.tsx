/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { useApiResource, UseApiResourceResult } from './useApiResource'

// Test harness component that exposes the hook's state to assertions
// via a render-prop callback. The probe's prop type is intentionally
// loose (`unknown`) because TS's generic arrow components collide with
// JSX syntax in `.tsx` files; tests narrow via the local `ref`.
type ProbeProps = {
  fetcher: (signal: AbortSignal) => Promise<unknown>
  deps: ReadonlyArray<unknown>
  onState(state: UseApiResourceResult<unknown>): void
}

const Probe: React.FC<ProbeProps> = ({ fetcher, deps, onState }) => {
  const state = useApiResource<unknown>(fetcher, deps)
  onState(state)
  return <div data-testid="probe-status">{state.status}</div>
}

describe('useApiResource', () => {
  test('resolves and sets data with status=success', async () => {
    const ref: { current: UseApiResourceResult<string> | null } = {
      current: null,
    }
    const onState = (s: UseApiResourceResult<string>): void => {
      ref.current = s
    }
    // unused signal is intentional; the hook owns the controller and
    // gates state updates on signal.aborted
    const fetcher: (signal: AbortSignal) => Promise<string> = jest.fn(() =>
      Promise.resolve('hello')
    )

    render(<Probe fetcher={fetcher} deps={[]} onState={onState} />)

    await waitFor(() => {
      expect(ref.current).not.toBeNull()
      expect(ref.current?.status).toBe('success')
    })
    expect(ref.current?.data).toBe('hello')
    expect(ref.current?.error).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  test('network error sets error and status=error', async () => {
    const ref: { current: UseApiResourceResult<string> | null } = {
      current: null,
    }
    const onState = (s: UseApiResourceResult<string>): void => {
      ref.current = s
    }
    const fetcher: (signal: AbortSignal) => Promise<string> = jest.fn(() =>
      Promise.reject(new Error('boom'))
    )

    render(<Probe fetcher={fetcher} deps={[]} onState={onState} />)

    await waitFor(() => {
      expect(ref.current?.status).toBe('error')
    })
    expect(ref.current?.error).toBe('boom')
    expect(ref.current?.data).toBeNull()
  })

  test('AbortError is silent (no error state, no setState after unmount)', async () => {
    const ref: { current: UseApiResourceResult<string> | null } = {
      current: null,
    }
    const onState = (s: UseApiResourceResult<string>): void => {
      ref.current = s
    }
    // Simulate a long-running request that rejects with AbortError when
    // the controller is aborted.
    const fetcher = (signal: AbortSignal): Promise<string> =>
      new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })

    const { unmount } = render(
      <Probe fetcher={fetcher} deps={[]} onState={onState} />
    )

    // Unmount before the fetcher resolves; cleanup should abort the
    // pending request without surfacing an error.
    unmount()

    // Wait a tick for the abort path to settle, then assert the state
    // never transitioned to 'error' due to the AbortError.
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 10)
      })
    })
    expect(ref.current?.status).not.toBe('error')
    expect(ref.current?.error).toBeNull()
  })

  test('unmount mid-flight does not throw and does not setState', async () => {
    const ref: { current: UseApiResourceResult<string> | null } = {
      current: null,
    }
    let renderCount = 0
    const onState = (s: UseApiResourceResult<string>): void => {
      ref.current = s
      renderCount += 1
    }
    const lateRef: { resolve: ((value: string) => void) | undefined } = {
      resolve: undefined,
    }
    const fetcher: (signal: AbortSignal) => Promise<string> = () =>
      new Promise<string>((resolve) => {
        lateRef.resolve = resolve
      })

    const { unmount } = render(
      <Probe fetcher={fetcher} deps={[]} onState={onState} />
    )
    const beforeUnmountRenders = renderCount
    unmount()

    // Resolve AFTER unmount; the hook must not call setState (which
    // would print a React warning and bump the render count).
    lateRef.resolve?.('late')

    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 10)
      })
    })
    expect(renderCount).toBe(beforeUnmountRenders)
    expect(ref.current?.status).not.toBe('success')
  })

  test('deps change cancels previous fetch and starts a new one', async () => {
    const ref: { current: UseApiResourceResult<string> | null } = {
      current: null,
    }
    const onState = (s: UseApiResourceResult<string>): void => {
      ref.current = s
    }
    const seen: AbortSignal[] = []
    const fetcher = jest.fn((signal: AbortSignal): Promise<string> => {
      seen.push(signal)
      return Promise.resolve(`run-${seen.length}`)
    })

    const { rerender } = render(
      <Probe fetcher={fetcher} deps={[1]} onState={onState} />
    )
    await waitFor(() => {
      expect(ref.current?.data).toBe('run-1')
    })

    rerender(<Probe fetcher={fetcher} deps={[2]} onState={onState} />)
    await waitFor(() => {
      expect(ref.current?.data).toBe('run-2')
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    // The first run's signal should have been aborted when deps
    // changed; the second run's signal should not be aborted yet.
    expect(seen[0]?.aborted).toBe(true)
    expect(seen[1]?.aborted).toBe(false)
  })

  test('refetch triggers a fresh fetch with a new controller', async () => {
    const ref: { current: UseApiResourceResult<number> | null } = {
      current: null,
    }
    const onState = (s: UseApiResourceResult<number>): void => {
      ref.current = s
    }
    let counter = 0
    const fetcher: (signal: AbortSignal) => Promise<number> = jest.fn(() => {
      counter += 1
      return Promise.resolve(counter)
    })

    render(<Probe fetcher={fetcher} deps={[]} onState={onState} />)

    await waitFor(() => {
      expect(ref.current?.data).toBe(1)
    })

    await act(async () => {
      ref.current?.refetch()
    })

    await waitFor(() => {
      expect(ref.current?.data).toBe(2)
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
