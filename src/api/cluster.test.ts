import {
  parseClusterStatusRows,
  isClusterMode,
  fetchClusterStatus,
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

// MockWebSocket mirrors the pattern used in src/lib/queryStream.test.ts
// (one of the existing tests already proves streamQuery sends the
// statement payload correctly; this test only needs to drive a few
// canned frames and assert the parsed snapshot).
type Listener = (arg?: any) => void

class MockWebSocket {
  url: string

  protocols: string | string[] | undefined

  listeners: Record<string, Listener[]> = {}

  send = jest.fn()

  close = jest.fn()

  constructor(url: string, protocols?: string | string[]) {
    this.url = url
    this.protocols = protocols
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastWs = this
  }

  addEventListener(type: string, cb: Listener): void {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type]!.push(cb)
  }

  fire(type: string, data?: any): void {
    const list = this.listeners[type] || []
    list.forEach((cb) => cb(data))
  }
}

let lastWs: MockWebSocket | null = null

beforeEach(() => {
  lastWs = null
  // eslint-disable-next-line semi-style -- prettier emits the leading-semicolon protector
  ;(window as any).WebSocket = MockWebSocket
})

test('fetchClusterStatus resolves with the parsed snapshot from the WS stream', async () => {
  const promise = fetchClusterStatus()
  // Allow streamQuery's microtask to bind listeners and the WS to settle.
  await Promise.resolve()
  expect(lastWs).not.toBeNull()
  lastWs!.fire('open')
  // Server frames: schema, then a rowBatch of three members, then end.
  lastWs!.fire('message', {
    data: JSON.stringify({
      kind: 'rows',
      rows: [
        [1, 'leader', 4, 1, '10.0.0.1:7400', 0],
        [2, 'follower', 4, 1, '10.0.0.2:7400', 12],
        [3, 'follower', 4, 1, '10.0.0.3:7400', 7],
      ],
    }),
  })
  lastWs!.fire('message', {
    data: JSON.stringify({ kind: 'summary', row_count: 3, elapsed_ms: 1 }),
  })
  lastWs!.fire('message', { data: JSON.stringify({ kind: 'end' }) })
  lastWs!.fire('close')
  const snap = await promise
  expect(snap.members).toHaveLength(3)
  expect(snap.members[0]?.role).toBe('leader')
  expect(snap.selfNodeId).toBe(1)
  expect(typeof snap.fetchedAt).toBe('number')
})

test('fetchClusterStatus rejects when the stream emits an error frame', async () => {
  const promise = fetchClusterStatus()
  await Promise.resolve()
  lastWs!.fire('open')
  lastWs!.fire('message', {
    data: JSON.stringify({
      kind: 'error',
      code: 'permission_denied',
      message: 'principal lacks cluster.read',
    }),
  })
  lastWs!.fire('close')
  await expect(promise).rejects.toThrow(
    'permission_denied: principal lacks cluster.read'
  )
})
