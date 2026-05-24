import { runProcedure, asString, asNumber } from './queryRunner'

// RLS deny-policy wrappers (Geode 0.5.20). Backend procedures live in
// geode/src/execution/rls_dispatch.zig (lines 89-298):
//   geode.rls.add_deny_policy(graph, label, username)
//   geode.rls.remove_deny_policy(graph, label, username)  -> {status, removed_count}
//   geode.rls.list_deny_policies()                        -> rows of {graph, label, username}
//   geode.rls.policy_count()                              -> {count}
//
// An empty `username` applies the deny policy to all users — matches
// the upstream contract (see rls_dispatch.zig line 168).

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
  await runProcedure('geode.rls.add_deny_policy', [
    p.graph,
    p.label,
    p.username ?? '',
  ])
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
