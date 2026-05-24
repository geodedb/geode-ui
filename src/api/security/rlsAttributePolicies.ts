import { runProcedure, asString } from './queryRunner'

// ABAC attribute-policy wrappers (Geode 0.5.20). Backend procedures
// live in geode/src/execution/rls_dispatch.zig (lines 300-479):
//   geode.rls.add_attribute_policy(graph, label, row_property, attribute_key)
//   geode.rls.remove_attribute_policy(graph, label, row_property, attribute_key)
//
// There is no list_attribute_policies procedure; we query the
// generic gps.list_policies and filter to the canonical attribute-
// policy shape emitted by add_attribute_policy:
//   row.<row_property> = principal.attribute.<attribute_key>
// (rls_dispatch.zig:351-355).

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

export async function addAttributePolicy(
  p: AttributePolicyInput
): Promise<void> {
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

export async function removeAttributePolicy(
  p: AttributePolicyInput
): Promise<boolean> {
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

// Pattern matching the canonical expression emitted by
// add_attribute_policy (rls_dispatch.zig:351-355). Backend changes
// to that canonical form require a one-line update here.
const ATTR_PATTERN =
  /^row\.([A-Za-z_][\w]*)\s*=\s*principal\.attribute\.([A-Za-z_][\w]*)$/

export async function listAttributePolicies(): Promise<AttributePolicy[]> {
  try {
    const r = await runProcedure('gps.list_policies', [])
    return r.rows
      .map((row) => {
        const expr = asString(row.expression)
        const graph = asString(row.graph)
        const label = asString(row.label)
        const op = asString(row.operation)
        const permissive = row.permissive
        if (
          !expr ||
          !graph ||
          !label ||
          op !== 'select' ||
          permissive !== false
        ) {
          return null
        }
        const m = expr.match(ATTR_PATTERN)
        if (!m) return null
        return {
          graph,
          label,
          rowProperty: m[1]!,
          attributeKey: m[2]!,
        } as AttributePolicy
      })
      .filter((p): p is AttributePolicy => p !== null)
  } catch (err) {
    const e = err as { status?: number }
    if (e?.status === 501) return []
    throw err
  }
}
