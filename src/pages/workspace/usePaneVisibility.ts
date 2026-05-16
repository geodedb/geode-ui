// usePaneVisibility — tracks whether a pane's DOM node is in the viewport.
//
// Workspace panes can be mounted in a 2×2 (or 1×4 on narrow viewports)
// grid, and once two or three panes are visible at once the off-screen
// panes still hold the lazy Monaco editor (~MiB-scale module + a
// fully-instantiated `monaco.editor.IStandaloneCodeEditor`). The editor
// re-mount cost is small (the lazy chunk is already cached, and Monaco
// rebuilds its model from the controlled `value` prop), so dropping
// it when the pane is fully off-screen is a strictly-better trade
// for memory/idle CPU.
//
// Stream / result state is intentionally NOT gated on visibility:
// once a user issues a query the answer must still arrive even if they
// scroll the pane out of view (otherwise the result is silently lost
// and "did my query finish?" becomes a UX bug).
//
// Returns `true` when the observed element intersects the viewport at
// any threshold ≥ 0% (entirely off-screen ⇒ false). The default to
// `true` keeps SSR / no-IntersectionObserver test environments using
// the un-suspended render path.

import { useEffect, useRef, useState } from 'react'

export type UsePaneVisibility = {
  // Pane root is a styled.section (HTMLElement). Typed as HTMLElement
  // so the consumer's `<Pane ref={ref}/>` resolves to the styled-
  // components ref overload without a manual cast.
  ref: React.RefObject<HTMLElement | null>
  visible: boolean
}

export function usePaneVisibility(
  // Tests can force a particular initial state, but production callers
  // should accept the default (true → no flicker on first render).
  initial: boolean = true
): UsePaneVisibility {
  const ref = useRef<HTMLElement | null>(null)
  const [visible, setVisible] = useState<boolean>(initial)

  useEffect(() => {
    const node = ref.current
    if (!node) return undefined
    // Bail out gracefully in environments without IntersectionObserver
    // (jsdom older than 24 doesn't ship it). The pane stays visible-by-
    // default and Monaco renders normally — no functional regression.
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      return undefined
    }
    const observer = new IntersectionObserver(
      (entries) => {
        // entries[0] always corresponds to `node` since we only observe
        // one element per hook instance.
        const e = entries[0]
        if (!e) return
        setVisible(e.isIntersecting)
      },
      // rootMargin pulls the trigger a little BEFORE the pane actually
      // scrolls into view so the editor remounts in time to be ready
      // by the time the user looks at it.
      { root: null, rootMargin: '100px', threshold: 0 }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return { ref, visible }
}
