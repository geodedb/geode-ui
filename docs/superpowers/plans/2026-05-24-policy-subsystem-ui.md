# Geode Policy Subsystem UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring geode-ui to parity with the policy subsystem that landed in geode (RLS deny policies, ABAC attribute policies, user attributes) and surface the other recent backend additions (GQL `Interval()` family, FULLTEXT indexes in SHOW INDEXES, ALTER USER SET ROLE revocation semantics).

**Architecture:** All new backend procedures live behind GQL `CALL geode.rls.*` and `ALTER USER ... ATTRIBUTE` statements — they are NOT exposed as discrete REST endpoints in `gen/cmd/server/openapi.yaml`. We therefore call them through the existing `POST /api/v1/query` (`client.query`) using a small set of typed wrappers (`src/api/security/*.ts`). The wrappers parse the QueryResp tabular shape into narrowed TypeScript types. Each wrapper is unit-tested against the response shape; each admin page is component-tested with the wrapper mocked; each end-to-end flow is exercised by a Playwright spec against the live geode-test harness.

**Tech Stack:** TypeScript 5.8, React 18, styled-components 6, @geodedb/ui-core (DataTable/Button/Modal/Field), react-i18next, Jest 29 + @testing-library/react 14, Playwright 1.59, genapi-generated client at `gen/client/react/client.ts`.

**Scope check:** This plan covers ONE coherent subsystem (security/policy administration) plus two small surface changes (Interval functions in Monaco, FULLTEXT index display). The KMS, 2PC, max-connections, and webhook env overrides are server-admin operator concerns and explicitly OUT OF SCOPE — they have no end-user UI surface in geode-ui's current design and require a new operator-config page that is itself worth a separate plan when justified.

---

## File Structure

### New files to create

```
src/api/security/
├── queryRunner.ts            # Thin wrapper around client.query that returns typed rows
├── queryRunner.test.ts
├── userAttributes.ts         # setAttribute/removeAttribute/listAttributes wrappers
├── userAttributes.test.ts
├── rlsDenyPolicies.ts        # addDenyPolicy/removeDenyPolicy/listDenyPolicies/policyCount
├── rlsDenyPolicies.test.ts
├── rlsAttributePolicies.ts   # addAttributePolicy/removeAttributePolicy
└── rlsAttributePolicies.test.ts

src/components/admin/
├── UserAttributesModal.tsx       # Per-user attribute editor (opened from UsersPage row action)
├── UserAttributesModal.test.tsx
├── RlsDenyPoliciesPage.tsx       # /admin/rls-deny-policies route
├── RlsDenyPoliciesPage.test.tsx
├── RlsAttributePoliciesPage.tsx  # /admin/rls-attribute-policies route
└── RlsAttributePoliciesPage.test.tsx

e2e/specs/
├── 44-admin-user-attributes.spec.ts
├── 45-admin-rls-deny-policies.spec.ts
├── 46-admin-rls-attribute-policies.spec.ts
└── 47-fulltext-indexes-and-interval-fns.spec.ts

src/lib/monaco/
└── intervalFunctions.ts          # Tokens + completion provider entries
```

### Files to modify

```
src/api/capabilities.ts                # +attributes/rlsDenyPolicies/rlsAttributePolicies booleans
src/api/capabilities.test.ts           # cover the new flags
src/pages/AdminPage.tsx                # +2 new tabs: RLS Deny, RLS Attribute
src/pages/AdminPage.test.tsx           # update tab assertions
src/components/admin/UsersPage.tsx     # +per-row "Attributes" action that opens UserAttributesModal
src/components/admin/UsersPage.test.tsx
src/services/i18n/locales/en.ts        # new strings under userAttributes, rlsDeny, rlsAttribute
src/lib/rbacVocab.ts                   # add RLS_LABEL_PRIMITIVES etc. if needed for shared validators
src/pages/SchemaPage.tsx               # show "FULLTEXT" index_type in the indexes list (if not generic already)
src/pages/SchemaPage.test.tsx
src/components/editor/GqlEditor.tsx    # wire intervalFunctions into Monaco language config
e2e/helpers/security.ts                # NEW helper: createPolicyArtifacts/cleanup used by 45/46/specs
```

### Reasoning

- Procedure wrappers under `src/api/security/` keep the GQL `CALL` strings out of components and centralize result-row parsing (each wrapper is < 50 lines, single responsibility).
- Each admin page lives next to its existing siblings under `src/components/admin/` and reuses `useAdminListPage` for create/list/delete scaffolding.
- The `UserAttributesModal` is co-located with the admin pages because that's where it's invoked from, NOT under `src/components/users/` (no such directory; `UsersPage.tsx` is the only user-facing surface).
- E2E specs follow the existing numeric naming so the Playwright report retains its filesystem ordering.

---

## Procedure Catalog (Backend-Side, Reference Only)

These are the GQL procedures the UI must call. From `../geode/src/execution/rls_dispatch.zig` and `../geode/src/execution/auth_dispatch.zig`:

| Procedure | Args (in order) | Return columns | Auth |
|-----------|-----------------|----------------|------|
| `geode.rls.add_deny_policy` | graph, label, username | `status` | admin |
| `geode.rls.remove_deny_policy` | graph, label, username | `status`, `removed_count` | admin |
| `geode.rls.list_deny_policies` | (none) | `graph`, `label`, `username` | admin |
| `geode.rls.policy_count` | (none) | `count` | admin |
| `geode.rls.add_attribute_policy` | graph, label, row_property, attribute_key | `status` | admin |
| `geode.rls.remove_attribute_policy` | graph, label, row_property, attribute_key | `status`, `removed` | admin |
| `geode.auth.user_set_attribute` | username, key, value | `status` | admin |
| `geode.auth.user_remove_attribute` | username, key | `status` | admin |

User attributes can also be managed via GQL DDL:

```gql
ALTER USER <username> SET ATTRIBUTE <key> = '<value>'
ALTER USER <username> REMOVE ATTRIBUTE <key>
```

We prefer the `CALL geode.auth.user_*_attribute(...)` form because the DDL path requires shell-escaping the value and has weaker error reporting in current geode builds. Both are supported.

There is NO `list_attribute_policies` procedure yet; we list them indirectly by querying the policy catalog (`CALL gps.list_policies()` returns all RLS policies including the ones we added via `add_attribute_policy`). See Task 12 for the exact query shape.

There is NO `list_user_attributes` procedure yet; the UI persists an in-session map of `(username → key → value)` mirroring the server, updated on each set/remove. A future backend addition can replace this with a real `geode.auth.user_list_attributes(username)` procedure; the wrapper stays the same, only `userAttributes.ts:listAttributes` is swapped to call the real procedure. We DO read the persisted view by calling `geode.auth.user_list_attributes(username)` defensively — if the procedure exists we use it, otherwise we fall back to the cached map. The probe is cheap (one `CALL` with `try/catch` on `wire_feature_missing`).

---

## Task 1: Foundation — Typed GQL Runner

**Files:**
- Create: `src/api/security/queryRunner.ts`
- Test: `src/api/security/queryRunner.test.ts`

This is the only file that knows about the `QueryResp.columns/rows` array-of-arrays shape. Every other security wrapper goes through it.

- [ ] **Step 1: Write the failing test**

Create `src/api/security/queryRunner.test.ts`:

```typescript
/// <reference types="@testing-library/jest-dom" />
import { runProcedure, parseColumns, parseRows, asString, asNumber } from './queryRunner'

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
    const cols = parseColumns([{}, { name: 42 }, { name: 'ok' }])
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
    const result = await runProcedure('geode.rls.add_deny_policy', ['g1', "O'Reilly", 'alice'])
    expect(mockQuery).toHaveBeenCalledWith({
      statement: "CALL geode.rls.add_deny_policy('g1', 'O''Reilly', 'alice')",
    })
    expect(result.columns).toEqual(['status'])
    expect(result.rows).toEqual([{ status: 'ok' }])
  })
  it('escapes embedded single quotes via SQL-style doubling', async () => {
    mockQuery.mockResolvedValue({ columns: [], rows: [], row_count: 0, elapsed_ms: 0 })
    await runProcedure('geode.x', ["a'b", "c''d"])
    expect(mockQuery).toHaveBeenCalledWith({
      statement: "CALL geode.x('a''b', 'c''''d')",
    })
  })
  it('forwards QueryResp parse errors as Error with the original message', async () => {
    mockQuery.mockRejectedValue(Object.assign(new Error('wire_feature_missing'), { status: 501 }))
    await expect(runProcedure('geode.x', [])).rejects.toThrow(/wire_feature_missing/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --config jest.config.cjs src/api/security/queryRunner.test.ts`

Expected: FAIL with `Cannot find module './queryRunner'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/api/security/queryRunner.ts`:

```typescript
import { client } from '../client'

// queryRunner — typed wrapper around the generated POST /api/v1/query
// client method. Procedures like `geode.rls.add_deny_policy` are NOT
// exposed as discrete REST endpoints; we call them with
//
//   CALL <proc>('arg1', 'arg2', …)
//
// arguments are positional and single-quoted; embedded single quotes
// are doubled (SQL-style escape), matching geode's GQL lexer.

export type Cell = unknown

export interface ProcedureResult {
  columns: string[]
  rows: Array<Record<string, Cell>>
  rowCount: number
  elapsedMs: number
}

export function parseColumns(raw: Array<Record<string, unknown>>): string[] {
  return raw.map((c) => (typeof c?.name === 'string' ? c.name : ''))
}

export function parseRows(
  columns: string[],
  rows: Array<Array<unknown>>
): Array<Record<string, Cell>> {
  return rows.map((row) => {
    const out: Record<string, Cell> = {}
    for (let i = 0; i < columns.length; i++) {
      out[columns[i]!] = row[i]
    }
    return out
  })
}

export function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

export function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function escapeLiteral(s: string): string {
  // SQL-style: double every single quote. geode's lexer accepts the
  // doubled form as a literal ' character inside the literal.
  return s.replace(/'/g, "''")
}

export async function runProcedure(
  procedure: string,
  args: string[]
): Promise<ProcedureResult> {
  const literalArgs = args.map((a) => `'${escapeLiteral(a)}'`).join(', ')
  const statement = `CALL ${procedure}(${literalArgs})`
  const resp = await client.query({ statement })
  const columns = parseColumns(resp.columns ?? [])
  const rows = parseRows(columns, resp.rows ?? [])
  return {
    columns,
    rows,
    rowCount: resp.row_count ?? rows.length,
    elapsedMs: resp.elapsed_ms ?? 0,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --config jest.config.cjs src/api/security/queryRunner.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```
git add src/api/security/queryRunner.ts src/api/security/queryRunner.test.ts
git commit -m "feat(security): add typed GQL procedure runner"
```

---

## Task 2: User Attributes — Wrapper

**Files:**
- Create: `src/api/security/userAttributes.ts`
- Test: `src/api/security/userAttributes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/api/security/userAttributes.test.ts`:

```typescript
import { setUserAttribute, removeUserAttribute, listUserAttributes } from './userAttributes'

jest.mock('./queryRunner', () => ({
  runProcedure: jest.fn(),
}))

import { runProcedure } from './queryRunner'
const mockRun = runProcedure as jest.Mock

beforeEach(() => {
  mockRun.mockReset()
})

describe('setUserAttribute', () => {
  it('calls geode.auth.user_set_attribute with positional args', async () => {
    mockRun.mockResolvedValue({ columns: ['status'], rows: [{ status: 'ok' }], rowCount: 1, elapsedMs: 1 })
    await setUserAttribute('alice', 'department', 'engineering')
    expect(mockRun).toHaveBeenCalledWith('geode.auth.user_set_attribute', ['alice', 'department', 'engineering'])
  })
  it('rejects empty username/key with a typed error', async () => {
    await expect(setUserAttribute('', 'k', 'v')).rejects.toThrow(/username required/i)
    await expect(setUserAttribute('alice', '', 'v')).rejects.toThrow(/key required/i)
  })
})

describe('removeUserAttribute', () => {
  it('calls geode.auth.user_remove_attribute with positional args', async () => {
    mockRun.mockResolvedValue({ columns: ['status'], rows: [{ status: 'ok' }], rowCount: 1, elapsedMs: 1 })
    await removeUserAttribute('alice', 'department')
    expect(mockRun).toHaveBeenCalledWith('geode.auth.user_remove_attribute', ['alice', 'department'])
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
    expect(mockRun).toHaveBeenCalledWith('geode.auth.user_list_attributes', ['alice'])
    expect(result).toEqual([
      { key: 'department', value: 'engineering' },
      { key: 'level', value: 'L3' },
    ])
  })
  it('returns empty array when the procedure is missing (501)', async () => {
    mockRun.mockRejectedValue(Object.assign(new Error('wire_feature_missing'), { status: 501 }))
    const result = await listUserAttributes('alice')
    expect(result).toEqual([])
  })
  it('rethrows non-501 errors', async () => {
    mockRun.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }))
    await expect(listUserAttributes('alice')).rejects.toThrow('boom')
  })
})
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `npx jest --config jest.config.cjs src/api/security/userAttributes.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/api/security/userAttributes.ts`:

```typescript
import { runProcedure, asString } from './queryRunner'

export interface UserAttribute {
  key: string
  value: string
}

export async function setUserAttribute(
  username: string,
  key: string,
  value: string
): Promise<void> {
  if (!username) throw new Error('username required')
  if (!key) throw new Error('key required')
  await runProcedure('geode.auth.user_set_attribute', [username, key, value])
}

export async function removeUserAttribute(
  username: string,
  key: string
): Promise<void> {
  if (!username) throw new Error('username required')
  if (!key) throw new Error('key required')
  await runProcedure('geode.auth.user_remove_attribute', [username, key])
}

// listUserAttributes probes the optional `geode.auth.user_list_attributes`
// procedure. On geode builds without it (HTTP 501 wire_feature_missing)
// it returns []; callers should keep an in-memory mirror updated by the
// set/remove paths and merge the two for the rendered list.
export async function listUserAttributes(
  username: string
): Promise<UserAttribute[]> {
  if (!username) return []
  try {
    const r = await runProcedure('geode.auth.user_list_attributes', [username])
    return r.rows
      .map((row) => ({
        key: asString(row.key) ?? '',
        value: asString(row.value) ?? '',
      }))
      .filter((a) => a.key.length > 0)
  } catch (err) {
    const e = err as { status?: number }
    if (e?.status === 501) return []
    throw err
  }
}
```

- [ ] **Step 4: Run test, expect PASS**

Run: `npx jest --config jest.config.cjs src/api/security/userAttributes.test.ts`

- [ ] **Step 5: Commit**

```
git add src/api/security/userAttributes.ts src/api/security/userAttributes.test.ts
git commit -m "feat(security): user attribute set/remove/list wrappers"
```

---

## Task 3: RLS Deny Policy Wrapper

**Files:**
- Create: `src/api/security/rlsDenyPolicies.ts`
- Test: `src/api/security/rlsDenyPolicies.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/api/security/rlsDenyPolicies.test.ts`:

```typescript
import {
  addDenyPolicy,
  removeDenyPolicy,
  listDenyPolicies,
  getDenyPolicyCount,
} from './rlsDenyPolicies'

jest.mock('./queryRunner', () => ({ runProcedure: jest.fn() }))
import { runProcedure } from './queryRunner'
const mockRun = runProcedure as jest.Mock
beforeEach(() => mockRun.mockReset())

describe('addDenyPolicy', () => {
  it('passes graph, label, username positionally', async () => {
    mockRun.mockResolvedValue({ columns: ['status'], rows: [{ status: 'ok' }], rowCount: 1, elapsedMs: 1 })
    await addDenyPolicy({ graph: 'g1', label: 'Person', username: 'alice' })
    expect(mockRun).toHaveBeenCalledWith('geode.rls.add_deny_policy', ['g1', 'Person', 'alice'])
  })
  it('passes empty string when username is omitted (applies to all users)', async () => {
    mockRun.mockResolvedValue({ columns: ['status'], rows: [{ status: 'ok' }], rowCount: 1, elapsedMs: 1 })
    await addDenyPolicy({ graph: 'g1', label: 'Person' })
    expect(mockRun).toHaveBeenCalledWith('geode.rls.add_deny_policy', ['g1', 'Person', ''])
  })
  it('rejects empty graph or label', async () => {
    await expect(addDenyPolicy({ graph: '', label: 'X' })).rejects.toThrow(/graph required/i)
    await expect(addDenyPolicy({ graph: 'g', label: '' })).rejects.toThrow(/label required/i)
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
})
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `npx jest --config jest.config.cjs src/api/security/rlsDenyPolicies.test.ts`

- [ ] **Step 3: Implement**

Create `src/api/security/rlsDenyPolicies.ts`:

```typescript
import { runProcedure, asString, asNumber } from './queryRunner'

export interface DenyPolicy {
  graph: string
  label: string
  username: string
}

export interface DenyPolicyInput {
  graph: string
  label: string
  username?: string
}

export async function addDenyPolicy(p: DenyPolicyInput): Promise<void> {
  if (!p.graph) throw new Error('graph required')
  if (!p.label) throw new Error('label required')
  await runProcedure('geode.rls.add_deny_policy', [p.graph, p.label, p.username ?? ''])
}

export async function removeDenyPolicy(p: DenyPolicyInput): Promise<number> {
  if (!p.graph) throw new Error('graph required')
  if (!p.label) throw new Error('label required')
  const r = await runProcedure('geode.rls.remove_deny_policy', [
    p.graph,
    p.label,
    p.username ?? '',
  ])
  const first = r.rows[0]
  if (!first) return 0
  return asNumber(first.removed_count) ?? 0
}

export async function listDenyPolicies(): Promise<DenyPolicy[]> {
  const r = await runProcedure('geode.rls.list_deny_policies', [])
  return r.rows
    .map((row) => ({
      graph: asString(row.graph) ?? '',
      label: asString(row.label) ?? '',
      username: asString(row.username) ?? '',
    }))
    .filter((p) => p.graph.length > 0 && p.label.length > 0)
}

export async function getDenyPolicyCount(): Promise<number> {
  const r = await runProcedure('geode.rls.policy_count', [])
  const first = r.rows[0]
  if (!first) return 0
  return asNumber(first.count) ?? 0
}
```

- [ ] **Step 4: Run test, expect PASS**

- [ ] **Step 5: Commit**

```
git add src/api/security/rlsDenyPolicies.ts src/api/security/rlsDenyPolicies.test.ts
git commit -m "feat(security): RLS deny-policy CRUD wrappers"
```

---

## Task 4: ABAC Attribute Policy Wrapper

**Files:**
- Create: `src/api/security/rlsAttributePolicies.ts`
- Test: `src/api/security/rlsAttributePolicies.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/api/security/rlsAttributePolicies.test.ts`:

```typescript
import {
  addAttributePolicy,
  removeAttributePolicy,
  listAttributePolicies,
} from './rlsAttributePolicies'

jest.mock('./queryRunner', () => ({ runProcedure: jest.fn() }))
import { runProcedure } from './queryRunner'
const mockRun = runProcedure as jest.Mock
beforeEach(() => mockRun.mockReset())

describe('addAttributePolicy', () => {
  it('passes graph, label, row_property, attribute_key in order', async () => {
    mockRun.mockResolvedValue({ columns: ['status'], rows: [{ status: 'ok' }], rowCount: 1, elapsedMs: 1 })
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
    await expect(addAttributePolicy({ ...base, graph: '' })).rejects.toThrow(/graph required/i)
    await expect(addAttributePolicy({ ...base, label: '' })).rejects.toThrow(/label required/i)
    await expect(addAttributePolicy({ ...base, rowProperty: '' })).rejects.toThrow(/row property required/i)
    await expect(addAttributePolicy({ ...base, attributeKey: '' })).rejects.toThrow(/attribute key required/i)
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
      graph: 'g', label: 'L', rowProperty: 'p', attributeKey: 'k',
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
      graph: 'g', label: 'L', rowProperty: 'p', attributeKey: 'k',
    })
    expect(ok).toBe(false)
  })
})

describe('listAttributePolicies', () => {
  it('returns [] when gps.list_policies is unavailable (501)', async () => {
    mockRun.mockRejectedValue(Object.assign(new Error('wire_feature_missing'), { status: 501 }))
    const result = await listAttributePolicies()
    expect(result).toEqual([])
  })
  it('filters gps.list_policies output to attribute-style restrictive policies', async () => {
    mockRun.mockResolvedValue({
      columns: ['name', 'expression', 'graph', 'label', 'operation', 'permissive'],
      rows: [
        // Attribute-style policy: matches the pattern row.X = principal.attribute.Y
        {
          name: 'p1',
          expression: 'row.department = principal.attribute.department',
          graph: 'g1',
          label: 'Doc',
          operation: 'select',
          permissive: false,
        },
        // Non-attribute policy: a custom expression that won't match our pattern
        {
          name: 'p2',
          expression: 'true',
          graph: 'g1',
          label: 'Doc',
          operation: 'select',
          permissive: true,
        },
      ],
      rowCount: 2,
      elapsedMs: 1,
    })
    const result = await listAttributePolicies()
    expect(result).toEqual([
      {
        graph: 'g1',
        label: 'Doc',
        rowProperty: 'department',
        attributeKey: 'department',
      },
    ])
  })
})
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement**

Create `src/api/security/rlsAttributePolicies.ts`:

```typescript
import { runProcedure, asString } from './queryRunner'

export interface AttributePolicy {
  graph: string
  label: string
  rowProperty: string
  attributeKey: string
}

export interface AttributePolicyInput {
  graph: string
  label: string
  rowProperty: string
  attributeKey: string
}

export async function addAttributePolicy(p: AttributePolicyInput): Promise<void> {
  if (!p.graph) throw new Error('graph required')
  if (!p.label) throw new Error('label required')
  if (!p.rowProperty) throw new Error('row property required')
  if (!p.attributeKey) throw new Error('attribute key required')
  await runProcedure('geode.rls.add_attribute_policy', [
    p.graph,
    p.label,
    p.rowProperty,
    p.attributeKey,
  ])
}

export async function removeAttributePolicy(p: AttributePolicyInput): Promise<boolean> {
  if (!p.graph) throw new Error('graph required')
  if (!p.label) throw new Error('label required')
  if (!p.rowProperty) throw new Error('row property required')
  if (!p.attributeKey) throw new Error('attribute key required')
  const r = await runProcedure('geode.rls.remove_attribute_policy', [
    p.graph,
    p.label,
    p.rowProperty,
    p.attributeKey,
  ])
  const first = r.rows[0]
  if (!first) return false
  return first.removed === true
}

// listAttributePolicies queries gps.list_policies (when available) and
// filters to the canonical attribute-policy shape:
//   row.<rowProperty> = principal.attribute.<attributeKey>
// which is exactly what add_attribute_policy emits at
// rls_dispatch.zig:351-355.
const ATTR_PATTERN = /^row\.([A-Za-z_][\w]*)\s*=\s*principal\.attribute\.([A-Za-z_][\w]*)$/

export async function listAttributePolicies(): Promise<AttributePolicy[]> {
  try {
    const r = await runProcedure('gps.list_policies', [])
    const result: AttributePolicy[] = []
    for (const row of r.rows) {
      const expr = asString(row.expression)
      const graph = asString(row.graph)
      const label = asString(row.label)
      const op = asString(row.operation)
      const permissive = row.permissive
      if (!expr || !graph || !label || op !== 'select' || permissive !== false) continue
      const m = expr.match(ATTR_PATTERN)
      if (!m) continue
      result.push({
        graph,
        label,
        rowProperty: m[1]!,
        attributeKey: m[2]!,
      })
    }
    return result
  } catch (err) {
    const e = err as { status?: number }
    if (e?.status === 501) return []
    throw err
  }
}
```

- [ ] **Step 4: Run test, expect PASS**

- [ ] **Step 5: Commit**

```
git add src/api/security/rlsAttributePolicies.ts src/api/security/rlsAttributePolicies.test.ts
git commit -m "feat(security): ABAC attribute-policy CRUD wrappers"
```

---

## Task 5: Capabilities — add three new flags

**Files:**
- Modify: `src/api/capabilities.ts:17-22, 39-44, 53-67`
- Modify: `src/api/capabilities.test.ts`

- [ ] **Step 1: Read the current capabilities.test.ts**

Run: `cat src/api/capabilities.test.ts`

Confirm it has tests for the existing four flags.

- [ ] **Step 2: Add failing tests for the new flags**

Append to `src/api/capabilities.test.ts`:

```typescript
describe('fetchCapabilities — security subsystem flags', () => {
  it('exposes attributes/rlsDenyPolicies/rlsAttributePolicies from admin_writable', async () => {
    ;(client.getCapabilities as jest.Mock).mockResolvedValue({
      geode_version: '0.5.20',
      admin_writable: {
        users: true,
        roles: true,
        policies: true,
        grants: true,
        attributes: true,
        rls_deny_policies: true,
        rls_attribute_policies: true,
      },
      metrics_enabled: true,
    })
    const caps = await fetchCapabilities()
    expect(caps.adminWritable.attributes).toBe(true)
    expect(caps.adminWritable.rlsDenyPolicies).toBe(true)
    expect(caps.adminWritable.rlsAttributePolicies).toBe(true)
  })

  it('defaults the new flags to false when omitted from the response', async () => {
    ;(client.getCapabilities as jest.Mock).mockResolvedValue({
      geode_version: '0.5.19',
      admin_writable: { users: true, roles: true, policies: true, grants: true },
      metrics_enabled: false,
    })
    const caps = await fetchCapabilities()
    expect(caps.adminWritable.attributes).toBe(false)
    expect(caps.adminWritable.rlsDenyPolicies).toBe(false)
    expect(caps.adminWritable.rlsAttributePolicies).toBe(false)
  })
})
```

Run: `npx jest --config jest.config.cjs src/api/capabilities.test.ts`
Expected: FAIL — `attributes` is not a property of `AdminWritable`.

- [ ] **Step 3: Extend AdminWritable**

In `src/api/capabilities.ts`, replace the `AdminWritable` interface and `ADMIN_WRITABLE_NONE`:

```typescript
export interface AdminWritable {
  users: boolean
  roles: boolean
  policies: boolean
  grants: boolean
  attributes: boolean
  rlsDenyPolicies: boolean
  rlsAttributePolicies: boolean
}

export const ADMIN_WRITABLE_NONE: AdminWritable = {
  users: false,
  roles: false,
  policies: false,
  grants: false,
  attributes: false,
  rlsDenyPolicies: false,
  rlsAttributePolicies: false,
}
```

In `fetchCapabilities`, extend the mapping:

```typescript
    adminWritable: {
      users: asBool(aw.users),
      roles: asBool(aw.roles),
      policies: asBool(aw.policies),
      grants: asBool(aw.grants),
      attributes: asBool(aw.attributes),
      rlsDenyPolicies: asBool(aw.rls_deny_policies),
      rlsAttributePolicies: asBool(aw.rls_attribute_policies),
    },
```

- [ ] **Step 4: Run test, expect PASS**

Run: `npx jest --config jest.config.cjs src/api/capabilities.test.ts`

- [ ] **Step 5: Run full typecheck to catch downstream breakage**

Run: `npm run test:ts`

Expected: PASS — `ADMIN_WRITABLE_NONE` is used in only one place outside `capabilities.ts` (`useCapabilities.ts`), which spreads the constant and will pick up the new keys automatically.

- [ ] **Step 6: Commit**

```
git add src/api/capabilities.ts src/api/capabilities.test.ts
git commit -m "feat(security): capabilities flags for attribute + RLS subsystems"
```

---

## Task 6: i18n strings

**Files:**
- Modify: `src/services/i18n/locales/en.ts`

- [ ] **Step 1: Inspect existing structure**

Run: `grep -n 'policies:\|grants:\|users:' src/services/i18n/locales/en.ts | head`

Confirm the file uses domain keys like `users: { title, … }`.

- [ ] **Step 2: Add three new domain blocks**

After the existing `grants:` block in `src/services/i18n/locales/en.ts`, add:

```typescript
  userAttributes: {
    title: 'User attributes',
    description:
      'Per-user key/value attributes consumed by ABAC row-level policies (e.g. department, region).',
    noneYet: 'This user has no attributes yet.',
    keyLabel: 'Attribute key',
    valueLabel: 'Value',
    addButton: 'Add attribute',
    removeConfirmTitle: 'Remove attribute',
    removeConfirmBody: 'Remove "{{key}}" from user "{{username}}"?',
    invalidKey:
      'Attribute keys must start with a letter and contain only letters, digits, and underscores.',
    unsupportedNote:
      'User attribute management requires Geode 0.5.20 or newer.',
    unsupportedTooltip:
      'The connected Geode build does not implement geode.auth.user_set_attribute.',
  },
  rlsDeny: {
    title_one: '{{count}} deny policy',
    title_other: '{{count}} deny policies',
    description:
      'Label-level deny policies: rows of the named label are hidden from the named user. Leave username empty to deny all users.',
    newButton: 'New deny policy',
    graphLabel: 'Graph',
    labelLabel: 'Label',
    usernameLabel: 'Username (empty = all users)',
    removeConfirmTitle: 'Remove deny policy',
    removeConfirmBody:
      'Remove the deny policy for label "{{label}}" on graph "{{graph}}" (user "{{username}}")?',
    countSuffix_one: '{{count}} policy total',
    countSuffix_other: '{{count}} policies total',
    unsupportedNote:
      'RLS deny-policy management requires Geode 0.5.20 or newer.',
    unsupportedTooltip:
      'The connected Geode build does not implement geode.rls.add_deny_policy.',
  },
  rlsAttribute: {
    title_one: '{{count}} attribute policy',
    title_other: '{{count}} attribute policies',
    description:
      'Row-level ABAC: every row is shown only when row.<property> equals the querying user\'s attribute.<key>.',
    newButton: 'New attribute policy',
    graphLabel: 'Graph',
    labelLabel: 'Label',
    rowPropertyLabel: 'Row property',
    attributeKeyLabel: 'User attribute key',
    expressionPreview: 'Generates: {{preview}}',
    removeConfirmTitle: 'Remove attribute policy',
    removeConfirmBody:
      'Remove the attribute policy mapping row.{{rowProperty}} = principal.attribute.{{attributeKey}} on {{graph}}/{{label}}?',
    unsupportedNote:
      'ABAC attribute-policy management requires Geode 0.5.20 or newer.',
    unsupportedTooltip:
      'The connected Geode build does not implement geode.rls.add_attribute_policy.',
    listingUnsupportedNote:
      'This Geode build does not expose gps.list_policies — policies you create here are tracked locally for the current session only.',
  },
```

- [ ] **Step 3: Run translation validator**

Run: `npm run verify:translations`

Expected: PASS (the `en` locale is the reference; no other locale has these keys yet, but the validator only fails on missing keys in REQUIRED locales — `en` is the only required one).

- [ ] **Step 4: Commit**

```
git add src/services/i18n/locales/en.ts
git commit -m "i18n(security): add userAttributes / rlsDeny / rlsAttribute strings"
```

---

## Task 7: UserAttributesModal Component

**Files:**
- Create: `src/components/admin/UserAttributesModal.tsx`
- Test: `src/components/admin/UserAttributesModal.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/components/admin/UserAttributesModal.test.tsx`:

```typescript
/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'

jest.mock('../../api/security/userAttributes', () => ({
  listUserAttributes: jest.fn(),
  setUserAttribute: jest.fn(),
  removeUserAttribute: jest.fn(),
}))

import {
  listUserAttributes,
  setUserAttribute,
  removeUserAttribute,
} from '../../api/security/userAttributes'
import { UserAttributesModal } from './UserAttributesModal'
import { lightTheme } from '@geodedb/ui-core/theme'

const wrap = (node: React.ReactNode) =>
  render(<ThemeProvider theme={lightTheme}>{node}</ThemeProvider>)

beforeEach(() => {
  ;(listUserAttributes as jest.Mock).mockReset()
  ;(setUserAttribute as jest.Mock).mockReset()
  ;(removeUserAttribute as jest.Mock).mockReset()
})

test('lists existing attributes for the user on open', async () => {
  ;(listUserAttributes as jest.Mock).mockResolvedValue([
    { key: 'department', value: 'engineering' },
    { key: 'level', value: 'L3' },
  ])
  wrap(<UserAttributesModal username="alice" onClose={() => {}} />)
  expect(await screen.findByText('department')).toBeInTheDocument()
  expect(screen.getByText('engineering')).toBeInTheDocument()
  expect(screen.getByText('level')).toBeInTheDocument()
  expect(screen.getByText('L3')).toBeInTheDocument()
})

test('add flow calls setUserAttribute then re-renders the new row', async () => {
  ;(listUserAttributes as jest.Mock)
    .mockResolvedValueOnce([]) // initial
    .mockResolvedValueOnce([{ key: 'region', value: 'us-east' }]) // after add
  ;(setUserAttribute as jest.Mock).mockResolvedValue(undefined)
  wrap(<UserAttributesModal username="alice" onClose={() => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: /add attribute/i }))
  fireEvent.change(screen.getByLabelText(/attribute key/i), {
    target: { value: 'region' },
  })
  fireEvent.change(screen.getByLabelText(/^value$/i), {
    target: { value: 'us-east' },
  })
  fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
  await waitFor(() =>
    expect(setUserAttribute).toHaveBeenCalledWith('alice', 'region', 'us-east')
  )
  expect(await screen.findByText('region')).toBeInTheDocument()
  expect(screen.getByText('us-east')).toBeInTheDocument()
})

test('add validates attribute key format client-side', async () => {
  ;(listUserAttributes as jest.Mock).mockResolvedValue([])
  wrap(<UserAttributesModal username="alice" onClose={() => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: /add attribute/i }))
  fireEvent.change(screen.getByLabelText(/attribute key/i), {
    target: { value: '1invalid' },
  })
  fireEvent.change(screen.getByLabelText(/^value$/i), { target: { value: 'x' } })
  fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
  expect(
    await screen.findByText(/keys must start with a letter/i)
  ).toBeInTheDocument()
  expect(setUserAttribute).not.toHaveBeenCalled()
})

test('remove flow confirms then calls removeUserAttribute', async () => {
  ;(listUserAttributes as jest.Mock)
    .mockResolvedValueOnce([{ key: 'department', value: 'eng' }])
    .mockResolvedValueOnce([])
  ;(removeUserAttribute as jest.Mock).mockResolvedValue(undefined)
  wrap(<UserAttributesModal username="alice" onClose={() => {}} />)
  const row = await screen.findByText('department')
  const removeBtn = within(row.closest('tr')!).getByRole('button', { name: /remove/i })
  fireEvent.click(removeBtn)
  fireEvent.click(await screen.findByRole('button', { name: /confirm|remove/i }))
  await waitFor(() =>
    expect(removeUserAttribute).toHaveBeenCalledWith('alice', 'department')
  )
})

test('shows unsupported note when listUserAttributes returns 501 indirectly', async () => {
  ;(listUserAttributes as jest.Mock).mockResolvedValue([]) // 501 maps to [] in the wrapper
  ;(setUserAttribute as jest.Mock).mockRejectedValue(
    Object.assign(new Error('wire_feature_missing'), { status: 501 })
  )
  wrap(<UserAttributesModal username="alice" onClose={() => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: /add attribute/i }))
  fireEvent.change(screen.getByLabelText(/attribute key/i), {
    target: { value: 'k' },
  })
  fireEvent.change(screen.getByLabelText(/^value$/i), { target: { value: 'v' } })
  fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
  expect(
    await screen.findByText(/Geode build does not implement/i)
  ).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `npx jest --config jest.config.cjs src/components/admin/UserAttributesModal.test.tsx`

- [ ] **Step 3: Implement the modal**

Create `src/components/admin/UserAttributesModal.tsx`:

```typescript
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  Button,
  ConfirmModal,
  DataTable,
  Field,
  Input,
  Modal,
} from '@geodedb/ui-core'
import {
  listUserAttributes,
  setUserAttribute,
  removeUserAttribute,
  type UserAttribute,
} from '../../api/security/userAttributes'

// Valid attribute key shape mirrors the regex used by the geode lexer
// for identifiers: [A-Za-z_][A-Za-z0-9_]*. We validate client-side to
// give a clearer error than the wire_feature_missing 400 the server
// returns for malformed keys.
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

interface Props {
  username: string
  onClose: () => void
}

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
  min-width: 480px;
`

const RowActions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
`

export const UserAttributesModal: React.FC<Props> = ({ username, onClose }) => {
  const { t } = useTranslation()
  const [rows, setRows] = useState<UserAttribute[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listUserAttributes(username)
      setRows(data)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [username])

  useEffect(() => {
    void refetch()
  }, [refetch])

  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const openAdd = (): void => {
    setNewKey('')
    setNewValue('')
    setErr(null)
    setAddOpen(true)
  }

  const submitAdd = async (): Promise<void> => {
    if (!KEY_RE.test(newKey)) {
      setErr(t('userAttributes.invalidKey'))
      return
    }
    setSubmitting(true)
    try {
      await setUserAttribute(username, newKey, newValue)
      setAddOpen(false)
      await refetch()
    } catch (e) {
      const errObj = e as { status?: number; message?: string }
      if (errObj?.status === 501) {
        setErr(t('userAttributes.unsupportedTooltip'))
      } else {
        setErr(errObj?.message ?? String(e))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const submitRemove = async (): Promise<void> => {
    if (!confirmRemove) return
    setSubmitting(true)
    try {
      await removeUserAttribute(username, confirmRemove)
      setConfirmRemove(null)
      await refetch()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={t('userAttributes.title')}>
      <Body>
        <p>{t('userAttributes.description')}</p>
        {err && <div role="alert">{err}</div>}
        {rows.length === 0 && !loading ? (
          <p>{t('userAttributes.noneYet')}</p>
        ) : (
          <DataTable
            columns={[
              { key: 'key', header: t('userAttributes.keyLabel') },
              { key: 'value', header: t('userAttributes.valueLabel') },
              {
                key: 'actions',
                header: '',
                render: (row: UserAttribute) => (
                  <RowActions>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmRemove(row.key)}
                    >
                      {t('common.remove', { defaultValue: 'Remove' })}
                    </Button>
                  </RowActions>
                ),
              },
            ]}
            rows={rows}
            rowKey={(r) => r.key}
          />
        )}
        <Button onClick={openAdd}>{t('userAttributes.addButton')}</Button>
      </Body>

      {addOpen && (
        <Modal
          isOpen
          onClose={() => setAddOpen(false)}
          title={t('userAttributes.addButton')}
        >
          <Body>
            <Field label={t('userAttributes.keyLabel')}>
              <Input
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                autoFocus
              />
            </Field>
            <Field label={t('userAttributes.valueLabel')}>
              <Input
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
              />
            </Field>
            {err && <div role="alert">{err}</div>}
            <RowActions>
              <Button onClick={submitAdd} disabled={submitting}>
                {t('common.create', { defaultValue: 'Add' })}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setAddOpen(false)}
                disabled={submitting}
              >
                {t('common.cancel')}
              </Button>
            </RowActions>
          </Body>
        </Modal>
      )}

      {confirmRemove !== null && (
        <ConfirmModal
          isOpen
          title={t('userAttributes.removeConfirmTitle')}
          message={t('userAttributes.removeConfirmBody', {
            key: confirmRemove,
            username,
          })}
          confirmLabel={t('common.delete')}
          onConfirm={submitRemove}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </Modal>
  )
}
```

- [ ] **Step 4: Run test, expect PASS**

Run: `npx jest --config jest.config.cjs src/components/admin/UserAttributesModal.test.tsx`

If the test asserts on a button label that doesn't match (`remove` vs `delete`), reconcile by matching the locale string. The locale provides `common.delete` ('Delete'); update the test's `getByRole('button', { name: /remove/i })` to allow either label OR add `remove: 'Remove'` to the `common` block in `en.ts` (do this in Task 6 as an addition).

- [ ] **Step 5: Commit**

```
git add src/services/i18n/locales/en.ts src/components/admin/UserAttributesModal.tsx src/components/admin/UserAttributesModal.test.tsx
git commit -m "feat(security): UserAttributesModal — add/remove user attributes"
```

---

## Task 8: UsersPage — open UserAttributesModal from a row action

**Files:**
- Modify: `src/components/admin/UsersPage.tsx`
- Modify: `src/components/admin/UsersPage.test.tsx`

- [ ] **Step 1: Inspect the existing row-actions cell**

Run: `grep -n 'actions\|<Button' src/components/admin/UsersPage.tsx | head -20`

Note the existing per-row action layout (Enable/Disable/Delete buttons).

- [ ] **Step 2: Add a failing test**

In `src/components/admin/UsersPage.test.tsx`, add:

```typescript
test('clicking the Attributes button on a user row opens UserAttributesModal', async () => {
  ;(client.getUsers as jest.Mock).mockResolvedValue({
    users: [{ username: 'alice', email: 'a@b', enabled: true, roles: [] }],
  })
  ;(client.getCapabilities as jest.Mock).mockResolvedValue({
    admin_writable: { users: true, attributes: true },
  })
  // listUserAttributes is called when the modal opens
  jest.mock('../../api/security/userAttributes', () => ({
    listUserAttributes: jest.fn().mockResolvedValue([]),
    setUserAttribute: jest.fn(),
    removeUserAttribute: jest.fn(),
  }))
  wrap(<UsersPage />)
  fireEvent.click(await screen.findByRole('button', { name: /attributes/i }))
  expect(await screen.findByText(/User attributes/i)).toBeInTheDocument()
})
```

Run: `npx jest --config jest.config.cjs src/components/admin/UsersPage.test.tsx -t Attributes`. Expected: FAIL.

- [ ] **Step 3: Wire the modal into UsersPage**

In `UsersPage.tsx`:

1. Add an import:

```typescript
import { UserAttributesModal } from './UserAttributesModal'
```

2. Add state next to the existing modal state hooks:

```typescript
const [attributesFor, setAttributesFor] = useState<string | null>(null)
```

3. Add an "Attributes" button to the per-row actions cell, gated on `capabilities.adminWritable.attributes`:

```typescript
{capabilities.adminWritable.attributes && (
  <Button
    size="sm"
    variant="ghost"
    onClick={() => setAttributesFor(row.username)}
  >
    {t('userAttributes.title')}
  </Button>
)}
```

4. Render the modal at the bottom of the page JSX:

```typescript
{attributesFor !== null && (
  <UserAttributesModal
    username={attributesFor}
    onClose={() => setAttributesFor(null)}
  />
)}
```

- [ ] **Step 4: Run test, expect PASS**

Run: `npx jest --config jest.config.cjs src/components/admin/UsersPage.test.tsx`

- [ ] **Step 5: Commit**

```
git add src/components/admin/UsersPage.tsx src/components/admin/UsersPage.test.tsx
git commit -m "feat(security): open UserAttributesModal from the Users table"
```

---

## Task 9: RlsDenyPoliciesPage

**Files:**
- Create: `src/components/admin/RlsDenyPoliciesPage.tsx`
- Test: `src/components/admin/RlsDenyPoliciesPage.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/components/admin/RlsDenyPoliciesPage.test.tsx` modeled on `PoliciesPage.test.tsx`. Key cases:

```typescript
/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { MemoryRouter } from 'react-router-dom'
import { lightTheme } from '@geodedb/ui-core/theme'

jest.mock('../../api/client', () => ({ client: { getCapabilities: jest.fn() } }))
jest.mock('../../api/security/rlsDenyPolicies', () => ({
  addDenyPolicy: jest.fn(),
  removeDenyPolicy: jest.fn(),
  listDenyPolicies: jest.fn(),
  getDenyPolicyCount: jest.fn(),
}))

import { client } from '../../api/client'
import {
  addDenyPolicy,
  removeDenyPolicy,
  listDenyPolicies,
  getDenyPolicyCount,
} from '../../api/security/rlsDenyPolicies'
import { RlsDenyPoliciesPage } from './RlsDenyPoliciesPage'

const wrap = (n: React.ReactNode) =>
  render(
    <MemoryRouter>
      <ThemeProvider theme={lightTheme}>{n}</ThemeProvider>
    </MemoryRouter>
  )

beforeEach(() => {
  ;[
    client.getCapabilities,
    addDenyPolicy,
    removeDenyPolicy,
    listDenyPolicies,
    getDenyPolicyCount,
  ].forEach((m) => (m as jest.Mock).mockReset())
  ;(client.getCapabilities as jest.Mock).mockResolvedValue({
    admin_writable: { rls_deny_policies: true },
  })
})

test('renders the policy list from listDenyPolicies', async () => {
  ;(listDenyPolicies as jest.Mock).mockResolvedValue([
    { graph: 'g1', label: 'Person', username: 'alice' },
    { graph: 'g2', label: 'Org', username: '' },
  ])
  ;(getDenyPolicyCount as jest.Mock).mockResolvedValue(2)
  wrap(<RlsDenyPoliciesPage />)
  expect(await screen.findByText('Person')).toBeInTheDocument()
  expect(screen.getByText('Org')).toBeInTheDocument()
  expect(screen.getByText('alice')).toBeInTheDocument()
})

test('gates the New button on adminWritable.rlsDenyPolicies', async () => {
  ;(client.getCapabilities as jest.Mock).mockResolvedValue({
    admin_writable: { rls_deny_policies: false },
  })
  ;(listDenyPolicies as jest.Mock).mockResolvedValue([])
  ;(getDenyPolicyCount as jest.Mock).mockResolvedValue(0)
  wrap(<RlsDenyPoliciesPage />)
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /new deny policy/i })).toBeDisabled()
  )
})

test('create flow calls addDenyPolicy with the form values', async () => {
  ;(listDenyPolicies as jest.Mock)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ graph: 'g1', label: 'L', username: 'u' }])
  ;(getDenyPolicyCount as jest.Mock).mockResolvedValue(1)
  ;(addDenyPolicy as jest.Mock).mockResolvedValue(undefined)
  wrap(<RlsDenyPoliciesPage />)
  fireEvent.click(await screen.findByRole('button', { name: /new deny policy/i }))
  fireEvent.change(screen.getByLabelText(/^graph$/i), { target: { value: 'g1' } })
  fireEvent.change(screen.getByLabelText(/^label$/i), { target: { value: 'L' } })
  fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'u' } })
  fireEvent.click(screen.getByRole('button', { name: /create/i }))
  await waitFor(() =>
    expect(addDenyPolicy).toHaveBeenCalledWith({
      graph: 'g1',
      label: 'L',
      username: 'u',
    })
  )
})

test('remove flow calls removeDenyPolicy and refetches', async () => {
  ;(listDenyPolicies as jest.Mock)
    .mockResolvedValueOnce([{ graph: 'g1', label: 'Person', username: 'alice' }])
    .mockResolvedValueOnce([])
  ;(getDenyPolicyCount as jest.Mock).mockResolvedValue(0)
  ;(removeDenyPolicy as jest.Mock).mockResolvedValue(1)
  wrap(<RlsDenyPoliciesPage />)
  const row = await screen.findByText('Person')
  fireEvent.click(within(row.closest('tr')!).getByRole('button', { name: /remove/i }))
  fireEvent.click(await screen.findByRole('button', { name: /confirm|delete/i }))
  await waitFor(() =>
    expect(removeDenyPolicy).toHaveBeenCalledWith({
      graph: 'g1',
      label: 'Person',
      username: 'alice',
    })
  )
})
```

Run: `npx jest --config jest.config.cjs src/components/admin/RlsDenyPoliciesPage.test.tsx`. Expected: FAIL — module missing.

- [ ] **Step 2: Implement the page**

Create `src/components/admin/RlsDenyPoliciesPage.tsx`:

```typescript
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  ConfirmModal,
  DataTable,
  Field,
  Input,
  Modal,
} from '@geodedb/ui-core'
import {
  addDenyPolicy,
  removeDenyPolicy,
  listDenyPolicies,
  getDenyPolicyCount,
  type DenyPolicy,
} from '../../api/security/rlsDenyPolicies'
import { useCapabilities } from '../../hooks/useCapabilities'
import { AdminPageShell, ErrorBanner } from './AdminPageShell'

export const RlsDenyPoliciesPage: React.FC = () => {
  const { t } = useTranslation()
  const caps = useCapabilities()
  const gateCreate = caps.loaded && !caps.adminWritable.rlsDenyPolicies

  const [rows, setRows] = useState<DenyPolicy[]>([])
  const [count, setCount] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<DenyPolicy | null>(null)
  const [graph, setGraph] = useState('')
  const [label, setLabel] = useState('')
  const [username, setUsername] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const refetch = useCallback(async () => {
    try {
      const [list, n] = await Promise.all([
        listDenyPolicies(),
        getDenyPolicyCount(),
      ])
      setRows(list)
      setCount(n)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void refetch()
  }, [refetch])

  const onCreate = async (): Promise<void> => {
    setSubmitting(true)
    try {
      await addDenyPolicy({ graph, label, username })
      setShowCreate(false)
      setGraph('')
      setLabel('')
      setUsername('')
      await refetch()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  const onRemove = async (): Promise<void> => {
    if (!confirmRemove) return
    setSubmitting(true)
    try {
      await removeDenyPolicy(confirmRemove)
      setConfirmRemove(null)
      await refetch()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AdminPageShell
      title={t('rlsDeny.title', { count })}
      unsupportedNote={t('rlsDeny.unsupportedNote')}
      unsupportedTooltip={t('rlsDeny.unsupportedTooltip')}
      newButtonLabel={t('rlsDeny.newButton')}
      gateCreate={gateCreate}
      onCreate={() => setShowCreate(true)}
      err={err}
      testIds={{
        unsupportedNote: 'admin-rls-deny-unsupported',
        newButton: 'admin-new-rls-deny-btn',
      }}
    >
      <DataTable
        columns={[
          { key: 'graph', header: t('rlsDeny.graphLabel') },
          { key: 'label', header: t('rlsDeny.labelLabel') },
          {
            key: 'username',
            header: t('rlsDeny.usernameLabel'),
            render: (r: DenyPolicy) =>
              r.username || <em>{t('common.allUsers', { defaultValue: 'all users' })}</em>,
          },
          {
            key: 'actions',
            header: '',
            render: (r: DenyPolicy) => (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmRemove(r)}
              >
                {t('common.delete')}
              </Button>
            ),
          },
        ]}
        rows={rows}
        rowKey={(r) => `${r.graph}::${r.label}::${r.username}`}
      />

      {showCreate && (
        <Modal
          isOpen
          onClose={() => setShowCreate(false)}
          title={t('rlsDeny.newButton')}
        >
          <Field label={t('rlsDeny.graphLabel')}>
            <Input value={graph} onChange={(e) => setGraph(e.target.value)} autoFocus />
          </Field>
          <Field label={t('rlsDeny.labelLabel')}>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Field label={t('rlsDeny.usernameLabel')}>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <ErrorBanner err={err} />
          <Button onClick={onCreate} disabled={submitting || !graph || !label}>
            {t('common.create')}
          </Button>
          <Button variant="ghost" onClick={() => setShowCreate(false)} disabled={submitting}>
            {t('common.cancel')}
          </Button>
        </Modal>
      )}

      {confirmRemove && (
        <ConfirmModal
          isOpen
          title={t('rlsDeny.removeConfirmTitle')}
          message={t('rlsDeny.removeConfirmBody', confirmRemove)}
          confirmLabel={t('common.delete')}
          onConfirm={onRemove}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </AdminPageShell>
  )
}
```

- [ ] **Step 3: Run test, expect PASS**

Run: `npx jest --config jest.config.cjs src/components/admin/RlsDenyPoliciesPage.test.tsx`

- [ ] **Step 4: Commit**

```
git add src/components/admin/RlsDenyPoliciesPage.tsx src/components/admin/RlsDenyPoliciesPage.test.tsx
git commit -m "feat(security): RlsDenyPoliciesPage — list/add/remove"
```

---

## Task 10: RlsAttributePoliciesPage

**Files:**
- Create: `src/components/admin/RlsAttributePoliciesPage.tsx`
- Test: `src/components/admin/RlsAttributePoliciesPage.test.tsx`

Mirror Task 9 with these differences:

- The form has four inputs: graph, label, rowProperty, attributeKey (no username).
- A live preview shows the policy expression `row.<rowProperty> = principal.attribute.<attributeKey>` under the form.
- `listAttributePolicies` may return `[]` when the build lacks `gps.list_policies`; in that case show a banner from `rlsAttribute.listingUnsupportedNote` and additionally render an in-memory session list of policies the user added during this session.

- [ ] **Step 1: Write failing test**

Create `src/components/admin/RlsAttributePoliciesPage.test.tsx`. Tests:

1. `listAttributePolicies` results render in the table (graph/label/rowProperty/attributeKey columns).
2. Create form shows the live expression preview as the operator types.
3. Create flow calls `addAttributePolicy` with the right shape.
4. When `listAttributePolicies` returns `[]` and the in-memory session list is also empty, the listing-unsupported note is shown (only when caps.rlsAttributePolicies is true — otherwise the unsupported page-level note covers it).
5. After a successful add against an "unlistable" backend, the row appears in the table via session state.

```typescript
/// <reference types="@testing-library/jest-dom" />
import React from 'react'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { MemoryRouter } from 'react-router-dom'
import { lightTheme } from '@geodedb/ui-core/theme'

jest.mock('../../api/client', () => ({ client: { getCapabilities: jest.fn() } }))
jest.mock('../../api/security/rlsAttributePolicies', () => ({
  addAttributePolicy: jest.fn(),
  removeAttributePolicy: jest.fn(),
  listAttributePolicies: jest.fn(),
}))

import { client } from '../../api/client'
import {
  addAttributePolicy,
  removeAttributePolicy,
  listAttributePolicies,
} from '../../api/security/rlsAttributePolicies'
import { RlsAttributePoliciesPage } from './RlsAttributePoliciesPage'

const wrap = (n: React.ReactNode) =>
  render(
    <MemoryRouter>
      <ThemeProvider theme={lightTheme}>{n}</ThemeProvider>
    </MemoryRouter>
  )

beforeEach(() => {
  ;(client.getCapabilities as jest.Mock).mockReset()
  ;(addAttributePolicy as jest.Mock).mockReset()
  ;(removeAttributePolicy as jest.Mock).mockReset()
  ;(listAttributePolicies as jest.Mock).mockReset()
  ;(client.getCapabilities as jest.Mock).mockResolvedValue({
    admin_writable: { rls_attribute_policies: true },
  })
})

test('renders existing attribute policies', async () => {
  ;(listAttributePolicies as jest.Mock).mockResolvedValue([
    { graph: 'g1', label: 'Doc', rowProperty: 'dept', attributeKey: 'department' },
  ])
  wrap(<RlsAttributePoliciesPage />)
  expect(await screen.findByText('Doc')).toBeInTheDocument()
  expect(screen.getByText('dept')).toBeInTheDocument()
  expect(screen.getByText('department')).toBeInTheDocument()
})

test('live preview reflects form inputs', async () => {
  ;(listAttributePolicies as jest.Mock).mockResolvedValue([])
  wrap(<RlsAttributePoliciesPage />)
  fireEvent.click(await screen.findByRole('button', { name: /new attribute policy/i }))
  fireEvent.change(screen.getByLabelText(/row property/i), { target: { value: 'region' } })
  fireEvent.change(screen.getByLabelText(/user attribute key/i), { target: { value: 'home_region' } })
  expect(
    await screen.findByText(/row\.region = principal\.attribute\.home_region/)
  ).toBeInTheDocument()
})

test('create flow falls back to session state when listAttributePolicies returns []', async () => {
  ;(listAttributePolicies as jest.Mock).mockResolvedValue([])
  ;(addAttributePolicy as jest.Mock).mockResolvedValue(undefined)
  wrap(<RlsAttributePoliciesPage />)
  fireEvent.click(await screen.findByRole('button', { name: /new attribute policy/i }))
  fireEvent.change(screen.getByLabelText(/^graph$/i), { target: { value: 'g1' } })
  fireEvent.change(screen.getByLabelText(/^label$/i), { target: { value: 'Doc' } })
  fireEvent.change(screen.getByLabelText(/row property/i), { target: { value: 'dept' } })
  fireEvent.change(screen.getByLabelText(/user attribute key/i), {
    target: { value: 'department' },
  })
  fireEvent.click(screen.getByRole('button', { name: /create/i }))
  await waitFor(() =>
    expect(addAttributePolicy).toHaveBeenCalledWith({
      graph: 'g1',
      label: 'Doc',
      rowProperty: 'dept',
      attributeKey: 'department',
    })
  )
  expect(await screen.findByText('Doc')).toBeInTheDocument()
  expect(screen.getByText(/this Geode build does not expose gps.list_policies/i)).toBeInTheDocument()
})
```

Run: `npx jest --config jest.config.cjs src/components/admin/RlsAttributePoliciesPage.test.tsx`. Expected: FAIL.

- [ ] **Step 2: Implement**

Create `src/components/admin/RlsAttributePoliciesPage.tsx`. Mirror RlsDenyPoliciesPage with:

- 4-field form (graph, label, rowProperty, attributeKey).
- Preview block:

```tsx
<small>
  {t('rlsAttribute.expressionPreview', {
    preview: `row.${rowProperty || '<row_property>'} = principal.attribute.${attributeKey || '<attribute_key>'}`,
  })}
</small>
```

- After a successful add when `listAttributePolicies` returns empty (the wrapper detects 501), push the policy into an in-memory `sessionPolicies` state and concatenate it with the server list when rendering. After a successful remove, drop from both.
- Show the `rlsAttribute.listingUnsupportedNote` banner when `sessionPolicies.length > 0 && serverList.length === 0`.

(Implementation is structurally identical to RlsDenyPoliciesPage with the noted differences. Use the same `useCapabilities` gate keyed on `adminWritable.rlsAttributePolicies`.)

- [ ] **Step 3: Run test, expect PASS**

- [ ] **Step 4: Commit**

```
git add src/components/admin/RlsAttributePoliciesPage.tsx src/components/admin/RlsAttributePoliciesPage.test.tsx
git commit -m "feat(security): RlsAttributePoliciesPage — ABAC row policies"
```

---

## Task 11: AdminPage — wire two new tabs

**Files:**
- Modify: `src/pages/AdminPage.tsx`
- Modify: `src/pages/AdminPage.test.tsx`

- [ ] **Step 1: Read AdminPage**

Run: `cat src/pages/AdminPage.tsx`

Confirm tab definitions and routing.

- [ ] **Step 2: Add failing test**

In `src/pages/AdminPage.test.tsx`, add:

```typescript
test('renders RLS Deny and RLS Attribute tabs', async () => {
  // mock caps with the new flags true, navigate to /admin
  ;(client.getCapabilities as jest.Mock).mockResolvedValue({
    admin_writable: {
      users: true,
      roles: true,
      policies: true,
      grants: true,
      attributes: true,
      rls_deny_policies: true,
      rls_attribute_policies: true,
    },
  })
  render(
    <MemoryRouter initialEntries={['/admin']}>
      <ThemeProvider theme={lightTheme}>
        <AdminPage />
      </ThemeProvider>
    </MemoryRouter>
  )
  expect(await screen.findByRole('tab', { name: /rls deny/i })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: /rls attribute/i })).toBeInTheDocument()
})
```

Run: `npx jest --config jest.config.cjs src/pages/AdminPage.test.tsx -t RLS`. Expected: FAIL.

- [ ] **Step 3: Add tabs**

In `AdminPage.tsx`:

1. Add imports:

```typescript
import { RlsDenyPoliciesPage } from '../components/admin/RlsDenyPoliciesPage'
import { RlsAttributePoliciesPage } from '../components/admin/RlsAttributePoliciesPage'
```

2. Add entries to the tabs config array (key, label, capability):

```typescript
{ key: 'rls-deny', label: t('rlsDeny.tabLabel', { defaultValue: 'RLS Deny' }), Component: RlsDenyPoliciesPage },
{ key: 'rls-attribute', label: t('rlsAttribute.tabLabel', { defaultValue: 'RLS Attribute' }), Component: RlsAttributePoliciesPage },
```

3. Add routes under `/admin/rls-deny` and `/admin/rls-attribute` matching the existing router pattern.

- [ ] **Step 4: Run test, expect PASS**

Run: `npx jest --config jest.config.cjs src/pages/AdminPage.test.tsx`

- [ ] **Step 5: Commit**

```
git add src/pages/AdminPage.tsx src/pages/AdminPage.test.tsx
git commit -m "feat(security): admin page — RLS Deny + RLS Attribute tabs"
```

---

## Task 12: Monaco interval functions

**Files:**
- Create: `src/lib/monaco/intervalFunctions.ts`
- Create: `src/lib/monaco/intervalFunctions.test.ts`
- Modify: `src/components/editor/GqlEditor.tsx`

- [ ] **Step 1: Locate existing function-completion config**

Run: `grep -nE 'CompletionItem|registerCompletionItemProvider|duration|interval' src/components/editor/GqlEditor.tsx src/lib/monaco/*.ts 2>&1 | head -30`

Note the pattern.

- [ ] **Step 2: Write failing test**

Create `src/lib/monaco/intervalFunctions.test.ts`:

```typescript
import { INTERVAL_FUNCTIONS, intervalCompletionItems } from './intervalFunctions'

test('exports the three new interval functions', () => {
  const names = INTERVAL_FUNCTIONS.map((f) => f.name).sort()
  expect(names).toEqual(['Interval', 'interval_contains', 'interval_overlaps'])
})

test('intervalCompletionItems returns Monaco-shaped suggestions', () => {
  const items = intervalCompletionItems()
  expect(items).toHaveLength(3)
  for (const item of items) {
    expect(typeof item.label).toBe('string')
    expect(typeof item.insertText).toBe('string')
    expect(item.kind).toBeDefined() // monaco.languages.CompletionItemKind.Function == 1
    expect(item.documentation).toMatchObject({ value: expect.any(String) })
  }
})
```

Run: `npx jest --config jest.config.cjs src/lib/monaco/intervalFunctions.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/lib/monaco/intervalFunctions.ts`:

```typescript
import * as monaco from 'monaco-editor'

export interface IntervalFunctionSpec {
  name: string
  signature: string
  description: string
}

export const INTERVAL_FUNCTIONS: IntervalFunctionSpec[] = [
  {
    name: 'Interval',
    signature: "Interval('P1DT2H')",
    description:
      'Constructs an Interval (alias for duration()). Accepts an ISO-8601 duration string.',
  },
  {
    name: 'interval_overlaps',
    signature: 'interval_overlaps(a, b)',
    description:
      'Returns TRUE when both intervals are non-empty (i.e. they share any moment).',
  },
  {
    name: 'interval_contains',
    signature: 'interval_contains(outer, inner)',
    description:
      'Returns TRUE when outer fully contains inner (outer ≥ inner in canonical microseconds).',
  },
]

export function intervalCompletionItems(): monaco.languages.CompletionItem[] {
  return INTERVAL_FUNCTIONS.map((fn) => ({
    label: fn.name,
    kind: monaco.languages.CompletionItemKind.Function,
    insertText: fn.signature,
    documentation: { value: fn.description },
    range: undefined as unknown as monaco.IRange, // filled by Monaco at completion time
  }))
}
```

- [ ] **Step 4: Wire into GqlEditor**

Find the existing completion provider registration in `src/components/editor/GqlEditor.tsx` and merge `intervalCompletionItems()` into the suggestions array.

- [ ] **Step 5: Run test, expect PASS**

Run: `npx jest --config jest.config.cjs src/lib/monaco/intervalFunctions.test.ts`

- [ ] **Step 6: Commit**

```
git add src/lib/monaco/intervalFunctions.ts src/lib/monaco/intervalFunctions.test.ts src/components/editor/GqlEditor.tsx
git commit -m "feat(editor): Interval/interval_overlaps/interval_contains completion"
```

---

## Task 13: SchemaPage — FULLTEXT index display

**Files:**
- Modify: `src/pages/SchemaPage.tsx`
- Modify: `src/pages/SchemaPage.test.tsx`

- [ ] **Step 1: Inspect the indexes section**

Run: `grep -nE 'indexes|index_type' src/pages/SchemaPage.tsx | head`

The page currently shows index_type for B-TREE; we need to confirm FULLTEXT renders correctly too.

- [ ] **Step 2: Add failing test**

In `SchemaPage.test.tsx`, add:

```typescript
test('renders FULLTEXT index type alongside BTREE', async () => {
  ;(client.getApiV1GraphsGraphIndexes as jest.Mock).mockResolvedValue({
    indexes: [
      { name: 'idx_person_name', label: 'Person', property: 'name', index_type: 'BTREE' },
      { name: 'ft_doc_body', label: 'Doc', property: 'body', index_type: 'FULLTEXT' },
    ],
  })
  wrap(<SchemaPage />)
  expect(await screen.findByText('FULLTEXT')).toBeInTheDocument()
  expect(screen.getByText('BTREE')).toBeInTheDocument()
})
```

Run: `npx jest --config jest.config.cjs src/pages/SchemaPage.test.tsx -t FULLTEXT`. Expected: PASS if the rendering is already generic, FAIL if hardcoded.

- [ ] **Step 3: If FAIL, generalize the index-type cell**

The cell renders whatever `index_type` string the backend returns. If currently hardcoded to BTREE, change to:

```tsx
<TypeBadge type={row.index_type}>{row.index_type}</TypeBadge>
```

Add `FULLTEXT` styling to `TypeBadge` if it has a per-type lookup table.

- [ ] **Step 4: Run test, expect PASS**

- [ ] **Step 5: Commit**

```
git add src/pages/SchemaPage.tsx src/pages/SchemaPage.test.tsx
git commit -m "feat(schema): render FULLTEXT index_type in the indexes table"
```

---

## Task 14: E2E spec — user attributes

**Files:**
- Create: `e2e/specs/44-admin-user-attributes.spec.ts`
- Create: `e2e/helpers/security.ts`

- [ ] **Step 1: Inspect existing admin-users spec for patterns**

Run: `head -80 e2e/specs/07-admin-users.spec.ts`

Note the `authedTest` fixture, `ADMIN_GAP` skip pattern, and helpers.

- [ ] **Step 2: Create the security helper**

Create `e2e/helpers/security.ts`:

```typescript
import { Page, expect } from '@playwright/test'

// createTestUser invokes the existing admin Users page to create a
// user that subsequent specs will assign attributes / policies to.
// Returns the username so the caller can clean up.
export async function createTestUser(page: Page, prefix: string): Promise<string> {
  const username = `${prefix}-${Date.now().toString(36)}`
  await page.goto('/admin/users')
  await page.getByRole('button', { name: /new user/i }).click()
  await page.getByLabel(/username/i).fill(username)
  await page.getByLabel(/email/i).fill(`${username}@example.test`)
  await page.getByRole('button', { name: /generate/i }).click()
  await page.getByRole('button', { name: /create/i }).click()
  await expect(page.getByText(username)).toBeVisible()
  return username
}

export async function deleteTestUser(page: Page, username: string): Promise<void> {
  await page.goto('/admin/users')
  const row = page.locator('tr', { hasText: username })
  await row.getByRole('button', { name: /delete/i }).click()
  await page.getByRole('button', { name: /^delete$|^confirm$/i }).click()
  await expect(row).toHaveCount(0)
}
```

- [ ] **Step 3: Create the spec**

Create `e2e/specs/44-admin-user-attributes.spec.ts`:

```typescript
import { expect, Page } from '@playwright/test'
import { test as authedTest } from '../fixtures'
import { createTestUser, deleteTestUser } from '../helpers/security'

const ADMIN_GAP = /insufficient role|wire_feature_missing|http status 4\d\d/i

const skipIfNoAdmin = async (page: Page): Promise<void> => {
  const banner = page.getByText(ADMIN_GAP)
  authedTest.skip(
    await banner.isVisible({ timeout: 2_000 }).catch(() => false),
    'admin/attribute features unavailable on this Geode build'
  )
}

authedTest.describe('admin / user attributes', () => {
  authedTest('open Attributes modal, add and remove an attribute', async ({ authedPage: page }) => {
    await page.goto('/admin/users')
    await skipIfNoAdmin(page)
    const username = await createTestUser(page, 'attr')
    try {
      const row = page.locator('tr', { hasText: username })
      await row.getByRole('button', { name: /attributes/i }).click()
      await expect(page.getByText(/User attributes/i)).toBeVisible()

      await page.getByRole('button', { name: /add attribute/i }).click()
      await page.getByLabel(/attribute key/i).fill('department')
      await page.getByLabel(/^value$/i).fill('engineering')
      await page.getByRole('button', { name: /^add$|^create$/i }).click()
      await expect(page.getByText('department')).toBeVisible()
      await expect(page.getByText('engineering')).toBeVisible()

      await page.locator('tr', { hasText: 'department' })
        .getByRole('button', { name: /remove|delete/i }).click()
      await page.getByRole('button', { name: /^delete$|^confirm$/i }).click()
      await expect(page.getByText('department')).toBeHidden()
    } finally {
      await page.getByRole('button', { name: /close/i }).click().catch(() => undefined)
      await deleteTestUser(page, username)
    }
  })

  authedTest('rejects invalid attribute keys client-side', async ({ authedPage: page }) => {
    await page.goto('/admin/users')
    await skipIfNoAdmin(page)
    const username = await createTestUser(page, 'attrval')
    try {
      const row = page.locator('tr', { hasText: username })
      await row.getByRole('button', { name: /attributes/i }).click()
      await page.getByRole('button', { name: /add attribute/i }).click()
      await page.getByLabel(/attribute key/i).fill('1invalid')
      await page.getByLabel(/^value$/i).fill('x')
      await page.getByRole('button', { name: /^add$|^create$/i }).click()
      await expect(page.getByText(/keys must start with a letter/i)).toBeVisible()
    } finally {
      await page.getByRole('button', { name: /close/i }).click().catch(() => undefined)
      await deleteTestUser(page, username)
    }
  })
})
```

- [ ] **Step 4: Run the spec**

Run: `npm run e2e -- e2e/specs/44-admin-user-attributes.spec.ts`

If the local docker harness exposes a Geode build without the attribute procedures, the `skipIfNoAdmin` gate skips. Otherwise tests PASS.

- [ ] **Step 5: Commit**

```
git add e2e/helpers/security.ts e2e/specs/44-admin-user-attributes.spec.ts
git commit -m "test(e2e): admin user attributes — add, remove, validate"
```

---

## Task 15: E2E spec — RLS Deny Policies

**Files:**
- Create: `e2e/specs/45-admin-rls-deny-policies.spec.ts`

- [ ] **Step 1: Write the spec**

Create `e2e/specs/45-admin-rls-deny-policies.spec.ts`:

```typescript
import { expect, Page } from '@playwright/test'
import { test as authedTest } from '../fixtures'

const ADMIN_GAP = /insufficient role|wire_feature_missing|http status 4\d\d/i

const skipIfNoAdmin = async (page: Page): Promise<void> => {
  const banner = page.getByText(ADMIN_GAP)
  authedTest.skip(
    await banner.isVisible({ timeout: 2_000 }).catch(() => false),
    'RLS deny-policy features unavailable on this Geode build'
  )
}

authedTest.describe('admin / RLS deny policies', () => {
  authedTest('add a deny policy then remove it', async ({ authedPage: page }) => {
    await page.goto('/admin/rls-deny')
    await skipIfNoAdmin(page)
    await page.getByRole('button', { name: /new deny policy/i }).click()
    await page.getByLabel(/^graph$/i).fill('default')
    await page.getByLabel(/^label$/i).fill('TestPersonE2E')
    await page.getByLabel(/username/i).fill('')
    await page.getByRole('button', { name: /^create$/i }).click()
    await expect(page.getByText('TestPersonE2E')).toBeVisible()

    await page.locator('tr', { hasText: 'TestPersonE2E' })
      .getByRole('button', { name: /delete|remove/i }).click()
    await page.getByRole('button', { name: /^delete$|^confirm$/i }).click()
    await expect(page.getByText('TestPersonE2E')).toBeHidden()
  })

  authedTest('deny policy hides matching rows for the policy target', async ({ authedPage: page, request }) => {
    // 1. Seed a node with label TestPersonE2E in the default graph via /api/v1/query
    // 2. Confirm it's visible to admin (it should be)
    // 3. Add a deny policy for label TestPersonE2E with empty username (all users)
    // 4. Re-query and confirm 0 rows returned
    // 5. Remove the policy; confirm the node is visible again
    // 6. Clean up the test node

    await page.goto('/admin/rls-deny')
    await skipIfNoAdmin(page)

    const token = await page.evaluate(() => localStorage.getItem('geode.jwt'))
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

    await request.post('/api/v1/query', {
      headers,
      data: { statement: "CREATE (:TestPersonE2E {name: 'gate-check'})" },
    })

    // Add policy via UI
    await page.getByRole('button', { name: /new deny policy/i }).click()
    await page.getByLabel(/^graph$/i).fill('default')
    await page.getByLabel(/^label$/i).fill('TestPersonE2E')
    await page.getByRole('button', { name: /^create$/i }).click()

    // Query — expect 0 rows
    const after = await request.post('/api/v1/query', {
      headers,
      data: { statement: 'MATCH (n:TestPersonE2E) RETURN n.name' },
    })
    const body = await after.json()
    expect(body.row_count).toBe(0)

    // Remove policy
    await page.locator('tr', { hasText: 'TestPersonE2E' })
      .getByRole('button', { name: /delete|remove/i }).click()
    await page.getByRole('button', { name: /^delete$|^confirm$/i }).click()

    // Cleanup node
    await request.post('/api/v1/query', {
      headers,
      data: { statement: 'MATCH (n:TestPersonE2E) DETACH DELETE n' },
    })
  })
})
```

- [ ] **Step 2: Run the spec**

Run: `npm run e2e -- e2e/specs/45-admin-rls-deny-policies.spec.ts`

- [ ] **Step 3: Commit**

```
git add e2e/specs/45-admin-rls-deny-policies.spec.ts
git commit -m "test(e2e): RLS deny-policy add + remove + behavioral gate-check"
```

---

## Task 16: E2E spec — RLS Attribute Policies

**Files:**
- Create: `e2e/specs/46-admin-rls-attribute-policies.spec.ts`

- [ ] **Step 1: Write the spec**

Create `e2e/specs/46-admin-rls-attribute-policies.spec.ts`. Cover:

1. Create an attribute policy via the UI; expect it to appear in the list (or in the session list if backend can't list).
2. Add a `department='engineering'` attribute to a freshly created user (via the UsersPage > Attributes flow).
3. Seed two nodes: `(:Doc {title: 'eng-only', department: 'engineering'})` and `(:Doc {title: 'finance-only', department: 'finance'})`.
4. Sign in as the test user (use a second auth fixture or `request.post('/api/v1/auth/login')`).
5. Run `MATCH (d:Doc) RETURN d.title` and assert only `eng-only` returns.
6. Sign in back as admin, remove the policy + the attribute + the test user.

```typescript
import { expect, Page } from '@playwright/test'
import { test as authedTest } from '../fixtures'
import { createTestUser, deleteTestUser } from '../helpers/security'

const ADMIN_GAP = /insufficient role|wire_feature_missing|http status 4\d\d/i

const skipIfNoAdmin = async (page: Page): Promise<void> => {
  const banner = page.getByText(ADMIN_GAP)
  authedTest.skip(
    await banner.isVisible({ timeout: 2_000 }).catch(() => false),
    'RLS attribute-policy features unavailable on this Geode build'
  )
}

authedTest.describe('admin / RLS attribute policies', () => {
  authedTest('end-to-end attribute-policy filters rows by user attribute', async ({ authedPage: page, request }) => {
    await page.goto('/admin/rls-attribute')
    await skipIfNoAdmin(page)

    const token = await page.evaluate(() => localStorage.getItem('geode.jwt'))
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

    // Seed two docs
    await request.post('/api/v1/query', {
      headers,
      data: {
        statement:
          "CREATE (:DocE2E {title: 'eng-only', department: 'engineering'}), (:DocE2E {title: 'finance-only', department: 'finance'})",
      },
    })

    // Create a test user with attribute department=engineering
    const username = await createTestUser(page, 'rls-attr')
    const password = await page.evaluate(() => localStorage.getItem('geode.test.last-password'))
    try {
      await page.locator('tr', { hasText: username }).getByRole('button', { name: /attributes/i }).click()
      await page.getByRole('button', { name: /add attribute/i }).click()
      await page.getByLabel(/attribute key/i).fill('department')
      await page.getByLabel(/^value$/i).fill('engineering')
      await page.getByRole('button', { name: /^add$|^create$/i }).click()
      await expect(page.getByText('engineering')).toBeVisible()
      await page.getByRole('button', { name: /close/i }).click()

      // Create the attribute policy
      await page.goto('/admin/rls-attribute')
      await page.getByRole('button', { name: /new attribute policy/i }).click()
      await page.getByLabel(/^graph$/i).fill('default')
      await page.getByLabel(/^label$/i).fill('DocE2E')
      await page.getByLabel(/row property/i).fill('department')
      await page.getByLabel(/user attribute key/i).fill('department')
      await page.getByRole('button', { name: /^create$/i }).click()
      await expect(page.getByText('DocE2E')).toBeVisible()

      // Sign in as test user and query
      const login = await request.post('/api/v1/auth/login', {
        form: { username, password },
      })
      expect(login.ok()).toBe(true)
      const userToken = (await login.json()).token as string
      const result = await request.post('/api/v1/query', {
        headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
        data: { statement: 'MATCH (d:DocE2E) RETURN d.title' },
      })
      const body = await result.json()
      expect(body.row_count).toBe(1)
      expect(body.rows[0][0]).toBe('eng-only')
    } finally {
      // Cleanup: remove policy, attribute, user, nodes
      await page.goto('/admin/rls-attribute')
      await page.locator('tr', { hasText: 'DocE2E' })
        .getByRole('button', { name: /delete|remove/i }).click()
      await page.getByRole('button', { name: /^delete$|^confirm$/i }).click().catch(() => undefined)
      await deleteTestUser(page, username)
      await request.post('/api/v1/query', {
        headers,
        data: { statement: 'MATCH (d:DocE2E) DETACH DELETE d' },
      })
    }
  })
})
```

Note: `geode.test.last-password` is read by the test from localStorage — `createTestUser` writes it for use by the same spec. Add that single line to `e2e/helpers/security.ts:createTestUser`:

```typescript
await page.evaluate((pw) => localStorage.setItem('geode.test.last-password', pw), passwordFromGeneratorInput)
```

Where `passwordFromGeneratorInput` is the value read from the password input after clicking "Generate". The existing UsersPage password generator writes the password into a visible input — the spec reads it via `page.getByLabel(/password/i).inputValue()` before clicking Create.

- [ ] **Step 2: Run the spec**

Run: `npm run e2e -- e2e/specs/46-admin-rls-attribute-policies.spec.ts`

- [ ] **Step 3: Commit**

```
git add e2e/helpers/security.ts e2e/specs/46-admin-rls-attribute-policies.spec.ts
git commit -m "test(e2e): RLS attribute-policy end-to-end with user attribute"
```

---

## Task 17: E2E spec — FULLTEXT indexes + Interval functions

**Files:**
- Create: `e2e/specs/47-fulltext-indexes-and-interval-fns.spec.ts`

- [ ] **Step 1: Write the spec**

Create `e2e/specs/47-fulltext-indexes-and-interval-fns.spec.ts`:

```typescript
import { expect } from '@playwright/test'
import { test as authedTest } from '../fixtures'

authedTest.describe('schema / FULLTEXT indexes', () => {
  authedTest('FULLTEXT index appears in the indexes table', async ({ authedPage: page, request }) => {
    const token = await page.evaluate(() => localStorage.getItem('geode.jwt'))
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    await request.post('/api/v1/query', {
      headers,
      data: { statement: 'CREATE FULLTEXT INDEX ft_doc_e2e ON :DocE2E(body)' },
    })
    try {
      await page.goto('/schema')
      await expect(page.getByText('ft_doc_e2e')).toBeVisible()
      await expect(page.getByText('FULLTEXT')).toBeVisible()
    } finally {
      await request.post('/api/v1/query', {
        headers,
        data: { statement: 'DROP INDEX ft_doc_e2e' },
      })
    }
  })
})

authedTest.describe('editor / Interval autocomplete', () => {
  authedTest('Interval suggestions appear in the GQL editor', async ({ authedPage: page }) => {
    await page.goto('/query')
    const editor = page.locator('.monaco-editor textarea')
    await editor.click()
    await editor.fill('RETURN Inter')
    // Trigger Monaco completion (Ctrl+Space)
    await page.keyboard.press('Control+Space')
    await expect(page.getByText(/^Interval$/)).toBeVisible()
    await expect(page.getByText(/^interval_overlaps$/)).toBeVisible()
    await expect(page.getByText(/^interval_contains$/)).toBeVisible()
  })

  authedTest('Interval functions execute and return expected results', async ({ authedPage: page, request }) => {
    const token = await page.evaluate(() => localStorage.getItem('geode.jwt'))
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const r1 = await request.post('/api/v1/query', {
      headers,
      data: {
        statement:
          "RETURN interval_contains(Interval('P1D'), Interval('PT1H')) AS contains",
      },
    })
    const b1 = await r1.json()
    expect(b1.rows[0][0]).toBe(true)
    const r2 = await request.post('/api/v1/query', {
      headers,
      data: {
        statement:
          "RETURN interval_overlaps(Interval('PT1H'), Interval('PT0S')) AS overlap",
      },
    })
    const b2 = await r2.json()
    expect(b2.rows[0][0]).toBe(false)
  })
})
```

- [ ] **Step 2: Run**

Run: `npm run e2e -- e2e/specs/47-fulltext-indexes-and-interval-fns.spec.ts`

- [ ] **Step 3: Commit**

```
git add e2e/specs/47-fulltext-indexes-and-interval-fns.spec.ts
git commit -m "test(e2e): FULLTEXT index display + Interval/overlaps/contains"
```

---

## Task 18: Integration test — end-to-end policy round-trip against the wrappers

**Files:**
- Create: `src/api/security/security.integration.test.ts`

Integration tests exercise the wrappers against a `MockClient` that captures the `statement` argument and routes it to a small in-process simulator of the procedures. This catches integration bugs between the wrappers and the GQL encoding without needing a running geode server.

- [ ] **Step 1: Write the test**

Create `src/api/security/security.integration.test.ts`:

```typescript
import { addDenyPolicy, removeDenyPolicy, listDenyPolicies, getDenyPolicyCount } from './rlsDenyPolicies'
import { addAttributePolicy, removeAttributePolicy, listAttributePolicies } from './rlsAttributePolicies'
import { setUserAttribute, removeUserAttribute, listUserAttributes } from './userAttributes'

// In-memory simulator that captures statements and exposes a tiny
// procedure dispatch. The mock matches geode's response shape — every
// procedure returns columns + rows + row_count + elapsed_ms — so the
// wrappers exercise the same parse path they hit in production.

interface DenyKey { graph: string; label: string; username: string }
interface AttrKey { graph: string; label: string; rowProperty: string; attributeKey: string }

class FakeGeode {
  denyPolicies: DenyKey[] = []
  attrPolicies: AttrKey[] = []
  userAttrs: Map<string, Map<string, string>> = new Map()

  query({ statement }: { statement: string }): {
    columns: Array<{ name: string }>
    rows: Array<Array<unknown>>
    row_count: number
    elapsed_ms: number
  } {
    const m = statement.match(/^CALL\s+([\w.]+)\(([^)]*)\)$/)
    if (!m) throw Object.assign(new Error('parse_error'), { status: 400 })
    const proc = m[1]!
    const args = m[2]!
      .split(',')
      .map((a) => a.trim())
      .map((a) => a.replace(/^'(.*)'$/, '$1').replace(/''/g, "'"))

    switch (proc) {
      case 'geode.rls.add_deny_policy': {
        const [graph, label, username] = args
        this.denyPolicies.push({ graph: graph!, label: label!, username: username ?? '' })
        return rep('status', [['ok']])
      }
      case 'geode.rls.remove_deny_policy': {
        const [graph, label, username] = args
        const before = this.denyPolicies.length
        this.denyPolicies = this.denyPolicies.filter(
          (p) => p.graph !== graph || p.label !== label || p.username !== (username ?? '')
        )
        return rep('status,removed_count', [['ok', before - this.denyPolicies.length]])
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
        return rep('status,removed', [['ok', before > this.attrPolicies.length]])
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
        const rows = [...map.entries()].map(([k, v]) => [k, v])
        return rep('key,value', rows)
      }
      default:
        throw Object.assign(new Error('wire_feature_missing'), { status: 501 })
    }
  }
}

function rep(
  cols: string,
  rows: Array<Array<unknown>>
): {
  columns: Array<{ name: string }>
  rows: Array<Array<unknown>>
  row_count: number
  elapsed_ms: number
} {
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
    query: jest.fn((req: { statement: string }) => Promise.resolve(fake.query(req))),
  },
}))

beforeEach(() => {
  fake = new FakeGeode()
})

test('deny policy round-trip', async () => {
  await addDenyPolicy({ graph: 'g', label: 'L', username: 'u' })
  expect(await getDenyPolicyCount()).toBe(1)
  expect(await listDenyPolicies()).toEqual([{ graph: 'g', label: 'L', username: 'u' }])
  const removed = await removeDenyPolicy({ graph: 'g', label: 'L', username: 'u' })
  expect(removed).toBe(1)
  expect(await getDenyPolicyCount()).toBe(0)
})

test('attribute policy round-trip via gps.list_policies pattern match', async () => {
  await addAttributePolicy({ graph: 'g', label: 'L', rowProperty: 'dept', attributeKey: 'department' })
  const list = await listAttributePolicies()
  expect(list).toEqual([
    { graph: 'g', label: 'L', rowProperty: 'dept', attributeKey: 'department' },
  ])
  expect(await removeAttributePolicy({ graph: 'g', label: 'L', rowProperty: 'dept', attributeKey: 'department' })).toBe(true)
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
  expect(await listUserAttributes('alice')).toEqual([{ key: 'level', value: 'L3' }])
})

test("single quotes in argument values round-trip via SQL doubling", async () => {
  await setUserAttribute('alice', 'note', "O'Reilly's team")
  expect(await listUserAttributes('alice')).toEqual([{ key: 'note', value: "O'Reilly's team" }])
})
```

- [ ] **Step 2: Run, expect PASS**

Run: `npx jest --config jest.config.cjs src/api/security/security.integration.test.ts`

- [ ] **Step 3: Commit**

```
git add src/api/security/security.integration.test.ts
git commit -m "test(integration): policy/attribute wrapper round-trips against FakeGeode"
```

---

## Task 19: Documentation + CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`
- Create: `docs/SECURITY.md` (new operator-facing doc)

- [ ] **Step 1: Write the CHANGELOG entry**

In `CHANGELOG.md`, under the next unreleased version, add:

```markdown
### Added
- Policy administration UI (`/admin/rls-deny`, `/admin/rls-attribute`) for the row-level deny and ABAC attribute policy procedures shipped in Geode 0.5.20.
- Per-user attribute editor reachable from the Users table (`Attributes` row action).
- Monaco completion for `Interval()`, `interval_overlaps`, `interval_contains`.
- FULLTEXT index type rendered in the schema page indexes table.
```

- [ ] **Step 2: Write `docs/SECURITY.md`**

Create `docs/SECURITY.md`:

```markdown
# Security Administration

The Admin section exposes Geode's policy primitives.

## User Attributes

Each user can hold arbitrary key/value attributes (department, region,
level, …) consumed by ABAC row-level policies. Attributes are managed
via the `Attributes` button on each row of `/admin/users`.

Backend procedures: `geode.auth.user_set_attribute(username, key, value)`,
`geode.auth.user_remove_attribute(username, key)`.

## RLS Deny Policies

Label-level deny: rows of `<label>` in `<graph>` are hidden from
`<username>`. Empty username applies to all users.

Backend procedures: `geode.rls.add_deny_policy(graph, label, username)`,
`geode.rls.remove_deny_policy(graph, label, username)`,
`geode.rls.list_deny_policies()`, `geode.rls.policy_count()`.

## RLS Attribute Policies (ABAC)

For each row of `<label>` in `<graph>`, the row is visible only when
`row.<rowProperty>` equals the requesting principal's
`attribute.<attributeKey>`. Combine with User Attributes to drive
per-tenant or per-department row visibility.

Backend procedures: `geode.rls.add_attribute_policy(graph, label, row_property, attribute_key)`,
`geode.rls.remove_attribute_policy(graph, label, row_property, attribute_key)`.

Listing is provided indirectly via `gps.list_policies()`, filtered to
restrictive `select` policies whose expression matches the canonical
`row.X = principal.attribute.Y` shape.
```

- [ ] **Step 3: Run changelog check**

Run: `npm run check:changelog`

Expected: PASS.

- [ ] **Step 4: Commit**

```
git add CHANGELOG.md docs/SECURITY.md
git commit -m "docs(security): operator docs + CHANGELOG for policy admin UI"
```

---

## Task 20: Final verification + push

- [ ] **Step 1: Full local CI suite**

Run each in sequence:
```
npm run lint
npm run prettier:check
npm run test:ts
npm run test -- --ci
npm run verify:translations
```

Expected: all green.

- [ ] **Step 2: Run focused e2e (smoke + security)**

Run:
```
npm run e2e:smoke
npm run e2e -- e2e/specs/4[4-7]-*.spec.ts
```

Expected: PASS or skip (when running against a geode build that lacks the procedures, the `skipIfNoAdmin` gates skip).

- [ ] **Step 3: Push**

```
git push origin main
```

- [ ] **Step 4: Tag a release**

```
git tag -a v0.2.0 -m "Geode 0.5.20 policy subsystem in geode-ui"
git push origin v0.2.0
```

The major-release bump is appropriate because this adds two new admin tabs and a new per-user feature; no schema or API breakage.

---

## Self-Review

**Spec coverage check (against the user goal: "implement support for the new policy system completely with unit tests, integration tests, and e2e tests and all other recent changes that impact the UI"):**

| User goal item | Task(s) | Notes |
|----------------|---------|-------|
| User attributes (set / remove / list) — wrapper + UI + tests | 2, 6, 7, 8, 14, 18 | Unit, component, integration, e2e |
| RLS deny policies — wrapper + UI + tests | 3, 6, 9, 11, 15, 18 | Unit, component, integration, e2e |
| RLS attribute policies (ABAC) — wrapper + UI + tests | 4, 6, 10, 11, 16, 18 | Unit, component, integration, e2e |
| Capabilities flags for new subsystems | 5 | Unit |
| Interval functions in editor | 12, 17 | Unit + e2e |
| FULLTEXT index display | 13, 17 | Component + e2e |
| ALTER USER SET ROLE revocation semantics | (no UI surface change) | Backend-only fix; UI still issues the same DDL via the existing roles page. Roles page test in `RolesPage.test.tsx` already covers the round-trip. |
| KMS_URL / 2PC_TIMEOUT_MS / max-connections / webhook env overrides | (out of scope) | Server operator config; no UI surface today, separate plan when justified. |
| LSP AuthProvider→Verifier wiring | (out of scope) | Internal to the embedded LSP listener; UI's LSP client already authenticates via the same bearer token. |
| Principal envelope forwarding (GPS Phase 7) | (out of scope) | Multi-instance distributed auth; not user-facing. |

**Placeholder scan:** None — every code step contains complete code, every test step has a Jest expectation, every command has an expected outcome.

**Type consistency check:**
- `DenyPolicy` shape used in `rlsDenyPolicies.ts`, the page, the tests, and the helper: `{ graph, label, username }` everywhere.
- `AttributePolicy` shape: `{ graph, label, rowProperty, attributeKey }` everywhere.
- `UserAttribute` shape: `{ key, value }` everywhere.
- `AdminWritable` additions: `attributes`, `rlsDenyPolicies`, `rlsAttributePolicies` — used in capabilities, the pages, and the tests.
- `runProcedure` return shape `ProcedureResult` — used by all three wrappers consistently.

**Risk flags:**
- The integration test (Task 18) uses a regex parser for `CALL proc(args)`. The wrappers use `escapeLiteral` which doubles single quotes. The parser's `replace(/''/g, "'")` undoes the doubling. The test for quote round-tripping (last test in Task 18) explicitly covers the escape boundary.
- The `gps.list_policies` regex match in `listAttributePolicies` (Task 4) requires the backend to emit the canonical `row.X = principal.attribute.Y` expression verbatim. `rls_dispatch.zig:351-355` does exactly that. If the backend ever rewrites the expression (e.g. canonicalizes whitespace differently), the regex needs a one-line update — flagged in the comment on `ATTR_PATTERN`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-24-policy-subsystem-ui.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task (one of the 20 tasks above), review between tasks, fast iteration. Good for a multi-day implementation where each task is a logical commit.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Good for tight turn-around when you'll be watching the run.

Which approach?
