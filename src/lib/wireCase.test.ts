import { camelCaseStreamFrame, snakeToCamelDeep } from './wireCase'

describe('snakeToCamelDeep', () => {
  it('rewrites snake_case object keys to camelCase', () => {
    expect(snakeToCamelDeep({ start_node: 1, end_node: 2 })).toEqual({
      startNode: 1,
      endNode: 2,
    })
  })

  it('recurses into nested objects and arrays', () => {
    const input = {
      id: 7,
      labels: ['Person'],
      properties: { first_name: 'Ada', created_at: '2020' },
    }
    expect(snakeToCamelDeep(input)).toEqual({
      id: 7,
      labels: ['Person'],
      properties: { firstName: 'Ada', createdAt: '2020' },
    })
  })

  it('maps arrays element-wise (rows of cells)', () => {
    const rows = [
      [{ start_node: 1, end_node: 2 }, 'scalar', 3],
      [{ id: 9, properties: { is_active: true } }],
    ]
    expect(snakeToCamelDeep(rows)).toEqual([
      [{ startNode: 1, endNode: 2 }, 'scalar', 3],
      [{ id: 9, properties: { isActive: true } }],
    ])
  })

  it('returns scalars and null unchanged', () => {
    expect(snakeToCamelDeep(42)).toBe(42)
    expect(snakeToCamelDeep('a_b')).toBe('a_b') // string VALUES are not keys
    expect(snakeToCamelDeep(true)).toBe(true)
    expect(snakeToCamelDeep(null)).toBeNull()
    expect(snakeToCamelDeep(undefined)).toBeUndefined()
  })

  it('leaves already-camelCase keys untouched and collapses repeated underscores', () => {
    expect(
      snakeToCamelDeep({ alreadyCamel: 1, a__b: 2, max_open_conns: 3 })
    ).toEqual({ alreadyCamel: 1, aB: 2, maxOpenConns: 3 })
  })
})

describe('camelCaseStreamFrame', () => {
  it("converts the cells of a 'row' frame, leaving the envelope intact", () => {
    const frame = {
      kind: 'row',
      row: [
        { id: 1, start_node: 1, end_node: 2, properties: { acted_in: 'x' } },
      ],
    }
    expect(camelCaseStreamFrame(frame)).toEqual({
      kind: 'row',
      row: [{ id: 1, startNode: 1, endNode: 2, properties: { actedIn: 'x' } }],
    })
  })

  it("converts the cells of a 'rows' batch frame", () => {
    const frame = {
      kind: 'rows',
      rows: [[{ start_node: 1 }], [{ end_node: 2 }]],
    }
    expect(camelCaseStreamFrame(frame)).toEqual({
      kind: 'rows',
      rows: [[{ startNode: 1 }], [{ endNode: 2 }]],
    })
  })

  it('leaves scalar cells unchanged (tabular stream pays no key-rewrite cost)', () => {
    const frame = { kind: 'rows', rows: [[1, 'two', true]] }
    expect(camelCaseStreamFrame(frame)).toEqual(frame)
  })

  it('does NOT rewrite protocol envelope keys (summary row_count / elapsed_ms)', () => {
    const summary = { kind: 'summary', row_count: 10, elapsed_ms: 5 }
    expect(camelCaseStreamFrame(summary)).toEqual(summary)
  })

  it('passes schema / error / end frames through unchanged', () => {
    const schema = { kind: 'schema', columns: [{ name: 'n', type: 'NODE' }] }
    const err = { kind: 'error', code: 'boom', message: 'x' }
    const end = { kind: 'end' }
    expect(camelCaseStreamFrame(schema)).toEqual(schema)
    expect(camelCaseStreamFrame(err)).toEqual(err)
    expect(camelCaseStreamFrame(end)).toEqual(end)
  })

  it('returns non-object inputs as-is', () => {
    expect(camelCaseStreamFrame(null)).toBeNull()
    expect(camelCaseStreamFrame('not a frame')).toBe('not a frame')
    expect(camelCaseStreamFrame(7)).toBe(7)
  })
})
