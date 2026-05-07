import React from 'react'
import styled from 'styled-components'
import { projectColumns } from './projectColumns'

const Wrap = styled.div`
  overflow: auto;
  max-height: 480px;
  border: 1px solid ${({ theme }) => theme.colors.border};
`
const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  color: ${({ theme }) => theme.colors.text};
`
const Th = styled.th`
  position: sticky;
  top: 0;
  background: ${({ theme }) => theme.colors.surface};
  text-align: left;
  padding: 6px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`
const Td = styled.td`
  padding: 6px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  vertical-align: top;
  white-space: pre-wrap;
  word-break: break-word;
  max-width: 640px;
`

const NodeChip = styled.span`
  display: inline-block;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 0.78rem;
  font-weight: 600;
  background: ${({ theme }) => theme.colors.primary};
  color: #fff;
  margin-right: 4px;
`

const EdgeChip = styled(NodeChip)`
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.text};
  border: 1px solid ${({ theme }) => theme.colors.border};
`

const PropList = styled.dl`
  margin: 4px 0 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 2px 12px;
  font-size: 0.85rem;

  dt {
    color: ${({ theme }) => theme.colors.textSecondary};
    font-weight: 500;
  }

  dd {
    margin: 0;
    color: ${({ theme }) => theme.colors.text};
    word-break: break-word;
  }
`

type Props = {
  resp: {
    columns: Array<Record<string, unknown>>
    rows: Array<Array<unknown>>
  }
  // expand: when true (default), project node/edge columns into one
  // column per property. When false, render the existing chip + dl
  // structured cell — useful when the operator wants the raw graph
  // shape rather than a flattened table.
  expand?: boolean
}

function columnName(col: Record<string, unknown>, i: number): string {
  const name = col.name
  return typeof name === 'string' && name.length > 0 ? name : `col_${i}`
}

function columnType(col: Record<string, unknown>): string {
  const t = col.type
  return typeof t === 'string' ? t : ''
}

// Graph result types come back as plain JSON objects with the canonical
// {id, labels, properties} (node), {id, start_node, end_node, type,
// properties} (edge), or {nodes[], edges[]} (path) shape — see
// gen/types/types.gen.go and the geode-client-go conversion in
// rows.go:118-138. We render them in a Cypher-like notation so the
// table is readable, falling back to JSON for any other object.
type AnyRecord = Record<string, unknown>

function isNode(o: AnyRecord): boolean {
  return (
    typeof o.id !== 'undefined' &&
    Array.isArray(o.labels) &&
    typeof o.properties === 'object' &&
    o.properties !== null &&
    typeof (o as AnyRecord).start_node === 'undefined'
  )
}
function isEdge(o: AnyRecord): boolean {
  return (
    typeof o.id !== 'undefined' &&
    typeof o.start_node !== 'undefined' &&
    typeof o.end_node !== 'undefined' &&
    typeof o.type === 'string'
  )
}
function isPath(o: AnyRecord): boolean {
  return Array.isArray(o.nodes) && Array.isArray(o.edges)
}

// formatPropValue renders a single property value in the cypher-style
// summary. Strings are single-quoted (so 'Alice' vs Alice numeric is
// unambiguous); arrays/objects fall through to JSON.stringify so the
// representation stays compact but lossless. Nullish reads as the
// literal "null" / "undefined" — same convention as Cypher's text
// rendering of those values.
function formatPropValue(v: unknown): string {
  if (v === null) return 'null'
  if (v === undefined) return 'undefined'
  if (typeof v === 'string') return `'${v}'`
  if (Array.isArray(v) || (typeof v === 'object' && v !== null)) {
    return JSON.stringify(v)
  }
  return String(v)
}

// summarizeProps renders ALL keys of a node/edge property bag in a
// cypher-like " {k: v, ...}" form. We deliberately do NOT truncate —
// the previous "first 2 props + …" form was unhelpful for admin views
// where the interesting fields (username, email, roles) routinely
// landed past the cap. Cell-level wrapping (white-space: pre-wrap on
// Td) keeps the row readable when the property bag is large.
function summarizeProps(props: AnyRecord): string {
  const keys = Object.keys(props)
  if (keys.length === 0) return ''
  const pairs = keys.map((k) => `${k}: ${formatPropValue(props[k])}`)
  return ` {${pairs.join(', ')}}`
}

function formatNode(o: AnyRecord): string {
  const labels = (o.labels as string[]).map((l) => `:${l}`).join('')
  return `(${labels}${summarizeProps(o.properties as AnyRecord)})`
}
function formatEdge(o: AnyRecord): string {
  return `[:${o.type as string}${summarizeProps(o.properties as AnyRecord)}]`
}
function formatPath(o: AnyRecord): string {
  const n = (o.nodes as unknown[]).length
  const e = (o.edges as unknown[]).length
  return `<path: ${n} nodes, ${e} edges>`
}

export function formatCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return JSON.stringify(v)
  if (typeof v === 'object') {
    const o = v as AnyRecord
    if (isNode(o)) return formatNode(o)
    if (isEdge(o)) return formatEdge(o)
    if (isPath(o)) return formatPath(o)
    return JSON.stringify(o)
  }
  return String(v)
}

// CellView renders a single cell. For node and edge values it produces
// a structured display — a label/type chip plus a two-column property
// list — so a row with many properties stays readable instead of
// collapsing into a wall of text. Everything else falls through to
// formatCell, keeping the string contract for primitives, paths,
// arrays, and unknown objects (and preserving copy-paste behavior).
const CellView: React.FC<{ value: unknown }> = ({ value }) => {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as AnyRecord
    if (isNode(o)) {
      return (
        <div>
          <div>
            {(o.labels as string[]).map((l) => (
              <NodeChip key={l}>:{l}</NodeChip>
            ))}
          </div>
          <PropList>
            {Object.entries(o.properties as AnyRecord).map(([k, v2]) => (
              <React.Fragment key={k}>
                <dt>{k}</dt>
                <dd>{formatPropValue(v2)}</dd>
              </React.Fragment>
            ))}
          </PropList>
        </div>
      )
    }
    if (isEdge(o)) {
      return (
        <div>
          <div>
            <EdgeChip>:{o.type as string}</EdgeChip>
          </div>
          <PropList>
            {Object.entries(o.properties as AnyRecord).map(([k, v2]) => (
              <React.Fragment key={k}>
                <dt>{k}</dt>
                <dd>{formatPropValue(v2)}</dd>
              </React.Fragment>
            ))}
          </PropList>
        </div>
      )
    }
  }
  return <>{formatCell(value)}</>
}

export const TableView: React.FC<Props> = ({ resp, expand = true }) => {
  const view = expand ? projectColumns(resp) : resp
  return (
    <Wrap>
      <Table>
        <thead>
          <tr>
            {view.columns.map((c, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <Th key={`${columnName(c, i)}_${i}`}>
                {columnName(c, i)}{' '}
                <small style={{ opacity: 0.6 }}>{columnType(c)}</small>
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <tr key={i}>
              {row.map((cell, j) => (
                // eslint-disable-next-line react/no-array-index-key
                <Td key={j}>
                  <CellView value={cell} />
                </Td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </Wrap>
  )
}
