// wireCase — snake_case -> camelCase normalisation for the WebSocket query
// stream, mirroring the conversion the generated REST client performs on the
// sync path (gen/client/react/client.ts: snakeToCamel / convertKeys via
// fromWire).
//
// WHY THIS EXISTS
// genapi 0.11.1's generated client converts every response key
// snake_case->camelCase at the wire boundary, so the synchronous query path
// (client.query) hands the SPA camelCase rows + node/edge objects. The
// streaming path (/ws/query) is a hand-rolled WebSocket that bypasses the
// generated client, so without this normalisation the SAME query would render
// snake_case property keys in stream mode and camelCase keys in sync mode.
// Applying the conversion here makes both paths identical.
//
// WHERE IT RUNS
// On the streaming path the conversion is applied INSIDE the parse worker
// (queryStreamWorker.ts), immediately after JSON.parse and therefore OFF the
// main thread — the worker already exists to keep frame parsing off the
// render path (PERF #297), so the per-cell key rewrite rides the same
// off-thread budget. The main-thread inline fallback in queryStream.ts (used
// when Worker is unavailable) calls the same helper.
//
// SCOPE
// Only the row-cell payloads (`row` / `rows`) of a frame are converted; the
// protocol envelope keys (`kind`, `row_count`, `elapsed_ms`, `code`,
// `message`, `columns`) are left untouched so the StreamMsg contract and the
// reducer keep reading them verbatim. Scalar cells pass through unchanged, so
// a tabular (non-graph) stream pays only an array-traversal cost.

// snakeToCamelKey mirrors gen/client/react/client.ts `snakeToCamel`:
// collapse one-or-more underscores before a lowercase letter/digit and
// upper-case that character (start_node -> startNode, created_at -> createdAt).
function snakeToCamelKey(key: string): string {
  return key.replace(/_+([a-z0-9])/g, (_m, c: string) => c.toUpperCase())
}

// snakeToCamelDeep recursively rewrites every object key in `value`
// snake_case -> camelCase. Arrays are mapped element-wise; scalars (string,
// number, boolean, null, undefined) are returned unchanged. Matches the
// generated client's `convertKeys(value, snakeToCamel)` so the streaming and
// sync paths produce structurally identical data.
export function snakeToCamelDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => snakeToCamelDeep(item))
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    // ESLint forbids for...of (regenerator-runtime); iterate via forEach.
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      out[snakeToCamelKey(key)] = snakeToCamelDeep(item)
    })
    return out
  }
  return value
}

// camelCaseStreamFrame normalises a single parsed WS frame: it deep-converts
// the cell payload of a `row` frame ({ row: [...] }) or a `rowBatch`/`rows`
// frame ({ rows: [[...]] }) and returns the frame otherwise unchanged. A
// non-object input (or a frame with neither field) is returned as-is, so
// schema / summary / error / end frames pass straight through.
export function camelCaseStreamFrame(frame: unknown): unknown {
  if (frame === null || typeof frame !== 'object') return frame
  const f = frame as Record<string, unknown>
  if (Array.isArray(f.row)) {
    return { ...f, row: snakeToCamelDeep(f.row) }
  }
  if (Array.isArray(f.rows)) {
    return { ...f, rows: snakeToCamelDeep(f.rows) }
  }
  return frame
}
