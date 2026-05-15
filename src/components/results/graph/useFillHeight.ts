import { useEffect, useState } from 'react'

// Below the canvas chrome (toolbar) in fill mode this is the px the
// canvas leaves for itself out of the viewport — the overlay padding,
// the result tabs row, the graph toolbar, the stacked sidebar's first
// glimpse. Heuristic; the ResizeObserver / fit pass corrects framing.
export const FILL_CANVAS_CHROME_PX = 320

export type UseFillHeightArgs = {
  // When true the canvas grows to fill the available viewport (see the
  // GraphView fillHeight prop). When false the hook simply mirrors
  // `height` back out and never installs a resize listener.
  fillHeight: boolean
  // Caller-provided default height (the inline / non-fill render).
  height: number
}

// useFillHeight derives the canvas (and sidebar) pixel height. In fill
// mode it tracks window.innerHeight (debounced via the browser's resize
// event), guaranteeing the canvas grows with the maximized overlay
// without forcing GraphView to re-render on every resize event of an
// inline result panel. SSR-safe — falls back to `height` when window is
// undefined.
export function useFillHeight(args: UseFillHeightArgs): number {
  const { fillHeight, height } = args

  const [effectiveHeight, setEffectiveHeight] = useState<number>(() => {
    if (!fillHeight || typeof window === 'undefined') return height
    return Math.max(
      height,
      Math.round(window.innerHeight) - FILL_CANVAS_CHROME_PX
    )
  })

  useEffect(() => {
    const compute = (): number => {
      if (!fillHeight) return height
      const winH =
        typeof window === 'undefined' ? 800 : Math.round(window.innerHeight)
      return Math.max(height, winH - FILL_CANVAS_CHROME_PX)
    }
    setEffectiveHeight(compute())
    if (!fillHeight || typeof window === 'undefined') return undefined
    const onResize = (): void => setEffectiveHeight(compute())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [fillHeight, height])

  return effectiveHeight
}
