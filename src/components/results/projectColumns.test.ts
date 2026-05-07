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
})
