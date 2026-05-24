import {
  addDenyPolicy,
  removeDenyPolicy,
  listDenyPolicies,
  getDenyPolicyCount,
} from './rlsDenyPolicies'

jest.mock('./queryRunner', () => {
  const actual =
    jest.requireActual<typeof import('./queryRunner')>('./queryRunner')
  return { ...actual, runProcedure: jest.fn() }
})
import { runProcedure } from './queryRunner'

const mockRun = runProcedure as jest.Mock
beforeEach(() => mockRun.mockReset())

describe('addDenyPolicy', () => {
  it('passes graph, label, username positionally', async () => {
    mockRun.mockResolvedValue({
      columns: ['status'],
      rows: [{ status: 'ok' }],
      rowCount: 1,
      elapsedMs: 1,
    })
    await addDenyPolicy({ graph: 'g1', label: 'Person', username: 'alice' })
    expect(mockRun).toHaveBeenCalledWith('geode.rls.add_deny_policy', [
      'g1',
      'Person',
      'alice',
    ])
  })
  it('passes empty string when username is omitted (applies to all users)', async () => {
    mockRun.mockResolvedValue({
      columns: ['status'],
      rows: [{ status: 'ok' }],
      rowCount: 1,
      elapsedMs: 1,
    })
    await addDenyPolicy({ graph: 'g1', label: 'Person' })
    expect(mockRun).toHaveBeenCalledWith('geode.rls.add_deny_policy', [
      'g1',
      'Person',
      '',
    ])
  })
  it('rejects empty graph or label', async () => {
    await expect(addDenyPolicy({ graph: '', label: 'X' })).rejects.toThrow(
      /graph required/i
    )
    await expect(addDenyPolicy({ graph: 'g', label: '' })).rejects.toThrow(
      /label required/i
    )
  })
})

describe('removeDenyPolicy', () => {
  it('returns the removed_count from the response', async () => {
    mockRun.mockResolvedValue({
      columns: ['status', 'removed_count'],
      rows: [{ status: 'ok', removed_count: 2 }],
      rowCount: 1,
      elapsedMs: 1,
    })
    const n = await removeDenyPolicy({ graph: 'g', label: 'L', username: 'u' })
    expect(n).toBe(2)
  })
  it('returns 0 when removed_count is missing from the response', async () => {
    mockRun.mockResolvedValue({
      columns: ['status'],
      rows: [{ status: 'ok' }],
      rowCount: 1,
      elapsedMs: 1,
    })
    const n = await removeDenyPolicy({ graph: 'g', label: 'L', username: 'u' })
    expect(n).toBe(0)
  })
  it('returns 0 when the response is empty', async () => {
    mockRun.mockResolvedValue({
      columns: [],
      rows: [],
      rowCount: 0,
      elapsedMs: 1,
    })
    const n = await removeDenyPolicy({ graph: 'g', label: 'L', username: 'u' })
    expect(n).toBe(0)
  })
})

describe('listDenyPolicies', () => {
  it('returns rows mapped to {graph,label,username}', async () => {
    mockRun.mockResolvedValue({
      columns: ['graph', 'label', 'username'],
      rows: [
        { graph: 'g1', label: 'Person', username: 'alice' },
        { graph: 'g2', label: 'Org', username: '' },
      ],
      rowCount: 2,
      elapsedMs: 1,
    })
    const result = await listDenyPolicies()
    expect(result).toEqual([
      { graph: 'g1', label: 'Person', username: 'alice' },
      { graph: 'g2', label: 'Org', username: '' },
    ])
  })
  it('filters out rows missing required fields', async () => {
    mockRun.mockResolvedValue({
      columns: ['graph', 'label', 'username'],
      rows: [
        { graph: 'g1', label: 'Person', username: 'alice' },
        { graph: '', label: 'X', username: '' },
        { graph: 'g2', label: '', username: 'bob' },
      ],
      rowCount: 3,
      elapsedMs: 1,
    })
    const result = await listDenyPolicies()
    expect(result).toEqual([
      { graph: 'g1', label: 'Person', username: 'alice' },
    ])
  })
})

describe('getDenyPolicyCount', () => {
  it('returns the count number from the single row', async () => {
    mockRun.mockResolvedValue({
      columns: ['count'],
      rows: [{ count: 7 }],
      rowCount: 1,
      elapsedMs: 1,
    })
    const n = await getDenyPolicyCount()
    expect(n).toBe(7)
  })
  it('returns 0 on an empty response', async () => {
    mockRun.mockResolvedValue({
      columns: ['count'],
      rows: [],
      rowCount: 0,
      elapsedMs: 1,
    })
    expect(await getDenyPolicyCount()).toBe(0)
  })
})
