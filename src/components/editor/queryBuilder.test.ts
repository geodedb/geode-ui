import { synthesiseGql, BuilderState } from './queryBuilder'

// GAP-060: pin the synthesiser's contract. Every shape exercised here
// is one the Phase-1 UI can produce; the unit tests are the only
// place we can prove the round-trip is parseable without dragging in
// Monaco.

describe('synthesiseGql', () => {
  test('single-label MATCH defaults to RETURN n', () => {
    const out = synthesiseGql({
      startLabel: 'Person',
      projection: [],
    })
    expect(out).toBe('MATCH (n:Person) RETURN n')
  })

  test('USE GRAPH prefix when graph is set', () => {
    const out = synthesiseGql({
      graph: 'movies',
      startLabel: 'Person',
      projection: [],
    })
    expect(out).toBe('USE GRAPH movies; MATCH (n:Person) RETURN n')
  })

  test('edge type widens the pattern + the default projection', () => {
    const out = synthesiseGql({
      startLabel: 'Person',
      edgeType: 'ACTED_IN',
      endLabel: 'Movie',
      projection: [],
    })
    expect(out).toBe('MATCH (n:Person)-[r:ACTED_IN]->(m:Movie) RETURN n, r, m')
  })

  test('edgeDirection=in reverses the arrow', () => {
    const out = synthesiseGql({
      startLabel: 'Movie',
      edgeType: 'ACTED_IN',
      endLabel: 'Person',
      edgeDirection: 'in',
      projection: [],
    })
    expect(out).toBe('MATCH (n:Movie)<-[r:ACTED_IN]-(m:Person) RETURN n, r, m')
  })

  test('edgeDirection=both drops the arrow head', () => {
    const out = synthesiseGql({
      startLabel: 'Movie',
      edgeType: 'ACTED_IN',
      endLabel: 'Person',
      edgeDirection: 'both',
      projection: [],
    })
    expect(out).toBe('MATCH (n:Movie)-[r:ACTED_IN]-(m:Person) RETURN n, r, m')
  })

  test('custom projection overrides the default', () => {
    const out = synthesiseGql({
      startLabel: 'Person',
      projection: ['n.name', 'n.born'],
    })
    expect(out).toBe('MATCH (n:Person) RETURN n.name, n.born')
  })

  test('LIMIT appended when positive', () => {
    const out = synthesiseGql({
      startLabel: 'Person',
      projection: [],
      limit: 10,
    })
    expect(out).toBe('MATCH (n:Person) RETURN n LIMIT 10')
  })

  test('LIMIT omitted when zero or negative', () => {
    const s: BuilderState = {
      startLabel: 'Person',
      projection: [],
      limit: 0,
    }
    expect(synthesiseGql(s)).not.toContain('LIMIT')
    const s2: BuilderState = { ...s, limit: -1 }
    expect(synthesiseGql(s2)).not.toContain('LIMIT')
  })

  test('full Phase-1 shape composes cleanly', () => {
    const out = synthesiseGql({
      graph: 'movies',
      startLabel: 'Person',
      edgeType: 'ACTED_IN',
      endLabel: 'Movie',
      edgeDirection: 'out',
      projection: ['n.name', 'm.title', 'r.roles'],
      limit: 25,
    })
    expect(out).toBe(
      'USE GRAPH movies; MATCH (n:Person)-[r:ACTED_IN]->(m:Movie) RETURN n.name, m.title, r.roles LIMIT 25'
    )
  })
})
