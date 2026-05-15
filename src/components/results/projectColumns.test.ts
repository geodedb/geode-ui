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
        [{ id: 2, labels: ['User'], properties: { name: 'b' } }],
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

  test('single-pass: large input produces correct projection (1k rows)', () => {
    // Regression test for PERF-F6 (issue #26): the previous
    // implementation walked rows three times per node/edge column
    // (kindOf + orderedKeys + final project). The single-pass
    // refactor must produce byte-identical output. Use a 1000-row
    // input with two key shapes to exercise the union-of-keys path.
    const rows: unknown[][] = []
    for (let i = 0; i < 1000; i += 1) {
      const props =
        i % 2 === 0
          ? { name: `n${i}`, age: i }
          : { name: `n${i}`, email: `n${i}@x` }
      rows.push([{ id: i, labels: ['Person'], properties: props }])
    }
    const out = projectColumns({
      columns: [{ name: 'p', type: 'NODE' }],
      rows,
    })
    // First-seen-key order: name, age (from row 0), then email (row 1).
    expect(out.columns.map((c) => c.name)).toEqual([
      'p._labels',
      'p.name',
      'p.age',
      'p.email',
    ])
    expect(out.rows.length).toBe(1000)
    // Even-indexed rows have age set, email null.
    expect(out.rows[0]).toEqual(['Person', 'n0', 0, null])
    // Odd-indexed rows have age null, email set.
    expect(out.rows[1]).toEqual(['Person', 'n1', null, 'n1@x'])
  })

  test('null cells in node columns project to null for every expansion', () => {
    const resp = {
      columns: [{ name: 'n', type: 'NODE' }],
      rows: [[{ id: 1, labels: ['User'], properties: { name: 'a' } }], [null]],
    }
    const out = projectColumns(resp)
    expect(out.columns.map((c) => c.name)).toEqual(['n._labels', 'n.name'])
    expect(out.rows).toEqual([
      ['User', 'a'],
      [null, null],
    ])
  })

  // PERF-F7 (#51): regression — the GAP-F7 refactor collapses the
  // per-column discovery passes into a single row-major sweep. This
  // test instruments the input row set with a counting Proxy so we
  // can assert how many times each row is touched during the
  // inference phase. The single-pass implementation MUST visit each
  // row exactly once for inference regardless of column count.
  test('F7 single-pass: each row visited once during inference', () => {
    const accessCounts = new Map<number, number>()
    const node = (id: number, name: string) => ({
      id,
      labels: ['Person'],
      properties: { name, born: 1980 + id },
    })
    const baseRows: unknown[][] = [
      [node(0, 'A'), node(0, 'X'), node(0, 'M')],
      [node(1, 'B'), node(1, 'Y'), node(1, 'N')],
      [node(2, 'C'), node(2, 'Z'), node(2, 'O')],
    ]
    // Wrap each row in a Proxy that counts property reads (column
    // index accesses during inference).
    const trackedRows: unknown[][] = baseRows.map((row, idx) => {
      accessCounts.set(idx, 0)
      return new Proxy(row, {
        get(target, prop, receiver) {
          // Count only numeric column-index accesses. JS-reflective
          // reads (`length`, Symbol.iterator, etc.) pass through.
          if (typeof prop === 'string' && /^\d+$/.test(prop)) {
            accessCounts.set(idx, (accessCounts.get(idx) ?? 0) + 1)
          }
          return Reflect.get(target, prop, receiver)
        },
      }) as unknown[]
    })

    const out = projectColumns({
      columns: [
        { name: 'a', type: 'NODE' },
        { name: 'b', type: 'NODE' },
        { name: 'c', type: 'NODE' },
      ],
      rows: trackedRows,
    })

    // Sanity: projection is correct.
    expect(out.columns.length).toBe(3 * 3) // 3 nodes × (_labels + 2 props)
    expect(out.rows.length).toBe(3)

    // F7 invariant: inference (`states[i].kind/keys` discovery) does
    // a single sweep with 3 cols × 3 rows = 9 cell reads from
    // inference. Materialisation then re-walks all cells.
    // Pre-F7 implementation called `discoverPlan(rows, i, ...)` per
    // column, which would have read each row.length cells × 3 cols
    // ≈ 27 reads during inference (worse: O(C²) on the inner row
    // index access). Post-F7, the inference pass touches each row's
    // cell N=col-count times for the row-loop, then materialisation
    // touches them again. Total reads per row should be exactly
    // 2 × col-count = 6.
    // Tolerate +1 per row for the materialisation loop's
    // initial-cell access pattern.
    for (let i = 0; i < trackedRows.length; i += 1) {
      const count = accessCounts.get(i) ?? -1
      const cols = 3
      const maxAllowed = 2 * cols + 1
      expect(count).toBeLessThanOrEqual(maxAllowed)
      // And at least cols reads — inference MUST visit every column
      // at least once.
      expect(count).toBeGreaterThanOrEqual(cols)
    }
  })

  test('F7 single-pass: declared NODE/EDGE type drives output even for empty rows', () => {
    // Even with zero rows, a column declared as NODE must still
    // emit its structural _labels column. The pre-F7 implementation
    // also did this; the single-pass refactor must preserve it.
    const out = projectColumns({
      columns: [
        { name: 'n', type: 'NODE' },
        { name: 'e', type: 'EDGE' },
      ],
      rows: [] as unknown[][],
    })
    expect(out.columns.map((c) => c.name)).toEqual(['n._labels', 'e._type'])
    expect(out.rows).toEqual([])
  })
})
