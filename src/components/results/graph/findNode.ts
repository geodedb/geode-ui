// Substring search across a node's id, label(s), and property values.
// Case-insensitive; empty query returns false (so the input doesn't
// instantly "match everything" when the user clears the field).
export function matchesQuery(
  data: Record<string, unknown>,
  q: string
): boolean {
  const query = q.trim().toLowerCase()
  if (!query) return false
  // id (exact and substring) — cheap, common.
  const id = data.id != null ? String(data.id).toLowerCase() : ''
  if (id.includes(query)) return true
  // label can be a string OR a string[].
  const label = data.label
  if (typeof label === 'string' && label.toLowerCase().includes(query)) {
    return true
  }
  if (
    Array.isArray(label) &&
    label.some((l) => typeof l === 'string' && l.toLowerCase().includes(query))
  ) {
    return true
  }
  // props — substring match on the stringified value for each prop.
  const { props } = data
  if (props && typeof props === 'object' && !Array.isArray(props)) {
    return Object.values(props as Record<string, unknown>).some(
      (v) => v != null && String(v).toLowerCase().includes(query)
    )
  }
  return false
}
