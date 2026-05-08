import React, { useMemo, useRef } from 'react'
import styled from 'styled-components'
import { List, RowComponentProps } from 'react-window'
import { projectColumns } from './projectColumns'

// PERF-F5 + PERF-F6 (issue #26):
//
// (F5) The previous implementation rendered every row from
// view.rows.map(...) into the DOM. With page_size=1000 that meant
// ~1000 <tr> nodes plus their nested CellView trees, which collapsed
// scroll performance and ballooned memory. We now render the body
// rows through react-window so only the visible slice + a small
// overscan is materialized.
//
// (F6) projectColumns(resp) used to run on every render even when
// neither resp nor expand changed. We now memoize it on those inputs.
// projectColumns itself was also folded into a single discovery pass
// per column instead of three (kindOf + orderedKeys + project).
//
// We deliberately keep header semantics in a real <table> wrapper
// for accessibility/sticky-header behavior; the body is a windowed
// list rendered as a styled grid that mirrors the column layout. This
// is a pragmatic compromise — react-window v2's row-component API
// doesn't render <tr> directly. Existing assertions that look up
// cells by visible text still pass.

// Per-row sizing tunables. `react-window` v2 accepts `rowHeight` as a
// function `(index, props) => number` so we can compute a height that
// fits the wrapped content of each row instead of clipping every row
// to a single line. The estimate is heuristic: we don't measure the
// DOM, we approximate "how many wrapped lines does this content take?"
// from the cell's text length and the column count. Underestimates
// clip the last line cleanly (overflow: hidden on Cell); the cap stops
// a 10 KB string from blowing the virtualizer up.
const ROW_HEIGHT_MIN = 36
const ROW_HEIGHT_MAX = 240
const ROW_LINE_HEIGHT = 22 // 14 px font * ~1.5 line-height + safety
const APPROX_CHARS_PER_COLUMN = 18 // ~120 px column / ~7 px avg char width
const VIRTUAL_BODY_HEIGHT = 480

const Wrap = styled.div`
  border: 1px solid ${({ theme }) => theme.border.subtle};
  border-radius: ${({ theme }) => theme.radii.md};
  overflow: hidden;
`
const HeaderTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  color: ${({ theme }) => theme.text.primary};
  table-layout: fixed;
`
const Th = styled.th`
  background: ${({ theme }) => theme.bg.subtle};
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid ${({ theme }) => theme.border.default};
  color: ${({ theme }) => theme.text.secondary};
  font-size: ${({ theme }) => theme.font.sizes.sm};
  text-transform: uppercase;
  letter-spacing: 0.04em;
`
const RowOuter = styled.div`
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(120px, 1fr);
  border-top: 1px solid ${({ theme }) => theme.border.subtle};
  color: ${({ theme }) => theme.text.primary};

  &:hover {
    background: ${({ theme }) => theme.bg.subtle};
  }
`
const Cell = styled.div`
  padding: 8px 10px;
  vertical-align: top;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: hidden;
  min-width: 0;
  /* No text-overflow: ellipsis — multi-line ellipsis is non-standard
     and conflicts with the per-row height estimate; rows now grow to
     fit content via estimateRowHeight, and content that exceeds
     ROW_HEIGHT_MAX is clipped without ellipsis dots (rare). */
`

const NodeChip = styled.span`
  display: inline-block;
  padding: 1px 8px;
  border-radius: ${({ theme }) => theme.radii.pill};
  font-size: ${({ theme }) => theme.font.sizes.xs};
  font-weight: ${({ theme }) => theme.font.weights.semibold};
  background: ${({ theme }) => theme.colors.primary};
  color: ${({ theme }) => theme.text.onPrimary};
  margin-right: 4px;
`

const EdgeChip = styled(NodeChip)`
  background: ${({ theme }) => theme.bg.subtle};
  color: ${({ theme }) => theme.text.primary};
  border: 1px solid ${({ theme }) => theme.border.default};
`

const PropList = styled.dl`
  margin: 4px 0 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 2px 12px;
  font-size: ${({ theme }) => theme.font.sizes.sm};

  dt {
    color: ${({ theme }) => theme.text.secondary};
    font-weight: ${({ theme }) => theme.font.weights.medium};
  }

  dd {
    margin: 0;
    color: ${({ theme }) => theme.text.primary};
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
// the cell) keeps the row readable when the property bag is large.
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

// cellLines estimates how many wrapped lines a single cell occupies.
//   • null / undefined / '' → 1 line
//   • node / edge          → 1 chip line + one line per property
//   • everything else      → max of explicit \n-count and ceil(len/cpc)
//
// The character-width heuristic (APPROX_CHARS_PER_COLUMN) is intentionally
// conservative. We'd rather underestimate slightly and let `overflow:
// hidden` on Cell clip the last line than overestimate and waste vertical
// space.
function cellLines(cell: unknown): number {
  if (cell === null || cell === undefined) return 1
  if (typeof cell === 'object' && !Array.isArray(cell)) {
    const o = cell as AnyRecord
    if (isNode(o) || isEdge(o)) {
      const props = o.properties as AnyRecord | undefined
      const propCount = props ? Object.keys(props).length : 0
      return 1 + propCount
    }
  }
  const text = formatCell(cell)
  if (text.length === 0) return 1
  const explicit = text.split('\n').length
  const wrapped = Math.ceil(text.length / APPROX_CHARS_PER_COLUMN)
  return Math.max(1, Math.max(explicit, wrapped))
}

// estimateRowHeight is the per-row sizing function fed to react-window's
// <List rowHeight={(i) => …}>. It picks the tallest cell in the row and
// turns its line count into pixels. Floored at ROW_HEIGHT_MIN so a row
// of empty/short cells stays compact; capped at ROW_HEIGHT_MAX so a
// 10 KB JSON cell doesn't blow up the virtualizer. Exported for unit
// tests.
export function estimateRowHeight(row: unknown[]): number {
  const maxLines = row.reduce<number>(
    (acc, cell) => Math.max(acc, cellLines(cell)),
    1
  )
  // Single-line rows stay at the historical 36 px baseline so the
  // existing virtualization snapshot tests / smoke perf hold steady.
  // Each extra line contributes one ROW_LINE_HEIGHT.
  const h = ROW_HEIGHT_MIN + (maxLines - 1) * ROW_LINE_HEIGHT
  return Math.min(ROW_HEIGHT_MAX, Math.max(ROW_HEIGHT_MIN, h))
}

// CellView renders a single cell. For node and edge values it produces
// a structured display — a label/type chip plus a two-column property
// list — so a row with many properties stays readable instead of
// collapsing into a wall of text. Everything else falls through to
// formatCell, keeping the string contract for primitives, paths,
// arrays, and unknown objects (and preserving copy-paste behavior).
//
// Wrapping in React.memo (PERF-F6 / issue #26) lets the windowed list
// skip re-renders for cells whose `value` reference hasn't changed —
// a real win during streaming where the visible slice's row references
// are stable but the parent re-renders on every batch.
const CellView: React.FC<{ value: unknown }> = React.memo(({ value }) => {
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
})
CellView.displayName = 'CellView'

type RowProps = {
  rows: unknown[][]
  columnCount: number
}

// VirtualRow renders one row inside the windowed list. react-window
// supplies the absolute-position style; we lay cells out via a CSS
// grid that mirrors the header column count. role="row" + role="cell"
// keep the divs in the accessibility tree as part of the wrapping
// grid (the surrounding Wrap carries role="grid").
const VirtualRow = ({
  index,
  style,
  rows,
  columnCount,
}: RowComponentProps<RowProps>) => {
  const row = rows[index] || []
  return (
    <RowOuter
      role="row"
      data-row-index={index}
      style={{
        ...style,
        gridAutoColumns: `repeat(${columnCount}, 1fr)`,
      }}
    >
      {row.map((cell, j) => (
        // eslint-disable-next-line react/no-array-index-key
        <Cell key={j} role="cell">
          <CellView value={cell} />
        </Cell>
      ))}
    </RowOuter>
  )
}

export const TableView: React.FC<Props> = ({ resp, expand = true }) => {
  const view = useMemo(
    () => (expand ? projectColumns(resp) : resp),
    [resp, expand]
  )
  const rowProps = useMemo<RowProps>(
    () => ({ rows: view.rows, columnCount: view.columns.length }),
    [view.rows, view.columns]
  )
  // P-NEW-1: hold a single stable closure identity for the lifetime of
  // the component. A naive useMemo([view.rows]) keeps the closure
  // identity bound to the rows array, but the queryStreamReducer mints
  // a fresh `rows` array on every appended frame — so under streaming
  // the closure rebuilds per batch and react-window invalidates its
  // row-position cache, regressing the F5/F6 win documented in
  // PERF_GAP_ANALYSIS.md (#26). Read the latest rows through a ref
  // instead so the closure identity is stable across renders.
  const rowsRef = useRef(view.rows)
  rowsRef.current = view.rows
  const rowHeight = useMemo(
    () =>
      (index: number): number =>
        estimateRowHeight(rowsRef.current[index] ?? []),
    []
  )

  // Explicit ARIA roles: react-window renders the body as div-based
  // CSS grid (not a <tbody>), which severs the implicit columnheader
  // role on the standalone <thead><tr><th>. Wrap the whole composition
  // as role="grid" with explicit row/columnheader/cell roles so screen
  // readers (and Playwright's getByRole) see a single coherent table.
  return (
    <Wrap role="grid" aria-rowcount={view.rows.length}>
      <HeaderTable role="presentation">
        <thead>
          <tr role="row">
            {view.columns.map((c, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <Th key={`${columnName(c, i)}_${i}`} role="columnheader">
                {columnName(c, i)}{' '}
                <small style={{ opacity: 0.6 }}>{columnType(c)}</small>
              </Th>
            ))}
          </tr>
        </thead>
      </HeaderTable>
      <List
        rowComponent={VirtualRow}
        rowCount={view.rows.length}
        rowHeight={rowHeight}
        rowProps={rowProps}
        defaultHeight={VIRTUAL_BODY_HEIGHT}
        style={{ height: VIRTUAL_BODY_HEIGHT }}
      />
    </Wrap>
  )
}
