export type UseFillHeightArgs = {
  // When true the canvas should grow to fill the available viewport via
  // the parent flex chain — the hook returns `undefined` so the Canvas
  // styled-component falls back to `flex: 1 1 auto`. When false the hook
  // simply mirrors `height` back out.
  fillHeight: boolean
  // Caller-provided default height (the inline / non-fill render).
  height: number
}

// useFillHeight returns the canvas pixel height to use, or `undefined`
// when fill mode is active. In fill mode the canvas relies on the
// parent flex chain (Wrap → CanvasArea → Canvas with `flex: 1 1 auto`)
// to fill the available height, and the cytoscape ResizeObserver
// re-fits on container size change — so no JS layout math is needed.
export function useFillHeight(args: UseFillHeightArgs): number | undefined {
  const { fillHeight, height } = args
  if (fillHeight) return undefined
  return height
}
