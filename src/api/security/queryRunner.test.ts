/// <reference types="@testing-library/jest-dom" />
import {
  runProcedure,
  parseColumns,
  parseRows,
  asString,
  asNumber,
} from './queryRunner'

jest.mock('../client', () => ({
  client: { query: jest.fn() },
}))

import { client } from '../client'

const mockQuery = client.query as jest.Mock

beforeEach(() => {
  mockQuery.mockReset()
})

describe('parseColumns', () => {
  it('extracts the name field from each column descriptor', () => {
    const cols = parseColumns([{ name: 'status' }, { name: 'count' }])
    expect(cols).toEqual(['status', 'count'])
  })
  it('handles missing/non-string name fields by returning empty string', () => {
    const cols = parseColumns([
      {},
      { name: 42 as unknown as string },
      { name: 'ok' },
    ])
    expect(cols).toEqual(['', '', 'ok'])
  })
})

describe('asString/asNumber', () => {
  it('asString returns the string or null', () => {
    expect(asString('abc')).toBe('abc')
    expect(asString(42)).toBeNull()
    expect(asString(null)).toBeNull()
  })
  it('asNumber returns the number or null', () => {
    expect(asNumber(42)).toBe(42)
    expect(asNumber('42')).toBeNull()
    expect(asNumber(NaN)).toBeNull()
  })
})

describe('parseRows', () => {
  it('zips column names with each row tuple into a Record', () => {
    const rows = parseRows(
      ['graph', 'label', 'username'],
      [
        ['g1', 'Person', 'alice'],
        ['g2', 'Org', 'bob'],
      ]
    )
    expect(rows).toEqual([
      { graph: 'g1', label: 'Person', username: 'alice' },
      { graph: 'g2', label: 'Org', username: 'bob' },
    ])
  })
  it('truncates extra row cells beyond the declared columns', () => {
    const rows = parseRows(['a'], [[1, 2, 3]])
    expect(rows).toEqual([{ a: 1 }])
  })
  it('pads short rows with undefined', () => {
    const rows = parseRows(['a', 'b', 'c'], [[1]])
    expect(rows).toEqual([{ a: 1, b: undefined, c: undefined }])
  })
})

describe('runProcedure', () => {
  it('formats positional args as GQL string literals', async () => {
    mockQuery.mockResolvedValue({
      columns: [{ name: 'status' }],
      rows: [['ok']],
      row_count: 1,
      elapsed_ms: 1,
    })
    const result = await runProcedure('geode.rls.add_deny_policy', [
      'g1',
      "O'Reilly",
      'alice',
    ])
    expect(mockQuery).toHaveBeenCalledWith({
      statement: "CALL geode.rls.add_deny_policy('g1', 'O''Reilly', 'alice')",
    })
    expect(result.columns).toEqual(['status'])
    expect(result.rows).toEqual([{ status: 'ok' }])
  })
  it('escapes embedded single quotes via SQL-style doubling', async () => {
    mockQuery.mockResolvedValue({
      columns: [],
      rows: [],
      row_count: 0,
      elapsed_ms: 0,
    })
    await runProcedure('geode.x', ["a'b", "c''d"])
    expect(mockQuery).toHaveBeenCalledWith({
      statement: "CALL geode.x('a''b', 'c''''d')",
    })
  })
  it('forwards QueryResp parse errors as Error with the original message', async () => {
    mockQuery.mockRejectedValue(
      Object.assign(new Error('wire_feature_missing'), { status: 501 })
    )
    await expect(runProcedure('geode.x', [])).rejects.toThrow(
      /wire_feature_missing/
    )
  })
})
