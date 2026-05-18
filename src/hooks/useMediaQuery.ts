import { useEffect, useState } from 'react'

// useMediaQuery returns whether the given CSS media query currently matches
// the host viewport. The hook is SSR-safe: when `window` is undefined (the
// Next.js / RSC server pass, jest's node env without jsdom) it returns the
// `defaultValue` and never reads matchMedia. On the client, the initial
// render also uses `defaultValue` so server-rendered markup is byte-stable;
// the first useEffect tick reads the real matchMedia value and re-renders
// with the post-mount truth. Subsequent matchMedia change events update
// state without unsubscribing the listener (we attach once per query).
//
// Use this for layout decisions that must react to viewport size — e.g.
// shrinking the Monaco editor below the md breakpoint, or surfacing a
// first-class sidebar toggle on mobile that's otherwise buried inside a
// dropdown. For pure CSS responsiveness prefer styled-components @media
// rules; useMediaQuery is for behavior that needs JS (component selection,
// prop forwarding) and cannot be expressed in stylesheets alone.
export function useMediaQuery(
  query: string,
  defaultValue: boolean = false
): boolean {
  const [matches, setMatches] = useState<boolean>(defaultValue)

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return undefined
    }
    const mql = window.matchMedia(query)
    // Sync immediately so a mobile-loaded page doesn't flash desktop UI
    // before the next render tick.
    setMatches(mql.matches)
    const onChange = (e: MediaQueryListEvent): void => {
      setMatches(e.matches)
    }
    // Safari < 14 only supports the deprecated addListener; feature-detect.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    }
    mql.addListener(onChange)
    return () => mql.removeListener(onChange)
  }, [query])

  return matches
}
