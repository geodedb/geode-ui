import type { ElementDefinition } from 'cytoscape'
import type { EdgeBinding, NodeBinding, ParsedMatch } from '../matchPattern'

// pushSynthesisedRows synthesises Cytoscape nodes + edges entirely
// from the parsed MATCH pattern and the result rows, used when the
// server returned NO NODE or EDGE columns (a fully scalar RETURN
// list) so the orchestrator has nothing real to render. The MATCH
// pattern gives us:
//
//   - node bindings: variable name + GQL label (e.g. `p` → 'Person')
//   - edge bindings: from-var, to-var, edge type/varName
//
// Each row's column projection is keyed by (varName, identityValue)
// so the same Person aggregates across rows. Synthetic edges are
// minted per (row, edgeBinding) because the same edge can repeat
// with different properties across rows (e.g. one ACTED_IN per role).
//
// `out` is mutated; the helper is a write-through into the
// orchestrator's element list, mirroring the previous in-line
// behaviour.
export function pushSynthesisedRows(
  out: ElementDefinition[],
  parsed: ParsedMatch,
  rows: unknown[][]
): void {
  if (parsed.nodes.size === 0 && parsed.edges.length === 0) return
  type ColBind = { varName: string; field: string }
  const colBindings: (ColBind | null)[] = parsed.returnColumns.map((rc) => {
    if (rc.varName && rc.field) return { varName: rc.varName, field: rc.field }
    return null
  })

  type SyntheticNode = {
    nodeId: string
    binding: NodeBinding
    props: Record<string, unknown>
    label: string
  }
  const synthNodes = new Map<string, SyntheticNode>()
  const rowVarToNodeId: Map<string, string>[] = []
  rows.forEach((row) => {
    const varProps = new Map<string, Record<string, unknown>>()
    row.forEach((value, idx) => {
      const cb = colBindings[idx]
      if (!cb) return
      let entry = varProps.get(cb.varName)
      if (!entry) {
        entry = {}
        varProps.set(cb.varName, entry)
      }
      entry[cb.field] = value
    })
    const thisRow = new Map<string, string>()
    parsed.nodes.forEach((binding, varName) => {
      const props = varProps.get(varName)
      if (!props) return
      const identity = identityValue(props)
      if (identity === null) return
      const nodeId = `${varName}:${identity}`
      thisRow.set(varName, nodeId)
      const existing = synthNodes.get(nodeId)
      if (existing) {
        Object.entries(props).forEach(([k, v]) => {
          if (existing.props[k] === undefined) existing.props[k] = v
        })
      } else {
        const labelChoice = chooseLabelText(binding, props)
        synthNodes.set(nodeId, {
          nodeId,
          binding,
          props: { ...props },
          label: labelChoice,
        })
      }
    })
    rowVarToNodeId.push(thisRow)
  })

  synthNodes.forEach((sn) => {
    const labels = sn.binding.label ? [sn.binding.label] : []
    out.push({
      group: 'nodes',
      data: {
        id: sn.nodeId,
        label: sn.label,
        labels,
        // Synthesised nodes get a stable nodeType from the MATCH-bound
        // label when available; otherwise the row-derived display
        // label is the best identity we have. Keeps the color seed
        // immutable across applyLabels mutations (see pushRealNodes
        // for the rationale).
        nodeType: sn.binding.label ?? sn.label,
        props: sn.props,
        synthesised: true,
      },
    })
  })

  rows.forEach((row, rowIdx) => {
    const thisRow = rowVarToNodeId[rowIdx]
    if (!thisRow) return
    const varProps = new Map<string, Record<string, unknown>>()
    row.forEach((value, idx) => {
      const cb = colBindings[idx]
      if (!cb) return
      let entry = varProps.get(cb.varName)
      if (!entry) {
        entry = {}
        varProps.set(cb.varName, entry)
      }
      entry[cb.field] = value
    })
    parsed.edges.forEach((eb, eIdx) => {
      const fromId = thisRow.get(eb.fromVar)
      const toId = thisRow.get(eb.toVar)
      if (!fromId || !toId) return
      const props = (eb.varName && varProps.get(eb.varName)) || {}
      const labelText = chooseEdgeLabel(eb, props)
      out.push({
        group: 'edges',
        data: {
          id: `synth-r${rowIdx}-${eIdx}`,
          source: fromId,
          target: toId,
          type: eb.type ?? 'REL',
          label: labelText,
          // edgeType color-seed mirrors pushRealEdges.
          edgeType: eb.type ?? 'REL',
          props,
          synthesised: true,
        },
      })
    })
  })
}

function identityValue(props: Record<string, unknown>): string | null {
  const keys = Object.keys(props).sort()
  if (keys.length === 0) return null
  const idKey = keys.find((k) => /^id$/i.test(k)) ?? keys[0]
  if (idKey === undefined) return null
  const v = props[idKey]
  if (v === null || v === undefined) return null
  return String(v)
}

function chooseLabelText(
  binding: NodeBinding,
  props: Record<string, unknown>
): string {
  const named = props.name ?? props.title ?? props.id
  if (named !== undefined && named !== null && named !== '') {
    return String(named)
  }
  const keys = Object.keys(props).sort()
  const found = keys
    .map((k) => props[k])
    .find((v) => v !== undefined && v !== null && v !== '')
  if (found !== undefined) return String(found)
  return binding.label || binding.varName
}

function chooseEdgeLabel(
  binding: EdgeBinding,
  props: Record<string, unknown>
): string {
  const keys = Object.keys(props)
  if (keys.length === 1) {
    const v = props[keys[0]!]
    if (v !== undefined && v !== null && v !== '') return String(v)
  }
  return binding.type ?? 'REL'
}
