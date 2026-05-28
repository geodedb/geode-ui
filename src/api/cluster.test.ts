import {
  parseClusterStatusRows,
  isClusterMode,
  CLUSTER_STATUS_STMT,
  type ClusterMember,
} from './cluster'

describe('parseClusterStatusRows', () => {
  test('parses a standalone single-row response', () => {
    const rows: unknown[][] = [[0, 'standalone', 0, 0, '0.0.0.0:0', 0]]
    const members = parseClusterStatusRows(rows)
    expect(members).toEqual<ClusterMember[]>([
      {
        nodeId: 0,
        role: 'standalone',
        term: 0,
        leaderId: 0,
        endpoint: '0.0.0.0:0',
        lastContactMs: 0,
      },
    ])
  })

  test('parses a multi-row cluster response and coerces numeric strings', () => {
    const rows: unknown[][] = [
      [1, 'leader', '7', '1', '10.0.0.1:7400', 0],
      [2, 'follower', '7', '1', '10.0.0.2:7400', '42'],
      [3, 'follower', '7', '1', '10.0.0.3:7400', '88'],
    ]
    const members = parseClusterStatusRows(rows)
    expect(members).toHaveLength(3)
    expect(members[0]).toEqual<ClusterMember>({
      nodeId: 1,
      role: 'leader',
      term: 7,
      leaderId: 1,
      endpoint: '10.0.0.1:7400',
      lastContactMs: 0,
    })
    expect(members[2]?.lastContactMs).toBe(88)
  })

  test('skips malformed rows (wrong arity, non-coercible)', () => {
    const rows: unknown[][] = [
      [1, 'leader', 1, 1, 'h:1', 0],
      [99, 'follower'], // too short
      [null, 'follower', 1, 1, 'h:2', 0], // unusable id
    ]
    const members = parseClusterStatusRows(rows)
    expect(members).toHaveLength(1)
    expect(members[0]?.nodeId).toBe(1)
  })
})

describe('isClusterMode', () => {
  test('returns false when only row is standalone', () => {
    expect(
      isClusterMode([
        {
          nodeId: 0,
          role: 'standalone',
          term: 0,
          leaderId: 0,
          endpoint: '0.0.0.0:0',
          lastContactMs: 0,
        },
      ])
    ).toBe(false)
  })

  test('returns true when any row is non-standalone', () => {
    const members: ClusterMember[] = [
      {
        nodeId: 1,
        role: 'leader',
        term: 1,
        leaderId: 1,
        endpoint: 'h:1',
        lastContactMs: 0,
      },
      {
        nodeId: 2,
        role: 'follower',
        term: 1,
        leaderId: 1,
        endpoint: 'h:2',
        lastContactMs: 0,
      },
    ]
    expect(isClusterMode(members)).toBe(true)
  })

  test('returns false for empty input (defensive — treat as not-a-cluster)', () => {
    expect(isClusterMode([])).toBe(false)
  })
})

describe('CLUSTER_STATUS_STMT', () => {
  test('is exactly "SHOW CLUSTER STATUS"', () => {
    expect(CLUSTER_STATUS_STMT).toBe('SHOW CLUSTER STATUS')
  })
})
