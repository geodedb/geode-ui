/**
 * useTableBodySize -- ResizeObserver-driven container-size tracking
 * for the windowed TableView body.
 *
 * Extracted from src/components/results/TableView.tsx as part of
 * Q rank 19 / #184. The hook returns the live container width (used
 * by the chars-per-column heuristic that feeds the row-height
 * estimator) and the body height (the virtualizer's flex-grown
 * height, floored at the planner's minimum so a tiny parent still
 * shows a usable body).
 *
 * Behavior:
 *  - Reads the container's initial rect synchronously after mount via
 *    getBoundingClientRect so the first render has real numbers
 *    instead of waiting for the first ResizeObserver tick.
 *  - Falls back to `undefined` width + `minBodyHeight` if
 *    ResizeObserver is missing (older jsdom, SSR) so the component
 *    still renders with the legacy heuristics.
 *  - Disconnects the observer on unmount.
 */
import { useEffect, useRef, useState } from 'react'

export interface UseTableBodySizeOptions {
  /**
   * Floor (px) for the returned body height. Matches the planner's
   * VIRTUAL_BODY_MIN value -- callers pass it from the same
   * constant block so the floor stays in lockstep with TableView's
   * own minimum.
   */
  minBodyHeight: number
  /**
   * Pixel budget reserved for the sticky header that sits inside
   * the same flex container as the virtualized body. Subtracted
   * from the wrap height so body + header sum to the wrap content
   * box. Pass the planner's HEADER_BUDGET_PX constant.
   */
  headerBudgetPx: number
}

export interface UseTableBodySizeResult {
  /**
   * Ref the caller MUST attach to the outer wrap element (i.e. the
   * one the ResizeObserver watches). When the ref is unset the hook
   * returns the initial floor values.
   */
  wrapRef: React.MutableRefObject<HTMLDivElement | null>
  /**
   * Live width of the wrap's content box (px). `undefined` until the
   * first measurement lands (and forever in jsdom/SSR without
   * ResizeObserver). Callers use this to seed their chars-per-column
   * heuristic and fall back to a default when undefined.
   */
  containerWidth: number | undefined
  /**
   * Live height of the virtualizer body (px). Floored at
   * `minBodyHeight`; subtracted by `headerBudgetPx` so the header
   * + body sum equals the wrap content box.
   */
  bodyHeight: number
}

export function useTableBodySize(
  opts: UseTableBodySizeOptions
): UseTableBodySizeResult {
  const { minBodyHeight, headerBudgetPx } = opts
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [containerWidth, setContainerWidth] = useState<number | undefined>(
    undefined
  )
  const [bodyHeight, setBodyHeight] = useState<number>(minBodyHeight)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined
    if (typeof ResizeObserver === 'undefined') return undefined

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const w = entry.contentRect.width
      const h = entry.contentRect.height
      if (Number.isFinite(w) && w > 0) setContainerWidth(w)
      if (Number.isFinite(h) && h > 0) {
        setBodyHeight(Math.max(minBodyHeight, h - headerBudgetPx))
      }
    })
    ro.observe(el)

    // Seed from the synchronous bounding rect so the very first render
    // (before the observer's first callback) has real numbers.
    const r = el.getBoundingClientRect()
    if (Number.isFinite(r.width) && r.width > 0) setContainerWidth(r.width)
    if (Number.isFinite(r.height) && r.height > 0) {
      setBodyHeight(Math.max(minBodyHeight, r.height - headerBudgetPx))
    }

    return () => ro.disconnect()
  }, [minBodyHeight, headerBudgetPx])

  return { wrapRef, containerWidth, bodyHeight }
}
