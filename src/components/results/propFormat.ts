// formatPropValue renders a single graph property value as a short
// human-readable string. Strings are single-quoted (so 'Alice' vs a
// bare numeric is unambiguous); arrays/objects fall through to
// JSON.stringify so the representation stays compact but lossless.
// Nullish reads as the literal "null" / "undefined" — the same
// convention Cypher uses when it renders those values as text.
//
// Lives in its own module so both the results table (TableView's
// cypher-style cells) and the graph inspector's structured property
// view share one formatter.
export function formatPropValue(v: unknown): string {
  if (v === null) return 'null'
  if (v === undefined) return 'undefined'
  if (typeof v === 'string') return `'${v}'`
  if (Array.isArray(v) || (typeof v === 'object' && v !== null)) {
    return JSON.stringify(v)
  }
  return String(v)
}
