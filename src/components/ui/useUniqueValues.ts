import { useMemo, useRef } from 'react'

// useUniqueValues — extract a deduplicated, sorted string list from a
// homogeneous record array via a picker function. Used to populate
// <datalist> suggestion lists from server-fetched data without any
// per-input bespoke selector logic.
//
// Stability: returns the SAME array identity across renders when the
// computed contents are equivalent, so downstream <datalist> components
// avoid spurious re-renders. The stability check is a string-join hash
// — cheap, deterministic, and good enough for the small N (<200) of an
// audit-log page filter list.
export function useUniqueValues<T>(
  items: ReadonlyArray<T>,
  pick: (item: T) => string | undefined
): ReadonlyArray<string> {
  const cacheRef = useRef<{ key: string; value: ReadonlyArray<string> }>({
    key: '',
    value: [],
  })
  return useMemo(() => {
    const seen = new Set<string>()
    items.forEach((item) => {
      const raw = pick(item)
      if (typeof raw === 'string') {
        const trimmed = raw.trim()
        if (trimmed !== '') {
          seen.add(trimmed)
        }
      }
    })
    const next = Array.from(seen).sort()
    const key = next.join(' ')
    if (cacheRef.current.key === key) {
      return cacheRef.current.value
    }
    cacheRef.current = { key, value: next }
    return next
  }, [items, pick])
}
