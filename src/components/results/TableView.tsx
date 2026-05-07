import React from 'react'
import styled from 'styled-components'

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
  white-space: nowrap;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
`

type Props = {
  resp: {
    columns: Array<Record<string, unknown>>
    rows: Array<Array<unknown>>
  }
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

function summarizeProps(props: AnyRecord, max = 2): string {
  const keys = Object.keys(props).slice(0, max)
  if (keys.length === 0) return ''
  const pairs = keys.map((k) => {
    const v = props[k]
    const repr = typeof v === 'string' ? `'${v}'` : String(v)
    return `${k}: ${repr}`
  })
  const more = Object.keys(props).length > max ? ', …' : ''
  return ` {${pairs.join(', ')}${more}}`
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

export const TableView: React.FC<Props> = ({ resp }) => (
  <Wrap>
    <Table>
      <thead>
        <tr>
          {resp.columns.map((c, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <Th key={`${columnName(c, i)}_${i}`}>
              {columnName(c, i)}{' '}
              <small style={{ opacity: 0.6 }}>{columnType(c)}</small>
            </Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {resp.rows.map((row, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <tr key={i}>
            {row.map((cell, j) => (
              // eslint-disable-next-line react/no-array-index-key
              <Td key={j}>{formatCell(cell)}</Td>
            ))}
          </tr>
        ))}
      </tbody>
    </Table>
  </Wrap>
)
