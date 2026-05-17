import { parseMatchAndReturn } from '../matchPattern'
import {
  applyParsedMatchLabels,
  pickScalarLabel,
} from './applyParsedMatchLabels'

describe('applyParsedMatchLabels', () => {
  test('groups per-row scalars by their MATCH variable', () => {
    // MATCH (p:Person)-[r:ACTED_IN]->(m:Movie) RETURN p.name, m.title
    const parsed = parseMatchAndReturn(
      'MATCH (p:Person)-[r:ACTED_IN]->(m:Movie) RETURN p.name, m.title'
    )
    const colVar = parsed.returnColumns.map((rc) => rc.varName ?? null)
    const row = ['Keanu', 'The Matrix']
    const out = applyParsedMatchLabels(row, colVar, parsed, new Set())
    expect(out.get('p')).toBe('Keanu')
    expect(out.get('m')).toBe('The Matrix')
  })

  test('skips columns flagged in skip set', () => {
    const parsed = parseMatchAndReturn('MATCH (p:Person) RETURN p.name')
    const colVar = parsed.returnColumns.map((rc) => rc.varName ?? null)
    const out = applyParsedMatchLabels(['hidden'], colVar, parsed, new Set([0]))
    expect(out.size).toBe(0)
  })

  test('returns empty map when colVar is empty', () => {
    const parsed = parseMatchAndReturn('MATCH (p) RETURN 1')
    const out = applyParsedMatchLabels(['x'], [], parsed, new Set())
    expect(out.size).toBe(0)
  })

  test('non-string scalar values are stringified through pickScalarLabel', () => {
    const parsed = parseMatchAndReturn('MATCH (p:Person) RETURN p.age')
    const colVar = parsed.returnColumns.map((rc) => rc.varName ?? null)
    const out = applyParsedMatchLabels([42], colVar, parsed, new Set())
    expect(out.get('p')).toBe('42')
  })
})

describe('pickScalarLabel', () => {
  test('prefers a field named name', () => {
    expect(pickScalarLabel({ name: 'Alice', age: 30 })).toBe('Alice')
  })
  test('falls back to title when no name', () => {
    expect(pickScalarLabel({ title: 'Manager', age: 30 })).toBe('Manager')
  })
  test('falls back to id when no name/title', () => {
    expect(pickScalarLabel({ id: 'X-1', other: 'y' })).toBe('X-1')
  })
  test('falls back to first non-empty alphabetically', () => {
    expect(pickScalarLabel({ zebra: '', alpha: 'first', beta: 'second' })).toBe(
      'first'
    )
  })
  test('returns null when every field is empty/null', () => {
    expect(pickScalarLabel({ a: null, b: undefined, c: '' })).toBe(null)
  })
  test('returns null on empty input', () => {
    expect(pickScalarLabel({})).toBe(null)
  })
})
