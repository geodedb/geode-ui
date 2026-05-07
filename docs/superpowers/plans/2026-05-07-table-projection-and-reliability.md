# Table Column Projection + Multi-Request Reliability Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project node/edge columns into one column per property by default, fix intermittent multi-request failures on the Query page, and back both with Playwright tests.

**Architecture:**
1. Add a pure `projectColumns(resp)` helper that walks `resp.columns` + `resp.rows` and emits an expanded `{columns, rows}` shape — one column per node/edge label & property — plus a `compact` mode that returns the input unchanged. TableView calls it through a "Expand graph cells" toggle (default ON).
2. Reset volatile per-run state (`resp`, `err`, `stream` reducer, `handleRef`) at the *start* of every Run click, not only inside the branch that owns it. A leftover stream from the previous run was leaving stale rows on screen and confusing the busy flag.
3. New Playwright spec drives 5 consecutive `MATCH … RETURN n` runs and asserts each one yields a full result, plus a node-projection check that verifies the property columns are visible.

**Tech Stack:** TypeScript / React / styled-components, Jest + RTL for unit tests, Playwright for e2e. No backend changes — projection is entirely client-side.

---

## File Structure

| Path | Responsibility |
|---|---|
| `src/components/results/projectColumns.ts` (new) | Pure helper: take a `QueryResp`, return `{columns, rows}` with node/edge cells projected into property columns. No React deps. |
| `src/components/results/projectColumns.test.ts` (new) | Unit tests: passthrough for primitives, node expansion, edge expansion, mixed rows, empty rows, toggle returns input unchanged. |
| `src/components/results/TableView.tsx` (modify) | Add `expand` prop (default true). Call `projectColumns` when expand=true; render existing structured cell when expand=false. |
| `src/pages/QueryPage.tsx` (modify) | (a) Add `Expand graph cells` checkbox wired to TableView. (b) On every `run()`, reset `resp`, `err`, `stream`, `handleRef`, `busy` *before* dispatching the new query — same shape as `runStream` does today, applied uniformly. |
| `src/components/results/TableView.test.tsx` (modify) | Add a test that confirms TableView projects columns by default. |
| `e2e/specs/11-table-projection.spec.ts` (new) | Playwright: log in, run `MATCH (n:Person) RETURN n LIMIT 3`, assert separate columns for `n._labels`, `n.name` (and any other Person properties present). |
| `e2e/specs/12-multi-request.spec.ts` (new) | Playwright: log in, run 5 consecutive queries (mix of node-returning and scalar) on the same page without reloads, assert each surfaces a result and the busy flag clears between runs. |

---

## Task 1: Add `projectColumns` helper

**Files:**
- Create: `src/components/results/projectColumns.ts`
- Test: `src/components/results/projectColumns.test.ts`

- [ ] **Step 1.1: Write the failing test**

```typescript
// src/components/results/projectColumns.test.ts
import { projectColumns } from './projectColumns'

describe('projectColumns', () => {
  test('passthrough when no node/edge columns', () => {
    const resp = {
      columns: [{ name: 'n', type: 'STRING' }],
      rows: [['alice'], ['bob']],
    }
    const out = projectColumns(resp)
    expect(out.columns).toEqual([{ name: 'n', type: 'STRING' }])
    expect(out.rows).toEqual([['alice'], ['bob']])
  })

  test('expands a node column into _labels + one column per property', () => {
    const node = (id: number, name: string, born: number) => ({
      id,
      labels: ['Person'],
      properties: { name, born },
    })
    const resp = {
      columns: [{ name: 'n', type: 'NODE' }],
      rows: [[node(1, 'Alice', 1980)], [node(2, 'Bob', 1990)]],
    }
    const out = projectColumns(resp)
    expect(out.columns.map((c) => c.name)).toEqual([
      'n._labels',
      'n.name',
      'n.born',
    ])
    expect(out.rows).toEqual([
      ['Person', 'Alice', 1980],
      ['Person', 'Bob', 1990],
    ])
  })

  test('expands an edge column into _type + properties', () => {
    const edge = {
      id: 100,
      start_node: 1,
      end_node: 2,
      type: 'ACTED_IN',
      properties: { role: 'Lead', year: 2008 },
    }
    const resp = {
      columns: [{ name: 'e', type: 'EDGE' }],
      rows: [[edge]],
    }
    const out = projectColumns(resp)
    expect(out.columns.map((c) => c.name)).toEqual([
      'e._type',
      'e.role',
      'e.year',
    ])
    expect(out.rows).toEqual([['ACTED_IN', 'Lead', 2008]])
  })

  test('takes the union of property keys across rows (missing => null cell)', () => {
    const resp = {
      columns: [{ name: 'n', type: 'NODE' }],
      rows: [
        [{ id: 1, labels: ['User'], properties: { name: 'a', email: 'a@x' } }],
        [{ id: 2, labels: ['User'], properties: { name: 'b' } }], // no email
      ],
    }
    const out = projectColumns(resp)
    expect(out.columns.map((c) => c.name)).toEqual([
      'n._labels',
      'n.name',
      'n.email',
    ])
    expect(out.rows).toEqual([
      ['User', 'a', 'a@x'],
      ['User', 'b', null],
    ])
  })

  test('multi-label nodes join labels with ":"', () => {
    const resp = {
      columns: [{ name: 'n', type: 'NODE' }],
      rows: [[{ id: 1, labels: ['Person', 'Actor'], properties: {} }]],
    }
    expect(projectColumns(resp).rows).toEqual([['Person:Actor']])
  })

  test('non-node/edge columns are interleaved correctly', () => {
    const node = { id: 1, labels: ['Movie'], properties: { title: 'Matrix' } }
    const resp = {
      columns: [
        { name: 'm', type: 'NODE' },
        { name: 'rating', type: 'FLOAT' },
      ],
      rows: [[node, 9.1]],
    }
    const out = projectColumns(resp)
    expect(out.columns.map((c) => c.name)).toEqual([
      'm._labels',
      'm.title',
      'rating',
    ])
    expect(out.rows).toEqual([['Movie', 'Matrix', 9.1]])
  })

  test('empty rows yield only structural _labels/_type column', () => {
    const resp = {
      columns: [{ name: 'n', type: 'NODE' }],
      rows: [] as unknown[][],
    }
    const out = projectColumns(resp)
    expect(out.columns.map((c) => c.name)).toEqual(['n._labels'])
    expect(out.rows).toEqual([])
  })

  test('null cells in node columns project to null for every expansion', () => {
    const resp = {
      columns: [{ name: 'n', type: 'NODE' }],
      rows: [
        [{ id: 1, labels: ['User'], properties: { name: 'a' } }],
        [null],
      ],
    }
    const out = projectColumns(resp)
    expect(out.columns.map((c) => c.name)).toEqual(['n._labels', 'n.name'])
    expect(out.rows).toEqual([
      ['User', 'a'],
      [null, null],
    ])
  })
})
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `npx jest --config jest.config.cjs src/components/results/projectColumns.test.ts`
Expected: FAIL — module not found / `projectColumns` is not a function.

- [ ] **Step 1.3: Implement the helper**

```typescript
// src/components/results/projectColumns.ts

// projectColumns turns a graph-aware QueryResp into a flat tabular shape.
//
// - For each NODE column, emit `{name}._labels` followed by one
//   `{name}.{key}` column for every property key found across all
//   rows (preserving first-seen order). Cells become the corresponding
//   property value (or null when absent / the original cell was null).
// - For each EDGE column, emit `{name}._type` followed by one
//   `{name}.{key}` column per edge property key.
// - Other columns (paths, scalars, unknown objects) pass through
//   unchanged in their original positions.
//
// Returns the original shape verbatim if no row contains a node or
// edge — projection only fires when there's something to project.

export type Col = { name: string; type: string }
export type ProjResp = { columns: Col[]; rows: unknown[][] }

type AnyRecord = Record<string, unknown>

function isNode(o: unknown): o is AnyRecord {
  if (!o || typeof o !== 'object') return false
  const r = o as AnyRecord
  return (
    typeof r.id !== 'undefined' &&
    Array.isArray(r.labels) &&
    typeof r.properties === 'object' &&
    r.properties !== null &&
    typeof r.start_node === 'undefined'
  )
}

function isEdge(o: unknown): o is AnyRecord {
  if (!o || typeof o !== 'object') return false
  const r = o as AnyRecord
  return (
    typeof r.id !== 'undefined' &&
    typeof r.start_node !== 'undefined' &&
    typeof r.end_node !== 'undefined' &&
    typeof r.type === 'string'
  )
}

// kindOf inspects the first non-null cell in a column to decide
// whether the column should be projected. We don't trust column.type
// alone — it can be a generic "ANY" or a server-side label that
// doesn't match the client predicate.
type Kind = 'node' | 'edge' | 'other'
function kindOf(rows: unknown[][], colIdx: number, declared: string): Kind {
  if (declared && declared.toUpperCase() === 'NODE') return 'node'
  if (declared && declared.toUpperCase() === 'EDGE') return 'edge'
  for (const row of rows) {
    const cell = row[colIdx]
    if (cell == null) continue
    if (isNode(cell)) return 'node'
    if (isEdge(cell)) return 'edge'
    return 'other'
  }
  return 'other'
}

// orderedKeys collects property keys across rows in first-seen order,
// so the projected table is deterministic for the user.
function orderedKeys(rows: unknown[][], colIdx: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const row of rows) {
    const cell = row[colIdx]
    if (!cell || typeof cell !== 'object') continue
    const props = (cell as AnyRecord).properties as AnyRecord | undefined
    if (!props) continue
    for (const k of Object.keys(props)) {
      if (!seen.has(k)) {
        seen.add(k)
        out.push(k)
      }
    }
  }
  return out
}

export function projectColumns(resp: {
  columns: Array<{ name: string; type: string } | Record<string, unknown>>
  rows: unknown[][]
}): ProjResp {
  const cols: Col[] = resp.columns.map((c) => {
    const r = c as AnyRecord
    return {
      name: typeof r.name === 'string' ? r.name : '',
      type: typeof r.type === 'string' ? r.type : '',
    }
  })

  // Pre-compute kind + (for node/edge) the projection keys per column.
  const plan = cols.map((c, i) => {
    const k = kindOf(resp.rows, i, c.type)
    if (k === 'other') return { kind: k, name: c.name, type: c.type }
    return { kind: k, name: c.name, type: c.type, keys: orderedKeys(resp.rows, i) }
  })

  // Bail out early if nothing to project — keep the original shape so
  // unrelated tests / consumers don't have to care about projection.
  if (plan.every((p) => p.kind === 'other')) {
    return { columns: cols, rows: resp.rows }
  }

  // Build expanded columns.
  const outCols: Col[] = []
  for (const p of plan) {
    if (p.kind === 'node') {
      outCols.push({ name: `${p.name}._labels`, type: 'STRING' })
      for (const k of p.keys!) outCols.push({ name: `${p.name}.${k}`, type: '' })
    } else if (p.kind === 'edge') {
      outCols.push({ name: `${p.name}._type`, type: 'STRING' })
      for (const k of p.keys!) outCols.push({ name: `${p.name}.${k}`, type: '' })
    } else {
      outCols.push({ name: p.name, type: p.type })
    }
  }

  // Project each row through the plan.
  const outRows: unknown[][] = resp.rows.map((row) => {
    const out: unknown[] = []
    plan.forEach((p, i) => {
      const cell = row[i]
      if (p.kind === 'node') {
        if (cell && typeof cell === 'object') {
          const r = cell as AnyRecord
          const labels = (r.labels as string[]) || []
          out.push(labels.join(':'))
          const props = (r.properties as AnyRecord) || {}
          for (const k of p.keys!) {
            out.push(Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null)
          }
        } else {
          out.push(null)
          for (const _k of p.keys!) out.push(null)
        }
      } else if (p.kind === 'edge') {
        if (cell && typeof cell === 'object') {
          const r = cell as AnyRecord
          out.push(r.type as string)
          const props = (r.properties as AnyRecord) || {}
          for (const k of p.keys!) {
            out.push(Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null)
          }
        } else {
          out.push(null)
          for (const _k of p.keys!) out.push(null)
        }
      } else {
        out.push(cell)
      }
    })
    return out
  })

  return { columns: outCols, rows: outRows }
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

Run: `npx jest --config jest.config.cjs src/components/results/projectColumns.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 1.5: Commit**

```bash
git add src/components/results/projectColumns.ts src/components/results/projectColumns.test.ts
git commit -m "feat(table): add projectColumns helper for node/edge expansion"
```

---

## Task 2: Wire `projectColumns` into TableView with default-on toggle

**Files:**
- Modify: `src/components/results/TableView.tsx`
- Test: `src/components/results/TableView.test.tsx`

- [ ] **Step 2.1: Write the failing test**

Add to `src/components/results/TableView.test.tsx`:

```typescript
test('TableView projects node columns into property columns by default', () => {
  const node = {
    id: 1,
    labels: ['Person'],
    properties: { name: 'Alice', born: 1980 },
  }
  render(
    <ThemeProvider theme={theme}>
      <TableView
        resp={{ columns: [{ name: 'n', type: 'NODE' }], rows: [[node]] }}
      />
    </ThemeProvider>
  )
  expect(screen.getByText('n._labels')).toBeInTheDocument()
  expect(screen.getByText('n.name')).toBeInTheDocument()
  expect(screen.getByText('n.born')).toBeInTheDocument()
  expect(screen.getByText('Person')).toBeInTheDocument()
  expect(screen.getByText('Alice')).toBeInTheDocument()
  expect(screen.getByText('1980')).toBeInTheDocument()
})

test('TableView with expand=false renders node as a structured chip cell', () => {
  const node = {
    id: 1,
    labels: ['Person'],
    properties: { name: 'Alice' },
  }
  render(
    <ThemeProvider theme={theme}>
      <TableView
        expand={false}
        resp={{ columns: [{ name: 'n', type: 'NODE' }], rows: [[node]] }}
      />
    </ThemeProvider>
  )
  expect(screen.getByText(':Person')).toBeInTheDocument()
  // No projected column header in compact mode.
  expect(screen.queryByText('n._labels')).not.toBeInTheDocument()
})
```

- [ ] **Step 2.2: Run tests to verify they fail**

Run: `npx jest --config jest.config.cjs src/components/results/TableView.test.tsx`
Expected: FAIL — `getByText('n._labels')` finds nothing because TableView doesn't project today, and `expand` prop is unknown.

- [ ] **Step 2.3: Modify TableView to consume `projectColumns`**

In `src/components/results/TableView.tsx`, add the import at the top:

```typescript
import { projectColumns } from './projectColumns'
```

Replace the `Props` type and the `TableView` component with:

```typescript
type Props = {
  resp: {
    columns: Array<Record<string, unknown>>
    rows: Array<Array<unknown>>
  }
  // expand: when true (default), project node/edge columns into one
  // column per property. When false, render the existing chip + dl
  // structured cell — useful when the operator wants the raw graph
  // shape rather than a flattened table.
  expand?: boolean
}

export const TableView: React.FC<Props> = ({ resp, expand = true }) => {
  const view = expand ? projectColumns(resp) : resp
  return (
    <Wrap>
      <Table>
        <thead>
          <tr>
            {view.columns.map((c, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <Th key={`${columnName(c, i)}_${i}`}>
                {columnName(c, i)}{' '}
                <small style={{ opacity: 0.6 }}>{columnType(c)}</small>
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <tr key={i}>
              {row.map((cell, j) => (
                // eslint-disable-next-line react/no-array-index-key
                <Td key={j}>
                  <CellView value={cell} />
                </Td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </Wrap>
  )
}
```

- [ ] **Step 2.4: Run all TableView tests to verify they pass**

Run: `npx jest --config jest.config.cjs src/components/results/TableView.test.tsx`
Expected: PASS — 15 tests (13 existing + 2 new).

- [ ] **Step 2.5: Commit**

```bash
git add src/components/results/TableView.tsx src/components/results/TableView.test.tsx
git commit -m "feat(table): expand node/edge columns into property columns by default"
```

---

## Task 3: QueryPage gains an "Expand" toggle and resets state per run

**Files:**
- Modify: `src/pages/QueryPage.tsx`

- [ ] **Step 3.1: Replace the `run`/`runSync`/`runStream` block to reset shared state up front**

Find the current block in `src/pages/QueryPage.tsx`:

```typescript
const runSync = async (): Promise<void> => {
    setBusy(true)
    setErr(null)
    try {
      const r = await client.query({
        statement: stmt,
        page_size: 1000,
        timeout_ms: 30000,
      })
      setResp(r)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'query failed')
    } finally {
      setBusy(false)
    }
  }

  const runStream = (): void => {
    setErr(null)
    setResp(null)
    dispatch({ type: 'start' })
    setBusy(true)
    const h = streamQuery(stmt, undefined, (m) => {
      dispatch({ type: 'msg', msg: m })
      if (m.kind === 'end' || m.kind === 'error') setBusy(false)
    })
    handleRef.current = h
    h.done.then(() => {
      dispatch({ type: 'closed' })
      setBusy(false)
      handleRef.current = null
    })
  }

  const run = (): void => {
    if (streamMode) {
      runStream()
    } else {
      runSync()
    }
  }
```

Replace it with:

```typescript
// resetRunState clears every per-run piece of state so a previous
// run's leftovers (rows, errors, an in-flight WebSocket) cannot
// leak into the next click. Without this, two sync runs back-to-
// back show the *first* result for a moment until the second
// resolves; a sync run after a stream run can show stale stream
// rows; and a stream-cancel followed by a sync run leaves
// handleRef pointing at a closed socket.
const resetRunState = (): void => {
  setErr(null)
  setResp(null)
  dispatch({ type: 'reset' })
  if (handleRef.current) {
    handleRef.current.cancel()
    handleRef.current = null
  }
}

const runSync = async (): Promise<void> => {
  resetRunState()
  setBusy(true)
  try {
    const r = await client.query({
      statement: stmt,
      page_size: 1000,
      timeout_ms: 30000,
    })
    setResp(r)
  } catch (e: unknown) {
    setErr(e instanceof Error ? e.message : 'query failed')
  } finally {
    setBusy(false)
  }
}

const runStream = (): void => {
  resetRunState()
  dispatch({ type: 'start' })
  setBusy(true)
  const h = streamQuery(stmt, undefined, (m) => {
    dispatch({ type: 'msg', msg: m })
    if (m.kind === 'end' || m.kind === 'error') setBusy(false)
  })
  handleRef.current = h
  h.done.then(() => {
    dispatch({ type: 'closed' })
    setBusy(false)
    handleRef.current = null
  })
}

const run = (): void => {
  if (streamMode) {
    runStream()
  } else {
    runSync()
  }
}
```

- [ ] **Step 3.2: Add `expand` state + checkbox + pass through to TableView**

Find:

```typescript
const [streamMode, setStreamMode] = useState(false)
```

Add right after:

```typescript
const [expand, setExpand] = useState(true)
```

Find:

```tsx
<ToggleLabel>
  <input
    type="checkbox"
    checked={streamMode}
    onChange={(e) => {
      setStreamMode(e.target.checked)
      dispatch({ type: 'reset' })
      setResp(null)
      setErr(null)
    }}
  />
  Stream
</ToggleLabel>
```

Add a sibling label right after it:

```tsx
<ToggleLabel>
  <input
    type="checkbox"
    checked={expand}
    onChange={(e) => setExpand(e.target.checked)}
  />
  Expand graph cells
</ToggleLabel>
```

Find:

```tsx
{tab === 'table' && <TableView resp={activeResp} />}
```

Replace with:

```tsx
{tab === 'table' && <TableView resp={activeResp} expand={expand} />}
```

- [ ] **Step 3.3: Run frontend tests**

Run: `npm test -- --silent`
Expected: PASS — 12 suites, 27+ tests (existing + 2 new TableView tests).

- [ ] **Step 3.4: Run lint to confirm no regressions**

Run: `npx eslint --quiet src/pages/QueryPage.tsx src/components/results/TableView.tsx src/components/results/projectColumns.ts`
Expected: 0 errors.

- [ ] **Step 3.5: Commit**

```bash
git add src/pages/QueryPage.tsx
git commit -m "fix(query): reset per-run state on every Run + add Expand toggle"
```

---

## Task 4: Playwright spec for column projection

**Files:**
- Create: `e2e/specs/11-table-projection.spec.ts`

- [ ] **Step 4.1: Write the spec**

```typescript
// e2e/specs/11-table-projection.spec.ts
import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

test.describe('table column projection', () => {
  test('MATCH (n:Person) RETURN n shows separate columns for each property', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    await expect(sel.queryRunBtn(page)).toBeVisible()

    // Type a node-returning query.
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH (n:Person) RETURN n LIMIT 3`
    )
    await sel.queryRunBtn(page).click()

    // Wait for the row-count summary so we know the run finished.
    await expect(page.getByText(/\d+ rows/)).toBeVisible({ timeout: 10_000 })

    // Default tab is table; assert the projected headers exist.
    await sel.queryTabTable(page).click()
    await expect(
      page.getByRole('columnheader', { name: /n\._labels/ })
    ).toBeVisible()
    await expect(
      page.getByRole('columnheader', { name: /n\.name/ })
    ).toBeVisible()

    // And the row data is NOT a wall-of-text "(:Person {…})" string —
    // each property cell stands on its own.
    await expect(page.getByText('Alice Wonder', { exact: true })).toBeVisible()
  })

  test('Expand toggle off falls back to chip+prop-list rendering', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH (n:Person) RETURN n LIMIT 1`
    )
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/\d+ rows/)).toBeVisible({ timeout: 10_000 })

    // Toggle Expand off.
    await page
      .getByRole('checkbox', { name: /Expand graph cells/i })
      .uncheck()

    // Compact mode: a single column "n" with the chip cell inside.
    await expect(
      page.getByRole('columnheader', { name: /^n\b/ })
    ).toBeVisible()
    await expect(page.getByText(':Person', { exact: true })).toBeVisible()

    // Re-enable for the next assertion: projected headers come back.
    await page.getByRole('checkbox', { name: /Expand graph cells/i }).check()
    await expect(
      page.getByRole('columnheader', { name: /n\.name/ })
    ).toBeVisible()
  })
})
```

- [ ] **Step 4.2: Bring the e2e stack up if it isn't already**

Run: `make e2e-up` (idempotent — `up -d --build`).
Expected: `geode-e2e-geode-ui-1` listed as healthy in `docker ps`.

- [ ] **Step 4.3: Run the new spec**

Run: `npm run e2e -- --reporter=list e2e/specs/11-table-projection.spec.ts`
Expected: 2 tests pass.

- [ ] **Step 4.4: Commit**

```bash
git add e2e/specs/11-table-projection.spec.ts
git commit -m "test(e2e): table column projection + Expand toggle"
```

---

## Task 5: Playwright spec for multi-request consistency

**Files:**
- Create: `e2e/specs/12-multi-request.spec.ts`

- [ ] **Step 5.1: Write the spec**

```typescript
// e2e/specs/12-multi-request.spec.ts
import { test, expect } from '../fixtures'
import { sel } from '../helpers/selectors'
import { seed } from '../helpers/gqlData'

// Reproduction guard for "commands are not consistently working on
// multiple requests". The page is loaded once; we then run a sequence
// of queries on the same QueryPage instance and assert each one
// settles to a result. Any row-count discrepancy or stuck busy state
// (no result banner after 10s) fails the test.
test.describe('query page survives many consecutive runs', () => {
  test('5 sequential RETURN queries each yield a result', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    await expect(sel.queryRunBtn(page)).toBeVisible()

    const queries: Array<{ stmt: string; expect: RegExp }> = [
      {
        stmt: `USE GRAPH ${seed.graph}; MATCH (n:Person) RETURN n.name LIMIT 1`,
        expect: /1 rows/,
      },
      {
        stmt: `USE GRAPH ${seed.graph}; MATCH (m:Movie) RETURN m.title LIMIT 2`,
        expect: /2 rows/,
      },
      { stmt: `RETURN 42 AS answer`, expect: /1 rows/ },
      {
        stmt: `USE GRAPH ${seed.graph}; MATCH (n:Person) RETURN n LIMIT 3`,
        expect: /3 rows/,
      },
      {
        stmt: `USE GRAPH ${seed.graph}; MATCH (n:Movie) RETURN count(n) AS movies`,
        expect: /1 rows/,
      },
    ]

    for (const q of queries) {
      await page.locator('.monaco-editor').first().click()
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.type(q.stmt)
      await sel.queryRunBtn(page).click()

      // Each run must surface its own row-count banner. waitFor with a
      // tight timeout catches "stuck busy" (the bug we're hunting).
      await expect(page.getByText(q.expect)).toBeVisible({ timeout: 10_000 })

      // Run button must be enabled again before we type the next one.
      await expect(sel.queryRunBtn(page)).toBeEnabled({ timeout: 5_000 })
    }
  })

  test('toggling stream on/off across runs does not leak rows', async ({
    authedPage: page,
  }) => {
    await page.goto('/')
    // Sync run #1.
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH (n:Person) RETURN n.name LIMIT 1`
    )
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/1 rows/)).toBeVisible({ timeout: 10_000 })

    // Stream run #2 with a different row count.
    await sel.queryStreamToggle(page).check()
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(
      `USE GRAPH ${seed.graph}; MATCH (n:Person) RETURN n LIMIT 4`
    )
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/4 rows/)).toBeVisible({ timeout: 15_000 })

    // Sync run #3 — the previous stream's rows must NOT leak.
    await sel.queryStreamToggle(page).uncheck()
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('RETURN 1 AS one')
    await sel.queryRunBtn(page).click()
    await expect(page.getByText(/1 rows/)).toBeVisible({ timeout: 10_000 })
  })
})
```

- [ ] **Step 5.2: Run the new spec**

Run: `npm run e2e -- --reporter=list e2e/specs/12-multi-request.spec.ts`
Expected: 2 tests pass.

- [ ] **Step 5.3: Commit**

```bash
git add e2e/specs/12-multi-request.spec.ts
git commit -m "test(e2e): multi-request reliability on the query page"
```

---

## Task 6: Rebuild + redeploy + push

- [ ] **Step 6.1: Rebuild the geode-ui container so the tailnet UI gets the new bundle**

Run:

```bash
docker compose -f deploy/docker-compose.test.yml up -d --build geode-ui
```

Expected: `geode-ui-1 Started`. New `main.<hash>.js` is served by the container.

- [ ] **Step 6.2: Confirm the projection runs in the live bundle**

Run:

```bash
BUNDLE=$(curl -s http://localhost:8080/ | grep -oE 'main\.[a-f0-9]+\.js' | head -1)
echo "$BUNDLE"
curl -s "http://localhost:8080/$BUNDLE" | grep -oE 'projectColumns|_labels|_type' | sort -u
```

Expected: at least `_labels`, `_type`, and `projectColumns` (or its mangled equivalent) appear — confirms the new code shipped.

- [ ] **Step 6.3: Run the full e2e suite once to confirm no regressions**

Run: `npm run e2e -- --reporter=list`
Expected: all specs in `e2e/specs/` pass (or skip-gracefully where `SHOW USERS` etc. trip the v0.5.11 wire gap).

- [ ] **Step 6.4: Push**

```bash
git push origin main
```

Expected: pre-push hooks (gofmt, golangci-lint, go test -race, jest --ci, webpack production build) all green; remote advances to the new HEAD.

---

## Self-Review Notes

- Spec coverage:
  - "break out nodes into columns by default" → Tasks 1–3.
  - "commands not consistently working on multiple requests" → Task 3 (resetRunState) + Task 5 (regression spec).
  - "full Playwright tests" → Tasks 4 + 5.
- Type consistency: `projectColumns` returns `{columns: Col[], rows: unknown[][]}`; TableView's `Props.resp` accepts the broader `Array<Record<string, unknown>>` shape so passing the raw `QueryResp` is still fine. The narrower `Col[]` is structurally compatible.
- Placeholder scan: every step shows actual code or an exact command.
- Assumption: Geode v0.5.11 returns `RETURN n` rows as `{id, labels, properties}` objects (the same shape graphResult.ts already detects). If the server ever flattens nodes server-side, `projectColumns` becomes a no-op (the early `every(p.kind === 'other')` bail-out handles that).
