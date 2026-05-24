import {
  setUserAttribute,
  removeUserAttribute,
  listUserAttributes,
} from './userAttributes'

jest.mock('./queryRunner', () => {
  const actual =
    jest.requireActual<typeof import('./queryRunner')>('./queryRunner')
  return { ...actual, runProcedure: jest.fn() }
})

import { runProcedure } from './queryRunner'

const mockRun = runProcedure as jest.Mock

beforeEach(() => {
  mockRun.mockReset()
})

describe('setUserAttribute', () => {
  it('calls geode.auth.user_set_attribute with positional args', async () => {
    mockRun.mockResolvedValue({
      columns: ['status'],
      rows: [{ status: 'ok' }],
      rowCount: 1,
      elapsedMs: 1,
    })
    await setUserAttribute('alice', 'department', 'engineering')
    expect(mockRun).toHaveBeenCalledWith('geode.auth.user_set_attribute', [
      'alice',
      'department',
      'engineering',
    ])
  })
  it('rejects empty username/key with a typed error', async () => {
    await expect(setUserAttribute('', 'k', 'v')).rejects.toThrow(
      /username required/i
    )
    await expect(setUserAttribute('alice', '', 'v')).rejects.toThrow(
      /key required/i
    )
  })
})

describe('removeUserAttribute', () => {
  it('calls geode.auth.user_remove_attribute with positional args', async () => {
    mockRun.mockResolvedValue({
      columns: ['status'],
      rows: [{ status: 'ok' }],
      rowCount: 1,
      elapsedMs: 1,
    })
    await removeUserAttribute('alice', 'department')
    expect(mockRun).toHaveBeenCalledWith('geode.auth.user_remove_attribute', [
      'alice',
      'department',
    ])
  })
})

describe('listUserAttributes', () => {
  it('returns an array of {key,value} from the procedure rows', async () => {
    mockRun.mockResolvedValue({
      columns: ['key', 'value'],
      rows: [
        { key: 'department', value: 'engineering' },
        { key: 'level', value: 'L3' },
      ],
      rowCount: 2,
      elapsedMs: 1,
    })
    const result = await listUserAttributes('alice')
    expect(mockRun).toHaveBeenCalledWith('geode.auth.user_list_attributes', [
      'alice',
    ])
    expect(result).toEqual([
      { key: 'department', value: 'engineering' },
      { key: 'level', value: 'L3' },
    ])
  })
  it('returns empty array when the procedure is missing (501)', async () => {
    mockRun.mockRejectedValue(
      Object.assign(new Error('wire_feature_missing'), { status: 501 })
    )
    const result = await listUserAttributes('alice')
    expect(result).toEqual([])
  })
  it('rethrows non-501 errors', async () => {
    mockRun.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }))
    await expect(listUserAttributes('alice')).rejects.toThrow('boom')
  })
  it('returns [] for an empty username (no procedure call)', async () => {
    const result = await listUserAttributes('')
    expect(result).toEqual([])
    expect(mockRun).not.toHaveBeenCalled()
  })
})
