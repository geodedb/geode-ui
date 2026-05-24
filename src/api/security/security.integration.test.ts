import {
  addDenyPolicy,
  removeDenyPolicy,
  listDenyPolicies,
  getDenyPolicyCount,
} from './rlsDenyPolicies'
import {
  addAttributePolicy,
  removeAttributePolicy,
  listAttributePolicies,
} from './rlsAttributePolicies'
import {
  setUserAttribute,
  removeUserAttribute,
  listUserAttributes,
} from './userAttributes'

// In-memory simulator that captures statements and routes them through
// a tiny procedure dispatcher matching the upstream contract. The mock
// emits the same QueryResp shape (columns + rows + row_count +
// elapsed_ms) so the wrappers exercise the same parse path they hit
// in production.

interface DenyKey {
  graph: string
  label: string
  username: string
}
interface AttrKey {
  graph: string
  label: string
  rowProperty: string
  attributeKey: string
}

interface FakeQueryResp {
  columns: Array<{ name: string }>
  rows: Array<Array<unknown>>
  row_count: number
  elapsed_ms: number
}

class FakeGeode {
  denyPolicies: DenyKey[] = []

  attrPolicies: AttrKey[] = []

  userAttrs: Map<string, Map<string, string>> = new Map()

  query({ statement }: { statement: string }): FakeQueryResp {
    const m = statement.match(/^CALL\s+([\w.]+)\(([^)]*)\)$/)
    if (!m) throw Object.assign(new Error('parse_error'), { status: 400 })
    const proc = m[1]!
    const args = parseArgs(m[2]!)

    switch (proc) {
      case 'geode.rls.add_deny_policy': {
        const [graph, label, username] = args
        this.denyPolicies.push({
          graph: graph!,
          label: label!,
          username: username ?? '',
        })
        return rep('status', [['ok']])
      }
      case 'geode.rls.remove_deny_policy': {
        const [graph, label, username] = args
        const before = this.denyPolicies.length
        this.denyPolicies = this.denyPolicies.filter(
          (p) =>
            p.graph !== graph ||
            p.label !== label ||
            p.username !== (username ?? '')
        )
        return rep('status,removed_count', [
          ['ok', before - this.denyPolicies.length],
        ])
      }
      case 'geode.rls.list_deny_policies':
        return rep(
          'graph,label,username',
          this.denyPolicies.map((p) => [p.graph, p.label, p.username])
        )
      case 'geode.rls.policy_count':
        return rep('count', [[this.denyPolicies.length]])
      case 'geode.rls.add_attribute_policy': {
        const [graph, label, rowProperty, attributeKey] = args
        this.attrPolicies.push({
          graph: graph!,
          label: label!,
          rowProperty: rowProperty!,
          attributeKey: attributeKey!,
        })
        return rep('status', [['ok']])
      }
      case 'geode.rls.remove_attribute_policy': {
        const [graph, label, rowProperty, attributeKey] = args
        const before = this.attrPolicies.length
        this.attrPolicies = this.attrPolicies.filter(
          (p) =>
            p.graph !== graph ||
            p.label !== label ||
            p.rowProperty !== rowProperty ||
            p.attributeKey !== attributeKey
        )
        return rep('status,removed', [
          ['ok', before > this.attrPolicies.length],
        ])
      }
      case 'gps.list_policies':
        return rep(
          'name,expression,graph,label,operation,permissive',
          this.attrPolicies.map((p, i) => [
            `p${i}`,
            `row.${p.rowProperty} = principal.attribute.${p.attributeKey}`,
            p.graph,
            p.label,
            'select',
            false,
          ])
        )
      case 'geode.auth.user_set_attribute': {
        const [u, k, v] = args
        if (!this.userAttrs.has(u!)) this.userAttrs.set(u!, new Map())
        this.userAttrs.get(u!)!.set(k!, v!)
        return rep('status', [['ok']])
      }
      case 'geode.auth.user_remove_attribute': {
        const [u, k] = args
        this.userAttrs.get(u!)?.delete(k!)
        return rep('status', [['ok']])
      }
      case 'geode.auth.user_list_attributes': {
        const [u] = args
        const map = this.userAttrs.get(u!)
        if (!map) return rep('key,value', [])
        return rep(
          'key,value',
          [...map.entries()].map(([k, v]) => [k, v])
        )
      }
      default:
        throw Object.assign(new Error('wire_feature_missing'), { status: 501 })
    }
  }
}

function parseArgs(raw: string): string[] {
  if (raw.trim() === '') return []
  // The fake's call site escapes single quotes via the SQL doubling
  // convention (`O''Reilly`). Split on `', '`-style separators and
  // unwrap the surrounding quotes — works because the wrappers never
  // emit literal commas inside a value.
  const out: string[] = []
  let i = 0
  while (i < raw.length) {
    while (raw[i] === ' ' || raw[i] === ',') i += 1
    if (raw[i] !== "'") break
    i += 1 // consume opening quote
    let buf = ''
    while (i < raw.length) {
      if (raw[i] === "'") {
        if (raw[i + 1] === "'") {
          buf += "'"
          i += 2
        } else {
          i += 1
          break
        }
      } else {
        buf += raw[i]
        i += 1
      }
    }
    out.push(buf)
  }
  return out
}

function rep(cols: string, rows: Array<Array<unknown>>): FakeQueryResp {
  return {
    columns: cols.split(',').map((name) => ({ name })),
    rows,
    row_count: rows.length,
    elapsed_ms: 1,
  }
}

let fake: FakeGeode

jest.mock('../client', () => ({
  client: {
    query: jest.fn((req: { statement: string }) =>
      Promise.resolve(fake.query(req))
    ),
  },
}))

beforeEach(() => {
  fake = new FakeGeode()
})

test('deny policy round-trip', async () => {
  await addDenyPolicy({ graph: 'g', label: 'L', username: 'u' })
  expect(await getDenyPolicyCount()).toBe(1)
  expect(await listDenyPolicies()).toEqual([
    { graph: 'g', label: 'L', username: 'u' },
  ])
  const removed = await removeDenyPolicy({
    graph: 'g',
    label: 'L',
    username: 'u',
  })
  expect(removed).toBe(1)
  expect(await getDenyPolicyCount()).toBe(0)
})

test('attribute policy round-trip via gps.list_policies pattern match', async () => {
  await addAttributePolicy({
    graph: 'g',
    label: 'L',
    rowProperty: 'dept',
    attributeKey: 'department',
  })
  expect(await listAttributePolicies()).toEqual([
    { graph: 'g', label: 'L', rowProperty: 'dept', attributeKey: 'department' },
  ])
  expect(
    await removeAttributePolicy({
      graph: 'g',
      label: 'L',
      rowProperty: 'dept',
      attributeKey: 'department',
    })
  ).toBe(true)
  expect(await listAttributePolicies()).toEqual([])
})

test('user attribute round-trip', async () => {
  await setUserAttribute('alice', 'department', 'engineering')
  await setUserAttribute('alice', 'level', 'L3')
  expect(await listUserAttributes('alice')).toEqual([
    { key: 'department', value: 'engineering' },
    { key: 'level', value: 'L3' },
  ])
  await removeUserAttribute('alice', 'department')
  expect(await listUserAttributes('alice')).toEqual([
    { key: 'level', value: 'L3' },
  ])
})

test('single quotes in argument values round-trip via SQL doubling', async () => {
  await setUserAttribute('alice', 'note', "O'Reilly's team")
  expect(await listUserAttributes('alice')).toEqual([
    { key: 'note', value: "O'Reilly's team" },
  ])
})

test('cross-feature isolation: user attrs do not leak across users', async () => {
  await setUserAttribute('alice', 'department', 'engineering')
  await setUserAttribute('bob', 'department', 'finance')
  expect(await listUserAttributes('alice')).toEqual([
    { key: 'department', value: 'engineering' },
  ])
  expect(await listUserAttributes('bob')).toEqual([
    { key: 'department', value: 'finance' },
  ])
})

test('listDenyPolicies handles multi-row results', async () => {
  await addDenyPolicy({ graph: 'g1', label: 'A', username: 'alice' })
  await addDenyPolicy({ graph: 'g1', label: 'B', username: '' })
  await addDenyPolicy({ graph: 'g2', label: 'A', username: 'bob' })
  expect(await getDenyPolicyCount()).toBe(3)
  const list = await listDenyPolicies()
  expect(list).toHaveLength(3)
  expect(list).toContainEqual({ graph: 'g1', label: 'B', username: '' })
})
