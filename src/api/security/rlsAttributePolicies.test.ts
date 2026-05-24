import {
  addAttributePolicy,
  removeAttributePolicy,
  listAttributePolicies,
} from './rlsAttributePolicies'

jest.mock('./queryRunner', () => {
  const actual =
    jest.requireActual<typeof import('./queryRunner')>('./queryRunner')
  return { ...actual, runProcedure: jest.fn() }
})
import { runProcedure } from './queryRunner'

const mockRun = runProcedure as jest.Mock
beforeEach(() => mockRun.mockReset())

describe('addAttributePolicy', () => {
  it('passes graph, label, row_property, attribute_key in order', async () => {
    mockRun.mockResolvedValue({
      columns: ['status'],
      rows: [{ status: 'ok' }],
      rowCount: 1,
      elapsedMs: 1,
    })
    await addAttributePolicy({
      graph: 'g1',
      label: 'Doc',
      rowProperty: 'department',
      attributeKey: 'department',
    })
    expect(mockRun).toHaveBeenCalledWith('geode.rls.add_attribute_policy', [
      'g1',
      'Doc',
      'department',
      'department',
    ])
  })
  it('rejects empty fields', async () => {
    const base = { graph: 'g', label: 'L', rowProperty: 'p', attributeKey: 'k' }
    await expect(addAttributePolicy({ ...base, graph: '' })).rejects.toThrow(
      /graph required/i
    )
    await expect(addAttributePolicy({ ...base, label: '' })).rejects.toThrow(
      /label required/i
    )
    await expect(
      addAttributePolicy({ ...base, rowProperty: '' })
    ).rejects.toThrow(/row property required/i)
    await expect(
      addAttributePolicy({ ...base, attributeKey: '' })
    ).rejects.toThrow(/attribute key required/i)
  })
})

describe('removeAttributePolicy', () => {
  it('returns true when removed=true', async () => {
    mockRun.mockResolvedValue({
      columns: ['status', 'removed'],
      rows: [{ status: 'ok', removed: true }],
      rowCount: 1,
      elapsedMs: 1,
    })
    const ok = await removeAttributePolicy({
      graph: 'g',
      label: 'L',
      rowProperty: 'p',
      attributeKey: 'k',
    })
    expect(ok).toBe(true)
  })
  it('returns false when removed=false', async () => {
    mockRun.mockResolvedValue({
      columns: ['status', 'removed'],
      rows: [{ status: 'not-found', removed: false }],
      rowCount: 1,
      elapsedMs: 1,
    })
    const ok = await removeAttributePolicy({
      graph: 'g',
      label: 'L',
      rowProperty: 'p',
      attributeKey: 'k',
    })
    expect(ok).toBe(false)
  })
})

describe('listAttributePolicies', () => {
  it('returns [] when gps.list_policies is unavailable (501)', async () => {
    mockRun.mockRejectedValue(
      Object.assign(new Error('wire_feature_missing'), { status: 501 })
    )
    expect(await listAttributePolicies()).toEqual([])
  })
  it('filters gps.list_policies output to attribute-style restrictive policies', async () => {
    mockRun.mockResolvedValue({
      columns: [
        'name',
        'expression',
        'graph',
        'label',
        'operation',
        'permissive',
      ],
      rows: [
        {
          name: 'p1',
          expression: 'row.department = principal.attribute.department',
          graph: 'g1',
          label: 'Doc',
          operation: 'select',
          permissive: false,
        },
        {
          name: 'p2',
          expression: 'true',
          graph: 'g1',
          label: 'Doc',
          operation: 'select',
          permissive: true,
        },
        {
          name: 'p3',
          expression: 'row.x = principal.attribute.y',
          graph: 'g2',
          label: 'Article',
          operation: 'update', // wrong op — filter out
          permissive: false,
        },
      ],
      rowCount: 3,
      elapsedMs: 1,
    })
    expect(await listAttributePolicies()).toEqual([
      {
        graph: 'g1',
        label: 'Doc',
        rowProperty: 'department',
        attributeKey: 'department',
      },
    ])
  })
  it('rethrows non-501 errors', async () => {
    mockRun.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }))
    await expect(listAttributePolicies()).rejects.toThrow('boom')
  })
})
